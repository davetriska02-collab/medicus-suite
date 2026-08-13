// First-run setup wizard (#setup). Hidden route — reachable from the
// dashboard card and from the router, never from the nav.
//
// Shape (Deputy/RotaCloud pattern, adapted to general practice):
//   1 Welcome     — states the time budget, offers three paths
//   2 Practice    — practice code + open days, with a live connection check
//   3 Review      — pull 4 weeks, show EVERY clinician before anything is kept
//   4 First rota  — generate 4 weeks and land on the grid, not on "settings saved"
//
// Two rules the old one-click setup broke and this one keeps:
//   - Nothing reaches storage until the user has seen it. Steps 1–3 only ever
//     write to state.ui.setup; the single persist happens in step 4.
//   - The wizard ends at a WORKING ROTA. "Generate my rota" routes to #rota.
//
// Step state lives in state.ui.setup, so leaving the route and coming back
// resumes where the user was (within the session — it is deliberately not
// persisted: a half-finished wizard is not practice data).

import { esc } from '../../shared/esc.js';
import { todayISO, mondayOf, addDays, dayKey, fmtDay } from '../../shared/time.js';
import { DAY_KEYS, ROLES, newStaff } from '../../shared/model.js';
import { isValidPracticeCode, fetchOverview, fetchOverviewRange } from '../../shared/medicus-api.js';
import { parseOverview } from '../../engine/reconcile.js';
import { buildImportPlan, SKIP_KNOWN } from '../../engine/setup-plan.js';
import { inferPatterns } from '../../engine/infer.js';
import { inferRooms } from '../../engine/room-infer.js';
import { generateEntries } from '../../engine/template.js';
import { demoData } from '../../shared/demo.js';
import { save, uid } from '../../shared/store.js';

const WEEKS_BACK = 4;
const WEEKS_AHEAD = 4;

export default {
  render(root, ctx) {
    const w = wizardState(ctx.state);
    if (w.step === 'manual') return renderManual(root, ctx);
    if (w.step === 2) return renderPractice(root, ctx, w);
    if (w.step === 3) return renderReview(root, ctx, w);
    if (w.step === 4) return renderFirstRota(root, ctx, w);
    return renderWelcome(root, ctx, w);
  },
};

/* ---- shared chrome ---- */

function wizardState(state) {
  if (!state.ui.setup) state.ui.setup = { step: 1 };
  return state.ui.setup;
}

function progress(n) {
  return `
    <div class="wiz-progress">
      <div class="wiz-dots">${[1, 2, 3, 4].map((i) => `<span class="wiz-dot${i <= n ? ' on' : ''}"></span>`).join('')}</div>
      <span class="sub">Step ${n} of 4</span>
    </div>`;
}

const LATER_LINK = '<button type="button" class="linkbtn" id="w-later">Set up later</button>';

function wireLater(root, ctx) {
  const btn = root.querySelector('#w-later');
  if (!btn) return;
  btn.onclick = async () => {
    // Leaving mid-wizard must leave nothing behind: the step-3 import lives in
    // memory only, so it is rolled back rather than stranded unsaved.
    rollbackImport(ctx);
    ctx.state.settings.setupDismissed = true;
    await ctx.persist('settings');
    ctx.state.ui.setup = null;
    location.hash = '#dashboard';
  };
}

// Undo an un-persisted step-3 import (going Back from step 4, or bailing out).
function rollbackImport(ctx) {
  const w = ctx.state.ui.setup;
  if (!w || !w.importedIds || !w.importedIds.length) return;
  const ids = new Set(w.importedIds);
  ctx.state.staff = ctx.state.staff.filter((p) => !ids.has(p.id));
  w.importedIds = [];
  w.imported = 0;
}

function goTo(ctx, step) {
  wizardState(ctx.state).step = step;
  ctx.rerender();
}

