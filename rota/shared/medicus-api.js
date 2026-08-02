// Medicus REST client. Read-only; rides the user's logged-in Medicus session
// (credentials: 'include'), the same proven pattern as the Medicus Suite.
// Practice code: 4–8 hex chars forming the API subdomain.

import { localISO } from './time.js';

export function isValidPracticeCode(code) {
  return /^[0-9a-f]{4,8}$/i.test(String(code || '').trim());
}

export function apiBase(practiceCode) {
  return `https://${String(practiceCode).trim().toLowerCase()}.api.england.medicus.health`;
}

// Appointment book for one date: per-clinician sessions with slot/appointment
// entries. The source of truth for who is actually consulting.
export async function fetchOverview(practiceCode, dateISO) {
  const url =
    `${apiBase(practiceCode)}/scheduling/data/appointment-book/embedded-overview` +
    `?date=${encodeURIComponent(dateISO)}&filterByUsualLocation=false`;
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`Medicus HTTP ${res.status} for ${dateISO}`);
  return res.json();
}

// Fetch several dates concurrently; one failed day must not sink the rest.
export async function fetchOverviewRange(practiceCode, dates) {
  const results = await Promise.allSettled(dates.map((d) => fetchOverview(practiceCode, d)));
  const byDate = {};
  const errors = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') byDate[dates[i]] = r.value;
    else errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
  });
  return { byDate, errors };
}

// Inbound demand: task arrivals per day across the five patient-request
// task types. Payloads contain patient names — we count and discard,
// never persist (PHI minimisation).
const TASK_TYPES = [
  'medical_patient_request_task',
  'admin_patient_request_task',
  'review_investigation_results_task',
  'prescription_request_task_routine',
  'prescription_request_task_non_routine',
];

export async function fetchTaskCounts(practiceCode, startISO, endISO) {
  const results = await Promise.allSettled(
    TASK_TYPES.map(async (type) => {
      const url =
        `${apiBase(practiceCode)}/tasks/data/${type}/task-list` +
        `?createdAt_startDate=${encodeURIComponent(startISO)}&createdAt_endDate=${encodeURIComponent(endISO)}`;
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error(`Medicus HTTP ${res.status} for ${type}`);
      return res.json();
    })
  );
  const byDate = {};
  const errors = [];
  for (const r of results) {
    if (r.status !== 'fulfilled') {
      errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
      continue;
    }
    for (const task of (r.value && r.value.tasks) || []) {
      if (!task.createdAt) continue;
      const d = new Date(task.createdAt);
      if (Number.isNaN(d.getTime())) continue;
      const date = localISO(d);
      byDate[date] = (byDate[date] || 0) + 1;
    }
  }
  return { byDate, errors };
}
