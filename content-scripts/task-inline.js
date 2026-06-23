// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Inline "Create task" widget for task / patient pages.
//
// The prescription-request overview (and other task overviews) has no "create
// task" control of its own. Rather than puppet Medicus's UI, this builds the
// action as NEW API WIRING — exactly like booking-inline.js — driving Medicus's
// own create-task endpoints with credentialed same-origin fetches:
//
//   GET  /patient/data/workflow/general-task/create?patientId=…
//        → { assigneeOptions:{teams[],staff[]}, priorityOptions[] }
//   POST /patient/workflow/general-task/create
//        { patientId, assigneeId, assigneeType, description, priority, snoozeUntil }
//
// This keeps Medicus the system of record (its validation/access/audit fire as
// normal). The API subdomain ({siteId}.api.<host>) allows CORS from the page
// origin, so this works from the content-script context (same as booking).
'use strict';

(function () {
  if (window.__msTkInline) return;
  window.__msTkInline = true;

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── URL detection ─────────────────────────────────────────────────────────────

  function getTaskInfo() {
    const m = location.pathname.match(
      /\/([0-9a-f]{4,})\/tasks\/data\/([^/]+)\/overview\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
    );
    if (!m) return null;
    return { siteId: m[1], typeSlug: m[2], taskUuid: m[3] };
  }

  // ── State ─────────────────────────────────────────────────────────────────────

  function blankState() {
    return {
      open: false,
      loading: false,
      error: null,
      patientId: null,
      teams: [],
      staff: [],
      priorities: [],
      assignee: '', // "type|value"
      priority: 0,
      description: '',
      step: 'form', // 'form' | 'created'
      creating: false,
      createError: null,
      createdAssignee: null,
    };
  }

  let s = blankState();

  // ── API ───────────────────────────────────────────────────────────────────────

  function apiBaseUrl() {
    const info = getTaskInfo();
    const parts = location.pathname.split('/').filter(Boolean);
    const siteId = (info && info.siteId) || parts[0] || '';
    return `https://${siteId}.api.${location.hostname}`;
  }

  async function apiFetch(path, opts) {
    opts = opts || {};
    const resp = await fetch(`${apiBaseUrl()}${path}`, {
      method: opts.method || 'GET',
      credentials: 'include',
      headers: Object.assign({ Accept: 'application/json, text/plain, */*' }, opts.headers),
      body: opts.body,
    });
    if (!resp.ok) throw new Error(`API ${resp.status}`);
    const text = await resp.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch (_) {
      throw new Error('Task API returned an unexpected response.');
    }
  }

  // Resolve task UUID → patient UUID via the API subdomain (same as booking).
  async function resolvePatientId(typeSlug, taskUuid) {
    const data = await apiFetch(`/tasks/data/${typeSlug}/overview/${taskUuid}`);
    return data?.data?.patient?.id || data?.data?.patientId || data?.patient?.id || data?.patientId || null;
  }

  async function apiFetchForm(patientId) {
    return apiFetch(`/patient/data/workflow/general-task/create?patientId=${encodeURIComponent(patientId)}`);
  }

  async function apiCreateTask(payload) {
    return apiFetch('/patient/workflow/general-task/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  // ── DOM injection ─────────────────────────────────────────────────────────────
  //
  // Anchor preference, in order:
  //   1. directly beneath the booking widget when it's present (keeps them paired);
  //   2. after the "Codes & actions" card (task types that have it);
  //   3. above the bottom "More actions" action row — prescribing overviews
  //      (Routine / Non-Routine Repeat Request, Medications for Re-authorisation)
  //      have NO "Codes & actions" card, so anchoring to it alone meant the widget
  //      never injected there. Every task overview has the action row, so this is
  //      the universal fallback.
  // Heading scan is kept cheap exactly as booking-inline does (narrow heading
  // carriers first, skip container nodes whose textContent would concatenate a
  // big subtree).

  const HEADING_RE = /^Codes\s*(?:&|&amp;|and)\s*actions$/i;

  function visible(el) {
    return !!(el && (el.offsetParent !== null || (el.getClientRects && el.getClientRects().length)));
  }

  function matchHeading(el) {
    if (el.closest('#ms-tk-widget')) return false;
    if (el.firstElementChild) return false;
    return HEADING_RE.test(el.textContent.trim());
  }

  function findHeading() {
    for (const el of document.querySelectorAll('h1,h2,h3,h4,h5,h6,strong,b,legend')) {
      if (matchHeading(el)) return el;
    }
    for (const el of document.querySelectorAll('div,span,p')) {
      if (matchHeading(el)) return el;
    }
    return null;
  }

  function findCard() {
    const heading = findHeading();
    if (!heading) return null;
    let node = heading.parentElement;
    let fallback = node;
    while (node && node !== document.body) {
      const btns = node.querySelectorAll('button, [role="button"], input[type="submit"]');
      for (const b of btns) {
        if (/^submit$/i.test((b.value || b.textContent || '').trim())) return node;
      }
      fallback = node;
      node = node.parentElement;
    }
    return fallback;
  }

  // The bottom-most visible "More actions" button's row, excluding any inside a
  // dialog/drawer. Returns the row element so we can insert the panel above it.
  function findActionRow() {
    const btns = document.querySelectorAll('button, [role="button"]');
    for (let i = btns.length - 1; i >= 0; i--) {
      const b = btns[i];
      if (!/more actions/i.test((b.textContent || '').trim())) continue;
      if (b.closest('[role="dialog"], [aria-modal="true"]')) continue;
      if (!visible(b)) continue;
      return b.parentElement;
    }
    return null;
  }

  function injectWidget() {
    if (!getTaskInfo()) return;
    if (document.getElementById('ms-tk-widget')) return;
    const w = document.createElement('div');
    w.id = 'ms-tk-widget';
    renderInto(w);
    // 1/2: after the booking widget or the "Codes & actions" card.
    const after = document.getElementById('ms-bk-widget') || findCard();
    if (after && after.parentElement) {
      withObserverPaused(() => after.after(w));
      return;
    }
    // 3: above the bottom action row (prescribing overviews have no card).
    const row = findActionRow();
    if (row && row.parentElement) {
      withObserverPaused(() => row.parentElement.insertBefore(w, row));
      return;
    }
    // Nothing to anchor to on this page — leave it for a later mutation tick.
  }

  // Tear the widget out when we leave a task overview (mirrors booking-inline's
  // fix — otherwise Vue keeps the node parented to a surviving card and it
  // strands on the wrong page).
  function removeWidget() {
    const w = document.getElementById('ms-tk-widget');
    if (!w) return;
    withObserverPaused(() => w.remove());
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  function renderInto(el) {
    el.innerHTML = buildHtml();
    bindEvents(el);
  }

  function rerender() {
    const w = document.getElementById('ms-tk-widget');
    if (w) renderInto(w);
  }

  function buildHtml() {
    let body = '';
    if (s.open) {
      if (s.loading) {
        body = `<div class="ms-tk-body"><div class="ms-tk-loading">Loading task form…</div></div>`;
      } else if (s.error) {
        body = `<div class="ms-tk-body"><div class="ms-tk-error">${esc(s.error)}</div></div>`;
      } else if (s.step === 'created') {
        body = renderCreated();
      } else {
        body = renderForm();
      }
    }
    return `
      <div class="ms-tk-header" id="ms-tk-toggle" role="button" tabindex="0" aria-expanded="${s.open}">
        <span class="ms-tk-chevron">${s.open ? '▾' : '▸'}</span>
        <span>Create task for this patient</span>
      </div>
      ${body}
    `;
  }

  function assigneeOptionsHtml() {
    function opts(list) {
      return list
        .map((o) => {
          const val = `${o.type}|${o.value}`;
          return `<option value="${esc(val)}"${s.assignee === val ? ' selected' : ''}>${esc(o.label)}</option>`;
        })
        .join('');
    }
    let html = '<option value="">— select —</option>';
    if (s.teams.length) html += `<optgroup label="Teams">${opts(s.teams)}</optgroup>`;
    if (s.staff.length) html += `<optgroup label="Staff">${opts(s.staff)}</optgroup>`;
    return html;
  }

  function priorityOptionsHtml() {
    return s.priorities
      .map(
        (p) =>
          `<option value="${esc(p.value)}"${String(s.priority) === String(p.value) ? ' selected' : ''}>${esc(p.label)}</option>`
      )
      .join('');
  }

  function renderForm() {
    const canCreate = s.description.trim() && s.assignee && !s.creating;
    return `
      <div class="ms-tk-body">
        ${!s.patientId ? '<div class="ms-tk-warn">Could not determine patient ID — try navigating away and back.</div>' : ''}
        <div class="ms-tk-row">
          <label class="ms-tk-label" for="ms-tk-assignee">Assign to</label>
          <select class="ms-tk-select" id="ms-tk-assignee">${assigneeOptionsHtml()}</select>
        </div>
        <div class="ms-tk-row">
          <label class="ms-tk-label" for="ms-tk-desc">Details</label>
          <textarea class="ms-tk-textarea" id="ms-tk-desc" rows="3" placeholder="What needs doing?" maxlength="2000">${esc(s.description)}</textarea>
        </div>
        ${
          s.priorities.length > 1
            ? `<div class="ms-tk-row">
                 <label class="ms-tk-label" for="ms-tk-priority">Priority</label>
                 <select class="ms-tk-select" id="ms-tk-priority">${priorityOptionsHtml()}</select>
               </div>`
            : ''
        }
        ${s.createError ? `<div class="ms-tk-error">${esc(s.createError)}</div>` : ''}
        <button class="ms-tk-btn" id="ms-tk-create"${canCreate ? '' : ' disabled'}>${s.creating ? 'Creating…' : 'Create task'}</button>
      </div>
    `;
  }

  function renderCreated() {
    return `
      <div class="ms-tk-body ms-tk-success">
        <div class="ms-tk-success-icon">✓</div>
        <div><strong>Task created</strong></div>
        ${s.createdAssignee ? `<div>Assigned to ${esc(s.createdAssignee)}</div>` : ''}
        <button class="ms-tk-btn-ghost" id="ms-tk-again">Create another</button>
      </div>
    `;
  }

  // ── Actions ───────────────────────────────────────────────────────────────────

  function assigneeLabel(encoded) {
    const all = s.teams.concat(s.staff);
    const hit = all.find((o) => `${o.type}|${o.value}` === encoded);
    return hit ? hit.label : '';
  }

  async function doOpen() {
    s.open = true;
    // Cached for this task — state is reset on SPA navigation (runInject), so if
    // the assignee/priority lists are already loaded nothing changed; just reveal
    // the form instead of re-resolving the patient and re-fetching the form data.
    if (s.patientId && (s.teams.length || s.staff.length)) {
      s.error = null;
      rerender();
      return;
    }
    s.loading = true;
    s.error = null;
    rerender();
    try {
      const info = getTaskInfo();
      if (info) s.patientId = await resolvePatientId(info.typeSlug, info.taskUuid);
      if (!s.patientId) throw new Error('Could not determine the patient for this task.');
      const form = await apiFetchForm(s.patientId);
      s.teams = (form.assigneeOptions && form.assigneeOptions.teams) || [];
      s.staff = (form.assigneeOptions && form.assigneeOptions.staff) || [];
      const pri = Array.isArray(form.priorityOptions)
        ? form.priorityOptions.map((o) => ({ value: o.value, label: o.label }))
        : [];
      s.priorities = pri.length ? pri : [{ value: 0, label: 'Normal' }];
      const def =
        s.priorities.find((p) => String(p.label).toLowerCase() === 'normal') ||
        s.priorities.find((p) => p.value === 0) ||
        s.priorities[0];
      s.priority = def ? def.value : 0;
    } catch (err) {
      s.error = err.message || 'Failed to load the task form.';
    } finally {
      s.loading = false;
      rerender();
    }
  }

  async function doCreate() {
    if (s.creating || !s.patientId || !s.assignee || !s.description.trim()) return;
    s.creating = true;
    s.createError = null;
    rerender();
    try {
      const sep = s.assignee.indexOf('|');
      const assigneeType = s.assignee.slice(0, sep);
      const assigneeId = s.assignee.slice(sep + 1);
      const payload = {
        patientId: s.patientId,
        contextId: null,
        contextType: null,
        assigneeId,
        assigneeType,
        description: s.description.trim(),
        priority: Number(s.priority) || 0,
        snoozeUntil: null,
      };
      await apiCreateTask(payload);
      s.createdAssignee = assigneeLabel(s.assignee);
      s.step = 'created';
    } catch (err) {
      s.createError = err.message || 'Failed to create the task — please try again.';
    } finally {
      s.creating = false;
      rerender();
    }
  }

  // ── Event binding ─────────────────────────────────────────────────────────────

  function bindEvents(el) {
    const toggle = el.querySelector('#ms-tk-toggle');
    if (toggle) {
      toggle.addEventListener('click', () => {
        if (s.open) {
          s.open = false;
          rerender();
        } else {
          doOpen();
        }
      });
      toggle.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle.click();
        }
      });
    }

    el.querySelector('#ms-tk-assignee')?.addEventListener('change', (e) => {
      s.assignee = e.target.value;
      rerender();
    });

    // Don't rerender on each keystroke (it would drop focus); just keep state and
    // toggle the Create button's enabled flag live. Capture the button once
    // rather than re-querying the document on every character.
    const createBtn = el.querySelector('#ms-tk-create');
    el.querySelector('#ms-tk-desc')?.addEventListener('input', (e) => {
      s.description = e.target.value;
      if (createBtn) createBtn.disabled = !(s.description.trim() && s.assignee && !s.creating);
    });

    el.querySelector('#ms-tk-priority')?.addEventListener('change', (e) => {
      s.priority = e.target.value;
    });

    el.querySelector('#ms-tk-create')?.addEventListener('click', () => doCreate());

    el.querySelector('#ms-tk-again')?.addEventListener('click', () => {
      const { patientId, teams, staff, priorities, priority } = s;
      s = blankState();
      s.open = true;
      s.patientId = patientId;
      s.teams = teams;
      s.staff = staff;
      s.priorities = priorities;
      s.priority = priority;
      rerender();
    });
  }

  // ── SPA navigation & re-injection ─────────────────────────────────────────────
  // Identical discipline to booking-inline.js (own-mutation filter, cheap path
  // gate, throttle + animation-frame deferral, remove-on-leave).

  let _lastPath = location.pathname;
  let _throttle = null;
  let _obs = null;

  function observeBody() {
    if (_obs) _obs.observe(document.body, { childList: true, subtree: true });
  }

  function withObserverPaused(fn) {
    if (!_obs) {
      fn();
      return;
    }
    _obs.disconnect();
    try {
      fn();
    } finally {
      observeBody();
    }
  }

  function _isOwnWidgetMutation(mutations) {
    for (const m of mutations) {
      if (m.target && m.target.nodeType === 1 && m.target.closest && m.target.closest('#ms-tk-widget')) {
        continue;
      }
      for (const nodes of [m.addedNodes, m.removedNodes]) {
        for (const n of nodes) {
          if (n.nodeType !== 1) continue;
          if (n.id === 'ms-tk-widget') continue;
          if (n.closest && n.closest('#ms-tk-widget')) continue;
          return false;
        }
      }
    }
    return true;
  }

  function onMutations(mutations) {
    if (_isOwnWidgetMutation(mutations)) return;
    scheduleInject();
  }

  function scheduleInject() {
    if (_throttle) return;
    const onTaskPage = !!getTaskInfo();
    const pathChanged = location.pathname !== _lastPath;
    if (!onTaskPage && !pathChanged) return;
    if (onTaskPage && !pathChanged) {
      const existing = document.getElementById('ms-tk-widget');
      if (existing && existing.isConnected) return;
    }
    _throttle = setTimeout(runInject, 350);
  }

  function runInject() {
    _throttle = null;
    const currentPath = location.pathname;
    if (currentPath !== _lastPath) {
      _lastPath = currentPath;
      s = blankState();
    }
    if (document.hidden) return;
    if (!getTaskInfo()) {
      removeWidget();
      return;
    }
    const existing = document.getElementById('ms-tk-widget');
    if (existing && existing.isConnected) return;
    requestAnimationFrame(() => {
      if (document.hidden) return;
      const w = document.getElementById('ms-tk-widget');
      if (w && w.isConnected) return;
      injectWidget();
    });
  }

  const _hub = window.__chObserverHub;
  if (_hub && _hub.subscribe) {
    _hub.subscribe(onMutations);
  } else {
    _obs = new MutationObserver(onMutations);
    observeBody();
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) scheduleInject();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleInject);
  } else {
    scheduleInject();
  }
})();
