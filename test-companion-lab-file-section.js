// Medicus Suite — Companion "Lab Filing" section source invariants (fold-in stages 1 + 2, 2026-09-27)
// Run with: node test-companion-lab-file-section.js
//
// The section lives inside the task-actions-panel IIFE and can't be imported, so these are source-level safety
// pins, same convention as test-task-actions-due.js: content-scripts/triage-lens/lab-file-button.js computes
// severity/blockers/matching and PUBLISHES it (window.__chLabFileState + a 'ch-lab-file-state' event); Companion
// only ever renders that data. Stage 2 finished the fold-in — lab-file-button.js has NO visible DOM of its own
// left at all (see its own buildUI() comment).

'use strict';

const fs = require('fs');
const path = require('path');
const LC = require('./shared/lab-catalogue-core.js');

let passed = 0;
let failed = 0;
function check(cond, msg) {
  if (cond) {
    console.log(`  OK  ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL  ${msg}`);
    failed++;
    process.exitCode = 1;
  }
}

const panel = fs.readFileSync(path.join(__dirname, 'content-scripts', 'task-actions-panel.js'), 'utf8');
const btn = fs.readFileSync(path.join(__dirname, 'content-scripts', 'triage-lens', 'lab-file-button.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, 'content-scripts', 'task-actions-panel.css'), 'utf8');
const role = require('./shared/companion-role.js');

console.log('--- lab-file-button.js publishes, Companion never recomputes ---');
{
  check(
    /function publishLabFileState\(state\)/.test(btn) && /window\.__chLabFileState = state;/.test(btn),
    'lab-file-button.js exposes its computed state on a plain window global'
  );
  check(
    /document\.dispatchEvent\(new CustomEvent\('ch-lab-file-state'\)\)/.test(btn),
    'lab-file-button.js dispatches a DOM event on every publish, so Companion does not have to poll on its own'
  );
  check(
    /window\.__chLabFileState \|\| null/.test(panel) && !/loadReportSeverity|computeProfileBlockers/.test(panel),
    'Companion reads window.__chLabFileState and never touches the severity/blockers computation itself — that stays sole-owned by lab-file-button.js'
  );
}

console.log('\n--- signature-gated, so lab-filing’s own ~400ms poll does not force a full Companion rebuild ---');
{
  check(
    /function labFileSignature\(state\)/.test(panel),
    'a pure signature function exists over the DATA (mode/title/sub/reasons/requestMatchInfo), not the rendered HTML'
  );
  check(
    /function syncLabFileState\(\) \{[\s\S]*?if \(dirty\) rerender\(\);\s*\n\s*\}/.test(panel),
    "syncLabFileState() only calls rerender() when the data signature OR the toast actually changed (a 'dirty' flag, since stage 2 added a second, independent reason to redraw — the toast)"
  );
  check(
    /document\.addEventListener\('ch-lab-file-state', syncLabFileState\)/.test(panel),
    'the event listener is registered once at boot'
  );
  check(
    /if \(isInvestigationResultTask\(\)\) syncLabFileState\(\);/.test(panel),
    'runInject() also calls it directly — belt and braces for an event dispatched before the listener attached'
  );
}

console.log('\n--- reasonsOpen is genuine interaction state, lifted into s.lf (not just DOM) ---');
{
  check(
    /function blankLabFileState\(\) \{[\s\S]{0,200}?reasonsOpen: false,/.test(panel),
    'reasonsOpen lives in state, not just the <details> element’s own open attribute'
  );
  check(
    /lf: blankLabFileState\(\)/.test(panel),
    'blankState() carries the lab-filing sub-state, so a full state reset on navigation also resets it'
  );
  check(
    /\(lf\.reasonsOpen \? ' open' : ''\)/.test(panel),
    'the rendered <details> echoes s.lf.reasonsOpen back — a rebuild triggered by ANY other section’s action still reproduces the open/closed state, not just this section’s own poll'
  );
  check(
    /s\.lf\.reasonsOpen = !!lfReasonsToggle\.parentElement\.open;/.test(panel),
    'toggling the <details> writes the new state back into s.lf, closing the loop'
  );
}

console.log('\n--- placement: first, above everything else, on an investigation-review task ---');
{
  check(
    /const showLabFile = shows\.labFile && isInvestigationResultTask\(\) && !!s\.lf\.data;/.test(panel),
    'gated on the dedicated labFile role key (not `record`) and the same precise task-type detector the "Open appts/links/tasks" section already uses'
  );
  check(
    /\(showLabFile \? labFileSectionHtml\(\) : ''\) \+\s*\n\s*\(recordFirst \? recordSectionHtml\(\) : ''\)/.test(
      panel
    ),
    'Lab Filing renders before recordFirst — first section in the widget, matching "what the clinician is there to act on"'
  );
}

console.log('\n--- role-gating: deliberately NOT excluding Nursing/Triage the way `record` does ---');
{
  const nurseTask = role.roleShows('nursing', 'task');
  const triageTask = role.roleShows('triage', 'task');
  check(
    nurseTask.labFile === true && triageTask.labFile === true,
    'Nursing and Triage both see Lab Filing on a task page, even though roleShows(...).record excludes both of them'
  );
  check(
    /labFile: hasPatient,/.test(fs.readFileSync(path.join(__dirname, 'shared', 'companion-role.js'), 'utf8')),
    'the gate is a plain hasPatient check, independent of role, matching the standalone card’s previously-unconditional visibility'
  );
}

console.log('\n--- confirmRequestMatch: Companion calls the SAME write path, never a re-implementation ---');
{
  check(
    /window\.__chConfirmRequestMatch = confirmRequestMatch;/.test(btn),
    'lab-file-button.js exposes its existing confirmRequestMatch (OV.addRequestAlias + labcatalogueSaveOverlay) for Companion to call'
  );
  check(
    /window\.__chConfirmRequestMatch\(invId, text, btn\);/.test(panel),
    "Companion's inline confirm affordance calls that same exposed function — no second overlay-writing code path"
  );
}

console.log(
  '\n--- request-match candidates mark the EXISTING outstanding-investigations list, not a duplicate box (2026-09-27) ---'
);
{
  check(
    !/ms-tap-lf-match-confirm|data-lf-match-idx/.test(panel),
    'the stage-1 standalone "Matched to your request" box\'s markup/wiring is gone — it duplicated the same labels already shown under OUTSTANDING INVESTIGATIONS'
  );
  check(
    /function labFileRequestMatchFor\(itemText\)/.test(panel),
    'a lookup exists correlating an outstanding-investigation item against the current report’s own requestMatchInfo candidates'
  );
  check(
    /const match = inv\.items\.length \? labFileRequestMatchFor\(item\) : null;/.test(panel),
    'renderInvestigationRow checks each item against the lookup'
  );
  check(
    /data-lf-confirm-inv="/.test(panel) && /data-lf-confirm-text="/.test(panel),
    'a matched item gets an inline confirm button carrying the investigation id and exact candidate text'
  );
  check(
    /el\.querySelectorAll\('\.ms-tap-lf-inv-confirm'\)\.forEach/.test(panel),
    'the inline confirm buttons are bound the same way as every other delegated click handler'
  );
}

console.log('\n--- stage 2: checkbox state (wlChecked/catWlChecked) is lifted into s.lf, not just the DOM ---');
{
  check(
    /wlChecked: new Set\(\),/.test(panel) && /catWlChecked: new Set\(\),/.test(panel),
    'blankLabFileState() carries both checklist Sets, so a full state reset on navigation also resets them'
  );
  check(
    /const anyChecked = rows\.some\(\(r\) => s\.lf\.wlChecked\.has\(r\.key\)\);/.test(panel) &&
      /\(s\.lf\.wlChecked\.has\(r\.key\) \? ' checked' : ''\)/.test(panel),
    'the legacy whitelist checklist echoes s.lf.wlChecked back into both the checkbox `checked` attribute and the Save button’s visibility'
  );
  check(
    /const key = cb\.getAttribute\('data-lf-wl-key'\);\s*\n\s*if \(cb\.checked\) s\.lf\.wlChecked\.add\(key\);\s*\n\s*else s\.lf\.wlChecked\.delete\(key\);\s*\n\s*rerender\(\);/.test(
      panel
    ),
    'toggling a checkbox writes into s.lf.wlChecked and rerenders — so a rebuild triggered by ANY other section’s action still reproduces every tick, not just this section’s own poll'
  );
}

console.log(
  '\n--- catalogue whitelist: a comment already saved, awaiting approval, is never re-offered as a fresh checkbox (2026-09-28, Nick live-caught) ---'
);
{
  check(
    /const pendingRows = rows\.filter\(\(r\) => r\.pending\);\s*\n\s*const newRows = rows\.filter\(\(r\) => !r\.pending\);/.test(
      panel
    ),
    'labFileCatalogueWhitelistHtml() splits rows into pending (already saved, awaiting re-approval) and new (never submitted) before rendering either'
  );
  check(
    /already whitelisted, awaiting approval/.test(panel),
    'a pending row is rendered as a plain notice, not a checkbox — resubmitting it would just create noise, not progress'
  );
  check(
    /Go approve it/.test(panel) &&
      /ms-tap-lf-open-setup" data-lf-open-setup="' \+\s*\n\s*esc\(r\.investigationId\)/.test(panel),
    'a pending row\'s "Go approve it" button reuses the SAME class/data-attribute (ms-tap-lf-open-setup / data-lf-open-setup) the unapproved-groups box already uses — the existing delegated click handler picks it up for free, no new wiring'
  );
  check(
    /const anyChecked = newRows\.some\(\(r\) => s\.lf\.catWlChecked\.has\(r\.key\)\);/.test(panel),
    "the Save button's visibility is derived from newRows only — a pending row (which never gets a checkbox) can never spuriously enable it"
  );
}

console.log(
  '\n--- stage 2: Save-button clicks call the exposed write functions with a correctly-shaped `checks` array ---'
);
{
  check(
    /const checks = rows\s*\n\s*\.filter\(\(r\) => s\.lf\.wlChecked\.has\(r\.key\)\)\s*\n\s*\.map\(\(r\) => \(\{\s*\n\s*checkbox: \{ checked: true \},\s*\n\s*residue: r\.residue,\s*\n\s*targetProfiles: r\.targetProfileIds\.map\(\(id\) => \(\{ id \}\)\),/.test(
      panel
    ),
    'the legacy Save button reconstructs a {checkbox, residue, targetProfiles} array from the checked rows — the exact shape whitelistSelectedComments already expects, no signature change needed on that side'
  );
  check(
    /window\.__chWhitelistComments\(checks, btn\);/.test(panel) &&
      /window\.__chWhitelistCatalogueComments\(checks, btn\);/.test(panel),
    'both Save buttons call the exposed write functions directly — no second implementation of the save logic'
  );
}

console.log('\n--- stage 2: toast is published, not built as DOM, and Companion owns the auto-clear timer ---');
{
  check(
    /toastSeenId: null,\s*\n\s*toastVisible: null,/.test(panel),
    'blankLabFileState() tracks which published toast id has already been shown, and what is currently visible'
  );
  check(
    /const toast = window\.__chLabFileToast \|\| null;\s*\n\s*if \(toast && toast\.id !== s\.lf\.toastSeenId\) \{/.test(
      panel
    ),
    'a new toast id (not just a new toast object) is what triggers (re)showing it — matches identical consecutive messages correctly'
  );
  check(
    /setTimeout\(\(\) => \{\s*\n\s*if \(s\.lf\.toastVisible === toast\) \{\s*\n\s*s\.lf\.toastVisible = null;\s*\n\s*rerender\(\);\s*\n\s*\}\s*\n\s*\}, 5200\);/.test(
      panel
    ),
    'Companion clears the toast itself after ~5.2s (matching the old .chlf-toast dismiss timing) — lab-file-button.js has no DOM to manage this with any more'
  );
}

console.log('\n--- stage 2: File/message buttons and suppress link call the exposed functions directly ---');
{
  check(
    /window\.__chLabFileAction\('fileNoAction'\);/.test(panel) &&
      /window\.__chLabFileAction\('fileAndMessage'\);/.test(panel),
    'the primary/secondary File buttons call the exposed onAction wrapper — the same re-fetch-and-re-verify-at-click-time macro, never a re-implementation'
  );
  check(
    /window\.__chSuppressCurrentPatient\(\);/.test(panel),
    '"Never auto-file this patient" calls the exposed suppressCurrentPatient directly'
  );
}

console.log('\n--- CSS: scoped under #ms-tap-widget, following the existing token/prefix convention ---');
{
  check(
    /#ms-tap-widget \.ms-tap-lf-title/.test(css),
    'lab-filing styles are scoped under the widget id, like every other section'
  );
  const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  check(!/\.chlf-/.test(cssNoComments), 'no leftover .chlf- selectors (outside comments) were copy-pasted in unscoped');
}

console.log('\n--- sanity: catalogue engine this section ultimately depends on is unaffected ---');
check(
  typeof LC.buildIndex === 'function',
  'shared/lab-catalogue-core.js still loads normally (no accidental breakage from this pass)'
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
