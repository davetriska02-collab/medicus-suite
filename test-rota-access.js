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

  const {
    hashPasscode,
    verifyPasscode,
    newSalt,
    makeAccess,
    accessSummary,
    KDF,
    DEFAULT_ITERATIONS,
    newRecoveryCode,
    normaliseRecoveryCode,
    hashRecoveryCode,
    verifyRecoveryCode,
    hasRecoveryCode,
    withRecoveryCode,
    carryRecoveryCode,
    RECOVERY_ALPHABET,
    RECOVERY_LENGTH,
  } = await R('engine/access.js');

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

  console.log('\n--- Recovery code: generation ---');

  // A forgotten passcode used to mean wiping every rota.* key (H-064). The
  // recovery code is the non-destructive way back: generated once, hashed like
  // the passcode, and able only to REMOVE the gate — never to reveal it.
  const r1 = newRecoveryCode();
  const r2 = newRecoveryCode();
  check(typeof r1 === 'string' && r1 !== r2, `newRecoveryCode returns a fresh string each call (${r1})`);
  check(normaliseRecoveryCode(r1).length === RECOVERY_LENGTH, `a code carries ${RECOVERY_LENGTH} characters`);
  check(RECOVERY_LENGTH >= 8, `codes are at least 8 characters (got ${RECOVERY_LENGTH})`);
  check(
    [...normaliseRecoveryCode(r1)].every((c) => RECOVERY_ALPHABET.includes(c)),
    'every character comes from the declared alphabet'
  );
  // Human transcription is the whole point: these are the pairs people misread
  // off a handwritten sheet.
  check(
    !/[0O1IL]/.test(RECOVERY_ALPHABET),
    `the alphabet excludes the look-alikes 0/O and 1/I/L (${RECOVERY_ALPHABET})`
  );
  check(/^[A-Z0-9]+(-[A-Z0-9]+)+$/.test(r1), `the displayed code is grouped for reading aloud (${r1})`);

  const codes = new Set();
  for (let i = 0; i < 500; i++) codes.add(newRecoveryCode());
  check(codes.size === 500, '500 codes are all distinct');
  // Rejection sampling, not `% alphabet.length` on a raw byte: with 30 letters
  // the naive modulo would over-pick the first 16. A skew that gross shows up
  // in a few thousand characters.
  {
    const counts = new Map();
    for (const c of [...codes].map(normaliseRecoveryCode).join('')) counts.set(c, (counts.get(c) || 0) + 1);
    const total = 500 * RECOVERY_LENGTH;
    const expected = total / RECOVERY_ALPHABET.length;
    const worst = Math.max(...[...RECOVERY_ALPHABET].map((c) => Math.abs((counts.get(c) || 0) - expected) / expected));
    check(counts.size === RECOVERY_ALPHABET.length, 'every letter of the alphabet is reachable');
    check(worst < 0.5, `no letter is grossly over- or under-drawn (worst deviation ${(worst * 100).toFixed(0)}%)`);
  }

  console.log('\n--- Recovery code: normalisation ---');

  // Somebody reads the code off a sheet: their capitals, spaces and dashes must
  // not be the reason a practice stays locked out.
  check(normaliseRecoveryCode('abcde-fghjk') === 'ABCDEFGHJK', 'lower case is folded up');
  check(normaliseRecoveryCode('  ABCDE FGHJK  ') === 'ABCDEFGHJK', 'spaces are ignored');
  check(normaliseRecoveryCode('AB-CD--EFGHJK') === 'ABCDEFGHJK', 'dashes are ignored wherever they fall');
  for (const bad of [null, undefined, 42, {}, ['ABCDE']]) {
    check(normaliseRecoveryCode(bad) === '', `a non-string normalises to '' (${JSON.stringify(bad) ?? 'undefined'})`);
  }

  console.log('\n--- Recovery code: make → verify round trip ---');

  const recCode = newRecoveryCode();
  const withRec = await makeAccess('Partners0nly!', { strict: false, hint: 'the usual one', recoveryCode: recCode });
  check(hasRecoveryCode(withRec), 'makeAccess with a recoveryCode produces a record that has one');
  check(
    typeof withRec.recoverySalt === 'string' && B64.test(withRec.recoverySalt),
    'the recovery salt is a base64 string'
  );
  check(
    typeof withRec.recoveryHash === 'string' && B64.test(withRec.recoveryHash) && withRec.recoveryHash.length === 44,
    'the recovery hash is 44 base64 chars = 256 bits'
  );
  check(withRec.recoverySalt !== withRec.salt, 'the recovery code gets its OWN salt, not the passcode salt');
  check(
    typeof withRec.recoverySetAt === 'string' && !Number.isNaN(Date.parse(withRec.recoverySetAt)),
    'recoverySetAt is an ISO date'
  );
  check(
    !JSON.stringify(withRec).includes(normaliseRecoveryCode(recCode)),
    'the recovery code itself appears NOWHERE in the stored record'
  );
  check(await verifyPasscode('Partners0nly!', withRec), 'the passcode still verifies on a record carrying a recovery');

  check(await verifyRecoveryCode(recCode, withRec), 'the right recovery code verifies');
  check(await verifyRecoveryCode(recCode.toLowerCase(), withRec), 'a lower-cased recovery code verifies');
  check(await verifyRecoveryCode(normaliseRecoveryCode(recCode), withRec), 'the ungrouped form verifies');
  check(await verifyRecoveryCode(` ${recCode} `, withRec), 'surrounding whitespace does not stop it verifying');
  check(!(await verifyRecoveryCode(newRecoveryCode(), withRec)), 'a different recovery code does not verify');
  check(!(await verifyRecoveryCode('', withRec)), 'an empty recovery code does not verify');
  check(!(await verifyRecoveryCode('   ', withRec)), 'a whitespace-only recovery code does not verify');
  check(!(await verifyRecoveryCode('Partners0nly!', withRec)), 'the PASSCODE does not verify as the recovery code');
  check(!(await verifyPasscode(recCode, withRec)), 'the recovery code does not verify as the passcode');
  check(
    !(await verifyRecoveryCode(normaliseRecoveryCode(recCode).slice(0, -1), withRec)),
    'a truncated recovery code does not verify'
  );

  console.log('\n--- Recovery code: legacy records (no recovery hash) keep working ---');

  // The whole back-compatibility contract in one block: a record written before
  // recovery codes existed must behave EXACTLY as it did — the passcode gate
  // works, and there is simply no recovery route to offer.
  const legacy = await makeAccess('Partners0nly!', { strict: false, hint: 'the usual one' });
  check(
    legacy.recoverySalt === undefined && legacy.recoveryHash === undefined,
    'makeAccess adds no recovery by default'
  );
  check(hasRecoveryCode(legacy) === false, 'hasRecoveryCode is false for a legacy record');
  check(accessSummary(legacy).hasRecovery === false, 'accessSummary reports no recovery for a legacy record');
  check(await verifyPasscode('Partners0nly!', legacy), 'a legacy record still unlocks with its passcode');
  check(!(await verifyPasscode('wrong', legacy)), 'a legacy record still refuses a wrong passcode');
  check(!(await verifyRecoveryCode(recCode, legacy)), 'no code verifies against a legacy record');
  check(!(await verifyRecoveryCode(newRecoveryCode(), legacy)), 'a freshly generated code does not verify either');
  // Half a pair is not a recovery route: offering one would be a dead end.
  for (const [name, rec] of [
    ['only a recovery salt', { ...legacy, recoverySalt: newSalt() }],
    ['only a recovery hash', { ...legacy, recoveryHash: 'A'.repeat(44) }],
    ['an empty recovery salt', { ...withRec, recoverySalt: '' }],
    ['an empty recovery hash', { ...withRec, recoveryHash: '' }],
  ]) {
    check(hasRecoveryCode(rec) === false, `hasRecoveryCode is false with ${name}`);
    check((await verifyRecoveryCode(recCode, rec)) === false, `verifyRecoveryCode is false with ${name}`);
    check(await verifyPasscode('Partners0nly!', rec), `the passcode still verifies with ${name}`);
  }

  console.log('\n--- Recovery code: attaching, replacing and carrying ---');

  const reissueCode = newRecoveryCode();
  const reissued = await withRecoveryCode(withRec, reissueCode);
  check(await verifyRecoveryCode(reissueCode, reissued), 'a re-issued code verifies');
  check(!(await verifyRecoveryCode(recCode, reissued)), 'the PREVIOUS code stops working once a new one is issued');
  check(reissued.recoverySalt !== withRec.recoverySalt, 're-issuing draws a fresh recovery salt');
  check(await verifyPasscode('Partners0nly!', reissued), 're-issuing leaves the passcode untouched');

  const upgraded = await withRecoveryCode(legacy, reissueCode);
  check(hasRecoveryCode(upgraded), 'a legacy record can be given a recovery code without changing its passcode');
  check(await verifyPasscode('Partners0nly!', upgraded), 'the upgraded record still verifies its original passcode');

  // Changing the passcode must not invalidate a code the practice has already
  // written down and filed.
  const changed = carryRecoveryCode(await makeAccess('NewPass!23', { strict: true }), withRec);
  check(await verifyPasscode('NewPass!23', changed), 'the changed record verifies the NEW passcode');
  check(!(await verifyPasscode('Partners0nly!', changed)), 'the changed record refuses the old passcode');
  check(await verifyRecoveryCode(recCode, changed), 'the already-issued recovery code survives a passcode change');
  check(
    carryRecoveryCode(legacy, null) === legacy && !hasRecoveryCode(carryRecoveryCode(legacy, legacy)),
    'carryRecoveryCode is a no-op when there is nothing to carry'
  );

  console.log('\n--- Recovery code: tampered / malformed records return false, never throw ---');

  const REC_TAMPERED = [
    ['null', null],
    ['undefined', undefined],
    ['an array', []],
    ['a string', 'not-an-access-record'],
    ['a number', 42],
    ['{}', {}],
    ['recoveryHash wrong type', { ...withRec, recoveryHash: 12345 }],
    ['recoveryHash replaced with a plausible-looking one', { ...withRec, recoveryHash: 'A'.repeat(44) }],
    ['recoverySalt wrong type', { ...withRec, recoverySalt: ['nope'] }],
    ['recoverySalt is not valid base64', { ...withRec, recoverySalt: '!!!!not base64!!!!' }],
    ['recovery fields swapped for the passcode ones', { ...withRec, recoverySalt: withRec.salt }],
    ['iterations as a string', { ...withRec, iterations: '150000' }],
    ['iterations zero', { ...withRec, iterations: 0 }],
    ['iterations negative', { ...withRec, iterations: -1 }],
    ['iterations NaN', { ...withRec, iterations: NaN }],
    ['iterations removed', { ...withRec, iterations: undefined }],
    ['unknown kdf', { ...withRec, kdf: 'md5-lol' }],
  ];
  for (const [name, rec] of REC_TAMPERED) {
    let threw = null;
    let result = null;
    try {
      result = await verifyRecoveryCode(recCode, rec);
    } catch (e) {
      threw = e;
    }
    check(threw === null, `verifyRecoveryCode does not throw on ${name}`);
    check(result === false, `verifyRecoveryCode returns false on ${name}`);
  }
  for (const bad of [null, undefined, 42, {}, [recCode]]) {
    check(
      (await verifyRecoveryCode(bad, withRec)) === false,
      `a non-string recovery code (${JSON.stringify(bad) ?? 'undefined'}) does not verify`
    );
  }
  // hasRecoveryCode is what the unlock screen asks before offering the route,
  // so it must answer for junk rather than throw.
  for (const [name, value] of [
    ['null', null],
    ['undefined', undefined],
    ['{}', {}],
    ['an array', []],
    ['a string', 'nope'],
  ]) {
    check(hasRecoveryCode(value) === false, `hasRecoveryCode(${name}) is false, not a throw`);
  }
  // Empty input must never be hashable into a stored credential.
  for (const bad of ['', '   ', '---', null, 42]) {
    let threw = false;
    try {
      await hashRecoveryCode(bad, newSalt(), 1000);
    } catch {
      threw = true;
    }
    check(threw, `hashRecoveryCode refuses to hash ${JSON.stringify(bad) ?? 'undefined'}`);
  }
  // Same primitive as the passcode, so the same properties have to hold.
  {
    const salt = newSalt();
    const h1 = await hashRecoveryCode('ABCDE-FGHJK', salt, 1000);
    const h2 = await hashRecoveryCode('abcde fghjk', salt, 1000);
    check(h1 === h2, 'hashRecoveryCode hashes the NORMALISED code (grouping and case are not part of it)');
    check((await hashRecoveryCode('ABCDE-FGHJM', salt, 1000)) !== h1, 'a one-character change gives a different hash');
    check((await hashRecoveryCode('ABCDE-FGHJK', newSalt(), 1000)) !== h1, 'a different salt gives a different hash');
  }

  console.log('\n--- accessSummary ---');

  const sum = accessSummary(access);
  check(
    sum.enabled === true && sum.strict === false && sum.hasHint === true,
    'summary of a staff-view record with a hint'
  );
  check(
    JSON.stringify(Object.keys(sum).sort()) === JSON.stringify(['enabled', 'hasHint', 'hasRecovery', 'strict']),
    'summary carries only enabled/strict/hasHint/hasRecovery — never salt, hash or iterations'
  );
  check(
    accessSummary(withRec).hasRecovery === true && accessSummary(access).hasRecovery === false,
    'summary reports whether a recovery code exists (which is what the unlock screen offers on)'
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
      s.enabled === false && s.strict === false && s.hasHint === false && s.hasRecovery === false,
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
