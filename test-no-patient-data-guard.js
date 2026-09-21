'use strict';

// Regression test for scripts/check-no-patient-data.js — the patient-data CI
// guard. Exercises the two pure decision functions so a future edit that breaks
// NHS-number validation or path matching fails CI instead of silently letting
// patient data through.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  isValidNhsNumber,
  isForbiddenPath,
  parseDiffNewPath,
  findNhsHitsInDiff,
  fatalDiffReadError,
  isSafeRef,
  fileExemptFromNhsScan,
} = require('./scripts/check-no-patient-data.js');

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

check('valid Modulus-11 NHS numbers are detected', () => {
  // 9434765919 is the canonical NHS example number; 9000000009 is from the
  // synthetic test range — both pass Modulus-11.
  assert.strictEqual(isValidNhsNumber('9434765919'), true);
  assert.strictEqual(isValidNhsNumber('9000000009'), true);
});

check('numbers with the wrong check digit are rejected', () => {
  assert.strictEqual(isValidNhsNumber('9434765918'), false);
  assert.strictEqual(isValidNhsNumber('9434765910'), false);
});

check('non-10-digit inputs are rejected', () => {
  assert.strictEqual(isValidNhsNumber('123456789'), false); // 9 digits
  assert.strictEqual(isValidNhsNumber('12345678901'), false); // 11 digits
  assert.strictEqual(isValidNhsNumber('94347659x9'), false); // non-digit
});

check('a check digit computing to 10 is invalid', () => {
  // 1234567890 -> weighted sum gives remainder 1 -> check 10 -> invalid.
  assert.strictEqual(isValidNhsNumber('1234567890'), false);
});

check('forbidden patient-data paths are matched', () => {
  assert.strictEqual(isForbiddenPath('uploads/scan.pdf'), true);
  assert.strictEqual(isForbiddenPath('data/sars/patient.json'), true);
  assert.strictEqual(isForbiddenPath('output/export.csv'), true);
});

check('legitimate source paths are not matched', () => {
  assert.strictEqual(isForbiddenPath('engine/rules-engine.js'), false);
  assert.strictEqual(isForbiddenPath('docs/uploads-guide.md'), false); // not under uploads/
  assert.strictEqual(isForbiddenPath('side-panel/panel.js'), false);
});

check('quoted diff paths are parsed, not left as the previous file', () => {
  assert.strictEqual(parseDiffNewPath('+++ b/test-no-patient-data-guard.js'), 'test-no-patient-data-guard.js');
  // New files carry an empty timestamp field: a trailing tab. It is not part of the path.
  assert.strictEqual(parseDiffNewPath('+++ b/test-no-patient-data-guard.js\t'), 'test-no-patient-data-guard.js');
  assert.strictEqual(parseDiffNewPath('+++ "b/synth fixture.js"\t'), 'synth fixture.js');
  assert.strictEqual(parseDiffNewPath('+++ "b/caf\\303\\251.js"\t'), 'café.js');
  assert.strictEqual(parseDiffNewPath('+++ /dev/null'), null);
  assert.strictEqual(parseDiffNewPath('+++ "b/unterminated'), null);
});

check('a quoted path after an allowlisted file is still scanned', () => {
  // The published example number and the synthetic 9000000009 range both pass
  // Modulus-11. They live in this allowlisted file on purpose.
  const diff = [
    'diff --git a/test-no-patient-data-guard.js b/test-no-patient-data-guard.js',
    '+++ b/test-no-patient-data-guard.js\t',
    '@@ -1 +1 @@',
    '+const keep = "9434765919";',
    'diff --git "a/synth fixture.js" "b/synth fixture.js"',
    '--- "a/synth fixture.js"',
    '+++ "b/synth fixture.js"\t',
    '@@ -0,0 +1 @@',
    '+NHS 9000000009',
  ].join('\n');
  const hits = findNhsHitsInDiff(diff);
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].file, 'synth fixture.js');
  assert.strictEqual(hits[0].line, 1);
  assert.strictEqual(hits[0].token, '9000000009');
});

check('an unparsed path does not inherit an allowlist exemption', () => {
  const diff = [
    'diff --git a/rules/document-types.json b/rules/document-types.json',
    '+++ b/rules/document-types.json',
    '@@ -1 +1 @@',
    '+1111111111',
    'diff --git a/next b/next',
    '+++ "b/broken\t',
    '@@ -0,0 +3 @@',
    '+943 476 5919',
  ].join('\n');
  const hits = findNhsHitsInDiff(diff);
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].file, null);
  assert.strictEqual(hits[0].token, '943 476 5919');
});

