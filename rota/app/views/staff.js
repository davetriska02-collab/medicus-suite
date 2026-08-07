// Staff registry: the people the rota schedules, their contracts, flags
// and — crucially — the exact name they appear under in Medicus.

import { esc } from '../../shared/esc.js';
import { ROLES, EMPLOYMENT_TYPES, newStaff, roleById } from '../../shared/model.js';
import { uid } from '../../shared/store.js';
import { staffICS } from '../../engine/ics.js';
import { staffSorted, download } from './ui.js';

export default {
  render(root, ctx) {
    const { state } = ctx;
    const editingId = state.ui.staffEditing;
    const editing =
      editingId === 'new' ? (state.ui.staffDraft ||= newStaff()) : state.staff.find((s) => s.id === editingId);

    root.innerHTML = `
      <h1>Staff</h1>
      <div class="toolbar">
        <button id="add" class="primary">Add staff member</button>
        <span class="sub">${state.staff.length} people</span>
      </div>
      <table>
        <thead><tr><th>Name</th><th>Role</th><th>Employment</th><th>Sessions/wk</th><th>Flags</th><th>Medicus name</th><th title="Export this person's rota as an .ics calendar">Calendar</th></tr></thead>
        <tbody>
          ${staffSorted(state.staff)
            .map(
              (p) => `
            <tr class="clickable" data-id="${esc(p.id)}">
              <td><span class="dot" style="background:${esc(p.colour)}"></span>${esc(p.name)}${p.notAPerson ? ' <span class="pill cancelled" title="Directory lane — excluded from rota, inference and reconciliation">lane</span>' : ''}</td>
              <td>${esc((roleById(p.role) || {}).name || p.role)}</td>
              <td>${esc((EMPLOYMENT_TYPES.find((t) => t.id === p.employmentType) || {}).name || p.employmentType)}${p.registrarStage ? ` (${esc(p.registrarStage)})` : ''}</td>
              <td>${esc(String(p.contractedSessions))}</td>
              <td class="sub">${[p.dutyEligible ? 'duty' : '', p.supervisor ? 'supervisor' : '', p.prescriber ? 'prescriber' : ''].filter(Boolean).join(', ')}</td>
              <td class="sub">${esc(p.medicusName || '—')}</td>
              <td><button class="small" data-ics="${esc(p.id)}">Export .ics</button></td>
            </tr>
          `
            )
            .join('')}
          ${state.staff.length ? '' : `<tr><td colspan="7"><div class="empty-state"><h3>No staff yet</h3><p>Add people here, import clinicians from Medicus via Live sync, or load demo data from Settings.</p></div></td></tr>`}
        </tbody>
      </table>
      ${editing ? `<div class="modal-backdrop" id="staff-modal"><div class="modal">${form(editing, editingId === 'new', state.settings.sites || [], state.rooms || [])}</div></div>` : ''}
    `;

    root.querySelector('#add').onclick = () => {
      state.ui.staffEditing = 'new';
      state.ui.staffDraft = newStaff();
      ctx.rerender();
    };
    root.querySelectorAll('tr.clickable').forEach((tr) => {
      tr.onclick = () => {
        state.ui.staffEditing = tr.dataset.id;
        ctx.rerender();
      };
    });
    root.querySelectorAll('[data-ics]').forEach((btn) => {
      btn.onclick = (ev) => {
        ev.stopPropagation(); // don't open the row editor
        const person = state.staff.find((p) => p.id === btn.dataset.ics);
        if (!person) return;
        const sessions = state.entries.filter((e) => e.staffId === person.id).length;
        if (!sessions) {
          ctx.toast(`${person.name} has no rota sessions to export`);
          return;
        }
        const slug = person.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
        download(
          `rota-${slug}.ics`,
          staffICS({ person, entries: state.entries, rooms: state.rooms || [] }),
          'text/calendar'
        );
        ctx.toast(`Calendar exported for ${person.name}`);
      };
    });

    const f = root.querySelector('#staffform');
    if (!f) return;

    // Click on the dimmed backdrop (not the form) closes without saving.
    const modal = root.querySelector('#staff-modal');
    modal.addEventListener('mousedown', (ev) => {
      if (ev.target !== modal) return;
      state.ui.staffEditing = null;
      state.ui.staffDraft = null;
      ctx.rerender();
    });
    const val = (id) => f.querySelector(`#${id}`);

    f.querySelector('#save').onclick = async () => {
      const person = editing;
      person.name = val('f-name').value.trim();
      if (!person.name) {
        ctx.toast('Name is required');
        return;
      }
      person.role = val('f-role').value;
      person.employmentType = val('f-emp').value;
      person.registrarStage = person.employmentType === 'registrar' ? val('f-stage').value || 'ST1' : null;
      person.contractedSessions = Number(val('f-sessions').value) || 0;
      person.dutyEligible = val('f-duty').checked;
      person.supervisor = val('f-super').checked;
      person.prescriber = val('f-rx').checked;
      person.notAPerson = val('f-notperson').checked;
      person.entitlement = { annual: Number(val('f-al').value) || 0, study: Number(val('f-sl').value) || 0 };
      person.toilAccrued = Number(val('f-toil').value) || 0;
      person.medicusName = val('f-medicus').value.trim();
      person.site = val('f-site').value;
      person.usualRoomId = val('f-room').value || null;
      person.vtsDay = person.employmentType === 'registrar' ? val('f-vts').value : '';
      person.avoidDuty = [...val('f-avoidduty').selectedOptions].map((o) => o.value);
      person.colour = val('f-colour').value;
      if (editingId === 'new') {
        person.id = uid();
        state.staff.push(person);
      }
      state.ui.staffEditing = null;
      state.ui.staffDraft = null;
      await ctx.persist('staff');
      ctx.toast('Saved');
      ctx.rerender();
    };

    f.querySelector('#cancel').onclick = () => {
      state.ui.staffEditing = null;
      state.ui.staffDraft = null;
      ctx.rerender();
    };

    const del = f.querySelector('#delete');
    if (del)
      del.onclick = async () => {
        state.staff = state.staff.filter((s) => s.id !== editingId);
        state.entries = state.entries.filter((e) => e.staffId !== editingId);
        state.leave = state.leave.filter((l) => l.staffId !== editingId);
        state.ui.staffEditing = null;
        await ctx.persist('staff', 'entries', 'leave');
        ctx.toast('Deleted (their rota entries and leave too)');
        ctx.rerender();
      };
  },
};

