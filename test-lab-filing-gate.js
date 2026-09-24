// Medicus Suite — Lab Filing: union-only combination + shadow log (Phase E, stage E1). UNWIRED elsewhere until this
// file's assertions are joined by wiring tests. See engine/lab-filing-gate.js for the contract.
// Run with: node test-lab-filing-gate.js

'use strict';
const fs = require('fs');
const path = require('path');
const LFG = require('./engine/lab-filing-gate.js');

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

const okResult = (blockers, meta) => ({ ok: true, blockers: blockers || [], reasonKinds: [], meta: meta || {} });
const failResult = (error) => ({ ok: false, error: error || 'boom' });

console.log('--- combineFilingBlockers: union-only ---');
{
  const c1 = LFG.combineFilingBlockers([], okResult([]));
  check(c1.blockers.length === 0 && c1.usedCatalogue === true, 'both clean -> clean, and the catalogue was used');

  const c2 = LFG.combineFilingBlockers(['legacy says no'], okResult([]));
  check(
    c2.blockers.length === 1 && c2.blockers[0] === 'legacy says no' && c2.usedCatalogue === true,
    'the catalogue engine can NEVER remove a legacy blocker — legacy alone blocked, still blocked'
  );

  const c3 = LFG.combineFilingBlockers([], okResult(['catalogue says no']));
  check(
    c3.blockers.length === 1 && c3.blockers[0] === 'catalogue says no',
    'the catalogue engine CAN add a blocker legacy never had'
  );

  const c4 = LFG.combineFilingBlockers(['a'], okResult(['b']));
  check(c4.blockers.length === 2 && c4.blockers.includes('a') && c4.blockers.includes('b'), 'both sets combine');

  const c5 = LFG.combineFilingBlockers(['same'], okResult(['same']));
  check(c5.blockers.length === 1, 'an identical reason from both engines is not duplicated');

  const c6 = LFG.combineFilingBlockers([], failResult('catalogue threw'));
  check(
    c6.blockers.length === 0 && c6.usedCatalogue === false,
    'catalogue ok:false with no catalogueOnly flag -> legacy alone, NEVER a blanket deny of a legacy clearance'
  );
  const c7 = LFG.combineFilingBlockers(['legacy blocker'], failResult('catalogue threw'));
  check(
    c7.blockers.length === 1 && c7.blockers[0] === 'legacy blocker' && c7.usedCatalogue === false,
    'catalogue ok:false with a legacy blocker present -> the legacy blocker survives, and no blanket deny is invented'
  );
  const c8 = LFG.combineFilingBlockers(['x'], null);
  check(c8.blockers.length === 1 && c8.usedCatalogue === false, 'no catalogue result at all behaves like ok:false');

  const c9 = LFG.combineFilingBlockers([], failResult('catalogue threw'), { catalogueOnly: true });
  check(
    c9.usedCatalogue === false && c9.blockers.length === 1 && c9.blockers[0] === LFG.CATALOGUE_UNAVAILABLE_BLOCKER,
    'catalogue ok:false with no legacy profile (catalogueOnly) BLOCKS — filing must not proceed on the generic baseline'
  );
  const c10 = LFG.combineFilingBlockers(['legacy blocker'], failResult('catalogue threw'), { catalogueOnly: false });
  check(
    c10.blockers.length === 1 &&
      c10.blockers[0] === 'legacy blocker' &&
      !c10.blockers.includes(LFG.CATALOGUE_UNAVAILABLE_BLOCKER),
    'catalogue ok:false with a legacy blocker and catalogueOnly false keeps that blocker and does not add the catalogue-only deny'
  );
  const c11 = LFG.combineFilingBlockers([], okResult([]), { pendingCatalogueMissing: true });
  check(
    c11.usedCatalogue === true && c11.blockers.includes(LFG.PENDING_CATALOGUE_BLOCKER),
    'a missing pending catalogue adds a blocker even when the approved catalogue itself is clean — an unapproved range must not fall back to the lab range'
  );
  const c12 = LFG.combineFilingBlockers(['legacy says no'], failResult('x'), {
    catalogueOnly: false,
    pendingCatalogueMissing: true,
  });
  check(
    c12.usedCatalogue === false &&
      c12.blockers.includes('legacy says no') &&
      c12.blockers.includes(LFG.PENDING_CATALOGUE_BLOCKER) &&
      !c12.blockers.includes(LFG.CATALOGUE_UNAVAILABLE_BLOCKER),
    'pending catalogue missing still blocks alongside a legacy profile, without turning ok:false into a blanket catalogue deny'
  );
  const c13 = LFG.combineFilingBlockers([], okResult(['catalogue says no']), { pendingCatalogueMissing: true });
  check(
    c13.blockers.includes('catalogue says no') && c13.blockers.includes(LFG.PENDING_CATALOGUE_BLOCKER),
    'the pending-load blocker is added on top of real catalogue blockers, not instead of them'
  );
}

