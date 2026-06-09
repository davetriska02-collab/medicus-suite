// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
'use strict';

function todayISO() {
  // Local calendar date (NOT UTC) — toISOString() would roll to the next/previous
  // day in the early/late hours and query the wrong day's tasks.
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function initials(name) {
  const parts = (name || '').trim().split(/\s+/);
  const first = parts[0]?.[0] || '';
  const last = parts[parts.length - 1]?.[0] || '';
  return (first + last).toUpperCase() || '??';
}

async function fetchSlots(base, hiddenTypes = new Set()) {
  const today = todayISO();
  const now = new Date();
  const url = `${base}/scheduling/data/appointment-book/embedded-overview?date=${today}&filterByUsualLocation=false`;
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) throw new Error(`Slots HTTP ${r.status}`);
  const raw = await r.json();

  const entries = [];
  const byStaff = {};
  let amRemaining = 0;
  let pmRemaining = 0;

  (raw.staffSchedules || []).forEach(staff => {
    const staffName = staff.name || 'Unknown';
    (staff.schedule || []).forEach(session => {
      (session.entries || []).forEach(entry => {
        if (entry.diaryEntryType?.value !== 'slot') return;
        if (entry.startDateTime && new Date(entry.startDateTime) <= now) return;
        // Mirror the Slots tab: exclude appointment types the user has unticked
        // (triage / holding / etc. via slots.hiddenTypes) so the count reflects
        // the bookable slots they actually care about.
        const type = entry.appointmentType?.name || 'Unknown';
        if (hiddenTypes.has(type)) return;
        const hour = entry.startDateTime ? new Date(entry.startDateTime).getHours() : 0;
        const isAm = hour < 12;
        entries.push({
          staff: staffName,
          type,
          startDateTime: entry.startDateTime || '',
        });
        if (!byStaff[staffName]) byStaff[staffName] = { amRemaining: 0, pmRemaining: 0 };
        if (isAm) { byStaff[staffName].amRemaining++; amRemaining++; }
        else      { byStaff[staffName].pmRemaining++; pmRemaining++; }
      });
    });
  });

  return { entries, amRemaining, pmRemaining, totalRemaining: amRemaining + pmRemaining, byStaff };
}

async function fetchWaitingRoom(base) {
  const url = `${base}/scheduling/data/homepage/my-appointments`;
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) throw new Error(`WaitingRoom HTTP ${r.status}`);
  const raw = await r.json();

  const list = Array.isArray(raw) ? raw : (raw.schedule?.schedule?.flatMap(d => d.entries || []) || []);
  const appointments = list
    .filter(e => e.diaryEntryType?.value === 'appointment')
    .map(e => ({
      patientName:  e.patient?.name || 'Unknown',
      start:        e.startDateTime || '',
      reason:       e.compiledReasonForAppointment || '',
      deliveryMode: e.deliveryMode?.value || e.deliveryMode || '',
      isArrived:    e.displayStatus?.value === 'arrived',
    }));
  const arrivedCount = appointments.filter(a => a.isArrived).length;
  return { appointments, arrivedCount };
}

async function fetchSubmissions(base) {
  const today = todayISO();
  const TASK_TYPES = [
    { key: 'medical',       apiType: 'medical_patient_request_task' },
    { key: 'admin',         apiType: 'admin_patient_request_task' },
    { key: 'investigation', apiType: 'review_investigation_results_task' },
    { key: 'rxRoutine',     apiType: 'prescription_request_task_routine' },
    { key: 'rxNonRoutine',  apiType: 'prescription_request_task_non_routine' },
  ];

  const results = await Promise.allSettled(TASK_TYPES.map(async tt => {
    // The task-list endpoint filters by `createdAt_startDate` / `createdAt_endDate`.
    // Using plain `startDate` / `endDate` is silently ignored and returns the entire
    // open-task backlog — which is what inflated demand/velocity/PPI to tens of thousands.
    const url = `${base}/tasks/data/${tt.apiType}/task-list?createdAt_startDate=${today}&createdAt_endDate=${today}`;
    const r = await fetch(url, { credentials: 'include' });
    if (!r.ok) throw new Error(`${tt.key} HTTP ${r.status}`);
    const d = await r.json();
    return { key: tt.key, tasks: d.tasks || [] };
  }));

  const byHour = Array.from({ length: 24 }, (_, i) => ({
    hour: i, medical: 0, admin: 0, rxRoutine: 0, rxNonRoutine: 0, investigation: 0,
  }));
  const totals = { medical: 0, admin: 0, rxRoutine: 0, rxNonRoutine: 0, investigation: 0, all: 0 };
  const tasks = [];

  results.forEach(res => {
    if (res.status !== 'fulfilled') return;
    const { key, tasks: ts } = res.value;
    ts.forEach(t => {
      const hourOfDay = new Date(t.createdAt).getHours();
      tasks.push({ id: t.id, type: key, createdAt: t.createdAt, hourOfDay });
      if (byHour[hourOfDay]) byHour[hourOfDay][key] = (byHour[hourOfDay][key] || 0) + 1;
      totals[key] = (totals[key] || 0) + 1;
      totals.all++;
    });
  });

  return { tasks, totals, byHour };
}