function form(p, isNew, sites, rooms) {
  return `
    <div class="card" id="staffform">
      <h2 class="mt0">${isNew ? 'New staff member' : `Edit — ${esc(p.name)}`}</h2>
      <div class="formgrid">
        <label class="field">Name<input id="f-name" value="${esc(p.name)}" placeholder="Dr Jane Doe"></label>
        <label class="field">Role
          <select id="f-role">${ROLES.map((r) => `<option value="${r.id}" ${p.role === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select>
        </label>
        <label class="field">Employment
          <select id="f-emp">${EMPLOYMENT_TYPES.map((t) => `<option value="${t.id}" ${p.employmentType === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
        </label>
        <label class="field">Registrar stage
          <select id="f-stage">
            <option value="">—</option>
            ${['ST1', 'ST2', 'ST3'].map((s) => `<option ${p.registrarStage === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </label>
        <label class="field">Contracted sessions / week<input id="f-sessions" type="number" min="0" max="12" value="${esc(String(p.contractedSessions))}"></label>
        <label class="field">Annual leave (sessions/yr)<input id="f-al" type="number" min="0" value="${esc(String(p.entitlement.annual))}"></label>
        <label class="field">Study leave (sessions/yr)<input id="f-sl" type="number" min="0" value="${esc(String(p.entitlement.study))}"></label>
        <label class="field">TOIL banked (sessions)<input id="f-toil" type="number" min="0" value="${esc(String(p.toilAccrued || 0))}"></label>
        <label class="field">Name in Medicus appointment book<input id="f-medicus" value="${esc(p.medicusName)}" placeholder="exactly as Medicus shows it"></label>
        <label class="field">Usual room
          <select id="f-room">
            <option value="">—</option>
            ${rooms.map((r) => `<option value="${esc(r.id)}" ${p.usualRoomId === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}
          </select>
        </label>
        <label class="field">Site
          <select id="f-site">
            <option value="">—</option>
            ${(sites || []).map((x) => `<option ${p.site === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}
          </select>
        </label>
        <label class="field">VTS half-day (registrars — immovable)
          <select id="f-vts">
            <option value="">—</option>
            ${['mon', 'tue', 'wed', 'thu', 'fri']
              .flatMap((d) =>
                ['am', 'pm'].map(
                  (pp) =>
                    `<option value="${d}-${pp}" ${p.vtsDay === `${d}-${pp}` ? 'selected' : ''}>${d.toUpperCase()} ${pp.toUpperCase()}</option>`
                )
              )
              .join('')}
          </select>
        </label>
        <label class="field">Avoid duty on
          <select id="f-avoidduty" multiple size="4">
            ${['mon', 'tue', 'wed', 'thu', 'fri']
              .flatMap((d) =>
                ['am', 'pm'].map(
                  (pp) =>
                    `<option value="${d}-${pp}" ${(p.avoidDuty || []).includes(`${d}-${pp}`) ? 'selected' : ''}>${d.toUpperCase()} ${pp.toUpperCase()}</option>`
                )
              )
              .join('')}
          </select>
        </label>
        <label class="field">Colour<input id="f-colour" type="color" value="${esc(p.colour)}"></label>
      </div>
      <div class="mt10 mb8">
        <label class="check"><input id="f-duty" type="checkbox" ${p.dutyEligible ? 'checked' : ''}>Duty-doctor eligible</label>
        <label class="check"><input id="f-super" type="checkbox" ${p.supervisor ? 'checked' : ''}>Registrar supervisor</label>
        <label class="check"><input id="f-rx" type="checkbox" ${p.prescriber ? 'checked' : ''}>Prescriber</label>
        <label class="check"><input id="f-notperson" type="checkbox" ${p.notAPerson ? 'checked' : ''}>Not a person (111/directory lane — keep matched, exclude from rota &amp; inference)</label>
      </div>
      <div class="toolbar">
        <button id="save" class="primary">Save</button>
        <button id="cancel">Cancel</button>
        <span class="spacer"></span>
        ${isNew ? '' : '<button id="delete" class="danger">Delete</button>'}
      </div>
    </div>
  `;
}
