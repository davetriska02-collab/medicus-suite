// Settings: practice configuration, safe-staffing policy knobs,
// backup/restore and demo data.

import { esc } from '../../shared/esc.js';
import {
  makeAccess,
  verifyPasscode,
  accessSummary,
  newRecoveryCode,
  withRecoveryCode,
  carryRecoveryCode,
  hasRecoveryCode,
} from '../../engine/access.js';
import { DAY_KEYS, DEFAULT_SETTINGS } from '../../shared/model.js';
import { isValidPracticeCode } from '../../shared/medicus-api.js';
import { exportEnvelope, importEnvelope, wipe, save, uid } from '../../shared/store.js';
import { demoData } from '../../shared/demo.js';
import { mondayOf, todayISO, addDays, dayKey } from '../../shared/time.js';
import { buildEvidenceReport } from '../../engine/evidence.js';
import { timesheetCSV } from '../../engine/timesheet.js';
import { fetchOverviewRange } from '../../shared/medicus-api.js';
import { parseOverview } from '../../engine/reconcile.js';
import { inferRooms } from '../../engine/room-infer.js';
import { demoOverviewPayload } from '../../shared/demo.js';
import { download } from './ui.js';

export default {
  render(root, ctx) {
    const { state } = ctx;
    const s = state.settings;

    const syncStatus = state.ui.syncStatus || 'off';
    root.innerHTML = `
      <h1>Settings</h1>
      <div class="card">
        <h2 class="mt0">You &amp; practice sync</h2>
        <div class="formgrid">
          <label class="field">Your name (audit trail)
            <input id="s-username" value="${esc(s.userName || '')}" placeholder="e.g. Jo Bloggs (PM)">
          </label>
          <label class="field">Your role on this machine
            <select id="s-userrole">
              <option value="manager" ${s.userRole !== 'staff' ? 'selected' : ''}>Manager (full access)</option>
              <option value="staff" ${s.userRole === 'staff' ? 'selected' : ''}>Staff (My week focused)</option>
            </select>
          </label>
        </div>
        <div class="mt8 mb8">
          <label class="check"><input type="checkbox" id="s-notify" ${s.notifications ? 'checked' : ''}>Browser notifications for sync updates and waiting approvals</label>
        </div>
        <div class="toolbar mt8">
          ${
            syncStatus === 'unsupported'
              ? '<span class="sub">Shared-folder sync is not supported by this browser.</span>'
              : syncStatus === 'connected'
                ? `<span class="pill approved">sync connected</span><span class="sub">v${ctx.sync.status().version} — changes share via the folder, polled every 15s</span>
                 <span class="spacer"></span><button id="s-syncoff" class="danger">Disconnect</button>`
                : syncStatus === 'needs-permission'
                  ? `<span class="pill requested">reconnect needed</span>
                   <button id="s-syncperm" class="primary">Re-allow folder access</button>`
                  : `<button id="s-syncon" class="primary">Connect shared folder…</button>
                   <span class="sub">Pick a folder on the practice's shared drive — every machine pointed at the same folder shares one live rota. Data never leaves the practice.</span>`
          }
        </div>
        ${
          state.ui.syncRejected
            ? `<div class="warn mt8"><span class="sev high">sync</span><span>Shared rota v${esc(String(state.ui.syncRejected.version))}${state.ui.syncRejected.by ? ` from ${esc(state.ui.syncRejected.by)}` : ''} was <strong>rejected</strong> — malformed data, nothing was saved. Your local rota is unchanged. Reasons: ${esc(state.ui.syncRejected.reasons.join(' '))}</span></div>`
            : ''
        }
      </div>

      ${accessCard(state)}

      <div class="card">
        <h2 class="mt0">Practice</h2>
        <div class="formgrid">
          <label class="field">Medicus practice code
            <input id="s-code" value="${esc(s.practiceCode)}" placeholder="e.g. a3f2b1 (4–8 hex chars)">
          </label>
          <label class="field">List size (patients)
            <input id="s-list" type="number" min="0" value="${esc(String(s.listSize))}">
          </label>
          <label class="field">Template anchor Monday
            <input id="s-anchor" type="date" value="${esc(s.templateAnchorMonday || '')}">
          </label>
        </div>
        <div class="mt8">
          <strong>Open days:</strong>
          ${DAY_KEYS.map((d) => `<label class="check"><input type="checkbox" class="s-day" value="${d}" ${s.openDays.includes(d) ? 'checked' : ''}>${d.toUpperCase()}</label>`).join('')}
        </div>
        <div class="mt8">
          <strong>Enhanced access periods:</strong>
          <label class="check"><input type="checkbox" id="s-early" ${(s.extraPeriods || {}).early ? 'checked' : ''}>Early morning (07:00–08:00)</label>
          <label class="check"><input type="checkbox" id="s-eve" ${(s.extraPeriods || {}).eve ? 'checked' : ''}>Evening (18:30–20:00)</label>
          <span class="sub">adds EARLY/EVE columns to the rota and templates, and tracks DES minutes vs 60/1,000/week</span>
        </div>
        <div class="formgrid mt10">
          <label class="field">Sites (one per line — leave empty for single-site)
            <textarea id="s-sites" rows="3" style="display:block;margin-top:4px;min-width:220px">${esc((s.sites || []).join('\n'))}</textarea>
          </label>
          <label class="field">Bank holidays (YYYY-MM-DD, one per line)
            <textarea id="s-bh" rows="3" style="display:block;margin-top:4px;min-width:220px">${esc((s.bankHolidays || []).join('\n'))}</textarea>
          </label>
          <label class="field">Peak leave periods (name,start,end,maxSessions per line)
            <textarea id="s-peaks" rows="3" style="display:block;margin-top:4px;min-width:220px" placeholder="Summer,2026-07-20,2026-09-01,12">${esc((s.peakPeriods || []).map((p) => `${p.name},${p.start},${p.end},${p.maxSessions}`).join('\n'))}</textarea>
          </label>
        </div>
      </div>

      <div class="card">
        <h2 class="mt0">Safe-staffing policy <span class="sub" style="font-weight:400">(guidance defaults — configure to local policy)</span></h2>
        <div class="card-section">Duty &amp; access</div>
        <div class="formgrid">
          <label class="field">Duty doctors required — AM<input id="s-dutyam" type="number" min="0" max="5" value="${esc(String(s.dutyRequired.am))}"></label>
          <label class="field">Duty doctors required — PM<input id="s-dutypm" type="number" min="0" max="5" value="${esc(String(s.dutyRequired.pm))}"></label>
          <label class="field">Appointments per clinical session<input id="s-appts" type="number" min="1" value="${esc(String(s.apptsPerSurgerySession))}"></label>
          <label class="field">Access benchmark (appts / 1,000 patients / week)<input id="s-bench" type="number" min="0" value="${esc(String(s.accessBenchmarkPer1000))}"></label>
        </div>
        <div class="card-section">Leave caps</div>
        <div class="formgrid">
          <label class="field">Max simultaneous leave — GPs<input id="s-maxgp" type="number" min="0" value="${esc(String(s.maxSimultaneousLeave.gp))}"></label>
          <label class="field">Max simultaneous leave — nursing<input id="s-maxnur" type="number" min="0" value="${esc(String(s.maxSimultaneousLeave.nursing))}"></label>
          <label class="field">Max simultaneous leave — ARRS<input id="s-maxarrs" type="number" min="0" value="${esc(String(s.maxSimultaneousLeave.arrs))}"></label>
          <label class="field">Max simultaneous leave — non-clinical<input id="s-maxnon" type="number" min="0" value="${esc(String(s.maxSimultaneousLeave.nonclinical))}"></label>
        </div>
        <div class="card-section">Bradford &amp; WTD</div>
        <div class="formgrid">
          <label class="field">Bradford Factor — monitor at<input id="s-bfmon" type="number" min="0" value="${esc(String(s.bradfordThresholds.monitor))}"></label>
          <label class="field">Bradford Factor — high at<input id="s-bfhigh" type="number" min="0" value="${esc(String(s.bradfordThresholds.high))}"></label>
          <label class="field">Bradford Factor — severe at<input id="s-bfsev" type="number" min="0" value="${esc(String(s.bradfordThresholds.severe))}"></label>
          <label class="field">WTD weekly hours cap (warn)<input id="s-wtd" type="number" min="0" value="${esc(String(s.wtdWeeklyHours ?? 48))}"></label>
        </div>
        <button id="s-save" class="primary mt8">Save settings</button>
      </div>

      <div class="card">
        <h2 class="mt0">Rooms</h2>
        ${
          (state.rooms || [])
            .map(
              (r) => `
          <div class="toolbar mb8">
            <input value="${esc(r.name)}" data-roomname="${esc(r.id)}" style="width:240px" title="Edit to rename — usual-room assignments follow the room, not the name">
            <span class="spacer"></span>
            <button class="small danger" data-delroom="${esc(r.id)}">Remove</button>
          </div>`
            )
            .join('') ||
          '<div class="sub mb8">No rooms yet — add consulting/treatment rooms to assign them on the rota and catch double-bookings.</div>'
        }
        <div class="toolbar">
          <input id="s-newroom" placeholder="e.g. Room 3 / Treatment 1" style="width:220px">
          <button id="s-addroom">Add room</button>
          <span class="spacer"></span>
          <button id="s-inferrooms" ${isValidPracticeCode(s.practiceCode) ? '' : 'disabled title="Set your practice code above first"'}>Suggest from Medicus (4 weeks)</button>
          <button id="s-inferrooms-demo">Suggest from sample data</button>
        </div>
        <p class="sub">Suggestion reads the appointment book and counts the peak number of clinicians consulting
        face-to-face at once — that's how many rooms you need — then gives each clinician a stable usual room
        that never clashes with anyone they actually overlap with.</p>
        <div id="roominfer-out">${state.ui.roomInfer ? roomInferHTML(state.ui.roomInfer, state) : ''}</div>
      </div>

      <div class="card">
        <h2 class="mt0">Reports</h2>
        <div class="toolbar">
          <select id="s-evweeks">${[4, 8, 12, 26].map((n) => `<option value="${n}" ${n === 12 ? 'selected' : ''}>Last ${n} weeks</option>`).join('')}</select>
          <button id="s-evidence" class="primary">Generate CQC evidence pack</button>
          <span class="sub">Safe-staffing rules in force + the weekly compliance record — opens printable, save as PDF.</span>
        </div>
        <div class="toolbar" style="margin-top:8px">
          <input id="s-tsfrom" type="date" value="${esc(addDays(todayISO(), -27))}">
          <input id="s-tsto" type="date" value="${esc(todayISO())}">
          <button id="s-timesheet">Export timesheet CSV</button>
          <span class="sub">Sessions worked per person (by type, hours, locum-covered) plus approved leave — payroll-ready.</span>
        </div>
      </div>

      ${
        (state.audit || []).length
          ? `
      <div class="card">
        <h2 class="mt0">Audit log <span class="sub" style="font-weight:400">(last ${Math.min(state.audit.length, 25)} of ${state.audit.length})</span></h2>
        <table>
          <thead><tr><th>When</th><th>Who</th><th>Action</th></tr></thead>
          <tbody>${state.audit
            .slice(-25)
            .reverse()
            .map(
              (a) => `
            <tr><td class="sub">${esc(new Date(a.at).toLocaleString('en-GB'))}</td><td>${esc(a.by || '—')}</td><td>${esc(a.summary)}</td></tr>`
            )
            .join('')}
          </tbody>
        </table>
      </div>`
          : ''
      }

      <div class="card">
        <h2 class="mt0">Data</h2>
        <div class="toolbar">
          <button id="s-export">Export backup</button>
          <button id="s-import">Import backup</button>
          <input id="s-file" type="file" accept="application/json" hidden>
          <span class="spacer"></span>
          <button id="s-demo">Load demo dataset</button>
          <button id="s-wipe" class="danger">Wipe all data</button>
        </div>
        <p class="sub">Backups contain staff, rota entries, leave, settings and the (hashed) passcode
        configuration — no patient data is ever stored by this product. Wiping clears the passcode too,
        which is the way back in if it has been forgotten.</p>
      </div>
    `;

    wireAccessCard(root, ctx);

    root.querySelector('#s-save').onclick = async () => {
      const code = root.querySelector('#s-code').value.trim().toLowerCase();
      if (code && !isValidPracticeCode(code)) {
        ctx.toast('Practice code must be 4–8 hex characters');
        return;
      }
      s.practiceCode = code;
      s.userName = root.querySelector('#s-username').value.trim();
      s.userRole = root.querySelector('#s-userrole').value;
      s.sites = root
        .querySelector('#s-sites')
        .value.split('\n')
        .map((x) => x.trim())
        .filter(Boolean);
      s.extraPeriods = {
        early: root.querySelector('#s-early').checked,
        eve: root.querySelector('#s-eve').checked,
      };
      s.bankHolidays = root
        .querySelector('#s-bh')
        .value.split('\n')
        .map((x) => x.trim())
        .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x))
        .sort();
      s.peakPeriods = root
        .querySelector('#s-peaks')
        .value.split('\n')
        .map((line) => {
          const [name, start, end, max] = line.split(',').map((x) => x.trim());
          if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(start || '') || !/^\d{4}-\d{2}-\d{2}$/.test(end || '')) return null;
          return { name, start, end, maxSessions: Number(max) || 0 };
        })
        .filter(Boolean);
      s.listSize = Number(root.querySelector('#s-list').value) || 0;
      s.templateAnchorMonday = root.querySelector('#s-anchor').value || null;
      s.openDays = [...root.querySelectorAll('.s-day:checked')].map((c) => c.value);
      s.dutyRequired = {
        am: Number(root.querySelector('#s-dutyam').value) || 0,
        pm: Number(root.querySelector('#s-dutypm').value) || 0,
      };
      s.apptsPerSurgerySession =
        Number(root.querySelector('#s-appts').value) || DEFAULT_SETTINGS.apptsPerSurgerySession;
      s.accessBenchmarkPer1000 = Number(root.querySelector('#s-bench').value) || 0;
      s.maxSimultaneousLeave = {
        gp: Number(root.querySelector('#s-maxgp').value) || 0,
        nursing: Number(root.querySelector('#s-maxnur').value) || 0,
        arrs: Number(root.querySelector('#s-maxarrs').value) || 0,
        nonclinical: Number(root.querySelector('#s-maxnon').value) || 0,
      };
      s.bradfordThresholds = {
        monitor: Number(root.querySelector('#s-bfmon').value) || 0,
        high: Number(root.querySelector('#s-bfhigh').value) || 0,
        severe: Number(root.querySelector('#s-bfsev').value) || 0,
      };
      s.wtdWeeklyHours = Number(root.querySelector('#s-wtd').value) || 48;
      s.notifications = root.querySelector('#s-notify').checked;
      await ctx.persist('settings');
      ctx.toast('Settings saved');
      ctx.rerender();
    };

    const syncOn = root.querySelector('#s-syncon');
    if (syncOn)
      syncOn.onclick = async () => {
        try {
          await ctx.sync.connect();
          await ctx.syncConnected();
          ctx.toast('Shared folder connected — this machine now syncs');
        } catch (err) {
          if (err && err.name !== 'AbortError') ctx.toast(`Could not connect: ${err.message || err}`);
        }
      };
    const syncPerm = root.querySelector('#s-syncperm');
    if (syncPerm)
      syncPerm.onclick = async () => {
        if (await ctx.sync.requestPermission()) {
          await ctx.syncConnected();
          ctx.toast('Folder access restored');
        } else ctx.toast('Permission was not granted');
      };
    const syncOff = root.querySelector('#s-syncoff');
    if (syncOff)
      syncOff.onclick = async () => {
        await ctx.sync.disconnect();
        state.ui.syncStatus = 'off';
        state.ui.syncReady = false;
        ctx.toast('Sync disconnected — this machine is standalone again');
        ctx.rerender();
      };

    root.querySelector('#s-timesheet').onclick = async () => {
      const from = root.querySelector('#s-tsfrom').value;
      const to = root.querySelector('#s-tsto').value;
      if (!from || !to || to < from) {
        ctx.toast('Check the dates');
        return;
      }
      const csv = timesheetCSV({
        startDate: from,
        endDate: to,
        staff: state.staff,
        entries: state.entries,
        leaveList: state.leave,
      });
      download(`timesheet-${from}-to-${to}.csv`, csv, 'text/csv');
      await ctx.log(`Exported timesheet CSV ${from} – ${to}`);
      ctx.toast('Timesheet exported');
    };

    root.querySelector('#s-evidence').onclick = async () => {
      const weeks = Number(root.querySelector('#s-evweeks').value);
      const startMonday = addDays(mondayOf(todayISO()), -7 * (weeks - 1));
      const html = buildEvidenceReport({
        startMonday,
        weeks,
        staff: state.staff,
        entries: state.entries,
        leave: state.leave,
        rooms: state.rooms || [],
        settings: s,
        audit: state.audit || [],
        generatedBy: s.userName,
      });
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      window.open(url, '_blank');
      await ctx.log(`Generated CQC evidence pack (${weeks} weeks)`);
      ctx.toast('Evidence pack opened — use the browser print dialog to save as PDF');
    };

    const runRoomInfer = (rowsByDate) => {
      state.ui.roomInfer = inferRooms({ rowsByDate, staff: state.staff });
      ctx.rerender();
    };
    const inferLive = root.querySelector('#s-inferrooms');
    if (inferLive)
      inferLive.onclick = async () => {
        ctx.toast('Reading 4 weeks of appointment-book history…');
        const thisMonday = mondayOf(todayISO());
        const dates = [];
        for (let w = 4; w >= 1; w--) {
          for (let i = 0; i < 5; i++) dates.push(addDays(thisMonday, -7 * w + i));
        }
        try {
          const { byDate, errors } = await fetchOverviewRange(s.practiceCode, dates);
          if (errors.length && !Object.keys(byDate).length) {
            ctx.toast(`Fetch failed: ${errors[0]}`);
            return;
          }
          runRoomInfer(Object.fromEntries(Object.entries(byDate).map(([d, payload]) => [d, parseOverview(payload)])));
        } catch (err) {
          ctx.toast(err instanceof Error ? err.message : String(err));
        }
      };
    root.querySelector('#s-inferrooms-demo').onclick = () => {
      const thisMonday = mondayOf(todayISO());
      const rowsByDate = {};
      for (let w = 2; w >= 1; w--) {
        for (let i = 0; i < 4; i++) {
          const d = addDays(thisMonday, -7 * w + i);
          if (dayKey(d) !== 'sat' && dayKey(d) !== 'sun')
            rowsByDate[d] = parseOverview(demoOverviewPayload(state.staff, d));
        }
      }
      runRoomInfer(rowsByDate);
    };
    const applyInfer = root.querySelector('#s-applyrooms');
    if (applyInfer)
      applyInfer.onclick = async () => {
        const result = state.ui.roomInfer;
        if (!result) return;
        // Top up the registry to the suggested count, then pin usual rooms.
        while (state.rooms.length < result.roomCount) {
          state.rooms.push({ id: uid(), name: `Room ${state.rooms.length + 1}` });
        }
        for (const a of result.assignments) {
          const person = state.staff.find((p) => p.id === a.staffId);
          const room = state.rooms[a.roomIndex];
          if (person && room) person.usualRoomId = room.id;
        }
        await ctx.persist('rooms', 'staff');
        await ctx.log(
          `Applied room inference: ${result.roomCount} rooms, ${result.assignments.length} usual-room assignments`
        );
        ctx.toast(`${result.roomCount} room(s) ready and usual rooms set — use “Assign rooms” on the Rota page`);
        state.ui.roomInfer = null;
        ctx.rerender();
      };

    root.querySelectorAll('[data-roomname]').forEach((input) => {
      input.onchange = async () => {
        const room = state.rooms.find((r) => r.id === input.dataset.roomname);
        if (!room) return;
        const name = input.value.trim();
        if (!name) {
          input.value = room.name;
          return;
        } // blank rename rejected
        if (name === room.name) return;
        const old = room.name;
        room.name = name;
        await ctx.persist('rooms');
        await ctx.log(`Renamed room "${old}" to "${name}"`);
        ctx.toast(`Renamed to ${name} — assignments follow the room automatically`);
      };
    });

    root.querySelector('#s-addroom').onclick = async () => {
      const name = root.querySelector('#s-newroom').value.trim();
      if (!name) return;
      state.rooms = [...(state.rooms || []), { id: uid(), name }];
      await ctx.persist('rooms');
      ctx.rerender();
    };
    root.querySelectorAll('[data-delroom]').forEach((btn) => {
      btn.onclick = async () => {
        state.rooms = state.rooms.filter((r) => r.id !== btn.dataset.delroom);
        state.entries = state.entries.map((e) => (e.roomId === btn.dataset.delroom ? { ...e, roomId: null } : e));
        await ctx.persist('rooms', 'entries');
        ctx.rerender();
      };
    });

    root.querySelector('#s-export').onclick = async () => {
      const env = await exportEnvelope();
      download(`rota-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(env, null, 2));
    };

    root.querySelector('#s-import').onclick = () => root.querySelector('#s-file').click();
    root.querySelector('#s-file').onchange = async (ev) => {
      const file = ev.target.files[0];
      if (!file) return;
      try {
        await importEnvelope(JSON.parse(await file.text()));
        await ctx.reload();
        ctx.toast('Backup imported');
      } catch (err) {
        ctx.toast(err instanceof Error ? err.message : 'Import failed');
      }
    };

    root.querySelector('#s-demo').onclick = async () => {
      if (state.staff.length && !confirm('Replace current data with the demo dataset?')) return;
      const demo = demoData();
      await save('staff', demo.staff);
      await save('entries', demo.entries);
      await save('leave', demo.leave);
      await save('rooms', demo.rooms);
      await save('swaps', []);
      await save('audit', []);
      await save('settings', demo.settings);
      await ctx.reload();
      ctx.toast('Demo practice loaded — try “Generate from templates” on the Rota page');
    };

    root.querySelector('#s-wipe').onclick = async () => {
      if (!confirm('Delete ALL rota manager data? This cannot be undone.')) return;
      await wipe();
      await ctx.reload();
      ctx.toast('All data wiped');
    };
  },
};