// Weekdays of the last four whole weeks — the window the pattern and room
// inference were built for.
function pastWeekdays(anchorMonday) {
  const dates = [];
  for (let week = WEEKS_BACK; week >= 1; week--) {
    for (let i = 0; i < 5; i++) dates.push(addDays(anchorMonday, -7 * week + i));
  }
  return dates;
}

function lastWeekday(fromISO) {
  let d = addDays(fromISO, -1);
  while (dayKey(d) === 'sat' || dayKey(d) === 'sun') d = addDays(d, -1);
  return d;
}

// Medicus failures are opaque HTTP errors; a practice manager needs to know
// which of the three things it actually is — not signed in, wrong code, or
// the network. Everything else falls through with the raw message rather than
// being guessed at.
function friendlyError(err) {
  const msg = err instanceof Error ? err.message : String(err || '');
  const status = Number((/HTTP (\d{3})/.exec(msg) || [])[1] || 0);
  if (status === 401 || status === 403) {
    return 'Medicus did not accept this browser session. Open Medicus in another tab, sign in, then check again.';
  }
  if (status === 404) {
    return 'Nothing came back for that practice code. Check it against the code in your Medicus web address.';
  }
  if (status >= 500) return 'Medicus is not responding at the moment. Try again in a minute.';
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    return 'Could not reach Medicus. Check the practice code and that this machine is online.';
  }
  return msg || 'The appointment book could not be read.';
}

/* ---- step 1: welcome ---- */

function renderWelcome(root, ctx, w) {
  root.innerHTML = `
    <h1>Set up your rota</h1>
    ${progress(1)}
    <div class="card">
      <h2 class="mt0">Welcome — this takes about 3 minutes</h2>
      <p class="sub">Three ways in. Nothing is saved until you say so, and anything set here can be changed later.</p>

      <div class="wiz-path">
        <div>
          <strong>Connect to Medicus <span class="pill approved">recommended</span></strong>
          <p class="sub mt8">Reads four weeks of your appointment book, then suggests your clinicians, each
          person's usual week and how many rooms you run. You review every name before anything is kept.</p>
        </div>
        <button class="primary" id="w-live">Connect to Medicus</button>
      </div>

      <div class="wiz-path">
        <div>
          <strong>Try with sample data</strong>
          <p class="sub mt8">A realistic ten-clinician practice with a full four-week rota already on the grid.
          Explore everything without a Medicus session — wipe it any time from Settings.</p>
        </div>
        <button id="w-sample">Try with sample data</button>
      </div>

      <div class="wiz-path">
        <div>
          <strong>Set up by hand</strong>
          <p class="sub mt8">Add your team yourself. Best if you do not use the Medicus appointment book, or
          you want to start from a blank sheet.</p>
        </div>
        <button id="w-manual">Set up by hand</button>
      </div>

      <div class="toolbar mt12">
        <span class="spacer"></span>
        ${LATER_LINK}
      </div>
    </div>
  `;

  root.querySelector('#w-live').onclick = () => {
    w.code = w.code ?? ctx.state.settings.practiceCode ?? '';
    w.openDays = w.openDays || [...(ctx.state.settings.openDays || DAY_KEYS.slice(0, 5))];
    goTo(ctx, 2);
  };
  root.querySelector('#w-manual').onclick = () => goTo(ctx, 'manual');
  root.querySelector('#w-sample').onclick = () => loadSample(ctx);
  wireLater(root, ctx);
}

/* ---- the sample-data path ---- */

// The demo dataset deliberately ships entries: [] (shared/demo.js), which left
// sample users staring at an empty grid — exactly the problem this path exists
// to dissolve. So the sessions are generated here, as part of the load.
// Written with save() rather than persist(), matching the Settings demo button:
// a sample practice must never be pushed into a real practice's shared folder.
async function loadSample(ctx) {
  const { state } = ctx;
  if (state.staff.length && !confirm('Replace the current rota data with the sample practice?')) return;
  const demo = demoData();
  const monday = mondayOf(todayISO());
  const entries = generateEntries({
    staff: demo.staff,
    startDate: monday,
    endDate: addDays(monday, 7 * WEEKS_AHEAD - 1),
    existingEntries: [],
    leaveList: demo.leave,
    settings: demo.settings,
  });
  await save('staff', demo.staff);
  await save('entries', entries);
  await save('leave', demo.leave);
  await save('rooms', demo.rooms);
  await save('swaps', []);
  await save('audit', []);
  await save('settings', demo.settings);
  state.ui.setup = null;
  await ctx.reload();
  ctx.toast('Sample practice loaded — explore freely; wipe it from Settings → Data');
  location.hash = '#rota';
}

