// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — General-task create client (side-panel context).
//
// Drives Medicus's OWN create-task endpoints with credentialed same-origin
// fetches — the identical, proven pattern booking-api.js uses to create
// appointments from the side panel, and the same endpoints task-inline.js uses
// in the content-script context:
//
//   GET  /patient/data/workflow/general-task/create?patientId=…
//        → { assigneeOptions:{ teams[], staff[] }, priorityOptions[] }
//   POST /patient/workflow/general-task/create
//        { patientId, contextId, contextType, assigneeId, assigneeType,
//          description, priority, snoozeUntil }
//
// The side panel is an extension page with host_permissions for
// *.api.england.medicus.health, so it can call these directly with credentials
// (exactly like the slots/booking writes). Medicus stays the system of record —
// its validation, access control and audit fire as normal.
'use strict';

// Direct credentialed fetch against the API subdomain. Reads the body as text
// first so a stray HTML response yields a clear message, not a JSON-parse error.
// (Mirrors booking-api.js's apiFetch.)
async function apiFetch(url, opts) {
  opts = opts || {};
  const resp = await fetch(url, {
    method: opts.method || 'GET',
    credentials: 'include',
    headers: Object.assign({ Accept: 'application/json, text/plain, */*' }, opts.headers),
    body: opts.body,
  });
  if (!resp.ok) {
    if (resp.status === 401 || resp.status === 403) throw new Error('Not signed in to Medicus');
    throw new Error(`HTTP ${resp.status}`);
  }
  const text = await resp.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (_) {
    throw new Error('Task API returned an unexpected response.');
  }
}

// Fetch the create-task form for a patient → { teams[], staff[], priorities[] }
// where each assignee option is { type, value, label } and each priority is
// { value, label }. Normalised so callers never have to dig into the raw shape.
export async function fetchTaskCreateForm(apiBase, patientId) {
  if (!apiBase || !patientId) throw new Error('Missing practice or patient id');
  const form = await apiFetch(
    `${apiBase}/patient/data/workflow/general-task/create?patientId=${encodeURIComponent(patientId)}`
  );
  const teams = (form.assigneeOptions && form.assigneeOptions.teams) || [];
  const staff = (form.assigneeOptions && form.assigneeOptions.staff) || [];
  const priorities = Array.isArray(form.priorityOptions)
    ? form.priorityOptions.map((o) => ({ value: o.value, label: o.label }))
    : [];
  return { teams, staff, priorities: priorities.length ? priorities : [{ value: 0, label: 'Normal' }] };
}

// Create a general task. assignee is "type|value" (the encoding the form options
// use); description is the task body; priority is the numeric priority value.
// Returns the API response. Throws on any non-OK status (caller surfaces it).
export async function createGeneralTask(apiBase, { patientId, assignee, description, priority }) {
  if (!apiBase || !patientId) throw new Error('Missing practice or patient id');
  if (!assignee) throw new Error('Choose who to assign the task to');
  if (!description || !description.trim()) throw new Error('Task needs a description');
  const sep = assignee.indexOf('|');
  const assigneeType = sep >= 0 ? assignee.slice(0, sep) : '';
  const assigneeId = sep >= 0 ? assignee.slice(sep + 1) : assignee;
  return apiFetch(`${apiBase}/patient/workflow/general-task/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      patientId,
      contextId: null,
      contextType: null,
      assigneeId,
      assigneeType,
      description: description.trim(),
      priority: Number(priority) || 0,
      snoozeUntil: null,
    }),
  });
}
