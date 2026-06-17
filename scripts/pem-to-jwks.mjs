#!/usr/bin/env node
// pem-to-jwks.mjs — turn a private signing key into the PUBLIC JWKS we publish.
//
// SAFETY: this script only ever reads the PUBLIC half of the key. It never
// prints, copies, or writes the private key anywhere. The private .pem you pass
// in is read, the public key is derived from it in memory, and only the public
// JWKS is written out.
//
// Usage:
//   node scripts/pem-to-jwks.mjs [path-to-private-key.pem]
//
// Defaults to ./private-key.pem. Writes jwks-public/.well-known/jwks.json and
// prints the key id (kid) you then paste into backend/token-service/wrangler.toml.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createPrivateKey, createPublicKey, createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pemPath = resolve(process.cwd(), process.argv[2] || 'private-key.pem');
const outPath = resolve(repoRoot, 'jwks-public/.well-known/jwks.json');

let pem;
try {
  pem = readFileSync(pemPath, 'utf8');
} catch {
  console.error(`✗ Could not read a private key at: ${pemPath}`);
  console.error(`  Pass the path explicitly, e.g.  node scripts/pem-to-jwks.mjs ~/keys/private-key.pem`);
  process.exit(1);
}

let publicJwk;
try {
  // Load the private key, derive the PUBLIC key from it, export only public params.
  const priv = createPrivateKey(pem);
  const pub = createPublicKey(priv);
  publicJwk = pub.export({ format: 'jwk' }); // { kty, n, e } for RSA — no private fields
} catch (err) {
  console.error(`✗ That file isn't a valid private key (${err.message}).`);
  process.exit(1);
}

if (publicJwk.kty !== 'RSA') {
  console.error(`✗ Expected an RSA key, got ${publicJwk.kty}. The Worker is set up for RS256.`);
  process.exit(1);
}

// Stable key id = RFC 7638 JWK thumbprint (SHA-256, base64url).
const canonical = JSON.stringify({ e: publicJwk.e, kty: publicJwk.kty, n: publicJwk.n });
const kid = createHash('sha256').update(canonical).digest('base64url');

const jwks = {
  keys: [{ kty: publicJwk.kty, use: 'sig', alg: 'RS256', kid, n: publicJwk.n, e: publicJwk.e }],
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(jwks, null, 2) + '\n');

console.log('✓ Wrote public JWKS  →', outPath);
console.log('✓ Key id (kid)       →', kid);
console.log('');
console.log('Next:');
console.log('  1. Set this kid in backend/token-service/wrangler.toml  (KEY_ID = "' + kid + '")');
console.log('  2. git add jwks-public/.well-known/jwks.json  &&  git commit  &&  git push');
console.log('  3. The private key never needs to leave your machine / the Worker secret.');
