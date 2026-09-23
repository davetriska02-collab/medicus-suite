// Medicus Suite — Investigations options section: wiring + source guards. Phase C2.
// The page is DOM code (no unit-testable logic of its own — that lives in the pure modules and is tested there), so
// this guards the things that would silently break it or make it unsafe.
// Run with: node test-investigations-section.js

'use strict';
const fs = require('fs');
const path = require('path');

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
const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');
const src = read('options/investigations-section.js');
const html = read('options/options.html');

console.log('\n── safety of the renderer ──');
check(
  !/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(src),
  'no HTML-string injection (imported text is rendered as text only)'
);
check(!/\beval\(|new Function\(/.test(src), 'no eval');
check(/Not yet used by the suite/.test(src), 'the page says, on the page, that nothing reads the catalogue yet');
check(
  /What does this do\?/.test(src) && /function renderIntro\(\)/.test(src) && /h\('details', \{ class: 'inv-intro'/.test(src),
  'the "What does this do?" explainer is a collapsible disclosure, not a boxed notice'
);
check(
  /You still press File .{1,3} assisted, not automated\./.test(src),
  'the explainer says out loud that this is assisted, not automatic filing'
);
check(
  /S\.matchOpen === undefined\) S\.matchOpen = !\(S\.overlay\.investigations && S\.overlay\.investigations\.length\)/.test(
    src
  ) && /h\('details', \{ class: 'inv-match-details'/.test(src),
  '"Match requests to lab reports" is collapsible, open by default only until the practice has added its own tests'
);
check(/inv-scan-reports/.test(src), 'the "Reports to read" control has its own no-shrink class (fixes the overlap with the lab select)');
check(
  /h\('label', \{ class: 'lf-check inv-scan-reports' \}, 'Lab ', labSel\)/.test(src),
  'the lab select in "Match requests" has its own visible "Lab" label — it read as one run-on control without it'
);
{
  const css = read('options/investigations-section.css');
  check(
    /\.inv-limit\.inv-limit\s*\{/.test(css) && /\.inv-rt-num\.inv-rt-num\s*\{/.test(css),
    'the narrow-input classes repeat themselves for specificity (0,2,0) — options.html’s global input[type] reset ' +
      'is (0,1,1) and silently wins over a bare class, which is what stretched "Reports to read" to full width'
  );
}
check(!/Approve all/i.test(src), 'there is no bulk approve — each test is approved from its own review screen');
check(
  /Clicking 'Approve' means I am approving this test's wordings, results, and codes\. This saves changes above and makes this test active for the features that use this catalogue\./.test(
    src
  ),
  'the review screen states exactly what Approve means, next to the button'
);
check(!/I have checked/.test(src) && !/approveBtn\.disabled/.test(src), 'no fiddly tick-box on the review screen');
const approveButtons = src.match(/btn\(\s*'Approve( result)?',/g) || [];
check(
  approveButtons.length === 3 && /if \(st\.review\) buttons\.appendChild\(btn\('Approve/.test(src),
  'the only Approve buttons are on the review screens (test and result) and ONE filing approval, in the assisted filing bar of the test'
);
check(
  /OV\.approveFilingForTest\(S\.builtin, S\.overlay, st\.id, fLab, REVIEWER\)/.test(src) &&
    !/OV\.approveFiling\(/.test(src) &&
    !/OV\.approveFilingRange\(/.test(src),
  'assisted filing is approved once, for the test at a lab, through the pure helper — there is no per-result, per-range or per-group approve button'
);
check(
  !/inv-rt-fenable|inv-rt-fapproval|'Enable assisted filing'|'Filing approval'/.test(src),
  'there is no per-result "enable assisted filing" or approval column (Medicus files a whole report group)'
);
check(
  /Direction of the change/.test(src) && /trendDirection: st\.dir/.test(src),
  'the trend guard says which way it moved (changed / increased / decreased)'
);
check(
  /Assisted filing on for this test group from ' \+ fLabName/.test(src) &&
    /const fLabName = fLab \? labWords\(fLab\) : ''/.test(src),
  'the assisted filing switch names the lab in words ("… from SWL pathology"), never by its code'
);
check(
  /S\.scrollToAutofiling = true/.test(src) && /inv-af-badge/.test(src),
  'the list badge opens the test at its assisted filing bar'
);
check(
  !/filingLabEntry|OV\.setFilingLabControls/.test(src) &&
    /OV\.setFilingScreen/.test(src) &&
    /Medicus filing-screen wording/.test(src),
  'the filing-screen wording is one practice-wide, pre-filled setting (not per lab)'
);
check(
  /SC\.referenceRangeCandidates\(S\.merged, r\.observations\)/.test(src) &&
    /S\.rangeCandidates = new Map\(/.test(src),
  'reading the results queue also collects the lab’s own reference ranges, as suggestions (a Map, not persisted)'
);
check(
  /inv-rt-suggested/.test(src) &&
    /Suggested from the lab.s own range/.test(src) &&
    /Use this/.test(src),
  'an empty practice range is pre-filled from the lab’s own range, highlighted, and never saved without a click'
);
check(
  /Lab's own range: /.test(src),
  'a range already set still shows the lab’s own range beside it, for comparison'
);
check(/'Delete'/.test(src) && /removeInvestigation/.test(src), 'a practice test can be deleted (card and edit screen)');
check(/Read again/.test(src), 'the reading can be run again');
check(/awaiting review/.test(src), 'unreviewed entries are labelled as such');
check(
  !/\breviewed:\s*true/.test(src),
  'the page never hand-builds an approval — it goes through the pure approve helpers'
);

console.log('\n── learning from the results queue ──');
check(
  !/chrome\.storage\.local\.set/.test(src),
  'the page never writes to storage itself (everything goes through the IO module)'
);
check(
  /No values, patient or staff details|no values, patient or staff details/i.test(src),
  'the scan card tells the person what is (not) kept'
);
check(
  /SC\.collectObservations/.test(src) && /OV\.applyFills/.test(src),
  'reading goes through the tested scan module and writing through applyFills'
);
check(
  !/\.fetch\(|fetch\(/.test(src),
  'the page does no raw fetching of its own (the queue is read via the allocation client)'
);
check(
  /if \(u\.hint\) return \{ u, choice: 'test:' \+ u\.hint, checked: false \}/.test(src),
  'a similarity hint pre-selects a choice but never ticks it'
);

console.log('\n── options.html wiring ──');
{
  const iScan = html.lastIndexOf('lab-catalogue-scan.js');
  const iAlloc = html.lastIndexOf('lab-allocate-core.js');
  const iSect = html.lastIndexOf('investigations-section.js');
  check(
    iScan > 0 && iAlloc > 0 && iScan < iSect && iAlloc < iSect,
    'the scan module and the allocation client load before the section'
  );
}
check(/data-section="investigations"/.test(html), 'nav item present');
check(/id="sect-investigations"/.test(html) && /id="invMount"/.test(html), 'section and mount point present');
check(/investigations-section\.css/.test(html), 'stylesheet linked');
const order = [
  'lab-catalogue-core.js',
  'lab-catalogue-overlay.js',
  'lab-catalogue-import.js',
  'labcatalogue-io.js',
  'investigations-section.js',
].map((f) => html.lastIndexOf(f));
check(
  order.every((i) => i > 0) && order.every((v, i) => i === 0 || v > order[i - 1]),
  'scripts load in dependency order (core, overlay, import, io, section)'
);
check(
  /<script type="module" src="investigations-section\.js">/.test(html),
  'the section is a module (deferred) so the classic globals exist first'
);
check(fs.existsSync(path.join(__dirname, 'options/investigations-section.css')), 'stylesheet exists');

console.log('\n── the section only calls functions the IO module provides ──');
const io = read('shared/io/labcatalogue-io.js');
for (const fn of src.match(/\blabcatalogue[A-Za-z]+(?=\()/g) || []) {
  check(new RegExp(`\\n\\s+${fn},`).test(io), `${fn} is exported by labcatalogue-io.js`);
}

console.log('\n── card layout and unlinked-group actions ──');
check(
  [
    'How it is requested in Medicus',
    'How it comes back from the lab',
    'Never counts as this test…',
    'SNOMED codes',
  ].every((t) => src.includes(t)),
  'the card shows the four areas: requested / comes back from the lab / never matches / results'
);
check(/Add more tests to this panel/.test(src), 'the results panel offers "Add more tests to this panel"');
check(
  /SC\.orphanToProposal/.test(src) && /SC\.fillsForRequests/.test(src) && /SC\.fillsFromProposals/.test(src),
  'unlinked headings and unrecognised requests become tests through the scan module'
);
check(
  /Create a new test: "/.test(src) &&
    /Add to a test/.test(src) &&
    /New test from an unrecognised request/.test(src),
  'each unlinked heading offers: new test from a request / existing test / a new test named after the group itself'
);
check(
  /Create a new test: "\$\{u\.heading\}"/.test(src),
  'creating a new test from the group pre-fills its name from the lab’s own heading, not a placeholder'
);
check(/needs a request/.test(src), 'a test with no request wording is flagged');
{
  const runCode = (src.split('async function runMatch')[1] || '').split('function parseChoice')[0];
  check(
    runCode.length > 100 &&
      /if \(u\.target\) return \{ u, choice: 'test:' \+ u\.target, checked: true \}/.test(runCode) &&
      (runCode.match(/checked: true/g) || []).length === 1,
    'only a match the scan can support with evidence arrives ticked; hints and suggestions never do'
  );
}

console.log('\n── merging one lab into another, and no longer creating duplicates in the first place (2026-09-24) ──');
check(
  /If this is really the same lab as another one — a duplicate created by mistake — you can merge it by /.test(
    src
  ) &&
    /OV\.mergeLab\(S\.builtin, S\.overlay, lab\.id, into\.id\)/.test(src) &&
    /!isBuiltinLab \? labMergeBlock\(lab, labs\) : null/.test(src),
  'a duplicate lab can be merged away from the labs list (search box), via the tested overlay operation — never offered for a built-in'
);
console.log('\n── merge, sample filter, matching board ──');
check(
  /If this investigation is part of another test, you can move it to that card as one of the results for that test by /.test(
    src
  ) && /OV\.mergeInvestigation/.test(src),
  'the edit screen offers to move a test into another test (search box), via the tested overlay operation'
);
check(
  /If this is really the same result as another one, just under a different name or code, you can merge it by /.test(
    src
  ) &&
    /OV\.mergeResult/.test(src) &&
    /!isBuiltinResult\) w\.appendChild\(resultMergeBlock/.test(src),
  'a practice result can likewise be merged into another result (search box), via the tested overlay operation — never offered for a built-in'
);
check(
  /SC\.similarResults\(S\.merged, r\.label, r\.id\)/.test(src) &&
    /This might already exist as: /.test(src),
  'a result editor computes similarity hints against the live catalogue and surfaces likely duplicates automatically'
);
check(
  /Might be the same as: /.test(src) &&
    /const stageMerge = \(fromId, intoR\)/.test(src) &&
    (src.match(/stageMerge\(/g) || []).length >= 2,
  "a test's own results table shows the same duplicate hint inline (not only inside the separate result editor), via one shared staging helper used by both the hint link and drag/drop"
);
check(
  /st\.pendingMerges\.push\(/.test(src) &&
    /for \(const pm of st\.pendingMerges\) \{\s*\n\s*o = OV\.mergeResult\(S\.builtin, o, pm\.fromId, pm\.intoId\)\.overlay;/.test(
      src
    ) &&
    !/mergeTwoResults/.test(src),
  'dragging or picking a merge only STAGES it — the actual OV.mergeResult only runs from persist(), right before the test is saved, so the card never closes on drop and the merge is gated behind an explicit save (Nick, 2026-09-23)'
);
check(
  /Pending: will merge into /.test(src) && /Pending: will receive /.test(src) && /'undo'/.test(src),
  'a pending merge is shown inline on both the source and target rows, with its own undo, before anything is saved'
);
check(
  /nameCell\.draggable = true/.test(src) &&
    /nameCell\.addEventListener\('dragstart'/.test(src) &&
    /nameCell\.addEventListener\('drop'/.test(src) &&
    /inv-rt-dragover/.test(src),
  'dragging one result row onto another in the results table merges them — an alternative to clicking the hint link'
);
check(
  /might already exist — use instead: /.test(src) &&
    /inv-scan-duplike/.test(src) &&
    /dupIndex\.byCode\.get\(r\.code\)/.test(src) &&
    /it\.resultChoices\.set\(nk, c\.id\)/.test(src),
  "the match-requests-to-lab-reports scan screen flags a report result that looks like an existing catalogue result too, before it is even added — with an actual action (pick the existing one) right there, not only a passive warning"
);
check(
  /SC\.fillsFromProposals\(cat, \[prop\], null, it\.resultChoices\)/.test(src),
  "a picked \"use existing result\" choice from the match board is threaded through to fillsFromProposals's resultChoices param when the ticked matches are applied"
);
console.log('\n── "it\'s not X": dismissing a similarity suggestion (2026-09-24, Nick) ──');
check(
  /async function dismissSimilarPairAction\(idA, idB\)/.test(src) &&
    /OV\.dismissSimilarPair\(S\.overlay, idA, idB\)/.test(src),
  'a shared helper records a rejected pairing via the tested pure overlay operation'
);
check(
  (src.match(/dismissSimilarPairAction\(/g) || []).length >= 3,
  "\"it's not X\" is offered everywhere a duplicate hint with a real result id on both sides is shown — the results table, the standalone result editor's filter, and the match board"
);
check(
  /\.filter\(\s*\(c\) => !OV\.isSimilarPairDismissed\(S\.overlay, r\.id, c\.id\)\s*\)/.test(src),
  "the results table's own hint filters out anything already dismissed for that result"
);
check(
  /const rawResultPairId = \(name\) => 'name:' \+ LC\.norm\(name\)/.test(src) &&
    /!OV\.isSimilarPairDismissed\(S\.overlay, pairId, c\.id\)/.test(src),
  'the match board dismisses by a stable name-based pseudo-id, since a raw report result has no id of its own yet'
);
{
  const rmb = (src.split('function resultMergeBlock')[1] || '').split(/\nfunction /)[0];
  check(
    rmb.length > 100 &&
      /!OV\.isSimilarPairDismissed\(S\.overlay, r\.id, c\.id\)/.test(rmb) &&
      !/dismissSimilarPairAction/.test(rmb) &&
      /This popup's own toggle is purely local/.test(rmb),
    "the standalone \"Edit result\" popup only FILTERS dismissed pairs, it does not offer its own \"it's not X\" button — that popup isn't tracked at the S level, so a save triggered from inside it risks silently closing it"
  );
}
console.log('\n── tri-state list toggles + presets + needs-attention sort (2026-09-24, Nick) ──');
check(
  /toggles: \{ review: null, filing: null, labMatched: null, reqMatched: null \}/.test(src),
  'four independent tri-state facets exist (any/yes/no), not one either/or radio choice'
);
check(
  /const hasLabMatch = \(inv\) =>/.test(src) && /const hasRequestMatch = \(inv\) =>/.test(src),
  'matched-to-lab-report and matched-to-Medicus-request are each their own yes/no question, answerable without opening a test'
);
check(
  /t\.review !== null && d\.needsReview !== t\.review/.test(src) &&
    /t\.filing !== null && filingOverview\(d\.inv\)\.on !== t\.filing/.test(src) &&
    /t\.labMatched !== null && hasLabMatch\(d\.inv\) !== t\.labMatched/.test(src) &&
    /t\.reqMatched !== null && hasRequestMatch\(d\.inv\) !== t\.reqMatched/.test(src),
  'all four toggles are applied when building the visible list, and combine freely (any dimension left at "Any" does not filter)'
);
check(
  /presetBtn\('which need matching to a Medicus request', \{ reqMatched: false \}\)/.test(src) &&
    /presetBtn\('which need matching to a lab report', \{ labMatched: false \}\)/.test(src) &&
    /presetBtn\('where assisted filing is not yet enabled', \{ filing: false \}\)/.test(src) &&
    /S\.toggles = \{ review: null, filing: null, labMatched: null, reqMatched: null, \.\.\.set \}/.test(src),
  "each preset resets every toggle then sets just the one it names — \"show me X\" is a clean jump, not an accumulation of whatever was set before"
);
check(
  /const score = \(d\) =>/.test(src) &&
    /return out\.sort\(\(a, b\) => score\(b\) - score\(a\) \|\| a\.inv\.label\.localeCompare\(b\.inv\.label\)\)/.test(src),
  'the list sorts needs-attention items first (by a weighted score across the four facets), alphabetically within the same score — not a flat alphabetical list'
);
check(/kindFilter/.test(src) && /Filter by sample/.test(src), 'the list can be filtered by sample type');
check(
  /draggable/.test(src) &&
    /dragover/.test(src) &&
    /'drop'/.test(src) &&
    /Filter requests/.test(src) &&
    /Filter lab groups/.test(src),
  'the matching board has the requested/lab columns, drag-and-drop matching and a filter'
);
check(
  /it\.checked = true; \/\/ dragging is a deliberate act/.test(src),
  'a dragged match is a deliberate act and is ticked; nothing is matched without one'
);
{
  const gi = (src.split('function groupItem')[1] || '').split(/\nfunction /)[0];
  const pickAt = gi.indexOf('Investigation group:');
  const resultsLabelAt = gi.indexOf('Individual results in this group');
  check(
    pickAt >= 0 && resultsLabelAt >= 0 && pickAt < resultsLabelAt,
    'the group-level match is labelled "Investigation group" and sits ABOVE the individual-result suggestions, which are labelled separately — the two kinds of match on the card are not confused (Nick, 2026-09-24)'
  );
}
check(
  /filterLeft/.test(src) &&
    /filterRight/.test(src) &&
    !/Filter both sides/.test(src) &&
    /runMatch/.test(src) &&
    /IMP\.importOirTests/.test(src),
  'each side has its own filter (the two sides name things differently), and one button runs the import then the scan'
);
check(
  /async function applyTicked/.test(src) && /What was just added/.test(src) && /could not be added/.test(src),
  'adding is done one item at a time and reports exactly what was added and what could not be'
);
check(!/renderImportCard|renderScan\(/.test(src), 'the separate import card and scan card are gone');
check(
  /codeInfoFor/.test(src) && /inv-code-qof/.test(src) && /labcatalogueLoadCodeInfo/.test(src),
  'codes show their SNOMED description and a pale-green QOF highlight (from the cluster table)'
);
check(
  /OV\.removeEntry/.test(src) && /Remove this entry/.test(src),
  'entries the catalogue had to exclude can be removed from the problems list (they are not listed anywhere else)'
);

console.log('\n── layout: two columns on top; the never strip and the results table run the full width ──');
{
  const css = read('options/investigations-section.css');
  check(
    /\.inv-panel-never \{\s*grid-column: 1 \/ -1;\s*grid-row: 2;/.test(css) &&
      /\.inv-panel-res \{\s*grid-column: 1 \/ -1;\s*grid-row: 3;/.test(css),
    'the "never counts as this test" strip and the SNOMED codes block each span the whole width, below the two columns'
  );
  check(
    /'inv-restable'/.test(src) &&
      /'How it counts'/.test(src) &&
      /'Also called'/.test(src) &&
      !/'SNOMED description'/.test(src) &&
      !/\['Lab', 'lab'\]/.test(src),
    'the results are ONE table: name, code, how it counts, also called, unit — no description column and no lab column (the lab is chosen once above the table)'
  );
  check(
    /gridRow = span > 1/.test(src) && /'shared by ' \+ usedBy/.test(src),
    'each code is its own line, name / role / wordings span them, and a result shared by several tests says so'
  );
}

check(
  /\['Also called', 'words'\],\s*\['Unit', 'unit'\],\s*\['Practice normal range/.test(src),
  'the Unit column sits immediately before the practice range it defines'
);
check(
  /a\.lab \|\| LC\.norm\(a\.text\) !== LC\.norm\(r\.label\)/.test(src),
  'a wording that only repeats the result’s own name is not listed again (lab-tagged wordings always are)'
);

check(
  /\['core', 'Core to the lab group'\]/.test(src) && !/Identifies the test/.test(src),
  'the role is called "Core to the lab group" everywhere'
);
check(
  !/c\.unit \? h\('span', \{ class: 'lf-muted', text: c\.unit \}\) : null/.test(src),
  'the unit is not repeated after the practice range boxes (it is listed just before them)'
);
check(
  /\.inv-rt-words \{\s*flex-direction: column;/.test(read('options/investigations-section.css')),
  'the "also called" names stack one to a line'
);

console.log('\n── Edit and Details are one screen ──');
check(
  !/'Details'/.test(src) && !/'Hide'/.test(src),
  'there is no separate Details / Hide button — Edit opens everything'
);
check(
  /function resultEditorParts/.test(src) &&
    /const clickToEdit/.test(src) &&
    !/'Codes & wordings'/.test(src) &&
    /Click a code or an “also called” name to add or edit it/.test(src),
  'a result is edited by clicking its code or its "also called" cell (no separate button), and the panel says so'
);
check(
  /S\.open\.delete\(S\.editing\)/.test(src),
  'finishing an edit returns the card to its summary (nothing is left stuck open)'
);

console.log('\n── "How it comes back from the lab": real headings kept separate from matching-only wordings (2026-09-23) ──');
check(
  /const realHeads = st\.heads\.filter\(\(x\) => x\.lab\)/.test(src) &&
    /const otherWords = st\.heads\.filter\(\(x\) => !x\.lab\)/.test(src),
  'the edit screen splits real per-lab headings from lab-neutral matching wordings instead of listing them together'
);
check(
  /Other wordings that might match a heading/.test(src),
  'the matching-only wordings are shown separately, labelled as not real report headings'
);
check(
  /labWords\(x\.lab\)/.test(src) && !/labShort\(a\.lab\)\)/.test(src.match(/realHeadRow[\s\S]{0,600}/)?.[0] || ''),
  'a real heading is labelled with the lab in words (respects any rename), never its org code'
);
check(
  /OV\.setHeadingNote\(S\.builtin, S\.overlay, x\.lab, x\.text, noteIn\.value\)/.test(src),
  'each real heading has its own editable note (e.g. "used when the set includes potassium"), saved via the pure helper'
);
check(
  /lab: lab\.name \}\)/.test(src) && !/performerOrg \|\| lab\.name/.test(src),
  'the read-only summary also shows the lab in words, not its org code (headingChips)'
);

console.log('\n── "never offer to file" phrases: ONE practice-wide list, not per lab x group (2026-09-23) ──');
check(
  !/suppressIfText/.test(src),
  'the per-group suppress editor is gone from this page entirely — the concept moved to the catalogue overlay’s filing.suppress'
);
check(
  /const filingSuppressLine = \(\)/.test(src) && /OV\.setFilingSuppress\(S\.overlay, \{ items: next \}\)/.test(src),
  'one global suppress-phrase editor exists, saved via the pure helper'
);
check(
  /bar\.appendChild\(filingSuppressLine\(\)\)/.test(src),
  'it sits in the same assisted-filing bar as the Medicus wording — both are practice-wide, both shown once per test'
);
check(
  /filingSuppressEntry = \(\) =>/.test(src),
  'a small reader helper exists alongside filingGroupEntry/filingGuardEntry, matching the page’s own convention'
);

console.log('\n── collapsibles keep their state across a save/re-render (2026-09-24, Nick) ──');
{
  const detailsWithoutOpenState = (src.match(/h\('details',\s*\{\s*class:\s*'[^']+'\s*\}/g) || []).filter(
    (m) => !/inv-changes|inv-problems/.test(m) // these two are deliberately always/conditionally open, not user-toggle state
  );
  check(
    detailsWithoutOpenState.length === 0,
    'every collapsible outside the deliberately state-driven ones tracks its own open/closed state — none of them ' +
      'snap shut just because something elsewhere on the page triggered a save and a re-render'
  );
  check(
    /S\.labsOpen/.test(src) && /S\.otherWordsOpen/.test(src) && /S\.suppressLineOpen/.test(src) && /S\.wordingOpen/.test(src),
    'the labs/headings box and the three assisted-filing sub-panels each have their own tracked open state'
  );
}

console.log('\n── Medicus’s own exact request wording, offered for a request that already resolves (2026-09-24) ──');
check(
  /function newRequestWordingsEl\(\)/.test(src) &&
    /OV\.addRequestAlias\(S\.builtin, S\.overlay, w\.investigationId, w\.text, 'any'\)/.test(src),
  'the scan results offer Medicus’s own wording, one click to add, via the pure helper'
);
check(
  /const wordings = newRequestWordingsEl\(\)/.test(src),
  'it is shown in the "Match requests to lab reports" card, alongside what was just added'
);

console.log('\n── synonyms kept apart from "How it is requested in Medicus" (2026-09-24, Nick) ──');
check(
  /synonyms: \[\.\.\.\(inv\.synonyms \|\| \[\]\)\]/.test(src),
  'the editor loads the investigation’s existing synonyms into its own state'
);
check(
  /const synDet = h\('details', \{ class: 'inv-af-wording', open: S\.synonymsOpen \|\| undefined \}\)/.test(src),
  '"Edit synonyms" is its own small, collapsed, state-tracked control — not mixed into the requested-as box'
);
check(
  /synonyms: st\.synonyms,\s*\n\s*headingAliases: st\.heads/.test(src),
  'saving the test writes synonyms back through the same pure saveInvestigation call as everything else'
);
check(
  /const reqLabel = requests\.length \? '' : \(inv\.synonyms \|\| \[\]\)\.length \? 'known as ' : ''/.test(src),
  'a test with no confirmed wording yet falls back to showing its synonyms on the card, labelled differently ' +
    '("known as", not "requested as") so it never reads as a confirmed Medicus wording'
);
check(
  /\.\.\.\(d\.inv\.synonyms \|\| \[\]\),/.test(src),
  'the list search still finds a test by its old synonym terms'
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