check('checksum-invalid numbers, phones, and skipped paths are not hits', () => {
  const diff = [
    '+++ b/test-knowledge-utils.js\t',
    '@@ -1 +1 @@',
    '+NHS 943 476 5918',
    '+phone 01234 567890',
    '+++ b/vendor/bundle.js\t',
    '@@ -1 +1 @@',
    '+9434765919',
  ].join('\n');
  assert.deepStrictEqual(findNhsHitsInDiff(diff), []);
  assert.strictEqual(fileExemptFromNhsScan('vendor/bundle.js'), true);
  assert.strictEqual(fileExemptFromNhsScan(null), false);
});

check('a diff that cannot be read is a hard failure, not an empty scan', () => {
  const msg = fatalDiffReadError(Object.assign(new Error('spawnSync /bin/sh ENOBUFS'), { code: 'ENOBUFS' }));
  assert.match(msg, /ENOBUFS/);
  assert.match(msg, /Refusing to skip/);
});

check('base refs cannot smuggle extra git arguments', () => {
  assert.strictEqual(isSafeRef('origin/main'), true);
  assert.strictEqual(isSafeRef('HEAD~1'), true);
  assert.strictEqual(isSafeRef('--upload-pack=evil'), false);
  assert.strictEqual(isSafeRef('origin/main;touch /tmp/x'), false);
});

check('synthetic fixtures outside the allowlist are checksum-invalid', () => {
  // These files are not terminology dumps. A checksum-valid number here is a
  // scanner false positive the next time the line is edited. phiWarnings and
  // the summary/admin text only need the digit shape, not a valid check digit.
  const files = ['test-knowledge-utils.js', 'test-record-summary.js', 'test-chip-instructions.js'];
  const re = /\b(\d{3})[ -]?(\d{3})[ -]?(\d{4})\b/g;
  for (const f of files) {
    const text = fs.readFileSync(path.join(__dirname, f), 'utf8');
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      assert.strictEqual(isValidNhsNumber(m[1] + m[2] + m[3]), false, `${f} contains checksum-valid ${m[0]}`);
    }
  }
});

function gitIn(repo, args) {
  execFileSync('git', ['-C', repo, '-c', 'commit.gpgsign=false', '-c', 'user.email=dev@example.com', '-c', 'user.name=dev', ...args], {
    encoding: 'utf8',
  });
}

function runGuard(repo, env) {
  return execFileSync(process.execPath, [path.join(__dirname, 'scripts/check-no-patient-data.js')], {
    cwd: repo,
    env: Object.assign({}, process.env, env),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

check('CLI flags a quoted-path synthetic and refuses an oversized diff', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'nhs-guard-'));
  try {
    gitIn(repo, ['init', '-b', 'main']);
    fs.writeFileSync(path.join(repo, 'readme.txt'), 'seed\n');
    gitIn(repo, ['add', 'readme.txt']);
    gitIn(repo, ['commit', '-m', 'seed']);

    // A newly added allowlisted file has a trailing tab on the +++ line.
    // The exemption must still apply, or this guard's own fixtures cannot land.
    fs.writeFileSync(path.join(repo, 'test-no-patient-data-guard.js'), 'const n = "9434765919";\n');
    gitIn(repo, ['add', 'test-no-patient-data-guard.js']);
    gitIn(repo, ['commit', '-m', 'allowlisted synthetic']);
    const clean = runGuard(repo, { BASE_REF: 'HEAD~1' });
    assert.match(clean, /Patient-data guard: clean/);

    const spaced = path.join(repo, 'synth fixture.js');
    fs.writeFileSync(spaced, 'NHS 9000000009\n');
    gitIn(repo, ['add', 'synth fixture.js']);
    gitIn(repo, ['commit', '-m', 'add synthetic']);

    let failed = false;
    let out = '';
    try {
      out = runGuard(repo, { BASE_REF: 'HEAD~1' });
    } catch (e) {
      failed = true;
      out = (e.stdout || '') + (e.stderr || '');
    }
    assert.strictEqual(failed, true);
    assert.match(out, /synth fixture\.js:1 adds "9000000009"/);
    assert.doesNotMatch(out, /Patient-data guard: clean/);

    // Grow the diff past the cap. The refusal must be a failure — never the
    // clean success line the old empty-catch produced on ENOBUFS.
    fs.writeFileSync(path.join(repo, 'pad.js'), 'x'.repeat(4000) + '\nNHS 9434765919\n');
    gitIn(repo, ['add', 'pad.js']);
    gitIn(repo, ['commit', '-m', 'pad']);
    let overflowFailed = false;
    let overflow = '';
    try {
      overflow = runGuard(repo, { BASE_REF: 'HEAD~1', CHECK_NO_PATIENT_DATA_MAX_BUFFER: '1024' });
    } catch (e) {
      overflowFailed = true;
      overflow = (e.stdout || '') + (e.stderr || '');
    }
    assert.strictEqual(overflowFailed, true);
    assert.match(overflow, /Refusing to skip/);
    assert.doesNotMatch(overflow, /Patient-data guard: clean/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

if (failures) {
  console.error(`\n${failures} assertion group(s) failed`);
  process.exit(1);
}
console.log('\nAll patient-data guard tests passed');