async function fetchRequestMonitor(base, config) {
  const { assigneeId } = config;
  const url = `${base}/admin/data/request-monitor/${assigneeId}?pageSize=999`;
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) throw new Error(`RequestMonitor HTTP ${r.status}`);
  const d = await r.json();

  const now = Date.now();
  const items = (d.tasks || []).map(t => {
    const ageMs = now - new Date(t.createdAt).getTime();
    return {
      id:        t.id,
      patient:   initials(t.patientName),
      summary:   t.summary || t.summaryLabel || '',
      priority:  t.priority || '',
      createdAt: t.createdAt,
      ageMs,
    };
  });

  const urgentCount = items.filter(i => /urgent/i.test(i.priority)).length;
  const byAgeBucket = { lt1h: 0, h1to4: 0, h4to8: 0, gt8h: 0 };
  items.forEach(i => {
    if      (i.ageMs < 3600000)   byAgeBucket.lt1h++;
    else if (i.ageMs < 14400000)  byAgeBucket.h1to4++;
    else if (i.ageMs < 28800000)  byAgeBucket.h4to8++;
    else                          byAgeBucket.gt8h++;
  });

  return { items, urgentCount, totalCount: items.length, byAgeBucket };
}

async function fetchActivity(base) {
  const today = todayISO();
  const url = `${base}/reporting/data/activity/report?startDate=${today}&endDate=${today}`;
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) throw new Error(`Activity HTTP ${r.status}`);
  const d = await r.json();

  const totals = { consultations: 0, routineRx: 0, nonRoutineRx: 0, reviews: 0, documents: 0, results: 0, all: 0 };
  const rows = (d.rowData || []).map(row => {
    const consultations = row.consultations || 0;
    const routineRx     = row.routinePrescriptionRequestTasks || 0;
    const nonRoutineRx  = row.nonRoutinePrescriptionRequestTasks || 0;
    const reviews       = row.medicationReviews || 0;
    const documents     = row.documentTasks || 0;
    const results       = row.investigationReportTasks || 0;
    const total         = consultations + routineRx + nonRoutineRx + reviews + documents + results;
    totals.consultations += consultations;
    totals.routineRx     += routineRx;
    totals.nonRoutineRx  += nonRoutineRx;
    totals.reviews       += reviews;
    totals.documents     += documents;
    totals.results       += results;
    totals.all           += total;
    return { name: row.name || 'Unknown', consultations, routineRx, nonRoutineRx, reviews, documents, results, total };
  });

  return { rows, totals };
}

function computeCapacityPreset(storage, slotsData) {
  const presets  = storage['capacity.presets'];
  const activeId = storage['capacity.activePresetId'];
  if (!presets || !activeId) return null;

  const preset = (Array.isArray(presets) ? presets : Object.values(presets)).find(p => p.id === activeId);
  if (!preset?.minimumByDay) return null;

  const dayKey    = ['sun','mon','tue','wed','thu','fri','sat'][new Date().getDay()];
  const minimum   = preset.minimumByDay[dayKey] ?? 0;
  const remaining = slotsData?.totalRemaining ?? 0;

  let status;
  if (remaining === 0)                  status = 'closed';
  else if (minimum === 0)               status = 'sufficient';
  else if (remaining / minimum < 0.5)  status = 'low';
  else if (remaining / minimum < 0.75) status = 'tight';
  else                                  status = 'sufficient';

  return { minimum, status };
}

export async function fetchAllStreams() {
  const storageKeys = [
    'suite.practiceCode',
    'capacity.presets',
    'capacity.activePresetId',
    'suite.requestMonitor.config',
    'slots.hiddenTypes',
  ];

  const storage = await chrome.storage.local.get(storageKeys);
  const siteId  = storage['suite.practiceCode'] || null;
  const hiddenTypes = new Set(storage['slots.hiddenTypes'] || []);
  const fetchErrors = [];

  if (!siteId) {
    return {
      siteId: null,
      slots: null,
      waitingRoom: null,
      submissions: null,
      requestMonitor: null,
      activity: null,
      capacityPreset: null,
      fetchErrors: ['No practice code configured'],
    };
  }

  const base = `https://${siteId}.api.england.medicus.health`;
  const rmConfig  = storage['suite.requestMonitor.config'];
  const rmEnabled = rmConfig?.enabled && rmConfig?.assigneeId;

  const [slotsRes, wrRes, subRes, rmRes, actRes] = await Promise.allSettled([
    fetchSlots(base, hiddenTypes),
    fetchWaitingRoom(base),
    fetchSubmissions(base),
    rmEnabled ? fetchRequestMonitor(base, rmConfig) : Promise.resolve(null),
    fetchActivity(base),
  ]);

  const slots = slotsRes.status === 'fulfilled' ? slotsRes.value : null;
  if (slotsRes.status === 'rejected') fetchErrors.push(`slots: ${slotsRes.reason?.message || slotsRes.reason}`);

  const waitingRoom = wrRes.status === 'fulfilled' ? wrRes.value : null;
  if (wrRes.status === 'rejected') fetchErrors.push(`waitingRoom: ${wrRes.reason?.message || wrRes.reason}`);

  const submissions = subRes.status === 'fulfilled' ? subRes.value : null;
  if (subRes.status === 'rejected') fetchErrors.push(`submissions: ${subRes.reason?.message || subRes.reason}`);

  let requestMonitor = null;
  if (rmEnabled) {
    if (rmRes.status === 'fulfilled') {
      requestMonitor = rmRes.value;
    } else {
      fetchErrors.push(`requestMonitor: ${rmRes.reason?.message || rmRes.reason}`);
    }
  }

  const activity = actRes.status === 'fulfilled' ? actRes.value : null;
  if (actRes.status === 'rejected') fetchErrors.push(`activity: ${actRes.reason?.message || actRes.reason}`);

  const capacityPreset = computeCapacityPreset(storage, slots);

  return {
    siteId,
    slots,
    waitingRoom,
    submissions,
    requestMonitor,
    activity,
    capacityPreset,
    fetchErrors,
  };
}
