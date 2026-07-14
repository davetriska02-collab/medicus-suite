// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Follow-ups module v1.0
//
// The personal safety-net ledger (Practice dream-feature panel D1, first
// face): "MSU pending — chase Friday" logged in seconds, resurfaced when the
// due date passes. A lapsed entry is a prompt, never an action.
//
// INTENDED-PURPOSE FRAMING (docs/INTENDED-PURPOSE.md — read before editing
// copy): this is a personal reminder list, NOT the clinical record and NOT a
// safety-netting system of record. Safety-netting must still be documented
// in Medicus as usual; the honest-state line is a fixed part of the header,
// not a dismissable notice. Hazard log: H-040.
//
// Patient linkage (wrong-patient doctrine): entries created from the
// Monitoring tab carry the open patient's UUID + name verbatim, captured
// from the record context with the same open/submit re-check as the
// create-task form. Entries added on THIS tab are unlinked free text — a
// typed name is just text, never an identity claim.
//
// PHI: entries carry patient-identifiable free text, so the store is
// machine-local BY DESIGN — excluded from suite backups (see the allowlist
// rationale in test-backup-coverage.js) and capped + pruned in
// followups-core.js.

'use strict';

import {
  classifyFollowup,
  sortFollowups,
  followupCounts,
  validateFollowup,
  pruneFollowups,
  formatDueLabel,
  dateOnlyISO,
  FOLLOWUP_STATUS,
  DONE_RETENTION_DAYS,
} from './followups-core.js';

export const FOLLOWUPS_STORE_KEY = 'followups.entries';

let container = null;

function esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

// ── Storage (promise wrappers; every write runs the prune) ────────────────────

export function loadFollowups() {
  return new Promise((resolve) => {
    chrome.storage.local.get([FOLLOWUPS_STORE_KEY], (res) => {
      const v = res && res[FOLLOWUPS_STORE_KEY];
      resolve(Array.isArray(v) ? v : []);
    });
  });
}

function saveFollowups(entries) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [FOLLOWUPS_STORE_KEY]: pruneFollowups(entries, Date.now()) }, resolve);
  });
}

// Append one entry — shared with the Monitoring integration (sentinel.js
// imports this so the write path, prune and ledger note stay in one place).
export async function addFollowup({ what, due, patientUuid = null, patientName = '', source = 'manual' }) {
  const err = validateFollowup({ what, due });
  if (err) throw new Error(err);
  const entry = {
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `fu_${Date.now()}_${Math.random()}`,
    what: String(what).trim(),
    due,
    createdAt: new Date().toISOString(),
    status: FOLLOWUP_STATUS.OPEN,
    doneAt: null,
    patientUuid: patientUuid || null,
    patientName: String(patientName || ''),
    source,
  };
  const entries = await loadFollowups();
  entries.push(entry);
  await saveFollowups(entries);
  if (window.EventLedger && entry.patientUuid) {
    window.EventLedger.record({
      source: 'followups',
      patientRef: entry.patientUuid,
      severity: null,
      ruleId: null,
      label: 'follow-up reminder added',
      action: 'followup-added',
    });
  }
  return entry;
}

async function setStatus(id, status) {
  const entries = await loadFollowups();
  const entry = entries.find((x) => x && x.id === id);
  if (!entry) return;
  entry.status = status;
  entry.doneAt = status === FOLLOWUP_STATUS.DONE ? new Date().toISOString() : null;
  await saveFollowups(entries);
  if (window.EventLedger && entry.patientUuid && status === FOLLOWUP_STATUS.DONE) {
    window.EventLedger.record({
      source: 'followups',
      patientRef: entry.patientUuid,
      severity: null,
      ruleId: null,
      label: 'follow-up marked done',
      action: 'followup-done',
    });
  }
}

async function removeEntry(id) {
  const entries = await loadFollowups();
  await saveFollowups(entries.filter((x) => x && x.id !== id));
}

// ── Render ────────────────────────────────────────────────────────────────────

const BAND_META = {
  lapsed: { cls: 'fu-pill--red', text: null }, // text = due label ("3d overdue")
  due_today: { cls: 'fu-pill--amber', text: 'due today' },
  due_soon: { cls: 'fu-pill--soon', text: null },
  waiting: { cls: '', text: null },
};

