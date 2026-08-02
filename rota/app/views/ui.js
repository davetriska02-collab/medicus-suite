// Small helpers shared across views.

import { esc } from '../../shared/esc.js';
import { roleById, typeById, leaveTypeById } from '../../shared/model.js';

const GROUP_ORDER = { gp: 0, nursing: 1, arrs: 2, nonclinical: 3 };

export function staffSorted(staff) {
  return [...staff].sort((a, b) => {
    const ga = GROUP_ORDER[(roleById(a.role) || {}).group] ?? 9;
    const gb = GROUP_ORDER[(roleById(b.role) || {}).group] ?? 9;
    if (ga !== gb) return ga - gb;
    return a.name.localeCompare(b.name);
  });
}

export function staffLabel(person) {
  const role = roleById(person.role);
  const extra =
    person.employmentType === 'registrar' ? person.registrarStage || 'GPST' : role ? role.name : person.role;
  return `<span class="dot" style="background:${esc(person.colour)}"></span>${esc(person.name)}<span class="roletag">${esc(extra)}</span>`;
}

export function typeChip(typeId, status, extraTitle = '') {
  const t = typeById(typeId);
  if (!t) return '<span class="empty">·</span>';
  const extra = extraTitle ? ` — ${extraTitle}` : '';
  if (status === 'vacancy')
    return `<span class="chip vacancy" title="${esc(`Needs cover${extra}`)}">${esc(t.short)}!</span>`;
  const covered = status === 'covered' ? ' covered' : '';
  const title = (status === 'covered' ? `${t.name} — covered (locum)` : t.name) + extra;
  return `<span class="chip${covered}" style="background:${esc(t.colour)}" title="${esc(title)}">${esc(t.short)}</span>`;
}

export function leaveChip(leaveRecord) {
  const lt = leaveTypeById(leaveRecord.type);
  const cls = leaveRecord.type === 'sick' ? 'chip sick' : 'chip leave';
  return `<span class="${cls}" title="${esc(lt ? lt.name : leaveRecord.type)}">${esc(lt ? lt.short : '?')}</span>`;
}

export function warnHTML(warnings) {
  if (!warnings.length) return '<div class="muted">No warnings — the week looks safe.</div>';
  return warnings
    .map(
      (w) =>
        `<div class="warn"><span class="sev ${esc(w.severity)}">${esc(w.severity)}</span><span>${esc(w.message)}</span></div>`
    )
    .join('');
}

export function download(filename, text, mime = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
