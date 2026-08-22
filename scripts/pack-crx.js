#!/usr/bin/env node
// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — CRX3 packer (no npm dependencies).
//
// Builds a signed Chrome extension package for enterprise (policy) deployment:
//   dist/medicus-suite-v<version>.crx   — CRX3, RSA-signed
//   dist/update.xml                     — Omaha update manifest for the policy
//                                         update_url (points at the GitHub
//                                         release asset for this version)
//
// The signing key lives at keys/medicus-suite.pem (gitignored) or the path in
// $CRX_KEY_PEM. It is generated on first run. THE EXTENSION ID IS DERIVED FROM
// THIS KEY — lose the key and every managed install breaks on the next update,
// because a re-generated key means a new extension ID. Keep it safe, and keep
// the same PEM in the CRX_PRIVATE_KEY GitHub Actions secret so CI releases
// carry the same ID. See docs/IT-DEPLOYMENT.md.
//
// File selection: `git ls-files` (tracked files only — gitignored scratch,
// node_modules, keys and patient-data directories can never leak in), then the
// same exclude list as the release zip in .github/workflows/release.yml.
// KEEP THE TWO LISTS IN SYNC.
//
// Usage: node scripts/pack-crx.js   (or: npm run pack:crx)

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const KEY_PATH = process.env.CRX_KEY_PEM || path.join(ROOT, 'keys', 'medicus-suite.pem');
const REPO_SLUG = 'davetriska02-collab/medicus-suite';
// Stable across releases: GitHub rewrites /latest/download/ to the newest release.
const UPDATE_URL = `https://github.com/${REPO_SLUG}/releases/latest/download/update.xml`;

// ── File selection (mirror of the rsync excludes in release.yml) ────────────
const EXCLUDE_DIRS = new Set([
  '.git',
  '.github',
  '.githooks',
  '.claude',
  'scripts',
  '_build',
  'node_modules',
  'keys',
  'dist',
]);
const EXCLUDE_FILES = new Set([
  '.gitignore',
  'README.md',
  'LICENSE',
  'package.json',
  'package-lock.json',
  'eslint.config.mjs',
  '.prettierrc.json',
  '.prettierignore',
  '.DS_Store',
  'brand/generate-icons.mjs',
]);

function isExcluded(relPath) {
  const parts = relPath.split('/');
  if (parts.some((p) => EXCLUDE_DIRS.has(p))) return true;
  if (EXCLUDE_FILES.has(relPath) || EXCLUDE_FILES.has(parts[parts.length - 1])) return true;
  const base = parts[parts.length - 1];
  if (/^test-.*\.js$/.test(base)) return true;
  if (/\.(zip|crx|log)$/.test(base)) return true;
  return false;
}

function listPackFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
  return out
    .toString('utf8')
    .split('\0')
    .filter((f) => f && !isExcluded(f))
    .filter((f) => fs.existsSync(path.join(ROOT, f)));
}

// ── Key handling ────────────────────────────────────────────────────────────
function loadOrCreateKey() {
  if (fs.existsSync(KEY_PATH)) {
    return crypto.createPrivateKey(fs.readFileSync(KEY_PATH, 'utf8'));
  }
  console.log(`No key at ${KEY_PATH} — generating a new RSA-2048 key.`);
  console.log('NOTE: a new key means a NEW EXTENSION ID. Never regenerate casually.');
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  fs.mkdirSync(path.dirname(KEY_PATH), { recursive: true });
  fs.writeFileSync(KEY_PATH, pem, { mode: 0o600 });
  return privateKey;
}

function extensionIdFromSpki(spkiDer) {
  const hash = crypto.createHash('sha256').update(spkiDer).digest();
  let id = '';
  for (const byte of hash.subarray(0, 16)) {
    id += String.fromCharCode(97 + (byte >> 4)) + String.fromCharCode(97 + (byte & 0x0f));
  }
  return id;
}