/* ---- the by-hand path ---- */

function renderManual(root, ctx) {
  root.innerHTML = `
    <h1>Set up your rota</h1>
    <div class="card">
      <h2 class="mt0">Setting up by hand</h2>
      <p class="sub">Three steps, in this order:</p>
      <ol>
        <li><strong>Staff</strong> — add each clinician with their role, contracted sessions and leave entitlement.</li>
        <li><strong>Templates</strong> — set each person's usual week (which half-days they work, and what they do).</li>
        <li><strong>Rota</strong> — press Generate to roll those weeks forward into real sessions.</li>
      </ol>
      <p class="sub">The dashboard keeps a checklist of the rest — who you are on this machine, sharing with other
      machines, and a passcode — so nothing gets forgotten.</p>
      <div class="toolbar mt12">
        <button class="primary" id="w-staff">Add staff now</button>
        <button id="w-back">Back</button>
        <span class="spacer"></span>
        ${LATER_LINK}
      </div>
    </div>
  `;

  root.querySelector('#w-staff').onclick = async () => {
    // The by-hand path IS the setup being done, so the wizard stands down and
    // the dashboard checklist takes over the long tail.
    ctx.state.settings.setupDismissed = true;
    await ctx.persist('settings');
    ctx.state.ui.setup = null;
    location.hash = '#staff';
  };
  root.querySelector('#w-back').onclick = () => goTo(ctx, 1);
  wireLater(root, ctx);
}

/* ---- step 2: practice ---- */

