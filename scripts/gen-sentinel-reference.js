#!/usr/bin/env node
/**
 * gen-sentinel-reference.js
 *
 * Generates a portable reference of every Sentinel clinical rule EXCEPT QOF:
 *   - rules/drug-rules.json    (drug-monitoring, drug-allergy, drug-no-monitoring)
 *   - rules/vaccine-rules.json (vaccine eligibility + status terms)
 *   - rules/alert-library.json (PINCER / MHRA / NICE prescribing-safety alerts)
 *
 * Output:
 *   docs/SENTINEL-ALERT-REFERENCE.md   — human/LLM-readable narrative reference
 *   docs/sentinel-alert-reference.json — same content, machine-readable
 *
 * QOF (rules/qof-rules.json) is deliberately excluded: it is contractual
 * achievement, not patient-safety monitoring.
 *
 * Usage:  node scripts/gen-sentinel-reference.js
 *         node scripts/gen-sentinel-reference.js --check   (fail if stale)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RULES = path.join(ROOT, 'rules');
const DOCS = path.join(ROOT, 'docs');
const MD_OUT = path.join(DOCS, 'SENTINEL-ALERT-REFERENCE.md');
const JSON_OUT = path.join(DOCS, 'sentinel-alert-reference.json');

const read = (f) => JSON.parse(fs.readFileSync(path.join(RULES, f), 'utf8'));

const drugDoc = read('drug-rules.json');
const vaxDoc = read('vaccine-rules.json');
const alertDoc = read('alert-library.json');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

// ---------------------------------------------------------------- helpers

const list = (arr) => (arr && arr.length ? arr.map((s) => `\`${s}\``).join(', ') : '—');
const days = (n) => {
  if (n == null) return '—';
  if (n % 365 === 0) return `${n} d (${n / 365} y)`;
  if (n % 30 === 0 && n >= 60) return `${n} d (~${Math.round(n / 30)} mo)`;
  if (n % 7 === 0 && n >= 14) return `${n} d (${n / 7} wk)`;
  return `${n} d`;
};
const flag = (r) => (r.enabled === false ? ' **[SHIPPED DISABLED]**' : '');
const ageStr = (a) => {
  if (!a) return 'any';
  if (a.min != null && a.max != null) return `${a.min}–${a.max}`;
  if (a.min != null) return `≥${a.min}`;
  if (a.max != null) return `<${a.max}`;
  return 'any';
};
const sexStr = (s) => (!s || s === 'any' ? 'any' : s === 'F' ? 'female' : s === 'M' ? 'male' : s);

const lines = [];
const w = (s = '') => lines.push(s);

// ---------------------------------------------------------------- preamble

w('# Sentinel clinical alert reference (non-QOF)');
w();
w(
  'Machine-generated from the shipped rule files by `scripts/gen-sentinel-reference.js`. ' +
    'Do not hand-edit — edit the rule JSON and regenerate.'
);
w();
w('| Source | Version / last updated |');
w('|---|---|');
w(`| \`manifest.json\` | v${manifest.version} |`);
w(`| \`rules/drug-rules.json\` | ${drugDoc.lastUpdated} (schema v${drugDoc.schemaVersion}) |`);
w(`| \`rules/vaccine-rules.json\` | ${vaxDoc.lastUpdated} |`);
w(`| \`rules/alert-library.json\` | v${alertDoc.version} — ${alertDoc.lastUpdated} |`);
w();
w(
  '**Scope.** This is the full Sentinel rule set *minus QOF*: drug monitoring, drug–allergy ' +
    'cross-checks, vaccine eligibility, and the prescribing-safety alert library. ' +
    'QOF indicators/registers (`rules/qof-rules.json`, 60 indicators + 14 registers) are ' +
    'contractual achievement rather than patient-safety monitoring and are excluded by design.'
);
w();

// ---------------------------------------------------------------- semantics

w('## How to read these rules (engine semantics)');
w();
w(
  '- **Matching is case-insensitive SUBSTRING matching** against the drug/observation name ' +
    '(`engine/rules-engine.js` → `drugMatchesRule`). A generic term therefore auto-covers its ' +
    'qualified forms (`lithium` matches `lithium carbonate`), but **every distinct brand must be ' +
    'listed explicitly** or it silently never matches. A non-match produces no alert and no error.'
);
w(
  '- **`exclude` is sharp**: any drug whose name *contains* an exclude string is dropped entirely, ' +
    'including legitimate ones. Excludes exist to suppress genuine false positives (e.g. topical ' +
    'NSAIDs, vaginal oestrogens).'
);
w('- **SNOMED codes**, where present, are secondary identifiers alongside the text match, not the primary key.');
w('- **Monitoring test statuses** derived from `intervalDays` / `dueSoonDays`:');
w();
w('  | Status | Meaning |');
w('  |---|---|');
w('  | `in_date` | last result within `intervalDays` |');
w('  | `due_soon` | within the last `dueSoonDays` of the interval (amber) |');
w('  | `overdue` | older than `intervalDays` (red) |');
w('  | `stale` | severely overdue (≥2× interval) |');
w('  | `no_data` | no matching observation found (neutral — not actionable on its own) |');
w('  | `recently_initiated` | drug started within the smallest interval; `no_data` suppressed |');
w();
w(
  '- **`postInitiationDays`** (currently only the ACE-I/ARB U&E test) fires only when the drug ' +
    'start date is known AND no test has been recorded since starting: ≤ `postInitiationDueSoonDays` ' +
    '= neutral, then `due_soon`, then `overdue`. It cannot raise a false alert on an established ' +
    'patient whose start date is not visible.'
);
w('- **Severity**: `red` = alert/actionable, `amber` = caution, `info` = noted/awareness only.');
w(
  '- **`mustNotBePresent`** on a drug-combo rule inverts that clause: the rule fires only when ' +
    '*none* of the listed drugs is co-prescribed (this is how "without gastroprotection" is expressed).'
);
w(
  '- **Drug–allergy rules FAIL CLOSED** on the legacy session/DOM feed: allergies are only available ' +
    'from the Transactional (GP Connect Structured) feed, so with no allergy bundle they never fire.'
);
w();

// ---------------------------------------------------------------- part 1

const monitoring = drugDoc.rules.filter((r) => r.type === 'drug-monitoring');
const allergy = drugDoc.rules.filter((r) => r.type === 'drug-allergy');
const noMon = drugDoc.rules.filter((r) => r.type === 'drug-no-monitoring');

w('---');
w();
w(`## Part 1 — Drug monitoring rules (${monitoring.length})`);
w();
w(`Source file: \`rules/drug-rules.json\`. ${drugDoc.specVersion}`);
w();
w('### Index');
w();
w('| Rule ID | Class | Shared care | Tests | Interval(s) |');
w('|---|---|---|---|---|');
for (const r of monitoring) {
  const ivals = [...new Set((r.tests || []).map((t) => t.intervalDays))].map(days).join(', ');
  w(
    `| \`${r.id}\`${r.enabled === false ? ' *(disabled)*' : ''} | ${r.drugClass || '—'} | ${
      r.sharedCare ? 'yes' : 'no'
    } | ${(r.tests || []).map((t) => t.name).join(', ') || '—'} | ${ivals || '—'} |`
  );
}
w();

for (const r of monitoring) {
  w(`### \`${r.id}\`${flag(r)}`);
  w();
  if (r.drugClass) w(`**Class:** ${r.drugClass}  `);
  if (r.label) w(`**Label:** ${r.label}  `);
  w(`**Phase:** ${r.phase || 'maintenance'} · **Shared care:** ${r.sharedCare ? 'yes' : 'no'}`);
  if (r.ageRange || r.sex) w(`**Applies to:** age ${ageStr(r.ageRange)}, sex ${sexStr(r.sex)}`);
  w();
  w(`**Drug match terms:** ${list(r.drug && r.drug.match)}`);
  if (r.drug && r.drug.exclude && r.drug.exclude.length) w(`**Excluded:** ${list(r.drug.exclude)}`);
  if (r.drug && r.drug.snomed && r.drug.snomed.length) w(`**Drug SNOMED:** ${list(r.drug.snomed)}`);
  w();
  if (r.tests && r.tests.length) {
    w('**Monitoring requirements:**');
    w();
    w('| Test | Match terms | SNOMED | Interval | Due-soon window | Post-initiation |');
    w('|---|---|---|---|---|---|');
    for (const t of r.tests) {
      const pi =
        t.postInitiationDays != null
          ? `overdue at ${days(t.postInitiationDays)} from drug start (amber from ${days(t.postInitiationDueSoonDays)})`
          : '—';
      w(
        `| ${t.name} | ${list(t.match)} | ${list(t.snomed)} | ${days(t.intervalDays)} | ${days(
          t.dueSoonDays
        )} | ${pi} |`
      );
    }
    w();
  }
  if (r.hrtContext) {
    const h = r.hrtContext;
    w('**HRT context (endometrial-protection logic):**');
    w();
    w(`- Oestrogen terms (gate the chip): ${list(h.oestrogenTerms)}`);
    w(`- LNG-IUS terms: ${list(h.iusTerms)}`);
    w(`- IUS problem-code terms: ${list(h.iusProblemTerms)}`);
    w(`- Progestogen terms: ${list(h.progestogenTerms)}`);
    w(`- Hysterectomy terms: ${list(h.hysterectomyTerms)}`);
    w(`- IUS validity: ${h.iusValidityYears} years (older/undated coil code → \`expired\`)`);
    w();
  }
  w(`**Source:** ${r.source || '—'}`);
  w();
  if (r.notes) {
    w(`**Notes:** ${r.notes}`);
    w();
  }
}

// ---------------------------------------------------------------- part 2

w('---');
w();
w(`## Part 2 — Drug–allergy cross-checks (${allergy.length})`);
w();
w(
  'Type `drug-allergy`. Fires only when a documented **active** allergy co-occurs with a ' +
    'contraindicated drug. Requires the Transactional feed (fails closed otherwise).'
);
w();
for (const r of allergy) {
  w(`### \`${r.id}\`${flag(r)} — ${r.label}`);
  w();
  w(`**Severity:** ${r.severity}${r.crossSensitivity ? ' · cross-sensitivity caution (not absolute)' : ''}`);
  w();
  w(`**Allergy terms:** ${list(r.allergyTerms)}`);
  for (const ds of r.drugSets || []) {
    w(`**Drug set — ${ds.name}:** ${list(ds.match)}`);
    if (ds.exclude && ds.exclude.length) w(`**Excluded:** ${list(ds.exclude)}`);
  }
  w();
  w(`**Source:** ${r.source || '—'}`);
  w();
  if (r.notes) {
    w(`**Notes:** ${r.notes}`);
    w();
  }
}

// ---------------------------------------------------------------- part 3

w('---');
w();
w(`## Part 3 — Vaccine rules (${vaxDoc.rules.length})`);
w();
w(`Source file: \`rules/vaccine-rules.json\`. ${vaxDoc.specVersion}`);
w();
w(`**File-level note:** ${vaxDoc.notes}`);
w();
w('Eligibility is `anyOf` — a patient matching **any one** clause is eligible. Clause kinds:');
w();
w('| Kind | Meaning |');
w('|---|---|');
w('| `age` | age band (`ageMin`/`ageMax`) |');
w('| `problem` | substring match against coded problems (optionally age/sex-gated) |');
w('| `medication` | substring match against current medication |');
w('| `register` | membership of a QOF register (register codes) |');
w('| `conditional-register` | register membership AND at least one of `andAnyOf` sub-conditions |');
w('| `observation-threshold` | numeric observation compared with `operator` + `value` |');
w();
w(
  '`statusTerms.given` / `statusTerms.declined` are matched against coded immunisation/problem ' +
    'entries. **Order matters**: a declined term that is a superstring of a given term must be ' +
    'listed in `declined` or it substring-matches as GIVEN (the mRESVIA vax-002 defect).'
);
w();

for (const r of vaxDoc.rules) {
  w(`### \`${r.id}\`${flag(r)} — ${r.displayName}`);
  w();
  const sched =
    r.schedule === 'once'
      ? 'once (lifetime)'
      : r.season
        ? `seasonal, campaign window ${r.season.startDay}/${r.season.startMonth} – ${r.season.endDay}/${r.season.endMonth}`
        : r.schedule || '—';
  w(`**Vaccine:** ${r.vaccine} · **Schedule:** ${sched}`);
  w();
  w('**Eligibility (anyOf):**');
  w();
  w('| Clause | Criteria |');
  w('|---|---|');
  for (const c of (r.eligibility && r.eligibility.anyOf) || []) {
    const bits = [];
    if (c.ageMin != null || c.ageMax != null) bits.push(`age ${ageStr({ min: c.ageMin, max: c.ageMax })}`);
    if (c.sex) bits.push(`sex ${sexStr(c.sex)}`);
    if (c.match) bits.push(`match ${list(c.match)}`);
    if (c.registers) bits.push(`registers ${list(c.registers)}`);
    if (c.register) bits.push(`register \`${c.register}\``);
    if (c.observation) bits.push(`observation ${list(c.observation)} ${c.operator} ${c.value}`);
    if (c.andAnyOf) {
      const sub = c.andAnyOf
        .map((s) =>
          Object.entries(s)
            .map(([k, v]) => `${k}: ${list(v)}`)
            .join('; ')
        )
        .join(' **OR** ');
      bits.push(`AND any of → ${sub}`);
    }
    w(`| ${c.label || c.kind} *(${c.kind})* | ${bits.join(' · ') || '—'} |`);
  }
  w();
  w(`**Coded as GIVEN:** ${list(r.statusTerms && r.statusTerms.given)}`);
  w();
  w(`**Coded as DECLINED / not given:** ${list(r.statusTerms && r.statusTerms.declined)}`);
  w();
  w(`**Source:** ${r.source || '—'}`);
  w();
  if (r.notes) {
    w(`**Notes:** ${r.notes}`);
    w();
  }
}

// ---------------------------------------------------------------- part 4

w('---');
w();
w(`## Part 4 — Prescribing-safety alert library (${alertDoc.library.length})`);
w();
w(`Source file: \`rules/alert-library.json\` v${alertDoc.version}. ${alertDoc.specVersion}`);
w();
w(`**File-level note:** ${alertDoc.notes}`);
w();
w('### Index');
w();
w('| libId | Severity | Type | Category / subcategory | Title |');
w('|---|---|---|---|---|');
for (const a of alertDoc.library) {
  w(
    `| \`${a.libId}\`${a.rule.enabled === false ? ' *(disabled)*' : ''} | ${a.rule.severity || '—'} | ${
      a.rule.type
    } | ${a.category} / ${a.subcategory || '—'} | ${a.title} |`
  );
}
w();

for (const a of alertDoc.library) {
  const r = a.rule;
  w(`### \`${a.libId}\`${r.enabled === false ? ' **[SHIPPED DISABLED]**' : ''} — ${a.title}`);
  w();
  w(`**Severity:** ${r.severity || '—'} · **Type:** ${r.type} · **Category:** ${a.category} / ${a.subcategory || '—'}`);
  w();
  w(`**Description:** ${a.description}`);
  w();

  if (r.type === 'drug-combo' || r.type === 'drug-allergy') {
    w('**Trigger logic — ALL drug sets must be present:**');
    w();
    for (const ds of r.drugSets || []) {
      w(`- **${ds.name}:** ${list(ds.match)}`);
      if (ds.exclude && ds.exclude.length) w(`  - excluding: ${list(ds.exclude)}`);
    }
    if (r.mustNotBePresent && r.mustNotBePresent.length)
      w(`- **AND none of (must not be present):** ${list(r.mustNotBePresent)}`);
    if (r.requiresProblem && r.requiresProblem.length)
      w(`- **AND coded problem required:** ${list(r.requiresProblem)}`);
    if (r.excludesProblem && r.excludesProblem.length) w(`- **AND NOT coded problem:** ${list(r.excludesProblem)}`);
    if (r.minSetsPresent != null) w(`- **Minimum sets present:** ${r.minSetsPresent}`);
    w(`- **Demographics:** age ${ageStr(r.ageRange)}, sex ${sexStr(r.sex)}`);
    w();
  } else if (r.type === 'drug-monitoring') {
    w(`**Drug match:** ${list(r.drug && r.drug.match)}`);
    if (r.drug && r.drug.exclude && r.drug.exclude.length) w(`**Excluded:** ${list(r.drug.exclude)}`);
    w();
    w('**Monitoring requirement:**');
    w();
    w('| Test | Match terms | Interval | Due-soon window |');
    w('|---|---|---|---|');
    for (const t of r.tests || []) {
      w(`| ${t.name} | ${list(t.match)} | ${days(t.intervalDays)} | ${days(t.dueSoonDays)} |`);
    }
    w();
  } else if (r.type === 'event-count') {
    w(
      `**Trigger:** count of \`${r.sourceKind}\` matching ${list(r.match)} ` +
        `${r.operator} ${r.countThreshold} within ${r.windowMonths} months.`
    );
    if (r.exclude && r.exclude.length) w(`**Excluded terms:** ${list(r.exclude)}`);
    w(`**Demographics:** age ${ageStr(r.ageRange)}, sex ${sexStr(r.sex)}`);
    w();
  } else if (r.type === 'composite') {
    w(`**Trigger:** \`${r.operator}\` across rule IDs ${list(r.ruleIds)}.`);
    w();
  } else if (r.type === 'qof-indicator') {
    w(`**Indicator:** \`${r.indicatorCode}\` — ${r.indicatorName}`);
    if (r.check) {
      const c = r.check;
      w(
        `**Check (${c.kind}):** observation ${list(c.observation)}, direction ${c.direction}, ` +
          `≥${c.minPoints} points within ${c.withinMonths} months, minimum delta ${c.minDelta}.`
      );
    }
    w(`**Demographics:** age ${ageStr(r.ageRange)}, sex ${sexStr(r.sex)}`);
    w();
  }

  w(`**Source:** ${r.source || a.source || '—'}`);
  w();
  if (r.notes) {
    w(`**Notes:** ${r.notes}`);
    w();
  }
}

// ---------------------------------------------------------------- part 5

w('---');
w();
w('## Part 5 — Explicit "no monitoring required" suppression list');
w();
for (const r of noMon) {
  w(`### \`${r.id}\``);
  w();
  w(`**Notes:** ${r.notes}`);
  w();
  w(`**Drugs (${(r.drug.match || []).length}):** ${list(r.drug.match)}`);
  w();
  if (r.drug.exclude && r.drug.exclude.length) {
    w(`**Excluded:** ${list(r.drug.exclude)}`);
    w();
  }
}

// ---------------------------------------------------------------- caveats

w('---');
w();
w('## Known limitations (carry these into any downstream report)');
w();
w(
  '1. **Coded records only.** Every rule reads the GP record. Vaccines given at a pharmacy, ' +
    'bloods taken in secondary care, and uncoded diagnoses are invisible — a "due" or "no data" ' +
    'state is not proof the activity did not happen.'
);
w(
  '2. **Substring matching under-matches silently.** A brand absent from a `match` list produces ' +
    'no alert and no error. Brand-list completeness is guarded by `test-drug-brand-coverage.js`.'
);
w(
  '3. **`exclude` over-suppresses.** Any drug containing an exclude string is dropped, including ' +
    'legitimate prescriptions.'
);
w(
  '4. **Intervals are stable-maintenance intervals.** Intensified initiation/titration monitoring ' +
    'is described in the notes but not enforced (except the ACE-I/ARB post-initiation U&E).'
);
w(
  '5. **Drug–allergy rules need the Transactional feed.** On the legacy feed there is no allergy ' +
    'bundle and they never fire.'
);
w(
  '6. **Pregnancy-episode vaccines are not encoded.** Pertussis-in-pregnancy and RSV-in-pregnancy ' +
    'are deliberately omitted — the engine has no per-pregnancy or gestational-age gate.'
);
w(
  '7. **`trend-1` (rising PSA) reports `no_data` in practice** — only the latest PSA is available ' +
    'from the investigation dashboard API; multi-point history is not yet exposed.'
);
w(
  '8. **Some sources are pending primary confirmation.** Several Keeper passes were corroborated ' +
    'against secondary reproductions because gov.uk / BNF / journal PDFs returned 403. These are ' +
    'flagged in the per-rule notes and in the file-level spec versions above.'
);
w();

fs.mkdirSync(DOCS, { recursive: true });
const md = lines.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';

// ---------------------------------------------------------------- json twin

const json = {
  generatedBy: 'scripts/gen-sentinel-reference.js',
  suiteVersion: manifest.version,
  scope: 'Sentinel clinical rules excluding QOF (rules/qof-rules.json)',
  sources: {
    drugRules: { file: 'rules/drug-rules.json', lastUpdated: drugDoc.lastUpdated, specVersion: drugDoc.specVersion },
    vaccineRules: {
      file: 'rules/vaccine-rules.json',
      lastUpdated: vaxDoc.lastUpdated,
      specVersion: vaxDoc.specVersion,
    },
    alertLibrary: {
      file: 'rules/alert-library.json',
      version: alertDoc.version,
      lastUpdated: alertDoc.lastUpdated,
      specVersion: alertDoc.specVersion,
    },
  },
  matchingSemantics: {
    matching: 'case-insensitive substring against drug/observation name',
    exclude: 'any name containing an exclude string is dropped entirely',
    statuses: ['in_date', 'due_soon', 'overdue', 'stale', 'no_data', 'recently_initiated'],
    severities: { red: 'alert/actionable', amber: 'caution', info: 'awareness only' },
  },
  drugMonitoring: monitoring,
  drugAllergy: allergy,
  noMonitoring: noMon,
  vaccines: vaxDoc.rules,
  alertLibrary: alertDoc.library,
};

const jsonText = JSON.stringify(json, null, 2) + '\n';

if (process.argv.includes('--check')) {
  const stale = [];
  if (!fs.existsSync(MD_OUT) || fs.readFileSync(MD_OUT, 'utf8') !== md) stale.push(MD_OUT);
  if (!fs.existsSync(JSON_OUT) || fs.readFileSync(JSON_OUT, 'utf8') !== jsonText) stale.push(JSON_OUT);
  if (stale.length) {
    console.error('STALE — run `node scripts/gen-sentinel-reference.js`:\n  ' + stale.join('\n  '));
    process.exit(1);
  }
  console.log('Sentinel reference is up to date.');
  process.exit(0);
}

fs.writeFileSync(MD_OUT, md);
fs.writeFileSync(JSON_OUT, jsonText);
console.log(
  `Wrote ${path.relative(ROOT, MD_OUT)} (${md.split('\n').length} lines) and ` +
    `${path.relative(ROOT, JSON_OUT)}\n` +
    `  ${monitoring.length} monitoring · ${allergy.length} drug-allergy · ` +
    `${vaxDoc.rules.length} vaccine · ${alertDoc.library.length} safety alerts`
);