console.log('\n--- buildShadowLogEntry: shape and the two directions ---');
{
  const clean = LFG.buildShadowLogEntry({
    taskUuid: 't1',
    legacyBlockers: [],
    catalogueResult: okResult([], {
      labId: 'rj700-general-pathology',
      recognisedCount: 3,
      unrecognisedCount: 0,
      groupsUsed: ['LFTs'],
    }),
  });
  check(
    clean.wouldHaveUnblocked === false && clean.wouldHaveAddedBlock === false,
    'both clean -> neither direction fires'
  );
  check(clean.taskUuid === 't1' && clean.labId === 'rj700-general-pathology', 'taskUuid and labId (from meta) carried');
  check(clean.recognisedCount === 3 && clean.unrecognisedCount === 0, 'recognition counts carried from meta');
  check(JSON.stringify(clean.groupsUsed) === '["LFTs"]', 'groupsUsed carried, sorted');
  check(typeof clean.ts === 'string' && !Number.isNaN(Date.parse(clean.ts)), 'ts is a real ISO timestamp');

  const dangerous = LFG.buildShadowLogEntry({
    taskUuid: 't2',
    legacyBlockers: ['ALP is above range'],
    catalogueResult: okResult([], { labId: 'rj700-general-pathology' }),
  });
  check(
    dangerous.wouldHaveUnblocked === true && dangerous.wouldHaveAddedBlock === false,
    'legacy blocks, catalogue would not -> the DANGEROUS direction is flagged (H-080’s whole reason to exist)'
  );

  const safe = LFG.buildShadowLogEntry({
    taskUuid: 't3',
    legacyBlockers: [],
    catalogueResult: okResult(['not set up at this lab'], { labId: 'rj700-general-pathology' }),
  });
  check(
    safe.wouldHaveAddedBlock === true && safe.wouldHaveUnblocked === false,
    'catalogue blocks, legacy would not -> the SAFE direction (stricter, expected, not itself a concern)'
  );

  const bothBlock = LFG.buildShadowLogEntry({
    taskUuid: 't4',
    legacyBlockers: ['x'],
    catalogueResult: okResult(['y'], {}),
  });
  check(
    bothBlock.wouldHaveUnblocked === false && bothBlock.wouldHaveAddedBlock === false,
    'both block (for different reasons or the same one) -> neither direction fires; agreement is not a divergence'
  );

  const problem = LFG.buildShadowLogEntry({ taskUuid: 't5', legacyBlockers: [], catalogueResult: failResult('threw') });
  check(
    problem.catalogueOk === false &&
      problem.catalogueError === 'threw' &&
      problem.wouldHaveUnblocked === false &&
      problem.wouldHaveAddedBlock === false,
    'the catalogue engine failing to evaluate is recorded as its own thing, not silently read as either direction'
  );
}