function renderPractice(root, ctx, w) {
  const s = ctx.state.settings;
  const code = w.code ?? s.practiceCode ?? '';
  const openDays = w.openDays || [...(s.openDays || DAY_KEYS.slice(0, 5))];
  w.openDays = openDays;

  root.innerHTML = `
    <h1>Set up your rota</h1>
    ${progress(2)}
    <div class="card">
      <h2 class="mt0">Your practice</h2>
      <p class="sub">The practice code is the short code in your Medicus web address — 4 to 8 characters,
      digits and a–f. It is the same setting as Settings → Practice, so filling it in here fills it in there.</p>
      <div class="formgrid mt8">
        <label class="field">Medicus practice code
          <input id="w-code" value="${esc(code)}" placeholder="e.g. a3f2b1" autocomplete="off">
        </label>
      </div>
      <div class="mt8">
        <strong>Days the practice is open:</strong>
        ${DAY_KEYS.map(
          (d) =>
            `<label class="check"><input type="checkbox" class="w-day" value="${esc(d)}" ${openDays.includes(d) ? 'checked' : ''}>${esc(d.toUpperCase())}</label>`
        ).join('')}
      </div>
      <div class="toolbar mt12">
        <button id="w-check" class="primary">Check connection</button>
        <span class="sub">Reads one recent day of the appointment book. Nothing is saved by this.</span>
      </div>
      <div id="w-checkout">${w.check ? checkHTML(w.check) : ''}</div>
      <div class="toolbar mt12">
        <button id="w-back">Back</button>
        <button id="w-next" class="primary" ${w.check && w.check.ok ? '' : 'disabled'}>Continue</button>
        <span class="spacer"></span>
        ${LATER_LINK}
      </div>
    </div>
  `;

  const codeInput = root.querySelector('#w-code');
  const nextBtn = root.querySelector('#w-next');
  const out = root.querySelector('#w-checkout');

  const readForm = () => {
    w.code = codeInput.value.trim().toLowerCase();
    w.openDays = [...root.querySelectorAll('.w-day:checked')].map((c) => c.value);
  };

  codeInput.oninput = () => {
    // A changed code invalidates the previous green tick — and the pull that
    // would have followed it.
    w.check = null;
    w.plan = null;
    nextBtn.disabled = true;
    out.innerHTML = '';
  };

  root.querySelector('#w-check').onclick = async (ev) => {
    readForm();
    if (!isValidPracticeCode(w.code)) {
      w.check = { ok: false, message: 'A practice code is 4 to 8 characters, digits and a–f only.' };
      out.innerHTML = checkHTML(w.check);
      return;
    }
    const button = ev.currentTarget;
    button.disabled = true;
    out.innerHTML =
      '<div class="warn"><span class="sev info">checking</span><span>Reading one day of the appointment book…</span></div>';
    const date = lastWeekday(todayISO());
    try {
      const rows = parseOverview(await fetchOverview(w.code, date));
      const clinicians = rows.filter((r) => r.am.hasSession || r.pm.hasSession).length;
      w.check = clinicians
        ? {
            ok: true,
            message: `Connected — found ${clinicians} clinician session${clinicians === 1 ? '' : 's'} on ${fmtDay(date)}.`,
          }
        : {
            ok: false,
            message: `Medicus answered, but nobody was consulting on ${fmtDay(date)}. Check the practice code, or try again after a normal working day.`,
          };
    } catch (err) {
      w.check = { ok: false, message: friendlyError(err) };
    }
    button.disabled = false;
    out.innerHTML = checkHTML(w.check);
    nextBtn.disabled = !w.check.ok;
  };

  root.querySelector('#w-back').onclick = () => {
    readForm();
    goTo(ctx, 1);
  };

  nextBtn.onclick = async () => {
    readForm();
    if (!w.check || !w.check.ok) return;
    // Same field as Settings → Practice: the wizard writes it, it does not
    // keep a second copy of it.
    s.practiceCode = w.code;
    if (w.openDays.length) s.openDays = w.openDays;
    await ctx.persist('settings');
    w.plan = null;
    w.pulling = false;
    goTo(ctx, 3);
  };

  wireLater(root, ctx);
}

function checkHTML(check) {
  return `<div class="warn mt8"><span class="sev ${check.ok ? 'ok' : 'medium'}">${check.ok ? 'connected' : 'check'}</span><span>${esc(check.message)}</span></div>`;
}

/* ---- step 3: review the import ---- */

