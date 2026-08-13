// Medicus Suite — Rota passcode-gate tests (rota/engine/access.js)
// Run with: node test-rota-access.js
//
// The gate is honest about what it is (a workflow gate, not security — see the
// header of rota/engine/access.js), but the crypto underneath it still has to
// be correct: a passcode that sometimes verifies, a salt that repeats, or a
// verify() that THROWS on a tampered record would each be a way past it.
//
// Module loading: rota/ is ESM (its own package.json "type":"module"), this
// root file is CJS — same dynamic-import idiom as the other test-rota-*.js.
'use strict';
const path = require('path');
const R = (p) => import(new URL('rota/' + p, `file://${path.resolve(__dirname)}/`).href);

let passed = 0,
  failed = 0;
function check(cond, msg) {
  if (cond) {
    console.log(`  OK  ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL  ${msg}`);
    failed++;
  }
}

// Base64 of 32 bytes (SHA-256 output) is 44 chars ending in one '=' pad.
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

(async () => {
  // The engine deliberately uses globalThis.crypto.subtle so ONE file works in
  // both the browser and node. If that assumption ever stops holding, this
  // fails first and says why.
  check(Boolean(globalThis.crypto && globalThis.crypto.subtle), 'globalThis.crypto.subtle exists in this node');

  const { hashPasscode, verifyPasscode, newSalt, makeAccess, accessSummary, KDF, DEFAULT_ITERATIONS } =
    await R('engine/access.js');

  console.log('\n--- Salt ---');

  const s1 = newSalt();
  const s2 = newSalt();
  check(typeof s1 === 'string' && B64.test(s1), `newSalt returns base64 (${s1})`);
  check(s1 !== s2, 'two salts differ (a fixed salt would make the hash a lookup key)');
  const many = new Set();
  for (let i = 0; i < 200; i++) many.add(newSalt());
  check(many.size === 200, '200 salts are all distinct');

  console.log('\n--- Hashing ---');

  const hash1 = await hashPasscode('correct horse', s1, 1000);
  const hash2 = await hashPasscode('correct horse', s1, 1000);
  check(hash1 === hash2, 'hashPasscode is deterministic for the same passcode + salt + iterations');
  check(B64.test(hash1) && hash1.length === 44, `hash is 44 base64 chars = 256 bits (got ${hash1.length})`);
  check((await hashPasscode('correct horse', s2, 1000)) !== hash1, 'a different salt gives a different hash');
  check((await hashPasscode('correct horsf', s1, 1000)) !== hash1, 'a one-character change gives a different hash');
  check(
    (await hashPasscode('correct horse', s1, 2000)) !== hash1,
    'a different iteration count gives a different hash'
  );

  console.log('\n--- make → verify round trip ---');

  const access = await makeAccess('Partners0nly!', { strict: false, hint: 'the usual one' });
  check(access.enabled === true, 'makeAccess returns enabled:true');
  check(access.strict === false, 'makeAccess carries strict through');
  check(access.kdf === KDF && KDF === 'PBKDF2-SHA256', `makeAccess records the KDF (${access.kdf})`);
  check(access.iterations === DEFAULT_ITERATIONS && DEFAULT_ITERATIONS === 150000, 'default iterations are 150 000');
  check(B64.test(access.salt) && B64.test(access.hash), 'salt and hash are both base64 strings');
  check(
    typeof access.updatedAt === 'string' && !Number.isNaN(Date.parse(access.updatedAt)),
    'updatedAt is an ISO date'
  );
  check(access.hint === 'the usual one', 'hint is stored verbatim');
  check(!JSON.stringify(access).includes('Partners0nly!'), 'the passcode itself appears NOWHERE in the stored record');

  check(await verifyPasscode('Partners0nly!', access), 'the right passcode verifies');
  check(!(await verifyPasscode('partners0nly!', access)), 'wrong case does not verify (passcodes are case-sensitive)');
  check(!(await verifyPasscode('Partners0nly', access)), 'a truncated passcode does not verify');
  check(!(await verifyPasscode('something else entirely', access)), 'a wrong passcode does not verify');
  check(!(await verifyPasscode('', access)), 'an empty passcode does not verify');

  const strictAccess = await makeAccess('x1234', { strict: true });
  check(strictAccess.strict === true, 'makeAccess carries strict:true through');
  check(strictAccess.hint === '', 'hint defaults to an empty string, never undefined');
  check(strictAccess.salt !== access.salt, 'each makeAccess draws a fresh salt');
  check(await verifyPasscode('x1234', strictAccess), 'the second record verifies with its own passcode');
  check(!(await verifyPasscode('Partners0nly!', strictAccess)), 'records do not cross-verify');

  console.log('\n--- Unicode passcodes ---');

  // Explicit escapes, not literal characters: an NFC/NFD distinction that is
  // invisible in the source is a test that can be "fixed" into meaninglessness
  // by an editor silently normalising the file.
  const NFC_ECLAIR = '\u00e9clair'; // é as one codepoint
  const NFD_ECLAIR = 'e\u0301clair'; // e + combining acute
  for (const code of ['g\u00fcnther\u00df', '\u5bc6\u7801\u5bc6\u7801', 'pass\u{1f511}word', NFC_ECLAIR]) {
    const rec = await makeAccess(code, {});
    check(await verifyPasscode(code, rec), `unicode passcode verifies: ${JSON.stringify(code)}`);
    check(!(await verifyPasscode(code + 'x', rec)), `unicode passcode rejects a near miss: ${JSON.stringify(code)}`);
  }
  // The two forms look identical on screen but are different byte sequences,
  // so they are different passcodes. Asserted rather than "fixed": adding
  // normalisation would silently change what an already-stored passcode means,
  // locking somebody out on upgrade.
  const nfc = await makeAccess(NFC_ECLAIR, {});
  check(await verifyPasscode(NFC_ECLAIR, nfc), 'the NFC form verifies against its own record');
  check(
    !(await verifyPasscode(NFD_ECLAIR, nfc)),
    'the NFD form does NOT verify against an NFC record (byte-exact hashing, no normalisation)'
  );

  console.log('\n--- Tampered / malformed records return false, never throw ---');

  const TAMPERED = [
    ['null', null],
    ['undefined', undefined],
    ['an array', []],
    ['a string', 'not-an-access-record'],
    ['a number', 42],
    ['{}', {}],
    ['hash removed', { ...access, hash: undefined }],
    ['hash blanked', { ...access, hash: '' }],
    ['hash wrong type', { ...access, hash: 12345 }],
    ['hash replaced with a plausible-looking one', { ...access, hash: 'A'.repeat(44) }],
    ['salt removed', { ...access, salt: undefined }],
    ['salt wrong type', { ...access, salt: ['nope'] }],
    ['salt is not valid base64', { ...access, salt: '!!!!not base64!!!!' }],
    ['iterations as a string', { ...access, iterations: '150000' }],
    ['iterations zero', { ...access, iterations: 0 }],
    ['iterations negative', { ...access, iterations: -1 }],
    ['iterations NaN', { ...access, iterations: NaN }],
    ['unknown kdf', { ...access, kdf: 'md5-lol' }],
  ];
  for (const [name, rec] of TAMPERED) {
    let threw = null;
    let result = null;
    try {
      result = await verifyPasscode('Partners0nly!', rec);
    } catch (e) {
      threw = e;
    }
    check(threw === null, `verifyPasscode does not throw on ${name}`);
    check(result === false, `verifyPasscode returns false on ${name}`);
  }
  // A non-string passcode must not be coerced into a match either.
  for (const bad of [null, undefined, 42, {}, ['Partners0nly!']]) {
    check(
      (await verifyPasscode(bad, access)) === false,
      `a non-string passcode (${JSON.stringify(bad) ?? 'undefined'}) does not verify`
    );
  }

  console.log('\n--- accessSummary ---');

  const sum = accessSummary(access);
  check(
    sum.enabled === true && sum.strict === false && sum.hasHint === true,
    'summary of a staff-view record with a hint'
  );
  check(
    JSON.stringify(Object.keys(sum).sort()) === JSON.stringify(['enabled', 'hasHint', 'strict']),
    'summary carries only enabled/strict/hasHint — never salt, hash or iterations'
  );
  const strictSum = accessSummary(strictAccess);
  check(
    strictSum.enabled === true && strictSum.strict === true && strictSum.hasHint === false,
    'summary of a strict record with no hint'
  );
  check(
    accessSummary(await makeAccess('x1234', { hint: '   ' })).hasHint === false,
    'a whitespace-only hint does not count as a hint'
  );
  // null is the stored value for "no passcode has ever been set", so the
  // summary of it must be the all-off answer, not a crash.
  for (const [name, value] of [
    ['null', null],
    ['undefined', undefined],
    ['{}', {}],
    ['an array', []],
    ['a string', 'nope'],
  ]) {
    const s = accessSummary(value);
    check(
      s.enabled === false && s.strict === false && s.hasHint === false,
      `accessSummary(${name}) is all-false, not a throw`
    );
  }

  console.log('\n--- Cost ---');

  // Not a benchmark — a floor. If a future edit drops the iteration count to
  // something trivial, the derivation stops costing anything and this notices.
  const t0 = Date.now();
  await hashPasscode('Partners0nly!', access.salt, DEFAULT_ITERATIONS);
  const ms = Date.now() - t0;
  console.log(`  ..  ${DEFAULT_ITERATIONS} PBKDF2 rounds took ${ms}ms`);
  check(DEFAULT_ITERATIONS >= 100000, 'the shipped iteration count is at least 100 000');

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  if (failed > 0) process.exit(1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