console.log('\n--- shadow log entries never carry a patient value ---');
{
  const withReasonKinds = LFG.buildShadowLogEntry({
    taskUuid: 't6',
    legacyBlockers: [],
    catalogueResult: {
      ok: true,
      blockers: ['ALP (200 u/L) is above your practice maximum of 130'], // the human sentence — has a value
      reasonKinds: ['above-practice-range'], // the value-free twin — this is what the log must use
      meta: { labId: 'rj700-general-pathology', recognisedCount: 1, unrecognisedCount: 0, groupsUsed: ['LFTs'] },
    },
  });
  const flat = JSON.stringify(withReasonKinds);
  check(!/200/.test(flat), 'the shadow log entry does not repeat the raw result value from the blocker sentence');
  check(!/ALP \(/.test(flat), 'the shadow log entry does not repeat the human blocker sentence at all');
  check(
    JSON.stringify(withReasonKinds.catalogueReasonKinds) === '["above-practice-range"]',
    'catalogueReasonKinds carries only the short, value-free tag'
  );
  const missing = LFG.buildShadowLogEntry({
    taskUuid: 't7',
    legacyBlockers: [],
    catalogueResult: { ok: true, blockers: ['some sentence'], meta: {} }, // reasonKinds accidentally omitted
  });
  check(
    Array.isArray(missing.catalogueReasonKinds) && missing.catalogueReasonKinds.length === 0,
    'a caller that forgets reasonKinds gets an empty array, never a crash and never the blockers text as a fallback'
  );
}

console.log('\n--- never throws on malformed input ---');
{
  check(LFG.combineFilingBlockers(undefined, undefined).blockers.length === 0, 'combine with nothing at all');
  check(
    LFG.combineFilingBlockers('not an array', 'not a result').usedCatalogue === false,
    'combine with garbage types'
  );
  const entry = LFG.buildShadowLogEntry(undefined);
  check(
    entry && entry.taskUuid === null && entry.catalogueOk === false && Array.isArray(entry.groupsUsed),
    'buildShadowLogEntry with no opts at all still returns a well-shaped, value-free entry'
  );
  const garbage = LFG.buildShadowLogEntry({ taskUuid: 123, legacyBlockers: 'nope', catalogueResult: 'nope' });
  check(
    garbage.taskUuid === null && garbage.legacyBlockerCount === 0,
    'wrong-typed fields are read as absent, not thrown on'
  );
}

console.log('\n--- purity: no DOM / chrome.* / fetch / storage in this engine’s own source ---');
{
  const src = fs.readFileSync(path.join(__dirname, 'engine', 'lab-filing-gate.js'), 'utf8');
  const stripped = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  check(!/\bchrome\./.test(stripped), 'no chrome.* reference');
  check(!/\bdocument\b/.test(stripped), 'no document reference');
  check(!/\bfetch\(/.test(stripped), 'no fetch(...)');
  check(!/\bstorage\b/i.test(stripped), 'no storage reference');
}

console.log('\n--- wiring: manifest loads the two new engine files before the button script ---');
{
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));
  const group = manifest.content_scripts.find(
    (g) => Array.isArray(g.js) && g.js.includes('content-scripts/triage-lens/lab-file-button.js')
  );
  check(!!group, "lab-file-button.js's content_scripts group was found");
  const idx = (name) => (group ? group.js.indexOf(name) : -1);
  check(
    idx('shared/lab-filing-utils.js') >= 0 &&
      idx('engine/lab-filing-catalogue.js') > idx('shared/lab-filing-utils.js') &&
      idx('engine/lab-filing-gate.js') > idx('engine/lab-filing-catalogue.js') &&
      idx('content-scripts/triage-lens/lab-file-button.js') > idx('engine/lab-filing-gate.js'),
    'load order: lab-filing-utils.js, then the catalogue adapter, then the gate, then the button script'
  );
}

