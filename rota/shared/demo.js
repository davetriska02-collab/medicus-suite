// Demo dataset: a realistic 10,000-patient training practice. Lets the app
// be explored end-to-end (and screenshots taken) without a Medicus session.

import { newStaff, blankPattern, DEFAULT_SETTINGS } from './model.js';
import { uid } from './store.js';
import { todayISO, mondayOf, addDays } from './time.js';

function pat(weeks, cells) {
  // cells: { mon: ['surgery','admin'], ... } applied to every week
  const p = blankPattern(weeks);
  for (const week of p) {
    for (const [day, [am, pm]] of Object.entries(cells)) {
      week[day] = { am: am || null, pm: pm || null };
    }
  }
  return p;
}

export function demoData() {
  const mk = (seed) => newStaff({ ...seed, id: uid() });

  const staff = [
    mk({
      name: 'Dr Sarah Crane',
      role: 'gp',
      employmentType: 'partner',
      contractedSessions: 8,
      supervisor: true,
      entitlement: { annual: 36, study: 6 },
      colour: '#2563eb',
      medicusName: 'Dr Sarah Crane',
      pattern: pat(1, {
        mon: ['surgery', 'surgery'],
        tue: ['surgery', 'admin'],
        wed: ['surgery', 'surgery'],
        thu: ['surgery', 'surgery'],
        fri: [null, null],
      }),
    }),
    mk({
      name: 'Dr James Okafor',
      role: 'gp',
      employmentType: 'partner',
      contractedSessions: 8,
      supervisor: true,
      entitlement: { annual: 36, study: 6 },
      colour: '#0d9488',
      medicusName: 'Dr James Okafor',
      pattern: pat(1, {
        mon: ['surgery', 'surgery'],
        tue: [null, null],
        wed: ['surgery', 'surgery'],
        thu: ['surgery', 'admin'],
        fri: ['surgery', 'surgery'],
      }),
    }),
    mk({
      name: 'Dr Priya Nair',
      role: 'gp',
      employmentType: 'salaried',
      contractedSessions: 6,
      supervisor: true,
      entitlement: { annual: 27, study: 4 },
      colour: '#d97706',
      medicusName: 'Dr Priya Nair',
      pattern: pat(1, {
        mon: ['triage', 'surgery'],
        tue: ['surgery', 'surgery'],
        thu: ['surgery', 'surgery'],
        fri: [null, null],
      }),
    }),
    mk({
      name: 'Dr Tom Whitfield',
      role: 'gp',
      employmentType: 'salaried',
      contractedSessions: 4,
      entitlement: { annual: 18, study: 3 },
      colour: '#7c3aed',
      medicusName: 'Dr Tom Whitfield',
      pattern: pat(1, { tue: ['surgery', 'surgery'], fri: ['surgery', 'surgery'] }),
    }),
    mk({
      name: 'Dr Lena Kowalski',
      role: 'gp',
      employmentType: 'registrar',
      registrarStage: 'ST3',
      contractedSessions: 7,
      dutyEligible: false,
      entitlement: { annual: 27, study: 30 },
      colour: '#db2777',
      medicusName: 'Dr Lena Kowalski',
      pattern: pat(1, {
        mon: ['surgery', 'tutorial'],
        tue: ['surgery', 'surgery'],
        wed: ['surgery', 'cpd'],
        fri: ['surgery', null],
      }),
    }),
    mk({
      name: 'Hannah Reid',
      role: 'anp',
      employmentType: 'employed',
      contractedSessions: 8,
      dutyEligible: false,
      prescriber: true,
      entitlement: { annual: 30, study: 5 },
      colour: '#059669',
      medicusName: 'Hannah Reid ANP',
      pattern: pat(1, {
        mon: ['triage', 'surgery'],
        tue: ['surgery', 'surgery'],
        wed: ['surgery', 'surgery'],
        thu: ['surgery', 'surgery'],
      }),
    }),
    mk({
      name: 'Megan Doyle',
      role: 'nurse',
      employmentType: 'employed',
      contractedSessions: 10,
      dutyEligible: false,
      prescriber: false,
      entitlement: { annual: 30, study: 4 },
      colour: '#dc2626',
      medicusName: 'Megan Doyle',
      pattern: pat(1, {
        mon: ['surgery', 'surgery'],
        tue: ['surgery', 'surgery'],
        wed: ['surgery', 'surgery'],
        thu: ['surgery', 'surgery'],
        fri: ['surgery', 'surgery'],
      }),
    }),
    mk({
      name: 'Becca Lindqvist',
      role: 'hca',
      employmentType: 'employed',
      contractedSessions: 6,
      dutyEligible: false,
      prescriber: false,
      entitlement: { annual: 28, study: 2 },
      colour: '#4f46e5',
      medicusName: 'Becca Lindqvist',
      pattern: pat(1, { mon: ['surgery', null], wed: ['surgery', 'surgery'], fri: ['surgery', 'surgery'] }),
    }),
    mk({
      name: 'Omar Hassan',
      role: 'pharmacist',
      employmentType: 'arrs',
      contractedSessions: 4,
      dutyEligible: false,
      entitlement: { annual: 22, study: 3 },
      colour: '#b45309',
      medicusName: 'Omar Hassan',
      pattern: pat(1, { tue: ['surgery', 'admin'], thu: ['surgery', 'admin'] }),
    }),
    mk({
      name: 'Dr Felix Adeyemi',
      role: 'gp',
      employmentType: 'locum',
      contractedSessions: 0,
      dutyEligible: true,
      supervisor: false,
      entitlement: { annual: 0, study: 0 },
      colour: '#0891b2',
      medicusName: 'Dr Felix Adeyemi',
      pattern: blankPattern(1),
    }),
  ];

  const monday = mondayOf(todayISO());
  const leave = [
    {
      id: uid(),
      staffId: staff[3].id,
      type: 'annual',
      startDate: addDays(monday, 7),
      endDate: addDays(monday, 11),
      status: 'requested',
      sessions: 4,
      note: 'Half-term',
      createdAt: new Date().toISOString(),
    },
    // Sickness history for Megan (nurse): shows Bradford scoring, an
    // outstanding return-to-work conversation and the fit-note editor.
    {
      id: uid(),
      staffId: staff[6].id,
      type: 'sick',
      startDate: addDays(monday, -12),
      endDate: addDays(monday, -11),
      status: 'approved',
      sessions: 4,
      rtwDone: false,
      createdAt: new Date().toISOString(),
    },
    {
      id: uid(),
      staffId: staff[6].id,
      type: 'sick',
      startDate: addDays(monday, -40),
      endDate: addDays(monday, -38),
      status: 'approved',
      sessions: 6,
      rtwDone: true,
      createdAt: new Date().toISOString(),
    },
    {
      id: uid(),
      staffId: staff[6].id,
      type: 'sick',
      startDate: addDays(monday, -75),
      endDate: addDays(monday, -75),
      status: 'approved',
      sessions: 2,
      rtwDone: true,
      createdAt: new Date().toISOString(),
    },
  ];

  const rooms = ['Room 1', 'Room 2', 'Room 3', 'Treatment 1'].map((name) => ({ id: uid(), name }));

  const settings = {
    ...DEFAULT_SETTINGS,
    listSize: 10400,
    extraPeriods: { early: false, eve: true }, // show the EVE column off the bat
    templateAnchorMonday: monday,
  };

  return { staff, entries: [], leave, rooms, settings };
}