/* ---- passcode access gate ---- */

// The honest framing, in one place so both states of the card carry it. It is
// deliberately blunt: this is a workflow gate in a Chrome extension, and a
// settings page that implied otherwise would be the actual harm.
const ACCESS_HONESTY = `
  <ul class="sub accessnote">
    <li>This stops casual and accidental editing by staff who should not be changing the rota. It is
      not security: anyone who can open this browser profile's extension storage can still read
      everything, and a determined person can bypass the gate.</li>
    <li>The passcode itself is never stored — only a one-way hash of it — so it cannot be read back
      out of storage, a backup or the shared sync folder.</li>
    <li>The setting travels: practice backups and the shared-folder sync both carry this (hashed)
      configuration, so restoring a backup restores the passcode it was taken with, and connecting
      the shared folder applies the practice's lock to this machine too.</li>
    <li>Forgotten it? The passcode itself cannot be recovered. The one-time recovery code shown when
      it is set is the way back in: entering it on the unlock screen removes the passcode so a new
      one can be set. Without that code, only wiping the rota data in the Data section below clears
      the passcode, and that clears everything else with it.</li>
    <li>The recovery code is a way back in, not a second lock. It is held as a one-way hash in the
      same travelling configuration, and anyone holding the written code can take the gate off.</li>
  </ul>
`;