console.log('\n--- wiring: lab-file-button.js runs the mandatory shadow log (E1), unconditionally ---');
{
  const src = fs.readFileSync(path.join(__dirname, 'content-scripts', 'triage-lens', 'lab-file-button.js'), 'utf8');
  check(/const LFC = window\.LabFilingCatalogue/.test(src), 'reads the catalogue adapter global');
  check(/const LFG = window\.LabFilingGate/.test(src), 'reads the gate/shadow-log global');
  check(
    /CATALOGUE_SHADOW_KEY = 'labfiling\.catalogueShadowLog'/.test(src),
    'the shadow log has its OWN storage key, separate from labfiling.auditLog (the real filing audit)'
  );
  check(
    (src.match(/runFilingShadow\(rs, blockers\)/g) || []).length === 2,
    'the shadow evaluation runs from both the poll-time gate (evaluateGate) and the click-time re-verification (onAction)'
  );
  check(
    /LFC\.evaluateFilingCatalogue\(rs\.report, catalogue,/.test(src),
    'the catalogue engine is actually invoked by the shadow log, not just referenced'
  );
  check(
    /LFG\.buildShadowLogEntry\(\{/.test(src) && /chrome\.storage\.local\.set\(\{ \[CATALOGUE_SHADOW_KEY\]/.test(src),
    'a shadow entry is built and written to its own ring buffer, capped like the existing audit log'
  );
  check(
    /if \(area !== 'local' \|\| !changes\['labcatalogue\.practice'\]\) return;\s*\n\s*resetFilingCatalogue\(\);/.test(
      src
    ),
    'the cached acting catalogue is invalidated on the same storage change Phase D already listens for'
  );
  check(
    /resetFilingCatalogue\(\); \/\/ approvals\/edits change the acting catalogue[\s\S]*?scheduleEval\(\);\s*\n\s*\}\);/.test(
      src
    ),
    "invalidating the cache alone used to do nothing until something else happened to re-run the gate — approving on the Investigations page (a separate tab) fires this exact storage change but the blocked card sat there stale until an unrelated Medicus SPA re-render happened to poll again, sometimes never (Nick, 2026-09-26: \"re-approved, and the same thing appears — it's still blocked\"). scheduleEval() is now called explicitly, same as every other cache-affecting storage key already does"
  );
  check(
    /meds are deliberately NOT fetched here/.test(src),
    'the shadow log itself still does not fetch meds (documented scope limit) — only the real E2 combine below does'
  );
}

console.log(
  '\n--- wiring: E2 opt-in union-only combine — legacy AND the shadow catalogue evaluation both gate a real filing when chosen ---'
);
{
  const src = fs.readFileSync(path.join(__dirname, 'content-scripts', 'triage-lens', 'lab-file-button.js'), 'utf8');
  check(
    /const filingEngineWanted = \(\) => filingEnginePref === 'catalogue'/.test(src) &&
      /filingEnginePref = tc && tc\.prefs && tc\.prefs\.filingEngine === 'catalogue' \? 'catalogue' : 'legacy'/.test(
        src
      ),
    'the engine choice is opt-in, off (legacy) by default, read from triagelens.config.prefs.filingEngine (not labfiling.config) so it gets defaults.json governance and practice-wide publishing, same as oirEngine'
  );
  check(
    /async function combineWithCatalogueIfWanted\(rs, legacyBlockers, opts\)/.test(src) &&
      /LFG\.combineFilingBlockers\(\[\.\.\.legacyBlockers, \.\.\.extraBlockers\], catResult, \{/.test(src) &&
      /catalogueOnly,/.test(src) &&
      /pendingCatalogueMissing: !pendingCatalogue/.test(src),
    "one shared helper does the union-only combine (engine/lab-filing-gate.js's own contract), and tells it when this is catalogue-only and when the pending catalogue failed to load"
  );
  check(
    (src.match(/combineWithCatalogueIfWanted\(rs, blockers, \{ catalogueOnly: !/g) || []).length === 2,
    'the combine runs from BOTH the poll-time gate (evaluateGate, what is offered) and the click-time re-verification (onAction, what actually proceeds) — they must never disagree about what is blocked, and each passes catalogueOnly from the real legacy profile'
  );
  check(
    /if \(!filingEngineWanted\(\) \|\| !rs \|\| !rs\.report\) {\s*\n\s*return {\s*\n\s*blockers: legacyBlockers,\s*\n\s*engine: 'legacy',\s*\n\s*catalogueUnresolvedComments: \[\],\s*\n\s*catalogueUnapprovedGroups: \[\],\s*\n\s*};/.test(
      src
    ),
    'when the catalogue engine is not opted in, the legacy blockers pass through UNCHANGED'
  );
  check(
    /if \(!LFC \|\| !LFG\) \{/.test(src) &&
      /LFG\.combineFilingBlockers\(legacyBlockers, \{ ok: false \}, \{ catalogueOnly \}\)/.test(src),
    'if the catalogue adapter is missing while the engine is opted in, catalogue-only fail-closes and a legacy profile stays on its own blockers'
  );
  check(
    /const anyMedGuard =[\s\S]{0,220}excludeIfMeds\.length\)/.test(src) &&
      /if \(meds === null\) extraBlockers\.push\('could not check this patient/.test(src),
    'meds are fetched for the catalogue engine only when a catalogue guard actually needs them, and a fetch failure fails CLOSED (adds a blocker), same doctrine as the legacy meds check'
  );
  check(
    /combined\.usedCatalogue \? 'catalogue' : 'catalogue-fallback'/.test(src),
    "a catalogue evaluation that could not run (ok:false) is reported as 'catalogue-fallback', never silently read as 'nothing to add'"
  );
  check(
    /recordAudit\(profile, res, rs, combined\.engine\)/.test(src) && /engine: filingEngine \|\| 'legacy'/.test(src),
    'the audit trail records which engine actually decided a real filing — legacy, catalogue, or catalogue-fallback'
  );
}

console.log('\n--- wiring: the filing-engine choice lives on the Lab filing settings page ---');
{
  const src = fs.readFileSync(path.join(__dirname, 'options', 'labfiling-section.js'), 'utf8');
  check(
    /data-act="set-filing-engine"/.test(src) && /await persistFilingEngine\(el\.value\)/.test(src),
    "a select control on the Lab filing settings page sets it — persisted into triagelens.config.prefs, not labfiling.config (persistFilingEngine), mirroring Outstanding Requests' own engine pref"
  );
  check(
    /await chrome\.storage\.local\.get\('triagelens\.config'\)/.test(src) &&
      /prefs: \{ \.\.\.\(tc\.prefs \|\| \{\}\), filingEngine: engine \}/.test(src),
    'the write re-reads triagelens.config fresh and only touches its own pref key, so a concurrent edit on the Triage Lens options page is never clobbered'
  );
  check(
    /engine === 'legacy' \? 'selected'/.test(src) && /engine === 'catalogue' \? 'selected'/.test(src),
    'the control reflects the currently-saved choice, defaulting to legacy when unset'
  );
}

console.log('\n--- wiring: the catalogue engine can operate with ZERO legacy profiles (2026-09-25 fix) ---');
{
  const src = fs.readFileSync(path.join(__dirname, 'content-scripts', 'triage-lens', 'lab-file-button.js'), 'utf8');
  check(
    /if \(!profiles\.some\(\(p\) => p && p\.enabled === true\) && !engineWanted\) {/.test(src),
    'the "no enabled legacy profile" early exit no longer fires when the catalogue engine is opted in — this was the exact bug: it hid the button before the catalogue was ever consulted'
  );
  check(
    /const profile = merge && merge\.effective; \/\/ null is fine now/.test(src),
    'a null profile (nothing legacy matched) is allowed to flow through, not treated as an immediate hide'
  );
  check(
    /function catalogueScreenText\(catalogue\)/.test(src) &&
      /const screenText = profile \? profile\.filing : catalogueScreenText\(catalogueForScreen\)/.test(src),
    "with no legacy profile, the catalogue's own practice-wide screen wording (or the standard default) is used to find the File button, instead of a profile's"
  );
  check(
    /let currentLegacyProfile = null;/.test(src) &&
      /currentLegacyProfile = profile;/.test(src) &&
      /const eff = effectiveScore\(rs, profile, catalogueForScreen\);/.test(src) &&
      /computeProfileBlockers\(rs, profile\)/.test(src),
    'blocker computation uses the REAL (possibly null) legacy profile, not a synthetic one — a truthy-but-empty profile object would make unrecognisedAnalyteBlockers flag every result as unrecognised, which is the opposite of what catalogue-only mode needs'
  );
  check(
    /function catalogueDisplayProfile\(screenText, limits\)/.test(src) &&
      /paramsOverrideLabFlags: lim\.paramsOverrideLabFlags === true/.test(src) &&
      /profile \|\|\s*\n?\s*catalogueDisplayProfile\(/.test(src) &&
      /showButton\(displayProfile\);/.test(src) &&
      /LFC\.practiceConfirmLimits\(rs\.report, catalogueForScreen\)/.test(src),
    'catalogue-only builds a display profile whose confirm-dialog parameters are the practice ranges (and the lab-flag override flag), not an empty profile that would reprint the lab range'
  );
  check(
    /const confirmProfile = legacyProfile/.test(src) &&
      /LFC\.practiceConfirmLimits\(rs\.report, catalogueForAction\)/.test(src) &&
      /profile: confirmProfile,/.test(src),
    'the click-time confirm is rebuilt from the catalogue fetched for this report, so the dialog matches the ranges that just cleared the file'
  );
  check(
    /commitMode 'confirm' \(not the 'manual' pre-fill-only default\)/.test(src),
    "catalogue-only mode files with one click (commitMode 'confirm', not 'manual') — 'manual' only pre-fills, leaving the clinician to ALSO press Medicus's own File button, which is the double-click Nick asked to remove (2026-09-25)"
  );
  check(
    /const legacyProfile = currentLegacyProfile;/.test(src) &&
      /const eff = effectiveScore\(rs, legacyProfile, catalogueForAction\);/.test(src) &&
      /await computeProfileBlockers\(rs, legacyProfile\)/.test(src),
    "onAction's click-time re-verification uses the same real-legacy-profile split as evaluateGate — the two must never disagree about whether something is a real legacy match or a synthetic one"
  );
}

console.log(
  '\n--- regression: computeProfileBlockers must not crash on a null profile (2026-09-25, Nick live-caught) ---'
);
{
  const src = fs.readFileSync(path.join(__dirname, 'content-scripts', 'triage-lens', 'lab-file-button.js'), 'utf8');
  check(
    !/if \(Array\.isArray\(profile\.excludeIfMeds\)/.test(src),
    'the old unguarded "profile.excludeIfMeds" read is gone (it threw on a null profile — an UNCAUGHT PROMISE REJECTION that silently aborted evaluateGate()/onAction() partway through, so nothing after it — the shadow log, the catalogue combine, the button/blocked card — ever ran, on EVERY poll, for a catalogue-only screen)'
  );
  check(
    /if \(profile && Array\.isArray\(profile\.excludeIfMeds\) && profile\.excludeIfMeds\.length\) {/.test(src),
    'computeProfileBlockers now guards the null-profile case the same way every other check inside it already did'
  );
}

console.log(
  '\n--- wiring: a pending range/guard must be checked BEFORE offering assisted filing (Nick, 2026-09-25) ---'
);
{
  const src = fs.readFileSync(path.join(__dirname, 'content-scripts', 'triage-lens', 'lab-file-button.js'), 'utf8');
  check(
    /function ensureFilingCataloguePending\(\)/.test(src) &&
      /window\s*\n?\s*\.labcatalogueLoadEffective\(\{ includeUnreviewed: true \}\)/.test(src),
    'a second, separately-cached catalogue fetch exists with includeUnreviewed:true — every filing entry then carries its own reviewed flag instead of unreviewed ones being silently absent'
  );
  check(
    /_pendingFilingCataloguePromise = null;/.test(src),
    'it is invalidated on the same labcatalogue.practice storage change that invalidates the approved-only one — an approval must be picked up immediately, not on the next page load'
  );
  check(
    (src.match(/pendingCatalogue/g) || []).length >= 4,
    'pendingCatalogue is threaded through — fetched, and passed into BOTH real evaluateFilingCatalogue calls (the E2 combine AND the shadow log), not just one'
  );
  check(
    /const \[catalogue, pendingCatalogue\] = await Promise\.all\(\[\s*\n\s*ensureFilingCatalogue\(\),\s*\n\s*ensureFilingCataloguePending\(\),\s*\n\s*\]\);/.test(
      src
    ),
    'the E2 combine fetches both catalogues (approved-only for recognition, pending for the awaiting-approval check) in parallel'
  );
}

console.log(
  '\n--- wiring: whitelisting a catalogue-blocked comment writes into the report group it belongs to (2026-09-25) ---'
);
{
  const src = fs.readFileSync(path.join(__dirname, 'content-scripts', 'triage-lens', 'lab-file-button.js'), 'utf8');
  check(
    /const OV = window\.LabCatalogueOverlay;/.test(src),
    'the overlay module is loaded so the catalogue whitelist write can call OV.setFilingGroup directly'
  );
  check(
    /catalogueUnresolvedComments: LFC\.commentsForWhitelist\(rs\.report, catalogue\),/.test(src),
    "the catalogue engine's structured comment data is carried out of combineWithCatalogueIfWanted, not discarded (now sourced from commentsForWhitelist rather than evaluateFilingCatalogue's own narrower unresolvedComments — see the dedicated 2026-09-26 block below)"
  );
  check(
    /showBlockedHint\(\s*\n\s*combined\.blockers,\s*\n\s*profile,\s*\n\s*commentedResults,\s*\n\s*currentMatchedProfiles,\s*\n\s*combined\.catalogueUnresolvedComments,\s*\n\s*combined\.catalogueUnapprovedGroups,\s*\n\s*catalogueForScreen\s*\n\s*\)/.test(
      src
    ),
    'they reach the blocked card, alongside the existing legacy-profile comment list — two separate sources, not conflated'
  );
  check(
    /function renderCatalogueWhitelistBox\(comments\)/.test(src) &&
      /catalogueWhitelistBox\.appendChild\(saveBtn\)/.test(src),
    'a SEPARATE checkbox box exists for catalogue comments (different target/persistence from the legacy profile whitelist box)'
  );
  check(
    /async function whitelistSelectedCatalogueComments\(checks, saveBtn\)/.test(src) &&
      /allowComments: existingAllow\.concat\(toAdd\),\s*\n\s*overrideLabFlag: !!\(existing && existing\.overrideLabFlag\),/.test(
        src
      ),
    'saving writes into the (lab, heading) report group\'s allowComments via the tested pure overlay operation, explicitly disables the group, and preserves any lab-flag override already set on it — same "any change re-opens review, and switches off" safety posture as the legacy save'
  );
  check(
    /typeof LF\.allowCommentProblem === 'function' \? LF\.allowCommentProblem\(c\.residue\) : ''/.test(src) &&
      (src.match(/allowCommentProblem/g) || []).length >= 2,
    'a comment too short/generic to whitelist is refused with the reason, same guard as the legacy save — never silently accepted'
  );
  check(
    /await window\.labcatalogueSaveOverlay\(overlay\);/.test(src) && /scheduleEval\(\);/.test(src),
    'the save persists via the tested IO helper, then explicitly asks for a re-evaluation — a labcatalogue.practice write only invalidates the cached catalogue, it does not itself trigger a re-render the way a legacy STORE_PROFILES write does'
  );
}

console.log(
  '\n--- regression: a whitelisted + re-approved catalogue comment must not stay blocked forever (2026-09-25, Nick live-caught) ---'
);
{
  const src = fs.readFileSync(path.join(__dirname, 'content-scripts', 'triage-lens', 'lab-file-button.js'), 'utf8');
  check(
    /function catalogueAllowComments\(catalogue\)/.test(src) &&
      /catalogue\.filing\.groups\.flatMap\(\(g\) => \(Array\.isArray\(g\.allowComments\) \? g\.allowComments : \[\]\)\)/.test(
        src
      ),
    "a helper gathers every report group's allowComments practice-wide, for the baseline comment check to fall back on when there is no legacy profile"
  );
  check(
    /function effectiveScore\(rs, profile, catalogue\)/.test(src),
    'effectiveScore() takes the catalogue object itself (not just a derived comment list) — it now also needs it for the lab-flag override fix below'
  );
  check(
    /const commentProfile = allow\.length \? { allowComments: allow } : null;/.test(src),
    'the comment-only pseudo-profile is built ONLY inside the no-legacy-profile branch — used for the comment check (fileabilityBlockers/logCommentDebug), never returned or passed anywhere else, so it cannot reintroduce the unrecognisedAnalyteBlockers-blocks-everything bug (that lives in computeProfileBlockers, a completely separate function this pseudo-profile never reaches)'
  );
  check(
    /effectiveScore\(rs, profile, catalogueForScreen\)/.test(src),
    'evaluateGate() passes the catalogue it already fetched for screen-text lookup straight through — no extra fetch'
  );
  check(
    /const catalogueForAction = !legacyProfile && filingEngineWanted\(\) \? await ensureFilingCatalogue\(\) : null;/.test(
      src
    ) && /effectiveScore\(rs, legacyProfile, catalogueForAction\)/.test(src),
    "onAction()'s click-time re-verification does the same lookup (via the cached ensureFilingCatalogue(), so no real extra cost) — must never disagree with evaluateGate() about whether a whitelisted comment now passes"
  );
}

console.log(
  "\n--- regression: the catalogue lab-flag override must reach the baseline severity gate, not just this engine's own blockers (2026-09-25, Nick live-caught) ---"
);
{
  const engineSrc = fs.readFileSync(path.join(__dirname, 'engine', 'lab-filing-catalogue.js'), 'utf8');
  check(
    /function applyCatalogueOverrides\(report, catalogue\)/.test(engineSrc) &&
      /practiceConfirmLimits,\s*\n\s*commentsForWhitelist,/.test(engineSrc),
    "engine/lab-filing-catalogue.js exports a pure applyCatalogueOverrides mirroring shared/lab-filing-utils.js's applyParamOverrides — same safety bounds (never touches urgent, unit-safe, comparator-censored never clears, only within-bounds values clear)"
  );
  const btnSrc = fs.readFileSync(path.join(__dirname, 'content-scripts', 'triage-lens', 'lab-file-button.js'), 'utf8');
  check(
    /const adj = useCatalogue \? LFC\.applyCatalogueOverrides\(rs\.report, catalogue\) : rs\.report;/.test(btnSrc) &&
      /const severity = useCatalogue\s*\n\s*\? SEV\.evaluateReportSeverity\(adj, { priorityDisplay: '', resultRules, problems: \[\] }\)\s*\n\s*: rs\.severity;/.test(
        btnSrc
      ),
    'effectiveScore()\'s no-legacy-profile branch applies the catalogue override and RE-SCORES severity on the adjusted report — mirroring exactly what the legacy paramsOverrideLabFlags branch below it already does for a legacy profile, so a catalogue-approved override guard can actually clear the baseline "not every result is within normal limits" block, not just this engine\'s own "lab-flagged-abnormal" reason'
  );
}

console.log(
  '\n--- blocked card: the full reasons list can be expanded, not just the truncated "(+N more)" line (2026-09-25, Nick) ---'
);
{
  const btnSrc = fs.readFileSync(path.join(__dirname, 'content-scripts', 'triage-lens', 'lab-file-button.js'), 'utf8');
  check(
    /host\.appendChild\(subEl\);\s*\n\s*host\.appendChild\(reasonsEl\);/.test(btnSrc),
    'the expandable reasons list sits right after the truncated summary line in the card'
  );
  check(
    /reasons\.forEach\(\(r\) => reasonsList\.appendChild\(el\('li', null, r\)\)\);/.test(btnSrc),
    'every reason (not just the first two) is listed when expanded, in full — the same text subEl already truncates'
  );
  check(
    /const sig = JSON\.stringify\(reasons\);\s*\n\s*if \(sig !== reasonsSignature\)/.test(btnSrc),
    'rebuilding the list is gated on the reasons actually having changed — evaluateGate() re-renders the card on every observed page change (often more than once a second), and an unconditional rebuild would reset reasonsEl.open back to false before the clinician could finish reading it (the same idempotent-rebuild doctrine whitelistSignature already uses)'
  );
  const resets = (btnSrc.match(/(?<!let )reasonsSignature = null;/g) || []).length;
  check(
    resets === 2,
    'the signature is reset in both hideButton() and showButton() (2 sites) — a stale signature must never suppress the first render of a genuinely NEW blocked state'
  );
}

console.log(
  '\n--- comment whitelisting now works even with no approved filing setup at all (2026-09-26, Nick) ---'
);
{
  const btnSrc = fs.readFileSync(path.join(__dirname, 'content-scripts', 'triage-lens', 'lab-file-button.js'), 'utf8');
  check(
    /catalogueUnresolvedComments: LFC\.commentsForWhitelist\(rs\.report, catalogue\),/.test(btnSrc),
    "combineWithCatalogueIfWanted sources the whitelist checkbox data from commentsForWhitelist (every commented result whose heading is KNOWN to the lab), not evaluateFilingCatalogue's own unresolvedComments (which never even checks a result belonging to a group that isn't approved+enabled yet)"
  );
}

console.log(
  '\n--- "Set up on Investigations page" button, for a heading with no approved filing setup at all (2026-09-26, Nick) ---'
);
{
  const btnSrc = fs.readFileSync(path.join(__dirname, 'content-scripts', 'triage-lens', 'lab-file-button.js'), 'utf8');
  check(
    /function openInvestigationSetup\(invId\)/.test(btnSrc) &&
      /chrome\.runtime\.sendMessage\(\{ action: 'ms-open-options', section: 'investigations', review: invId \}\);/.test(
        btnSrc
      ),
    "opens the Investigations page, deep-linked to the one test that needs setting up, via the service worker's ms-open-options relay (chrome.tabs.create from the privileged background context) — never a content script's own window.open() to a chrome-extension:// URL, which Edge blocks outright (ERR_BLOCKED_BY_CLIENT) since options/options.html is not in web_accessible_resources (Nick, 2026-09-26, live-caught)"
  );
  const swSrc = fs.readFileSync(path.join(__dirname, 'service-worker.js'), 'utf8');
  check(
    /const review = String\(\(msg && msg\.review\) \|\| ''\);/.test(swSrc) &&
      /const query = \/\^\[a-z0-9-\]\+\$\/\.test\(review\) \? `\?review=\$\{review\}` : '';/.test(swSrc) &&
      /chrome\.tabs\.create\(\{ url: chrome\.runtime\.getURL\('options\/options\.html'\) \+ query \+ suffix \}\);/.test(
        swSrc
      ),
    "the service worker's ms-open-options handler validates `review` against the same slug shape every investigation id already has (shared/lab-catalogue-overlay.js's freshId/slugify) before it ever reaches a URL — a content script must never steer this at anything but a plain id"
  );
  check(
    /case 'ms-open-options': \{/.test(swSrc) &&
      (swSrc.match(/case 'ms-open-options': \{/g) || []).length === 1,
    'reuses the EXISTING ms-open-options relay (already used by reception-quick-actions.js\'s ⚙ button) rather than adding a second, duplicate open-options message type'
  );
  check(
    /catalogueUnapprovedGroups:\s*\n\s*catResult && catResult\.ok && Array\.isArray\(catResult\.unapprovedGroups\) \? catResult\.unapprovedGroups : \[\],/.test(
      btnSrc
    ),
    'combineWithCatalogueIfWanted carries engine/lab-filing-catalogue.js\'s own unapprovedGroups through unchanged — the "is this unambiguous" judgement stays in the pure engine, never re-decided in the DOM layer'
  );
  check(
    /function renderUnapprovedGroupsBox\(groups, catalogue\)/.test(btnSrc) &&
      /if \(!g \|\| !g\.investigationId \|\| seen\.has\(g\.investigationId\)\) continue;/.test(btnSrc),
    'the button box dedupes by investigation — several headings (or the same heading across polls) pointing at the same test only ever offer ONE button for it'
  );
  check(
    /const inv = invs\.find\(\(i\) => i\.id === g\.investigationId\);\s*\n\s*if \(!inv\) continue; \/\/ never offer a test the catalogue can no longer find/.test(
      btnSrc
    ),
    'a suggested investigation id the current catalogue can no longer find (deleted since the engine resolved it) is silently dropped, never a broken link'
  );
  check(
    /showBlockedHint\(\s*\n\s*combined\.blockers,\s*\n\s*profile,\s*\n\s*commentedResults,\s*\n\s*currentMatchedProfiles,\s*\n\s*combined\.catalogueUnresolvedComments,\s*\n\s*combined\.catalogueUnapprovedGroups,\s*\n\s*catalogueForScreen\s*\n\s*\);/.test(
      btnSrc
    ),
    'evaluateGate() threads the resolved catalogue through too, so the button can show the test\'s real label, not just its id'
  );
  // 4 total: the `let` declaration, the render function's own empty-rows early return, plus hideButton() and
  // showButton() — the same "reset it everywhere the box could go stale" doctrine as catalogueWhitelistSignature.
  const resets = (btnSrc.match(/(?<!let )unapprovedGroupsSignature = null;/g) || []).length;
  check(
    resets === 3,
    'the button box\'s signature is reset everywhere it can go stale: its own render function, hideButton(), and showButton()'
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
