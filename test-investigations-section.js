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
  /Keep as a group-and-results test/.test(src) &&
    /Add to a test/.test(src) &&
    /New test from an unrecognised request/.test(src),
  'each unlinked heading offers: new test from a request / existing test / group-and-results only'
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

console.log('\n── merge, sample filter, matching board ──');
check(
  /If this investigation is part of another test, you can move it to that card as one of the results for that test by /.test(
    src
  ) && /OV\.mergeInvestigation/.test(src),
  'the edit screen offers to move a test into another test (search box), via the tested overlay operation'
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