const MODE_EXPLAINER = `
  <p class="sub mt8">
    <strong>Staff view (default)</strong> — without the passcode the app is read-only: the rota and
    My week still open, so staff can check their week, request leave, propose swaps and export their
    calendar, but nothing can be edited and the admin pages are hidden.
    <br>
    <strong>Strict</strong> — without the passcode nothing opens at all.
  </p>
`;

// Shown ONCE per issued code, and never again: only the hash is stored, so this
// really is the only chance to read it. It lives in state.ui (per-view scratch,
// never persisted, never synced, gone when the tab closes) and is cleared the
// moment the manager says they have recorded it.
//
// It deliberately SURVIVES navigating around the app in the meantime: a manager
// who clicks away before writing it down should find it still here, not have
// lost the only copy to a stray click.
function recoveryOnceCard(state) {
  const code = state.ui.recoveryOnce;
  if (!code) return '';
  return `
    <div class="card">
      <h2 class="mt0">Recovery code <span class="pill requested">write this down now</span></h2>
      <p class="sub">
        This is the only time it can be shown. Only a one-way hash of it is stored, so nobody,
        including this app, can show it again.
      </p>
      <p class="reccode">${esc(code)}</p>
      <p class="sub">
        Record it somewhere a second manager can reach it — the practice safe, the partners' folder,
        wherever the other things nobody may lose are kept. Do not keep it only on this machine:
        it exists for the day the person who set the passcode is not here.
      </p>
      <p class="sub">
        If the passcode is forgotten, entering this code on the unlock screen removes the passcode
        so a new one can be set. It does not show the old passcode, and it does not make the gate
        secure: this is still a workflow gate against casual editing, not encryption.
      </p>
      <div class="toolbar mt8">
        <button id="ac-recdone" class="primary">I have recorded it</button>
      </div>
    </div>
  `;
}