// ── Minimal protobuf encoding (only what CRX3 needs) ────────────────────────
function varint(n) {
  const bytes = [];
  while (n > 0x7f) {
    bytes.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  bytes.push(n);
  return Buffer.from(bytes);
}

function lenDelimited(fieldTag, payload) {
  return Buffer.concat([varint(fieldTag), varint(payload.length), payload]);
}

function u32le(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}

// ── CRX3 assembly ───────────────────────────────────────────────────────────
// Format: "Cr24" | u32le(3) | u32le(headerLen) | CrxFileHeader | zip
// CrxFileHeader{ 2: AsymmetricKeyProof{1: public_key, 2: signature},
//                10000: SignedData{1: crx_id} }
// Signature = RSA-PKCS1v1.5-SHA256 over
//   "CRX3 SignedData\x00" | u32le(len(SignedData)) | SignedData | zip
function buildCrx(zipBuffer, privateKey) {
  const spki = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  const crxId = crypto.createHash('sha256').update(spki).digest().subarray(0, 16);
  const signedData = lenDelimited(0x0a, crxId); // SignedData.crx_id (field 1)

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(Buffer.from('CRX3 SignedData\x00', 'latin1'));
  signer.update(u32le(signedData.length));
  signer.update(signedData);
  signer.update(zipBuffer);
  const signature = signer.sign(privateKey);

  const proof = Buffer.concat([lenDelimited(0x0a, spki), lenDelimited(0x12, signature)]);
  const header = Buffer.concat([
    lenDelimited(0x12, proof), // CrxFileHeader.sha256_with_rsa (field 2)
    lenDelimited(80002, signedData), // CrxFileHeader.signed_header_data (field 10000)
  ]);

  return {
    crx: Buffer.concat([Buffer.from('Cr24', 'latin1'), u32le(3), u32le(header.length), header, zipBuffer]),
    extensionId: extensionIdFromSpki(spki),
    publicKeyBase64: spki.toString('base64'),
  };
}

// Parse our own output and verify the signature — catches encoding mistakes
// before a broken package ever reaches IT.
function verifyCrx(crxBuffer, expectedId) {
  if (crxBuffer.subarray(0, 4).toString('latin1') !== 'Cr24') throw new Error('bad magic');
  if (crxBuffer.readUInt32LE(4) !== 3) throw new Error('not CRX3');
  const headerLen = crxBuffer.readUInt32LE(8);
  const header = crxBuffer.subarray(12, 12 + headerLen);
  const zip = crxBuffer.subarray(12 + headerLen);

  // Both the header and the proof are flat sequences of len-delimited fields.
  const parseFields = (buf) => {
    const fields = {};
    let off = 0;
    const readVarint = () => {
      let n = 0;
      let shift = 0;
      for (;;) {
        const b = buf[off++];
        n |= (b & 0x7f) << shift;
        if (!(b & 0x80)) return n >>> 0;
        shift += 7;
      }
    };
    while (off < buf.length) {
      const tag = readVarint();
      const len = readVarint();
      fields[tag] = buf.subarray(off, off + len);
      off += len;
    }
    return fields;
  };
  const headerFields = parseFields(header);
  const signedData = headerFields[80002];
  const proofFields = parseFields(headerFields[0x12]);
  const spki = proofFields[0x0a];
  const signature = proofFields[0x12];

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(Buffer.from('CRX3 SignedData\x00', 'latin1'));
  verifier.update(u32le(signedData.length));
  verifier.update(signedData);
  verifier.update(zip);
  const publicKey = crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' });
  if (!verifier.verify(publicKey, signature)) throw new Error('signature verification failed');
  if (extensionIdFromSpki(spki) !== expectedId) throw new Error('extension ID mismatch');
}

// ── Main ────────────────────────────────────────────────────────────────────
function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const version = manifest.version;

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'medicus-crx-'));
  const files = listPackFiles();
  for (const rel of files) {
    const dest = path.join(staging, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), dest);
  }

  // Inject update_url into the packed copy only — the repo manifest stays
  // clean for unpacked dev installs (Chrome ignores update_url when unpacked).
  const packedManifest = { ...manifest, update_url: UPDATE_URL };
  fs.writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify(packedManifest, null, 2) + '\n');

  const zipPath = path.join(staging, '..', `medicus-crx-zip-${process.pid}.zip`);
  execFileSync('zip', ['-qr', '-X', zipPath, '.'], { cwd: staging });
  const zipBuffer = fs.readFileSync(zipPath);

  const privateKey = loadOrCreateKey();
  const { crx, extensionId, publicKeyBase64 } = buildCrx(zipBuffer, privateKey);
  verifyCrx(crx, extensionId);

  fs.mkdirSync(DIST, { recursive: true });
  const crxName = `medicus-suite-v${version}.crx`;
  const crxPath = path.join(DIST, crxName);
  fs.writeFileSync(crxPath, crx);

  const codebase = `https://github.com/${REPO_SLUG}/releases/download/v${version}/${crxName}`;
  const updateXml = [
    "<?xml version='1.0' encoding='UTF-8'?>",
    "<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>",
    `  <app appid='${extensionId}'>`,
    `    <updatecheck codebase='${codebase}' version='${version}' />`,
    '  </app>',
    '</gupdate>',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(DIST, 'update.xml'), updateXml);

  fs.rmSync(zipPath, { force: true });
  fs.rmSync(staging, { recursive: true, force: true });

  console.log('Packed OK (signature verified).');
  console.log(`  Extension ID : ${extensionId}`);
  console.log(`  Version      : ${version}`);
  console.log(`  Files packed : ${files.length}`);
  console.log(`  CRX          : ${path.relative(ROOT, crxPath)} (${(crx.length / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`  Update feed  : ${path.relative(ROOT, path.join(DIST, 'update.xml'))} -> ${UPDATE_URL}`);
  console.log(`  Public key   : (manifest "key" value, for Web Store ID continuity)`);
  console.log(`  ${publicKeyBase64}`);
}

main();
