'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  encodeVarint,
  encodeLengthDelimited,
  crxIdFromPublicKeyDer,
  extensionIdFromCrxId,
  extensionIdFromPublicKeyDer,
  publicKeyDerFromPrivatePem,
  generatePrivateKeyPem,
  buildCrx3,
  parseCrx3,
  committedExtensionId,
  assertKeyMatchesCommitted,
  shouldExclude,
} = require('./scripts/pack-crx.js');

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log('ok - ' + name);
  } catch (e) {
    failures++;
    console.error('not ok - ' + name + '\n  ' + e.message);
  }
}

check('staging excludes keep tests, keys and packaging out of the zip', () => {
  assert.strictEqual(shouldExclude('test-pack-crx.js'), true);
  assert.strictEqual(shouldExclude('scripts/pack-crx.js'), true);
  assert.strictEqual(shouldExclude('packaging/extension.pem'), true);
  assert.strictEqual(shouldExclude('node_modules/eslint/index.js'), true);
  assert.strictEqual(shouldExclude('manifest.json'), false);
  assert.strictEqual(shouldExclude('side-panel/panel.js'), false);
});

check('varint encodes single-byte values', () => {
  assert.deepStrictEqual([...encodeVarint(0)], [0]);
  assert.deepStrictEqual([...encodeVarint(1)], [1]);
  assert.deepStrictEqual([...encodeVarint(127)], [127]);
});

check('varint encodes field 10000 tag (CRX3 signed_header_data)', () => {
  // (10000 << 3) | 2 = 80002 → 0x82 0xf1 0x04
  assert.deepStrictEqual([...encodeVarint(80002)], [0x82, 0xf1, 0x04]);
});

check('length-delimited field writes tag + length + payload', () => {
  const buf = encodeLengthDelimited(1, Buffer.from([0xaa, 0xbb]));
  assert.strictEqual(buf[0], (1 << 3) | 2);
  assert.strictEqual(buf[1], 2);
  assert.deepStrictEqual([...buf.subarray(2)], [0xaa, 0xbb]);
});

check('extension id is 32 chars in a–p from the first 16 hash bytes', () => {
  const crxId = Buffer.from('0123456789abcdef0123456789abcdef', 'hex');
  const id = extensionIdFromCrxId(crxId);
  assert.strictEqual(id.length, 32);
  assert.match(id, /^[a-p]{32}$/);
  assert.strictEqual(id, 'abcdefghijklmnopabcdefghijklmnop');
});

check('id derivation is deterministic for a given public key', () => {
  const pem = generatePrivateKeyPem();
  const der = publicKeyDerFromPrivatePem(pem);
  const a = extensionIdFromPublicKeyDer(der);
  const b = extensionIdFromPublicKeyDer(der);
  assert.strictEqual(a, b);
  assert.match(a, /^[a-p]{32}$/);
  assert.deepStrictEqual(crxIdFromPublicKeyDer(der).length, 16);
});

check('different keys produce different ids', () => {
  const a = extensionIdFromPublicKeyDer(publicKeyDerFromPrivatePem(generatePrivateKeyPem()));
  const b = extensionIdFromPublicKeyDer(publicKeyDerFromPrivatePem(generatePrivateKeyPem()));
  assert.notStrictEqual(a, b);
});

check('CRX3 magic, version and zip payload survive a round-trip', () => {
  const pem = generatePrivateKeyPem();
  const zip = Buffer.from('PK\x03\x04fake-zip-payload-for-header-test');
  const { crx, extensionId } = buildCrx3(zip, pem);
  assert.ok(crx.subarray(0, 4).equals(Buffer.from('Cr24')));
  const parsed = parseCrx3(crx);
  assert.strictEqual(parsed.version, 3);
  assert.ok(parsed.zip.equals(zip));
  assert.match(extensionId, /^[a-p]{32}$/);
  const der = publicKeyDerFromPrivatePem(pem);
  assert.strictEqual(extensionId, extensionIdFromPublicKeyDer(der));
});

check('CRX3 signature verifies over the Chrome signed-data prefix + zip', () => {
  const pem = generatePrivateKeyPem();
  const zip = Buffer.from('PK\x03\x04verify-me');
  const { crx } = buildCrx3(zip, pem);
  const parsed = parseCrx3(crx);

  // Re-sign the same payload and confirm Node can verify with the public key.
  // The header is a protobuf we do not fully decode here; verifying the
  // constructed signature against the documented signed bytes is the contract.
  const publicKeyDer = publicKeyDerFromPrivatePem(pem);
  const crxId = crxIdFromPublicKeyDer(publicKeyDer);
  const signedHeaderData = encodeLengthDelimited(1, crxId);
  const lengthBuf = Buffer.alloc(4);
  lengthBuf.writeUInt32LE(signedHeaderData.length, 0);
  const toSign = Buffer.concat([Buffer.from('CRX3 SignedData\x00'), lengthBuf, signedHeaderData, zip]);
  const verify = crypto.createVerify('SHA256');
  verify.update(toSign);
  verify.end();
  const sign = crypto.createSign('SHA256');
  sign.update(toSign);
  sign.end();
  const signature = sign.sign(crypto.createPrivateKey(pem));
  assert.strictEqual(verify.verify(crypto.createPublicKey(pem), signature), true);
  assert.ok(parsed.header.includes(publicKeyDer));
  assert.ok(parsed.header.includes(signature));
});

check('pinned packaging/extension-id.txt is a well-formed Chrome id', () => {
  const id = committedExtensionId();
  assert.ok(id, 'packaging/extension-id.txt must be committed so IT has a stable id');
  assert.match(id, /^[a-p]{32}$/);
});

check('pinned id matches packaging/extension.pub.pem', () => {
  const pub = fs.readFileSync(path.join(__dirname, 'packaging/extension.pub.pem'), 'utf8');
  const der = crypto.createPublicKey(pub).export({ type: 'spki', format: 'der' });
  assert.strictEqual(extensionIdFromPublicKeyDer(der), committedExtensionId());
});

check('assertKeyMatchesCommitted rejects a random key once an id is pinned', () => {
  const der = publicKeyDerFromPrivatePem(generatePrivateKeyPem());
  const pinned = committedExtensionId();
  if (!pinned) return;
  const randomId = extensionIdFromPublicKeyDer(der);
  if (randomId === pinned) return;
  assert.throws(() => assertKeyMatchesCommitted(der), /Refusing to mint a different identifier/);
});

check('parseCrx3 rejects a non-CRX buffer', () => {
  assert.throws(() => parseCrx3(Buffer.from('not a crx')), /CRX too short/);
  assert.throws(() => parseCrx3(Buffer.alloc(16, 0x41)), /not a CRX3/);
});

check('temp dir is writable (sanity for the packer zip step)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-crx-'));
  fs.writeFileSync(path.join(dir, 'ok.txt'), 'ok');
  assert.strictEqual(fs.readFileSync(path.join(dir, 'ok.txt'), 'utf8'), 'ok');
  fs.rmSync(dir, { recursive: true, force: true });
});

if (failures) {
  console.error('\n' + failures + ' failed');
  process.exit(1);
}
console.log('\nAll pack-crx checks passed');