function accessCard(state) {
  const summary = accessSummary(state.access);
  const hint = state.access && typeof state.access.hint === 'string' ? state.access.hint : '';
  const updated = state.access && state.access.updatedAt ? state.access.updatedAt : '';
  const recoverySet = state.access && state.access.recoverySetAt ? state.access.recoverySetAt : '';

  if (!summary.enabled) {
    return `
      <div class="card">
        <h2 class="mt0">Passcode protection <span class="pill requested">off</span></h2>
        <p class="sub">
          Optional. Set a passcode so only the people who should be changing the rota — partners and
          managers — can edit it.
        </p>
        <p class="sub">
          Turning it on shows a one-time recovery code. Write it down and keep it where a second
          manager can reach it: without it, a forgotten passcode can only be cleared by wiping all
          the rota data.
        </p>
        ${MODE_EXPLAINER}
        <div class="formgrid mt8">
          <label class="field">New passcode<input id="ac-new" type="password" autocomplete="new-password"></label>
          <label class="field">Repeat passcode<input id="ac-confirm" type="password" autocomplete="new-password"></label>
          <label class="field">Hint (optional, shown on the unlock screen)
            <input id="ac-hint" value="${esc(hint)}" placeholder="e.g. the usual practice one">
          </label>
        </div>
        <div class="mt8">
          <label class="check"><input type="checkbox" id="ac-strict">Strict mode — lock the whole app, not just editing</label>
        </div>
        <div class="toolbar mt8">
          <button id="ac-set" class="primary">Turn on passcode protection</button>
        </div>
        ${ACCESS_HONESTY}
      </div>
    `;
  }

  return `
    ${recoveryOnceCard(state)}
    <div class="card">
      <h2 class="mt0">Passcode protection <span class="pill approved">on</span></h2>
      <p class="sub">
        Mode: <strong>${summary.strict ? 'strict — the whole app is locked' : 'staff view — the app is read-only without the passcode'}</strong>.
        ${summary.hasHint ? `Hint shown on the unlock screen: "${esc(hint)}".` : 'No hint is shown.'}
        ${updated ? `Last changed ${esc(new Date(updated).toLocaleString('en-GB'))}.` : ''}
      </p>
      ${MODE_EXPLAINER}
      <div class="card-section">Change something</div>
      <p class="sub">Every change below needs the current passcode.</p>
      <label class="field">Current passcode<input id="ac-current" type="password" autocomplete="current-password"></label>
      <div class="formgrid mt8">
        <label class="field">New passcode<input id="ac-new" type="password" autocomplete="new-password"></label>
        <label class="field">Repeat new passcode<input id="ac-confirm" type="password" autocomplete="new-password"></label>
      </div>
      <div class="toolbar">
        <button id="ac-change">Change passcode</button>
      </div>
      <div class="formgrid mt12">
        <label class="field">Hint<input id="ac-hint" value="${esc(hint)}" placeholder="leave empty for no hint"></label>
      </div>
      <div class="mt8">
        <label class="check"><input type="checkbox" id="ac-strict" ${summary.strict ? 'checked' : ''}>Strict mode — lock the whole app, not just editing</label>
      </div>
      <div class="toolbar mt8">
        <button id="ac-mode">Save mode &amp; hint</button>
        <span class="spacer"></span>
        <button id="ac-remove" class="danger">Remove passcode protection</button>
      </div>
      <div class="card-section">Recovery code</div>
      <p class="sub">
        ${
          summary.hasRecovery
            ? `A recovery code is set${recoverySet ? ` (issued ${esc(new Date(recoverySet).toLocaleString('en-GB'))})` : ''}.
               It was shown once when it was created and cannot be shown again — only a one-way hash
               of it is stored. Entering it on the unlock screen removes the passcode so a new one
               can be set.`
            : `No recovery code is set for this passcode. Until one is, a forgotten passcode can only
               be cleared by wiping all the rota data. Issue one now and keep it where a second
               manager can reach it.`
        }
      </p>
      <div class="toolbar mt8">
        <button id="ac-regen">${summary.hasRecovery ? 'Issue a new recovery code' : 'Issue a recovery code'}</button>
      </div>
      <p class="sub">
        ${
          summary.hasRecovery
            ? 'Issuing a new code stops the old one working straight away, so replace the written copy.'
            : 'The new code is shown once, here, as soon as it is issued.'
        }
      </p>
      ${ACCESS_HONESTY}
    </div>
  `;
}

