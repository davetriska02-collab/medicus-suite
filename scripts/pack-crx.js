#!/usr/bin/env node
'use strict';

/**
 * Pack Medicus Suite as a Chrome / Edge CRX3 and/or the GitHub release zip.
 *
 * CRX3 is the format Chrome 64+ and managed Edge expect. The extension id is
 * the first 16 bytes of SHA-256(SPKI public key), mapped onto a–p. Signing
 * with the same RSA key keeps that id stable across every CRX we issue, and
 * is the key Dave uploads to the Chrome Web Store so the store listing keeps
 * the same id.
 *
 * Key sources (first match wins):
 *   1. --key <path>
 *   2. CRX_PRIVATE_KEY env (PEM text, or a path to a PEM)
 *   3. packaging/extension.pem (local, gitignored)
 *
 * Usage:
 *   node scripts/pack-crx.js --zip
 *   node scripts/pack-crx.js --crx
 *   node scripts/pack-crx.js --zip --crx
 *   node scripts/pack-crx.js --print-id
 *   node scripts/pack-crx.js --generate-key
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PACKAGING_DIR = path.join(ROOT, 'packaging');
const DEFAULT_PEM = path.join(PACKAGING_DIR, 'extension.pem');
const PUB_PEM = path.join(PACKAGING_DIR, 'extension.pub.pem');
const ID_FILE = path.join(PACKAGING_DIR, 'extension-id.txt');

// Keep in lock-step with historical release.yml excludes so the unpacked zip
// stays the same shape clinicians already install. Extra rows are packaging
// artefacts that must never ship inside the extension.
const PACK_EXCLUDES = [
  '.git/',
  '.github/',
  '.gitignore',
  'README.md',
  'LICENSE',
  '_build/',
  'test-*.js',
  'scripts/',
  '.claude/',
  '*.zip',
  '*.crx',
  '*.pem',
  '.DS_Store',
  'package.json',
  'package-lock.json',
  'node_modules/',
  'eslint.config.mjs',
  '.prettierrc.json',
  '.prettierignore',
  '.githooks/',
  'brand/generate-icons.mjs',
  'packaging/',
];

const CRX3_MAGIC = Buffer.from('Cr24');
const CRX3_VERSION = 3;
const SIGNED_PREFIX = Buffer.from('CRX3 SignedData\x00');

function encodeVarint(n) {
  const bytes = [];
  let value = n >>> 0;
  while (value > 0x7f) {
    bytes.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  bytes.push(value);
  return Buffer.from(bytes);
}

function encodeLengthDelimited(fieldNumber, data) {
  const tag = encodeVarint((fieldNumber << 3) | 2);
  const len = encodeVarint(data.length);
  return Buffer.concat([tag, len, Buffer.from(data)]);
}

function encodeSignedData(crxId) {
  return encodeLengthDelimited(1, crxId);
}

function encodeAsymmetricKeyProof(publicKeyDer, signature) {
  return Buffer.concat([encodeLengthDelimited(1, publicKeyDer), encodeLengthDelimited(2, signature)]);
}

function encodeCrxFileHeader(proof, signedHeaderData) {
  return Buffer.concat([encodeLengthDelimited(2, proof), encodeLengthDelimited(10000, signedHeaderData)]);
}

function crxIdFromPublicKeyDer(publicKeyDer) {
  return crypto.createHash('sha256').update(publicKeyDer).digest().subarray(0, 16);
}

function extensionIdFromCrxId(crxId) {
  let id = '';
  for (const byte of crxId) {
    id += String.fromCharCode(97 + (byte >> 4));
    id += String.fromCharCode(97 + (byte & 0xf));
  }
  return id;
}

function extensionIdFromPublicKeyDer(publicKeyDer) {
  return extensionIdFromCrxId(crxIdFromPublicKeyDer(publicKeyDer));
}

function publicKeyDerFromPrivatePem(pem) {
  const privateKey = crypto.createPrivateKey(pem);
  return crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
}

function publicKeyPemFromDer(der) {
  const b64 = Buffer.from(der).toString('base64');
  const lines = b64.match(/.{1,64}/g) || [];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----\n`;
}

function generatePrivateKeyPem() {
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });
  return privateKey;
}

function readFileIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

function resolvePrivateKeyPem(opts = {}) {
  if (opts.keyPath) {
    return fs.readFileSync(opts.keyPath, 'utf8');
  }
  const fromEnv = process.env.CRX_PRIVATE_KEY;
  if (fromEnv && fromEnv.trim()) {
    const trimmed = fromEnv.trim();
    if (trimmed.includes('BEGIN') && trimmed.includes('PRIVATE KEY')) return trimmed + '\n';
    if (fs.existsSync(trimmed)) return fs.readFileSync(trimmed, 'utf8');
    throw new Error('CRX_PRIVATE_KEY is set but is neither a PEM nor a readable path');
  }
  const local = readFileIfExists(opts.pemPath || DEFAULT_PEM);
  if (local) return local;
  return null;
}

function parseArgs(argv) {
  const opts = {
    zip: false,
    crx: false,
    printId: false,
    generateKey: false,
    allowMissingKey: false,
    keyPath: null,
    outDir: path.join(ROOT, '_build'),
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--zip') opts.zip = true;
    else if (arg === '--crx') opts.crx = true;
    else if (arg === '--print-id') opts.printId = true;
    else if (arg === '--generate-key') opts.generateKey = true;
    else if (arg === '--allow-missing-key') opts.allowMissingKey = true;
    else if (arg === '--key') opts.keyPath = argv[++i];
    else if (arg === '--out-dir') opts.outDir = path.resolve(argv[++i]);
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return opts;
}

function readManifestVersion() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  if (!manifest.version) throw new Error('manifest.json has no version');
  return manifest.version;
}

function run(cmd, args, cwd) {
  const result = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(`${cmd} ${args.join(' ')} failed (${result.status}): ${detail}`);
  }
  return result;
}

function globToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function shouldExclude(relPosix) {
  const parts = relPosix.split('/').filter(Boolean);
  const base = parts[parts.length - 1] || '';
  for (const pattern of PACK_EXCLUDES) {
    if (pattern.endsWith('/')) {
      const dir = pattern.slice(0, -1);
      if (parts[0] === dir || parts.includes(dir)) return true;
    } else if (pattern.includes('*')) {
      const re = globToRegExp(pattern);
      if (re.test(base) || re.test(relPosix)) return true;
    } else if (pattern.includes('/')) {
      if (relPosix === pattern || relPosix.startsWith(`${pattern}/`)) return true;
    } else if (base === pattern || relPosix === pattern) {
      return true;
    }
  }
  return false;
}

function stageExtension(destDir) {
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });

  function walk(absDir, relPosix) {
    for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
      const childRel = relPosix ? `${relPosix}/${entry.name}` : entry.name;
      if (shouldExclude(childRel)) continue;
      const from = path.join(absDir, entry.name);
      const to = path.join(destDir, childRel);
      if (entry.isDirectory()) {
        fs.mkdirSync(to, { recursive: true });
        walk(from, childRel);
      } else if (entry.isFile()) {
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(from, to);
      }
    }
  }

  walk(ROOT, '');
  if (!fs.existsSync(path.join(destDir, 'manifest.json'))) {
    throw new Error('staged extension is missing manifest.json');
  }
}

function zipDirectoryContents(sourceDir, zipPath) {
  fs.rmSync(zipPath, { force: true });
  run('zip', ['-qr', zipPath, '.'], sourceDir);
}

function zipFolder(parentDir, folderName, zipPath) {
  fs.rmSync(zipPath, { force: true });
  run('zip', ['-qr', zipPath, folderName], parentDir);
}

function buildCrx3(zipBuffer, privateKeyPem) {
  const publicKeyDer = publicKeyDerFromPrivatePem(privateKeyPem);
  const crxId = crxIdFromPublicKeyDer(publicKeyDer);
  const signedHeaderData = encodeSignedData(crxId);
  const lengthBuf = Buffer.alloc(4);
  lengthBuf.writeUInt32LE(signedHeaderData.length, 0);
  const toSign = Buffer.concat([SIGNED_PREFIX, lengthBuf, signedHeaderData, zipBuffer]);
  const sign = crypto.createSign('SHA256');
  sign.update(toSign);
  sign.end();
  const signature = sign.sign(crypto.createPrivateKey(privateKeyPem));
  const proof = encodeAsymmetricKeyProof(publicKeyDer, signature);
  const header = encodeCrxFileHeader(proof, signedHeaderData);
  const headerSize = Buffer.alloc(4);
  headerSize.writeUInt32LE(header.length, 0);
  const version = Buffer.alloc(4);
  version.writeUInt32LE(CRX3_VERSION, 0);
  return {
    crx: Buffer.concat([CRX3_MAGIC, version, headerSize, header, zipBuffer]),
    extensionId: extensionIdFromCrxId(crxId),
    publicKeyDer,
  };
}

function parseCrx3(buf) {
  if (buf.length < 12) throw new Error('CRX too short');
  if (!buf.subarray(0, 4).equals(CRX3_MAGIC)) throw new Error('not a CRX3 (missing Cr24 magic)');
  const version = buf.readUInt32LE(4);
  if (version !== CRX3_VERSION) throw new Error(`unsupported CRX version ${version}`);
  const headerSize = buf.readUInt32LE(8);
  const headerStart = 12;
  const zipStart = headerStart + headerSize;
  if (zipStart > buf.length) throw new Error('CRX header overruns file');
  return {
    version,
    header: buf.subarray(headerStart, zipStart),
    zip: buf.subarray(zipStart),
  };
}

function committedExtensionId() {
  const raw = readFileIfExists(ID_FILE);
  return raw ? raw.trim() : null;
}

function committedPublicKeyPem() {
  return readFileIfExists(PUB_PEM);
}

function assertKeyMatchesCommitted(publicKeyDer) {
  const id = extensionIdFromPublicKeyDer(publicKeyDer);
  const expectedId = committedExtensionId();
  if (expectedId && expectedId !== id) {
    throw new Error(
      `private key produces id ${id} but ${path.relative(ROOT, ID_FILE)} pins ${expectedId}. ` +
        'Refusing to mint a different identifier.'
    );
  }
  const expectedPub = committedPublicKeyPem();
  if (expectedPub) {
    const actualPub = publicKeyPemFromDer(publicKeyDer);
    if (normalisePem(expectedPub) !== normalisePem(actualPub)) {
      throw new Error(
        `private key does not match ${path.relative(ROOT, PUB_PEM)}. ` + 'Refusing to sign with a different key.'
      );
    }
  }
  return id;
}

function normalisePem(pem) {
  return pem.replace(/\r\n/g, '\n').trim() + '\n';
}

function writeKeyPairFiles(privateKeyPem, destPem) {
  fs.mkdirSync(path.dirname(destPem), { recursive: true });
  fs.writeFileSync(destPem, privateKeyPem, { mode: 0o600 });
  const publicKeyDer = publicKeyDerFromPrivatePem(privateKeyPem);
  const id = extensionIdFromPublicKeyDer(publicKeyDer);
  fs.writeFileSync(PUB_PEM, publicKeyPemFromDer(publicKeyDer));
  fs.writeFileSync(ID_FILE, `${id}\n`);
  return { id, publicKeyDer };
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function pack(opts) {
  const version = readManifestVersion();
  const outDir = opts.outDir;
  fs.mkdirSync(outDir, { recursive: true });
  const folderName = `medicus-suite-v${version}`;
  const staged = path.join(outDir, folderName);
  const zipPath = path.join(outDir, `${folderName}.zip`);
  const crxPath = path.join(outDir, `${folderName}.crx`);
  const sumsPath = path.join(outDir, 'SHA256SUMS.txt');

  const result = {
    version,
    zipPath: null,
    crxPath: null,
    extensionId: null,
    skippedCrx: false,
  };

  if (opts.zip || opts.crx) {
    stageExtension(staged);
  }

  if (opts.zip) {
    zipFolder(outDir, folderName, zipPath);
    result.zipPath = zipPath;
  }

  if (opts.crx) {
    const pem = resolvePrivateKeyPem(opts);
    if (!pem) {
      if (!opts.allowMissingKey) {
        throw new Error(
          'No CRX signing key. Set CRX_PRIVATE_KEY, pass --key, or put a PEM at packaging/extension.pem.'
        );
      }
      result.skippedCrx = true;
    } else {
      const publicKeyDer = publicKeyDerFromPrivatePem(pem);
      result.extensionId = assertKeyMatchesCommitted(publicKeyDer);
      const tmpZip = path.join(os.tmpdir(), `medicus-suite-crx-${process.pid}.zip`);
      try {
        zipDirectoryContents(staged, tmpZip);
        const built = buildCrx3(fs.readFileSync(tmpZip), pem);
        fs.writeFileSync(crxPath, built.crx);
        result.crxPath = crxPath;
        result.extensionId = built.extensionId;
      } finally {
        fs.rmSync(tmpZip, { force: true });
      }
    }
  }

  if (opts.zip || result.crxPath) {
    const lines = [];
    if (result.zipPath) {
      lines.push(`${sha256File(result.zipPath)}  ${path.basename(result.zipPath)}`);
    }
    if (result.crxPath) {
      lines.push(`${sha256File(result.crxPath)}  ${path.basename(result.crxPath)}`);
    }
    fs.writeFileSync(sumsPath, lines.join('\n') + '\n');
    result.sumsPath = sumsPath;
  }

  return result;
}

function printHelp() {
  console.log(`Pack Medicus Suite as a CRX3 and/or release zip.

Usage:
  node scripts/pack-crx.js --zip [--crx] [--allow-missing-key]
  node scripts/pack-crx.js --crx
  node scripts/pack-crx.js --print-id
  node scripts/pack-crx.js --generate-key

Key: --key <pem>, or CRX_PRIVATE_KEY, or packaging/extension.pem
`);
}

function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    printHelp();
    return 0;
  }

  if (opts.generateKey) {
    if (fs.existsSync(DEFAULT_PEM)) {
      throw new Error(`${DEFAULT_PEM} already exists — refusing to overwrite the signing key`);
    }
    const pem = generatePrivateKeyPem();
    const { id } = writeKeyPairFiles(pem, DEFAULT_PEM);
    console.log(`Wrote ${path.relative(ROOT, DEFAULT_PEM)} (gitignored)`);
    console.log(`Wrote ${path.relative(ROOT, PUB_PEM)}`);
    console.log(`Wrote ${path.relative(ROOT, ID_FILE)}`);
    console.log(`Extension ID: ${id}`);
    if (!opts.zip && !opts.crx && !opts.printId) return 0;
  }

  if (opts.printId) {
    const pem = resolvePrivateKeyPem(opts);
    if (pem) {
      const id = extensionIdFromPublicKeyDer(publicKeyDerFromPrivatePem(pem));
      console.log(id);
      return 0;
    }
    const pinned = committedExtensionId();
    if (pinned) {
      console.log(pinned);
      return 0;
    }
    throw new Error('No signing key and no pinned packaging/extension-id.txt');
  }

  if (!opts.zip && !opts.crx) {
    printHelp();
    return 1;
  }

  const result = pack(opts);
  if (result.zipPath) console.log(`zip  ${result.zipPath}`);
  if (result.crxPath) console.log(`crx  ${result.crxPath}`);
  if (result.skippedCrx) {
    console.warn('crx  skipped (no signing key; zip-only release)');
  }
  if (result.extensionId) console.log(`id   ${result.extensionId}`);
  if (result.sumsPath) console.log(`sum  ${result.sumsPath}`);
  return 0;
}

module.exports = {
  PACK_EXCLUDES,
  shouldExclude,
  encodeVarint,
  encodeLengthDelimited,
  crxIdFromPublicKeyDer,
  extensionIdFromCrxId,
  extensionIdFromPublicKeyDer,
  publicKeyDerFromPrivatePem,
  publicKeyPemFromDer,
  generatePrivateKeyPem,
  buildCrx3,
  parseCrx3,
  resolvePrivateKeyPem,
  committedExtensionId,
  assertKeyMatchesCommitted,
  pack,
  main,
};

if (require.main === module) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}