// A sample Medicus embedded-overview payload (synthetic) so the
// reconciliation screen can be demonstrated without a live session.
export function demoOverviewPayload(staff, dateISO) {
  const mkEntry = (h, kind, status) => ({
    diaryEntryType: { value: kind },
    startDateTime: `${dateISO}T${String(h).padStart(2, '0')}:00:00`,
    displayStatus: { value: status || 'booked' },
    appointmentType: { name: 'GP consultation' },
  });
  const session = (hours, bookedCount) => ({
    summary: { status: { isCancelled: false } },
    entries: hours.map((h, i) => mkEntry(h, i < bookedCount ? 'appointment' : 'slot')),
  });
  // Deliberate mismatches: first GP has no PM clinic; an unknown clinician appears.
  const name = (i, fallback) => (staff[i] && (staff[i].medicusName || staff[i].name)) || fallback;
  return {
    staffSchedules: [
      { name: name(0, 'Dr Demo One'), schedule: [session([9, 10, 11], 2)] },
      { name: name(1, 'Dr Demo Two'), schedule: [session([9, 10, 11], 3), session([14, 15, 16], 1)] },
      { name: name(5, 'Demo ANP'), schedule: [session([9, 10], 2), session([14, 15], 2)] },
      { name: 'Dr Aisha Begum', schedule: [session([14, 15, 16], 2)] },
    ],
  };
}