// Access config is NOT part of the pushUndo → persist → rerender mutation
// pattern: it is not a rota edit and must never be undoable back into an
// unlocked state. It persists directly, and every CHANGE is audited (unlocks
// and failed attempts deliberately are not — see views/unlock.js).
function wireAccessCard(root, ctx) {
  const { state } = ctx;
  const val = (sel) => {
    const el = root.querySelector(sel);
    return el ? el.value : '';
  };
  const checked = (sel) => {
    const el = root.querySelector(sel);
    return Boolean(el && el.checked);
  };
  const currentOk = async () => {
    const ok = await verifyPasscode(val('#ac-current'), state.access);
    if (!ok) ctx.toast('Current passcode is not correct');
    return ok;
  };
  // recoveryOnce is the plaintext recovery code to display once. It is handed
  // to the manager only AFTER the record carrying its hash has actually been
  // written — a code written on paper that never reached storage is worse than
  // no code at all.
  const commit = async (access, summary, recoveryOnce) => {
    state.access = access;
    await ctx.persist('access');
    if (recoveryOnce) state.ui.recoveryOnce = recoveryOnce;
    await ctx.log(summary);
    ctx.toast(summary);
    ctx.rerender();
  };

  const setBtn = root.querySelector('#ac-set');
  if (setBtn)
    setBtn.onclick = async () => {
      const code = val('#ac-new');
      if (code.length < 4) {
        ctx.toast('Use at least 4 characters');
        return;
      }
      if (code !== val('#ac-confirm')) {
        ctx.toast('The two passcodes do not match');
        return;
      }
      const strict = checked('#ac-strict');
      // Every new passcode is issued with a recovery code: a gate with no way
      // back in is the hazard (H-064), not a safer default.
      const recovery = newRecoveryCode();
      await commit(
        await makeAccess(code, { strict, hint: val('#ac-hint').trim(), recoveryCode: recovery }),
        `Passcode protection turned on (${strict ? 'strict' : 'staff view'})`,
        recovery
      );
    };

  const changeBtn = root.querySelector('#ac-change');
  if (changeBtn)
    changeBtn.onclick = async () => {
      if (!(await currentOk())) return;
      const code = val('#ac-new');
      if (code.length < 4) {
        ctx.toast('Use at least 4 characters');
        return;
      }
      if (code !== val('#ac-confirm')) {
        ctx.toast('The two passcodes do not match');
        return;
      }
      // A change re-derives salt and hash from scratch; mode and hint are
      // carried across from the form so one press cannot silently revert them.
      const next = await makeAccess(code, { strict: checked('#ac-strict'), hint: val('#ac-hint').trim() });
      // The recovery code is independent of the passcode, so an existing one is
      // carried across untouched — the copy in the safe keeps working. A record
      // from before recovery codes existed gets one here, shown once, which is
      // how an already-protected practice acquires one without being wiped.
      if (hasRecoveryCode(state.access)) {
        await commit(carryRecoveryCode(next, state.access), 'Passcode changed');
        return;
      }
      const recovery = newRecoveryCode();
      await commit(await withRecoveryCode(next, recovery), 'Passcode changed', recovery);
    };

  const modeBtn = root.querySelector('#ac-mode');
  if (modeBtn)
    modeBtn.onclick = async () => {
      if (!(await currentOk())) return;
      const strict = checked('#ac-strict');
      const hint = val('#ac-hint').trim();
      await commit(
        { ...state.access, strict, hint, updatedAt: new Date().toISOString() },
        `Passcode mode set to ${strict ? 'strict' : 'staff view'}${hint ? ' with a hint' : ''}`
      );
    };

  // Issue (or re-issue) a recovery code for a passcode that is already set.
  // Only reachable from Settings, which a locked machine cannot open at all
  // (app.js effectiveRoute sends it to the unlock screen), so the gate is
  // already unlocked here; the current passcode is asked for on top, exactly
  // like every other change on this card.
  const regenBtn = root.querySelector('#ac-regen');
  if (regenBtn)
    regenBtn.onclick = async () => {
      if (!(await currentOk())) return;
      const replacing = hasRecoveryCode(state.access);
      if (
        replacing &&
        !confirm(
          'Issue a new recovery code? The one written down now stops working, so it must be replaced wherever it is kept.'
        )
      ) {
        return;
      }
      // updatedAt is deliberately left alone: it means "the passcode last
      // changed", which this does not do.
      const recovery = newRecoveryCode();
      await commit(
        await withRecoveryCode(state.access, recovery),
        replacing ? 'New recovery code issued (the previous one no longer works)' : 'Recovery code issued',
        recovery
      );
    };

  // Dismissing the one-time display is the ONLY thing that clears it, and it
  // clears it from memory only — nothing plaintext was ever written anywhere.
  const recDoneBtn = root.querySelector('#ac-recdone');
  if (recDoneBtn)
    recDoneBtn.onclick = () => {
      state.ui.recoveryOnce = null;
      ctx.rerender();
    };

  const removeBtn = root.querySelector('#ac-remove');
  if (removeBtn)
    removeBtn.onclick = async () => {
      if (!(await currentOk())) return;
      if (!confirm('Remove passcode protection? Anyone with this browser profile will be able to edit the rota.'))
        return;
      // null, not a disabled record: nothing is kept once protection is off —
      // including the recovery code, which has nothing left to recover.
      state.ui.recoveryOnce = null;
      await commit(null, 'Passcode protection removed');
    };
}

function roomInferHTML(result, state) {
  return `
    <div class="sub" style="margin-bottom:6px">${result.datesObserved} day(s) analysed — peak concurrent face-to-face clinicians: <strong>${result.roomCount}</strong></div>
    ${
      result.assignments.length
        ? `<table>
      <thead><tr><th>Clinician</th><th>F2F sessions seen</th><th>Suggested usual room</th></tr></thead>
      <tbody>${result.assignments
        .map(
          (a) => `
        <tr><td>${esc(a.name)}</td><td>${a.sessions}</td><td>Room ${a.roomIndex + 1}</td></tr>`
        )
        .join('')}
      </tbody>
    </table>`
        : '<div class="muted">No registered clinicians matched the appointment-book data.</div>'
    }
    ${result.unmatched.length ? `<div class="sub" style="margin-top:6px">Also consulting (not in registry): ${result.unmatched.map(esc).join(', ')}</div>` : ''}
    <div class="toolbar" style="margin-top:8px">
      <button id="s-applyrooms" class="primary" ${result.assignments.length ? '' : 'disabled'}>Apply: create ${result.roomCount} room(s) + set usual rooms</button>
    </div>
  `;
}