function renderReview(root, ctx, w) {
  if (w.pullError) {
    root.innerHTML = `
      <h1>Set up your rota</h1>
      ${progress(3)}
      <div class="card">
        <h2 class="mt0">The appointment book could not be read</h2>
        <div class="warn"><span class="sev high">medicus</span><span>${esc(w.pullError)}</span></div>
        <div class="toolbar mt12">
          <button id="w-back" class="primary">Back</button>
          <span class="spacer"></span>
          ${LATER_LINK}
        </div>
      </div>`;
    root.querySelector('#w-back').onclick = () => {
      w.pullError = null;
      goTo(ctx, 2);
    };
    wireLater(root, ctx);
    return;
  }

  if (!w.plan) {
    root.innerHTML = `
      <h1>Set up your rota</h1>
      ${progress(3)}
      <div class="card">
        <h2 class="mt0">Reading your practice</h2>
        <div id="w-progress"></div>
      </div>`;
    if (!w.pulling) {
      w.pulling = true;
      runPull(root, ctx, w);
    }
    return;
  }

  const rows = w.rows;
  const included = rows.filter((r) => r.include).length;
  root.innerHTML = `
    <h1>Set up your rota</h1>
    ${progress(3)}
    <div class="card">
      <h2 class="mt0">Review before importing</h2>
      <p class="sub">${esc(String(w.daysRead))} day${w.daysRead === 1 ? '' : 's'} of appointment book read.
      Everyone below is about to become a staff member — change anything that is wrong, and untick anyone who
      should not be on the rota (locum lists, NHS 111 lanes, a colleague who has left). Nothing is saved yet.</p>
      ${(w.fetchErrors || []).map((e) => `<div class="warn"><span class="sev medium">day skipped</span><span>${esc(e)}</span></div>`).join('')}

      ${
        rows.length
          ? `<table class="mt8">
        <thead><tr>
          <th>Import</th><th>Clinician</th><th>Role</th><th>Contracted sessions</th><th>Duty doctor</th><th>Seen</th>
        </tr></thead>
        <tbody>
          ${rows
            .map(
              (r) => `
            <tr>
              <td><input type="checkbox" data-inc="${esc(r.id)}" ${r.include ? 'checked' : ''} aria-label="Import ${esc(r.name)}"></td>
              <td>${esc(r.name)}</td>
              <td><select data-role="${esc(r.id)}" aria-label="Role for ${esc(r.name)}">
                ${ROLES.map((role) => `<option value="${esc(role.id)}" ${role.id === r.role ? 'selected' : ''}>${esc(role.name)}</option>`).join('')}
              </select></td>
              <td><input type="number" class="w80" min="0" max="20" value="${esc(String(r.contractedSessions))}" data-sess="${esc(r.id)}" aria-label="Contracted sessions for ${esc(r.name)}"></td>
              <td><input type="checkbox" data-duty="${esc(r.id)}" ${r.dutyEligible ? 'checked' : ''} aria-label="Duty eligible: ${esc(r.name)}"></td>
              <td class="sub">${esc(String(r.sessionCount))} session${r.sessionCount === 1 ? '' : 's'} over ${esc(String(r.days))} day${r.days === 1 ? '' : 's'}</td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>`
          : '<div class="empty-state"><h3>No new clinicians found</h3><p>Everyone in the appointment book is already in your team. Continue to generate the rota from the week patterns.</p></div>'
      }

      ${
        w.skipped.length
          ? `<details class="mt12"><summary class="sub">Already in your team / skipped (${w.skipped.length})</summary>
            <div class="mt8">${w.skipped
              .map(
                (sk) =>
                  `<div class="warn"><span class="sev info">${sk.reason === SKIP_KNOWN ? 'known' : 'no sessions'}</span><span>${esc(sk.name)}</span></div>`
              )
              .join('')}</div>
          </details>`
          : ''
      }

      <div class="card-section">Rooms</div>
      <div class="toolbar">
        <span>We will set up</span>
        <input type="number" id="w-rooms" class="w80" min="0" max="40" value="${esc(String(w.roomCount))}">
        <span>consulting room${w.roomCount === 1 ? '' : 's'}</span>
        <span class="sub">— the most clinicians the appointment book ever had consulting face-to-face at once${w.roomsAssigned ? `, with a usual room each for ${esc(String(w.roomsAssigned))} of them` : ''}.</span>
      </div>

      <div class="toolbar mt12">
        <button id="w-back">Back</button>
        <button id="w-import" class="primary">Import ${included} staff &amp; continue</button>
        <span class="spacer"></span>
        ${LATER_LINK}
      </div>
    </div>
  `;

  const importBtn = root.querySelector('#w-import');
  const rowById = (id) => rows.find((r) => r.id === id);
  const relabel = () => {
    importBtn.textContent = `Import ${rows.filter((r) => r.include).length} staff & continue`;
  };

  root.querySelectorAll('[data-inc]').forEach((box) => {
    box.onchange = () => {
      rowById(box.dataset.inc).include = box.checked;
      relabel();
    };
  });
  root.querySelectorAll('[data-role]').forEach((sel) => {
    sel.onchange = () => {
      rowById(sel.dataset.role).role = sel.value;
    };
  });
  root.querySelectorAll('[data-sess]').forEach((input) => {
    input.onchange = () => {
      rowById(input.dataset.sess).contractedSessions = Math.max(0, Number(input.value) || 0);
    };
  });
  root.querySelectorAll('[data-duty]').forEach((box) => {
    box.onchange = () => {
      rowById(box.dataset.duty).dutyEligible = box.checked;
    };
  });
  root.querySelector('#w-rooms').onchange = (ev) => {
    w.roomCount = Math.max(0, Number(ev.target.value) || 0);
  };

  root.querySelector('#w-back').onclick = () => goTo(ctx, 2);
  importBtn.onclick = () => commitImport(ctx, w);
  wireLater(root, ctx);
}

async function runPull(root, ctx, w) {
  const { state } = ctx;
  const area = root.querySelector('#w-progress');
  const stage = (text) => {
    if (area)
      area.insertAdjacentHTML(
        'beforeend',
        `<div class="warn"><span class="sev info">…</span><span>${esc(text)}</span></div>`
      );
  };

  const monday = mondayOf(todayISO());
  stage('Reading the appointment book…');
  let byDate = {};
  let errors = [];
  try {
    ({ byDate, errors } = await fetchOverviewRange(state.settings.practiceCode, pastWeekdays(monday)));
  } catch (err) {
    w.pulling = false;
    w.pullError = friendlyError(err);
    ctx.rerender();
    return;
  }
  if (!Object.keys(byDate).length) {
    w.pulling = false;
    w.pullError = friendlyError(errors[0] || '');
    ctx.rerender();
    return;
  }

  const rowsByDate = Object.fromEntries(Object.entries(byDate).map(([d, payload]) => [d, parseOverview(payload)]));
  const plan = buildImportPlan(rowsByDate, state.staff);

  stage('Inferring weekly patterns…');
  // Provisional staff records: real ids (so room inference and, later, the
  // entries all line up) but held in state.ui only. Nothing has been written.
  const pending = plan.candidates.map((c) => newStaff({ id: uid(), name: c.name, medicusName: c.name }));
  const inferred = inferPatterns({ rowsByDate, staff: [...state.staff, ...pending] });
  const cellsById = {};
  for (const p of inferred.proposals) {
    const person = pending.find((s) => s.id === p.staffId);
    if (person) person.pattern = p.pattern;
    cellsById[p.staffId] = p.cells;
  }

  stage('Suggesting rooms…');
  const roomInfer = inferRooms({ rowsByDate, staff: [...state.staff, ...pending] });

  const observedWeeks = Math.max(1, Math.round(Object.keys(rowsByDate).length / 5));
  w.daysRead = Object.keys(rowsByDate).length;
  w.fetchErrors = errors.slice(0, 2);
  w.plan = plan;
  w.pending = pending;
  w.roomInfer = roomInfer;
  w.roomsAssigned = roomInfer.assignments.length;
  w.roomCount = Math.max(roomInfer.roomCount, (state.rooms || []).length);
  w.skipped = plan.skipped;
  w.rows = pending.map((person, i) => {
    const candidate = plan.candidates[i];
    return {
      id: person.id,
      name: person.name,
      role: 'gp',
      // The inferred pattern IS the week, so its cell count is the honest
      // default; without one, average the observed sessions per week.
      contractedSessions: cellsById[person.id] || Math.max(1, Math.round(candidate.sessionCount / observedWeeks)),
      dutyEligible: true,
      include: true,
      sessionCount: candidate.sessionCount,
      days: candidate.dates.length,
    };
  });
  w.pulling = false;
  ctx.rerender();
}

// In-memory only: staff and rooms land in state so step 4 can generate against
// them, but the single persist is still one press away.
function commitImport(ctx, w) {
  const { state } = ctx;
  const imported = [];
  for (const row of w.rows) {
    if (!row.include) continue;
    const person = w.pending.find((p) => p.id === row.id);
    if (!person) continue;
    person.role = row.role;
    person.contractedSessions = row.contractedSessions;
    person.dutyEligible = row.dutyEligible;
    imported.push(person);
  }
  state.staff = [...state.staff, ...imported];

  while (state.rooms.length < w.roomCount) {
    state.rooms.push({ id: uid(), name: `Room ${state.rooms.length + 1}` });
  }
  for (const a of (w.roomInfer && w.roomInfer.assignments) || []) {
    const person = state.staff.find((p) => p.id === a.staffId);
    const room = state.rooms[a.roomIndex];
    if (person && room) person.usualRoomId = room.id;
  }

  w.imported = imported.length;
  w.importedIds = imported.map((p) => p.id);
  goTo(ctx, 4);
}

/* ---- step 4: the first rota ---- */

function renderFirstRota(root, ctx, w) {
  const { state } = ctx;
  const s = state.settings;
  const monday = s.templateAnchorMonday || mondayOf(todayISO());
  const lastDay = addDays(monday, 7 * WEEKS_AHEAD - 1);
  const withPattern = state.staff.filter((p) =>
    (p.pattern || []).some((week) => Object.values(week).some((day) => day && (day.am || day.pm)))
  ).length;

  root.innerHTML = `
    <h1>Set up your rota</h1>
    ${progress(4)}
    <div class="card">
      <h2 class="mt0">Generate your first rota</h2>
      <p class="sub">This rolls each person's usual week forward and writes real sessions you can drag, cover
      and print. Approved leave is punched out as it goes, and nothing that already exists is overwritten.</p>
      <div class="warn"><span class="sev ok">staff</span><span>${esc(String(state.staff.length))} in the team${w.imported ? `, ${esc(String(w.imported))} imported just now` : ''} — ${esc(String(withPattern))} with a usual week</span></div>
      <div class="warn"><span class="sev ok">weeks</span><span>${WEEKS_AHEAD} weeks, ${esc(fmtDay(monday))} to ${esc(fmtDay(lastDay))} (week patterns anchored to ${esc(monday)})</span></div>
      <div class="warn"><span class="sev ok">rooms</span><span>${esc(String((state.rooms || []).length))} room${(state.rooms || []).length === 1 ? '' : 's'} ready</span></div>

      <div class="card-section">Duty cover</div>
      <p class="sub">How many duty doctors the practice needs on at once. The rota warns — never blocks — when a
      half-day falls short.</p>
      <div class="formgrid">
        <label class="field">Duty doctors required — AM
          <input id="w-dutyam" type="number" min="0" max="5" value="${esc(String((s.dutyRequired || {}).am ?? 1))}">
        </label>
        <label class="field">Duty doctors required — PM
          <input id="w-dutypm" type="number" min="0" max="5" value="${esc(String((s.dutyRequired || {}).pm ?? 1))}">
        </label>
      </div>

      <div class="toolbar mt12">
        <button id="w-back">Back</button>
        <button id="w-generate" class="primary">Generate my rota</button>
        <span class="spacer"></span>
        ${LATER_LINK}
      </div>
    </div>
  `;

  root.querySelector('#w-back').onclick = () => {
    rollbackImport(ctx); // the import is re-applied when they press Import again
    goTo(ctx, w.plan ? 3 : 1);
  };
  root.querySelector('#w-generate').onclick = async (ev) => {
    ev.currentTarget.disabled = true;
    s.dutyRequired = {
      am: Number(root.querySelector('#w-dutyam').value) || 0,
      pm: Number(root.querySelector('#w-dutypm').value) || 0,
    };
    if (!s.templateAnchorMonday) s.templateAnchorMonday = monday;
    const created = generateEntries({
      staff: state.staff,
      startDate: monday,
      endDate: lastDay,
      existingEntries: state.entries,
      leaveList: state.leave,
      settings: s,
    });
    state.entries.push(...created);
    // The one write of the whole wizard.
    await ctx.persist('staff', 'rooms', 'entries', 'settings');
    await ctx.log(
      `Setup wizard: ${w.imported || 0} clinicians imported, ${(state.rooms || []).length} rooms, ${created.length} sessions generated`
    );
    state.ui.setup = null;
    ctx.toast('Your first rota is ready — drag any session to adjust it');
    location.hash = '#rota';
  };
  wireLater(root, ctx);
}