function rowHtml(entry, nowMs) {
  const band = classifyFollowup(entry, nowMs);
  const dueLabel = formatDueLabel(entry.due, nowMs);
  if (band === 'done') {
    return `<div class="fu-row fu-row--done" data-id="${esc(entry.id)}">
      <span class="fu-tick" aria-hidden="true">&#10003;</span>
      <span class="fu-what">${esc(entry.what)}</span>
      ${entry.patientName ? `<span class="fu-patient">${esc(entry.patientName)}</span>` : ''}
      <button class="fu-btn fu-remove" data-act="remove" title="Remove from the done list">&#10005;</button>
    </div>`;
  }
  const meta = BAND_META[band] || BAND_META.waiting;
  const pillText = meta.text || dueLabel;
  return `<div class="fu-row" data-id="${esc(entry.id)}">
    <div class="fu-row-main">
      <span class="fu-pill ${meta.cls}">${esc(pillText)}</span>
      <span class="fu-what">${esc(entry.what)}</span>
    </div>
    <div class="fu-row-sub">
      ${
        entry.patientName
          ? `<span class="fu-patient" title="${entry.patientUuid ? 'Linked to the record this was added from' : ''}">${
              entry.patientUuid ? '&#9741; ' : ''
            }${esc(entry.patientName)}</span>`
          : '<span class="fu-patient fu-patient--none">unlinked note</span>'
      }
      ${pillText.toLowerCase() === dueLabel.toLowerCase() ? '' : `<span class="fu-due">${esc(dueLabel)}</span>`}
      <span class="fu-actions">
        <button class="fu-btn fu-done" data-act="done">Done</button>
        <button class="fu-btn fu-remove" data-act="remove" title="Delete this reminder">&#10005;</button>
      </span>
    </div>
  </div>`;
}

async function renderList() {
  const list = container?.querySelector('#fuList');
  const doneWrap = container?.querySelector('#fuDoneWrap');
  if (!list || !doneWrap) return;
  const nowMs = Date.now();
  const sorted = sortFollowups(await loadFollowups(), nowMs);
  const open = sorted.filter((e) => classifyFollowup(e, nowMs) !== 'done');
  const done = sorted.filter((e) => classifyFollowup(e, nowMs) === 'done').slice(0, 15);

  list.innerHTML = open.length
    ? open.map((e) => rowHtml(e, nowMs)).join('')
    : '<div class="fu-empty">Nothing waiting. Add what you’re chasing and it comes back when it’s due.</div>';

  doneWrap.innerHTML = done.length
    ? `<div class="fu-done-head">Done (kept ${DONE_RETENTION_DAYS} days)</div>` +
      done.map((e) => rowHtml(e, nowMs)).join('')
    : '';
}

function renderScaffold() {
  container.innerHTML = `
  <div class="fu-wrap">
    <div class="fu-header">
      <div class="mod-eyebrow">Personal safety-net</div>
      <div class="mod-title">Follow-ups</div>
    </div>
    <div class="fu-honest">
      A personal reminder list, stored on this machine only. It is not part of
      the clinical record and never replaces safety-netting documented in
      Medicus. Nothing here acts by itself &mdash; a lapsed reminder is a
      prompt, not a system.
    </div>
    <form class="fu-add" id="fuAddForm">
      <input type="text" id="fuWhat" class="fu-input" maxlength="200"
        placeholder="What are you waiting for? e.g. chase MSU result" aria-label="What are you waiting for" />
      <input type="date" id="fuDue" class="fu-date" aria-label="Due date" />
      <button type="submit" class="fu-btn fu-btn--primary">Add</button>
    </form>
    <div class="fu-add-hint">
      Added here as an unlinked note &mdash; to link a reminder to a patient,
      add it from the Monitoring tab with their record open.
    </div>
    <div class="fu-error hidden" id="fuError" role="alert"></div>
    <div class="fu-list" id="fuList" aria-live="polite"></div>
    <div class="fu-done-wrap" id="fuDoneWrap"></div>
  </div>`;

  const dueInput = container.querySelector('#fuDue');
  if (dueInput) dueInput.value = dateOnlyISO(Date.now() + 7 * 86400000);

  container.querySelector('#fuAddForm')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const what = container.querySelector('#fuWhat')?.value || '';
    const due = container.querySelector('#fuDue')?.value || '';
    const errEl = container.querySelector('#fuError');
    try {
      await addFollowup({ what, due, source: 'manual' });
      if (errEl) errEl.classList.add('hidden');
      const whatEl = container.querySelector('#fuWhat');
      if (whatEl) whatEl.value = '';
    } catch (e) {
      if (errEl) {
        errEl.textContent = e.message || 'Could not add the reminder.';
        errEl.classList.remove('hidden');
      }
    }
  });

  // One delegated handler for done/remove — rows re-render constantly.
  container.querySelector('#fuList')?.parentElement?.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('.fu-btn[data-act]');
    if (!btn) return;
    const id = btn.closest('.fu-row')?.dataset.id;
    if (!id) return;
    if (btn.dataset.act === 'done') await setStatus(id, FOLLOWUP_STATUS.DONE);
    else if (btn.dataset.act === 'remove') await removeEntry(id);
  });
}

function onStorageChange(changes) {
  if (!container) return;
  if (changes[FOLLOWUPS_STORE_KEY]) renderList();
}

export async function init(el) {
  container = el;
  renderScaffold();
  renderList();
  chrome.storage.onChanged.addListener(onStorageChange);

  // Re-band at local midnight boundaries without a reload: cheap minute poll.
  const timer = setInterval(() => renderList(), 60 * 1000);

  return function cleanup() {
    clearInterval(timer);
    chrome.storage.onChanged.removeListener(onStorageChange);
    container = null;
  };
}

// Re-exported for the Today line so the count logic stays in one place.
export { followupCounts };
