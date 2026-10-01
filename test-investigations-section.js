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
check(
  /Catalogue engines are off until the practice switches them on/.test(src) &&
    /it has done so since v3\.264\.35/.test(src) &&
    !/Not yet used by the suite/.test(src) &&
    !/Filing does not read this yet/.test(src),
  'the page says catalogue filing has read approved setup since v3.264.35, and that the engines stay off until the practice switches them on'
);
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
check(/inv-scan-reports/.test(src), 'the "Reports to read" control has its own no-shrink class (originally fixed an overlap with the now-removed lab select)');
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
  /Save and approve covers this test\\u2019s wordings, results and codes, and assisted filing for the lab chosen in the dropdown only/.test(
    src
  ),
  'the review screen states that Save and approve covers this test and the dropdown lab only'
);
check(!/I have checked/.test(src) && !/approveBtn\.disabled/.test(src), 'no fiddly tick-box on the review screen');
const approveButtons = src.match(/btn\(\s*'(Save and approve( result)?|Approve)',/g) || [];
check(
  approveButtons.length === 5,
  'five approve actions: the test\'s own, the result\'s own, the lab on screen, and the practice-wide wording and never-file list'
);
check(
  /buttons\.appendChild\(btn\('Save and approve', \(\) => persist\(true\), 'lf-btn-primary'\)\);/.test(src) &&
    !/if \(st\.review\) buttons\.appendChild\(btn\('Save and approve',/.test(src),
  'the TEST\'s own "Save and approve" is always offered, never conditional on st.review — a test can have nothing of its own pending yet still have a pending assisted-filing approval, and this is the one screen that settles either (Nick, 2026-09-26: "the option is \'save\', not \'save and approve\', so again I have to open it a second time")'
);
check(
  /if \(fLab\) \{\s*\n\s*const mergedNow = OV\.mergeCatalogue\(S\.builtin, next, \{ includeUnreviewed: true, includeDisabled: true \}\)\s*\n\s*\.catalogue;\s*\n\s*const pending = OV\.filingStateForTest\(mergedNow, next, saved\.id, fLab\)\.pending;\s*\n\s*if \(pending\.length\) \{\s*\n\s*next = OV\.approveFilingForTest\(S\.builtin, next, saved\.id, fLab, REVIEWER\);/.test(
    src
  ) && !/for \(const lab of S\.merged\.labs\) \{\s*\n\s*const pending = OV\.filingStateForTest/.test(src),
  'Save and approve stamps assisted filing only for the lab on screen (fLab), never by walking every lab'
);
check(
  !/btn\(\s*'Edit',/.test(src) && !/if \(d\.needsReview && d\.ov\)/.test(src),
  'there is no separate Edit button and no separate needsReview-gated Review button — ONE entry point always opens the same screen, so approving never needs closing and reopening on the identical screen with a different button (Nick, 2026-09-25)'
);
check(
  /OV\.approveFilingForTest\(S\.builtin, S\.overlay, st\.id, fLab, REVIEWER\)/.test(src) &&
    /OV\.approveFiling\(S\.overlay, 'screen', OV\.filingScreenKey\(\), REVIEWER\)/.test(src) &&
    /OV\.approveFiling\(S\.overlay, 'suppress', OV\.filingSuppressKey\(\), REVIEWER\)/.test(src) &&
    !/OV\.approveFilingRange\(/.test(src) &&
    !/OV\.approveFiling\(S\.overlay, '(ranges|guards|groups)'/.test(src),
  'the lab on screen is approved through approveFilingForTest; wording and the never-file list have their own approveFiling buttons; there is no per-range approve'
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
  /return out\.sort\(\(a, b\) => a\.inv\.label\.localeCompare\(b\.inv\.label\)\);/.test(src) && !/const score = \(d\) =>/.test(src),
  'the list is plain alphabetical again — the needs-attention weighted sort tried 2026-09-24 was reverted 2026-09-25 ("in practice... they look random")'
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
  /filterLeft/.test(src) && /filterRight/.test(src) && !/Filter both sides/.test(src) && /runMatch/.test(src),
  'each side has its own filter (the two sides name things differently)'
);
console.log(
  '\n── the old, pre-catalogue Outstanding Requests test dictionary is no longer auto-imported on every scan (2026-09-26, Nick) ──'
);
check(
  !/IMP\.importOirTests\(/.test(src) && !/readOirTests/.test(src) && !/importNotesEl/.test(src),
  '"Match requests to lab reports" no longer reads triagelens.config.oirTests and re-imports it into the catalogue on every run — the catalogue now gets its confirmed investigations from reading real request/report/result data directly, so re-seeding from the old free-text dictionary every click was redundant (and kept resurrecting stale manual entries)'
);
check(
  /shared\/lab-catalogue-import\.js/.test(read('options/options.html')) || /IMP\.importOirTests/.test(read('shared/lab-catalogue-import.js')),
  'the underlying importOirTests helper itself is untouched (still a general-purpose, independently-tested pure function) — only the automatic call from this page is removed'
);
check(
  !/sc\.lab\b/.test(src) && !/test names from/.test(src),
  'the "which lab do these test names come from" picker is gone too — it only ever existed to tag the removed import, and has no other purpose on this page'
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

console.log(
  '\n── deep-link from the Lab Filing card\'s "Set up on Investigations page" button (2026-09-26, Nick) ──'
);
check(
  /function applyReviewDeepLink\(\)/.test(src) &&
    /params = new URLSearchParams\(location\.search\)/.test(src) &&
    /const invId = params\.get\('review'\);/.test(src),
  'options.html?review=<id> is read via the standard URLSearchParams API, not a hand-rolled parser'
);
check(
  /params\.delete\('review'\);\s*\n\s*const qs = params\.toString\(\);\s*\n\s*try \{\s*\n\s*history\.replaceState\(null, '', location\.pathname \+ \(qs \? '\?' \+ qs : ''\) \+ location\.hash\);/.test(
    src
  ),
  'the ?review= param is stripped from the URL (via history.replaceState, other query params and the hash preserved) once consumed — 2026-09-28, Nick, live-caught: load() runs applyReviewDeepLink() on every save() anywhere on the page, so a stale ?review= left in the address bar kept forcibly reopening the original deep-linked test and stomping on whatever else was being edited'
);
check(
  /S\.loaded = true;\s*\n\s*applyReviewDeepLink\(\);\s*\n\s*render\(\);/.test(src),
  'the deep link is applied once the catalogue has actually loaded (S.merged is populated), before the first render'
);
check(
  /S\.editing = inv\.id;\s*\n\s*S\.editState = editStateFor\(inv\);\s*\n\s*S\.open\.add\(inv\.id\);\s*\n\s*S\.scrollToAutofiling = true;\s*\n\}/.test(
    src
  ),
  'it opens the SAME single Review screen every other entry point uses (editStateFor, no separate deep-link-only editor) and scrolls to the assisted-filing bar — the deep link only exists to reach a decision that already lives there'
);
check(
  /const inv = S\.merged\.investigations\.find\(\(i\) => i\.id === invId\);\s*\n\s*if \(!inv\) return;/.test(src),
  'an id that no longer resolves (test deleted/renamed since the button was drawn) is silently ignored, never a crash or an error banner'
);
check(
  /chrome\.runtime\.sendMessage\(\{ action: 'ms-open-options', section: 'investigations', review: invId \}\);/.test(
    read('content-scripts/triage-lens/lab-file-button.js')
  ) &&
    /chrome\.tabs\.create\(\{ url: chrome\.runtime\.getURL\('options\/options\.html'\) \+ query \+ suffix \}\);/.test(
      read('service-worker.js')
    ),
  'the button that opens this link (lab-file-button.js) reuses the SAME query param name via the service worker\'s ms-open-options relay (a content script\'s own window.open() to a chrome-extension:// URL is blocked outright on Edge — ERR_BLOCKED_BY_CLIENT — since options/options.html is not in web_accessible_resources) and the existing #sect-investigations hash-router — no new deep-link mechanism duplicated on the other side'
);

console.log(
  '\n── "How it is requested in Medicus" suggests the known synonym instead of an empty box (2026-09-26, Nick) ──'
);
check(
  /const suggestedReq = !st\.reqs\.length && st\.synonyms\.length === 1 \? st\.synonyms\[0\] : '';/.test(src),
  'with no confirmed wording yet and exactly one legacy synonym on file, that synonym is put straight into the box — not left for someone to notice it sitting collapsed under "Edit synonyms" and retype by hand'
);
check(
  /reqText = input\(\{ placeholder: 'e\.g\. Anti-Xa level', 'aria-label': 'Request wording', value: suggestedReq \}\);/.test(
    src
  ),
  'the suggestion is the actual starting VALUE of the input, not just a placeholder that vanishes on focus — it is visible and one click of Add away from being confirmed'
);
check(
  /const knownSystems = \(S\.overlay\.context\.orderingSystems \|\| \[\]\)\.filter\(\(s\) =>\s*\n\s*SYSTEM_OPTIONS\.some\(\(\[v\]\) => v === s\)\s*\n\s*\);/.test(
    src
  ) && /reqSys = sel\(SYSTEM_OPTIONS, knownSystems\.length === 1 \? knownSystems\[0\] : 'any'\);/.test(src),
  'the ordering-system dropdown is preselected only when the practice\'s own "Your practice" settings name exactly one ordering system this page also offers — two or more configured, or none, and it stays "any system" rather than guessing'
);

console.log(
  '\n── a test\'s sole member is auto-marked "enough on its own" (2026-09-26, Nick) ──'
);
check(
  /if \(st\.members\.length === 1 && m\.role === 'core'\) m\.anchor = true;/.test(src),
  'a single-member test\'s only core result is forced anchor:true on render — there is no other core result it could ever need alongside, so this reflects a known fact rather than a default guess'
);
check(
  /disabled: m\.role !== 'core' \|\| st\.members\.length === 1,/.test(src),
  'the checkbox is disabled while it\'s genuinely the sole member — nothing meaningful to toggle, and unticking it would be wrong'
);
check(
  /if \(m\.role !== 'core'\) m\.anchor = false;/.test(src),
  'switching the sole member away from "core" still clears anchor, same as before — the new forcing only ever adds anchor:true for role core, never overrides a real choice for another role'
);

console.log(
  '\n── the "filing lab" picker is remembered PER TEST, not one shared value (2026-09-26, Nick, live-caught) ──'
);
check(
  /const filingLabByTest = new Map\(\);/.test(src) && /function currentFilingLab\(invId\)/.test(src),
  'the picked lab is keyed by investigation id, not a single global — opening a different test no longer silently shows whichever lab was picked last, e.g. Cervical Screening showing RJ700\'s "no heading recorded" warning despite Cervical Screening London\'s own headings being right there'
);
check(
  /const relevant = invId\s*\n\s*\? labs\.filter\(\(l\) => \(l\.groupHeadings \|\| \[\]\)\.some\(\(g\) => \(g\.identifies \|\| \[\]\)\.includes\(invId\)\)\)\s*\n\s*: \[\];/.test(
    src
  ),
  'with no explicit pick yet for this test, it defaults to a lab that actually identifies this test — never an unrelated one carried over from elsewhere'
);
check(
  /if \(labs\.some\(\(l\) => l\.id === picked\)\) return picked;/.test(src),
  'an explicit pick for THIS test always wins, even when the lab isn\'t "relevant" yet — setting up a brand-new heading at a lab for the first time is this screen\'s own job and must never be silently overridden'
);
check(
  /filingLabByTest\.set\(st\.id, pick\.value\);/.test(src) && /currentFilingLab\(st\.id\)/.test(src),
  'both the read and the write are keyed by the CURRENT test\'s own id (st.id), not a bare module-level variable'
);

console.log(
  '\n── a lab-scoped code\'s practice range/guards use ITS OWN lab, not the test\'s picker lab (2026-09-26, Nick, live-caught) ──'
);
check(
  /const eLab = \(c && c\.lab\) \|\| fLab;/.test(src),
  'the range cell resolves its lab from the code\'s own scope first — Kingston\'s urine white-cell code no longer inherits whichever lab happens to be selected in the test\'s picker'
);
check(
  /const cand = r && c \? S\.rangeCandidates\.get\(eLab \+ '\|' \+ c\.conceptId\) : null;/.test(src) &&
    /const e = r && c \? filingEntry\(r\.id, eLab, c\.conceptId\) : null;/.test(src),
  'both the saved practice-range entry and the suggested-range candidate are looked up by the code\'s own lab — this is what stopped RJ700\'s blood WBC range (4-11) leaking onto Kingston\'s urine white-cell result, which genuinely carries no reference range (confirmed via Medicus\'s own "Result History" — urine entries show "-", only the interleaved blood-style entries show 4-11)'
);
check(
  /const submit = \(\) => applyFiling\(\{ result: r\.id, lab: eLab, code: c\.conceptId, low: lo\.value, high: hi\.value \}\);/.test(
    src
  ),
  'saving a practice range for a lab-scoped code writes it under THAT lab, never under the test\'s picker lab'
);
check(
  /const resultLab = \(r\) => \{\s*\n\s*const scopes = r && r\.codes && r\.codes\.length \? \[\.\.\.new Set\(r\.codes\.map\(\(c\) => c\.lab \|\| null\)\)\] : \[\];\s*\n\s*return scopes\.length === 1 && scopes\[0\] \? scopes\[0\] : fLab;\s*\n\s*\};/.test(
    src
  ),
  'guards (set per result, not per code) use the result\'s own lab only when every one of its codes agrees on a single explicit scope — an ambiguous or unscoped result keeps the existing picker-lab behaviour unchanged'
);
check(
  /const rLab = resultLab\(r\);\s*\n\s*if \(r && rLab\) \{\s*\n\s*const ge = filingGuardEntry\(r\.id, rLab\);/.test(src),
  'the guards lookup and editor use the resolved result lab (rLab), not the bare picker lab (fLab)'
);

console.log(
  '\n── manually matching a lab group to a test is never kind-gated (2026-09-26, Nick, live-caught) ──'
);
check(
  !/\.filter\(\(i\) => i\.kind === u\.kind \|\| i\.kind === 'other'\)/.test(src),
  'the "add to a test" dropdown no longer filters candidate tests by the group\'s own guessed kind — Kingston\'s urine-specimen "Urine culture" group guesses kind \'urine\', which silently hid \'Urine MC&S (MSU)\' (kind \'microbiology\') from the list even though a person reading the actual report knows they are the same test'
);
check(
  !/unknownRequests\s*\n\s*\.filter\(\(r\) => !r\.kind \|\| r\.kind === u\.kind \|\| u\.kind === 'other'\)/.test(src),
  'the "unrecognised request" dropdown has the same manual-override fix — a person\'s explicit pick is never blocked by the kind guess either'
);
check(
  /const testOpts = opts\(\s*\n\s*S\.merged\.investigations\s*\n\s*\.sort\(\(x, y\) => x\.label\.localeCompare\(y\.label\)\)/.test(
    src
  ),
  'every test is offered in the manual dropdown, sorted by name — the "Suggested" optgroup above it still surfaces the auto-detected likely matches first'
);

console.log(
  '\n── flash()\'s toast-clear timer no longer rebuilds the whole page (2026-09-28, Nick, live-caught) ──'
);
{
  const flashFn = src.slice(src.indexOf('function flash('), src.indexOf('\n}\n', src.indexOf('function flash(')));
  check(
    /setTimeout\(\(\) => \{[\s\S]*?if \(S\.toast === msg\) \{[\s\S]*?S\.toast = '';/.test(flashFn),
    "the toast-clear timeout still only fires for the toast it scheduled, not a newer one that's replaced it"
  );
  check(
    /root && root\.querySelector\('\.lf-toast'\)/.test(flashFn) && /el\.remove\(\)/.test(flashFn),
    'clearing the toast removes just its own DOM node — a plain 4-second timer no longer calls the full-page render(), which used to fire completely independent of what the person was doing and could steal a click mid-interaction inside an open review card ("clicking within one open review card closes it and moves me to another, seemingly at random")'
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
