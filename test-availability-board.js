// Medicus Suite — availability wall
// Run with: node test-availability-board.js
'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

let passed = 0;
let failed = 0;
function check(cond, msg) {
  if (cond) {
    passed++;
    console.log(`  OK  ${msg}`);
  } else {
    failed++;
    console.error(`  FAIL  ${msg}`);
  }
}

function at(isoDay, hh, mm) {
  const [y, m, d] = isoDay.split('-').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
}

function entry(kind, start, type, extra) {
  return Object.assign(
    {
      diaryEntryType: { value: kind, isSlot: kind === 'slot' },
      startDateTime: start,
      appointmentType: type ? { name: type } : undefined,
    },
    extra || {}
  );
}

function session(service, entries, extra) {
  return Object.assign(
    {
      scheduleType: 'diary',
      summary: {
        status: { isCancelled: false },
        service: { name: service },
        defaultAppointmentType: extra && extra.defaultType ? { name: extra.defaultType } : undefined,
      },
      entries,
    },
    extra || {}
  );
}

(async () => {
  const core = await import(pathToFileURL(path.join(__dirname, 'shared/availability-board-core.js')).href);
  const Packs = require('./shared/practice-packs.js');

  console.log('\n--- parsing ---');
  const today = '2026-09-26';
  const now = new Date(2026, 8, 26, 13, 0, 0, 0);
  const raw = {
    staffSchedules: [
      {
        name: 'Duty Doctor',
        schedule: [session('Duty', [entry('slot', '2026-09-26 15:00:00', 'GP Appointment')])],
      },
      {
        name: 'Dr Amy Offer',
        schedule: [
          session('On the day GP', [
            entry('appointment', '2026-09-26 09:00:00', 'GP Appointment', {
              patient: { name: 'Patient Alpha', nhsNumber: '9434765919' },
              compiledReasonForAppointment: 'chest pain',
            }),
            entry('slot', '2026-09-26 12:00:00', 'GP Appointment'),
            entry('slot', '2026-09-26 14:10:00', 'GP Appointment'),
            entry('slot', '2026-09-26 14:40:00', 'On the day'),
          ]),
          session('General Appointments', [entry('slot', '2026-09-26T15:00:00', 'GP Appointment')], {
            scheduleType: 'unavailability-period',
          }),
        ],
      },
      {
        name: 'A Nurse Practitioner Clinic',
        schedule: [session('General Appointments', [entry('slot', '2026-09-26 14:20:00', 'GP Appointment')])],
      },
      {
        name: 'Nurse Room',
        schedule: [session('Nursing', [entry('slot', '2026-09-26 16:00:00', 'Nurse')])],
      },
      {
        name: 'Home Visits',
        schedule: [
          session('Visits', [
            entry('slot', '2026-09-26 11:00:00', 'Visit'),
            entry('slot', '2026-09-26 15:30:00', 'Home visit'),
          ]),
        ],
      },
      {
        name: '3-day embargo GP',
        schedule: [session('Embargo', [entry('slot', '2026-09-26 18:00:00', 'GP Appointment')])],
      },
    ],
    unassignedDiaries: [
      session('Extended access', [entry('slot', '2026-09-26 19:00:00', 'Extended access')], {
        summary: undefined,
      }),
    ],
  };
  // The unassigned session above replaced summary with undefined via Object.assign.
  // Rebuild it explicitly so the service name survives.
  raw.unassignedDiaries = [
    {
      scheduleType: 'diary',
      summary: { status: { isCancelled: false }, service: { name: 'Extended access' } },
      entries: [entry('slot', '2026-09-26 19:00:00', 'Extended access')],
    },
    {
      scheduleType: 'diary',
      summary: { status: { isCancelled: true }, service: { name: 'Routine GP' } },
      entries: [entry('slot', '2026-09-26 17:00:00', 'Routine')],
    },
  ];

  const roleMap = core.roleIndex([
    { name: 'Amy Offer', medicusName: 'Dr Amy Offer', role: 'gp', employmentType: 'registrar' },
  ]);
  const extracted = core.extractFreeSlots(raw, { now, dateISO: today, roleIndex: roleMap });
  const dumped = JSON.stringify(extracted);
  check(!dumped.includes('Patient Alpha'), 'patient name is not kept');
  check(!dumped.includes('9434765919'), 'NHS number is not kept');
  check(!dumped.includes('chest pain'), 'appointment reason is not kept');
  check(
    extracted.slots.every(
      (s) => Object.keys(s).sort().join(',') === 'clinician,roleHints,sessionHaystack,sessionName,slotType,startMs'
    ),
    'slot records are times, types, sessions and roles only'
  );
  check(
    extracted.slots.some((s) => s.startMs === at(today, 12, 0)) === false,
    'a slot that already started is dropped today'
  );
  check(
    extracted.slots.some((s) => s.clinician === 'Dr Amy Offer' && s.startMs === at(today, 14, 10)),
    'later on-the-day slot is kept'
  );
  check(
    !extracted.slots.some((s) => s.startMs === at(today, 15, 0) && s.clinician === 'Dr Amy Offer'),
    'unavailability block is skipped'
  );
  check(
    !extracted.slots.some((s) => s.slotType === 'Routine' && s.startMs === at(today, 17, 0)),
    'cancelled session is skipped'
  );
  check(extracted.observed.slotTypes.includes('Nurse'), 'observed slot types are names only');

  const tomorrow = core.extractFreeSlots(
    {
      staffSchedules: [
        {
          name: 'Dr Amy Offer',
          schedule: [session('Routine', [entry('slot', '2026-09-27 09:00:00', 'Routine GP')])],
        },
      ],
    },
    { now, dateISO: '2026-09-27', roleIndex: roleMap }
  );
  check(tomorrow.slots.length === 1, 'a future morning slot is kept on a later day');

  console.log('\n--- mapping, next slot, counts, colour ---');
  const cfg = core.normaliseConfig(null);
  check(
    cfg.tiles.some((t) => t.label === 'On-the-day GP' && t.showOnToday),
    'default today tiles include on-the-day GP'
  );
  check(
    cfg.tiles.some((t) => t.label === 'Nursing / HCA'),
    'default includes nursing / HCA'
  );
  check(
    cfg.tiles.some((t) => t.label === 'Visits'),
    'default includes visits'
  );
  check(
    cfg.tiles.some((t) => t.label === 'Registrar / additional GP'),
    'default includes registrar'
  );
  check(
    cfg.tiles.some((t) => t.label === 'ANP'),
    'default includes ANP'
  );
  check(
    cfg.tiles.some((t) => t.label === 'Pre-bookable routine GP' && t.weekLane === 'routine'),
    'routine GP feeds the 7-day view'
  );
  check(
    cfg.tiles.some((t) => t.label === '3-day embargo GP'),
    'default includes embargo'
  );
  check(
    cfg.tiles.some((t) => t.id === 'extended' && t.weekLane === 'extended' && t.showOnToday === false),
    'extended access is in the week view and off the today grid unless the practice shows it'
  );

  const views = core.todayViews(extracted.slots, cfg, now, false);
  const byLabel = Object.fromEntries(views.tiles.map((t) => [t.label, t]));
  check(
    byLabel['On-the-day GP'].remaining === 1 && byLabel['On-the-day GP'].nextLabel === '15:00',
    'duty session maps to on-the-day GP'
  );
  check(
    byLabel['Registrar / additional GP'].remaining === 2,
    'registrar role from the rota maps both of that diary’s free slots'
  );
  check(byLabel['Registrar / additional GP'].nextLabel === '14:10', 'registrar next time is 14:10');
  check(byLabel.ANP.remaining === 1, 'nurse practitioner diary maps to ANP');
  check(byLabel['Nursing / HCA'].remaining === 1, 'nurse type maps to nursing');
  check(byLabel.Visits.remaining === 1, 'past visit dropped, later visit remains');
  check(byLabel['3-day embargo GP'].remaining === 1, 'embargo diary maps to the embargo tile');
  check(
    byLabel['Pre-bookable routine GP'].remaining === 0,
    'routine today is empty when those slots were mapped elsewhere'
  );
  check(!views.tiles.some((t) => t.id === 'extended'), 'extended access is not a today tile by default');

  const redNow = new Date(at(today, 14, 18));
  const redViews = core.todayViews(extracted.slots, cfg, redNow, false);
  const reg = redViews.tiles.find((t) => t.id === 'registrar');
  check(
    reg.tone === 'red' && reg.countdown === '22 min' && reg.flash === true && reg.icon === false,
    'under 30 min is red, flashing, countdown 22 min'
  );
  const steady = core.attention('red', true);
  check(
    steady.flash === false && steady.icon === true && steady.tone === 'red',
    'reduced motion is steady red plus an icon'
  );
  const face = core.tileFace({ ...reg, flash: false, icon: true, tone: 'red' });
  check(
    face.primary === '22 min' && face.detail === 'Next 14:40' && face.secondary === `${reg.remaining} left`,
    'red face shows countdown and the clock time'
  );
  check(!JSON.stringify(face).includes('Amy'), 'the tile face has no clinician name');

  check(core.urgencyForMinutes(61) === 'green', 'over 60 min is green');
  check(core.urgencyForMinutes(60) === 'amber', '60 min is amber');
  check(core.urgencyForMinutes(30) === 'amber', '30 min is amber');
  check(core.urgencyForMinutes(29) === 'red', 'under 30 min is red');

  const hidden = core.normaliseConfig({
    tiles: cfg.tiles.map((t) => (t.id === 'anp' ? { ...t, hidden: true } : t)),
  });
  const hiddenViews = core.todayViews(extracted.slots, hidden, now, false);
  check(!hiddenViews.tiles.some((t) => t.id === 'anp'), 'a hidden tile is not shown');
  check(hiddenViews.unmapped === views.unmapped, 'hiding a tile does not pour its slots into another tile');

  console.log('\n--- 7-day aggregation ---');
  const dates = core.weekDates(today);
  check(dates.length === 7 && dates[0] === today && dates[6] === '2026-10-02', 'seven calendar days from today');
  check(
    core.isWeekendISO('2026-09-26') === true && core.isWeekendISO('2026-09-28') === false,
    'Saturday is a weekend, Monday is not'
  );
  const daySlots = (date, list) => ({ date, slots: list });
  const routineSlot = (date, hh) => ({
    startMs: at(date, hh, 0),
    slotType: 'Routine GP',
    sessionName: 'Routine',
    sessionHaystack: 'Routine',
    clinician: 'Dr Day',
    roleHints: [],
  });
  const extSlot = (date) => ({
    startMs: at(date, 18, 30),
    slotType: 'Extended access',
    sessionName: 'Extended access',
    sessionHaystack: 'Extended access',
    clinician: 'Hub',
    roleHints: [],
  });
  const rows = dates.map((date, i) => {
    if (i === 6) return { date, slots: null };
    if (core.isWeekendISO(date)) return daySlots(date, [extSlot(date)]);
    return daySlots(date, [routineSlot(date, 9), routineSlot(date, 11)]);
  });
  const week = core.weekView(rows, cfg);
  const sat = week.days.find((d) => d.date === '2026-09-26');
  const mon = week.days.find((d) => d.date === '2026-09-28');
  check(
    sat.weekend === true && sat.routine === 0 && sat.extended === 1,
    'Saturday routine stays 0 and extended access is counted apart'
  );
  check(mon.routine === 2 && mon.extended === 0, 'a weekday routine day counts its free GP slots');
  check(week.totalRoutine === 8, 'the total is routine slots only');
  check(week.totalExtended === 2, 'extended access has its own total');
  check(week.incomplete === true && week.days[6].routine === null, 'a day that was not read is not a zero');

  console.log('\n--- failure never becomes zero ---');
  const good = core.mergeSnapshots(null, {
    fetchedAt: 1000,
    days: { [today]: { ok: true, slots: extracted.slots } },
  });
  check(good.ready === true && good.days[today].slots.length > 0, 'a good reading is kept');
  const stale = core.mergeSnapshots(good, { fetchedAt: 2000, days: { [today]: { ok: false } } });
  check(
    stale.stale === true && stale.days[today].slots.length === good.days[today].slots.length,
    'a failed refresh keeps the previous slots'
  );
  check(stale.fetchedAt === 1000, 'the stamp stays on the last good reading');
  const none = core.mergeSnapshots(null, { fetchedAt: 2000, days: { [today]: { ok: false } } });
  check(none.ready === false && none.days[today].slots === null, 'a first failure is not a zero');
  const emptyBook = core.mergeSnapshots(null, { fetchedAt: 3000, days: { [today]: { ok: true, slots: [] } } });
  check(
    emptyBook.ready === true && emptyBook.days[today].slots.length === 0,
    'a book that was read and is empty is a real zero'
  );

  console.log('\n--- pack gate and poll budget ---');
  check(core.shouldFetch({ packOn: true, visible: true }) === true, 'fetch when the pack is on and the tab is visible');
  check(core.shouldFetch({ packOn: false, visible: true }) === false, 'pack off does not fetch');
  check(core.shouldFetch({ packOn: true, visible: false }) === false, 'a hidden tab does not fetch');
  check(core.DEFAULT_POLL_MS === 5 * 60 * 1000, 'default poll is 5 minutes');
  check(core.MIN_POLL_MS === 2 * 60 * 1000, 'poll floor is 2 minutes');
  check(core.REQUESTS_PER_REFRESH === 7, 'one refresh is seven day GETs');
  check(core.TICK_MS >= 15000 && core.TICK_MS <= 30000, 'local tick is between 15 and 30 seconds');
  check(core.pollMsFromConfig({ pollMinutes: 1 }) === core.MIN_POLL_MS, 'a shorter poll is raised to the floor');
  check(
    core.overviewPath('2026-09-26') ===
      '/scheduling/data/appointment-book/embedded-overview?date=2026-09-26&filterByUsualLocation=false',
    'the only book read is embedded-overview for one date'
  );
  check(Packs.KEYS.availabilityWall === 'suite.ui.availabilityWall', 'pack key');
  check(Packs.isGrandfather(Packs.KEYS.availabilityWall) === true, 'availability wall is default-on');
  check(Packs.isEnabled(Packs.KEYS.availabilityWall, undefined) === true, 'missing key means on');
  check(Packs.isEnabled(Packs.KEYS.availabilityWall, false) === false, 'explicit false stays off');

  const dropped = core.dropPastSlots(extracted.slots, new Date(at(today, 14, 30)));
  check(!dropped.some((s) => s.startMs < at(today, 14, 30)), 'a local tick drops slots that have started');
  check(
    dropped.some((s) => s.sessionName === 'Nursing'),
    'a local tick keeps session names on the slots that remain'
  );

  console.log('\n--- page contract ---');
  const wall = fs.readFileSync(path.join(__dirname, 'availability/wall.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, 'availability/wall.css'), 'utf8');
  check(wall.includes("method: 'GET'") && wall.includes('overviewPath'), 'the wall GETs the overview path');
  check(!/method:\s*['"]POST['"]/.test(wall) && !wall.includes('chrome.alarms'), 'no writes and no background alarm');
  check(wall.includes('visibilityState') && wall.includes('shouldFetch'), 'refresh pauses while the tab is hidden');
  check(
    wall.includes('prefers-reduced-motion') && css.includes('prefers-reduced-motion'),
    'reduced motion is wired in the page and the CSS'
  );
  check(css.includes('animation: none'), 'reduced motion stops the flash');
  check(
    /\.av-editor\[hidden\]\s*\{[^}]*display:\s*none/.test(css),
    'author display does not keep the setup overlay up while it is hidden'
  );
  check(
    /\.av-editor-card\s*\{[^}]*max-height:\s*100%/.test(css) && /#avEditorBody\s*\{[^}]*overflow:\s*auto/.test(css),
    'the setup card fits the viewport and the tile list scrolls inside it'
  );
  check(wall.includes('KEYS.availabilityWall'), 'the page reads the pack');
  check(
    wall.includes('Last updated') && wall.includes('not zeros'),
    'stale copy says the numbers are the previous reading'
  );
  const panel = fs.readFileSync(path.join(__dirname, 'side-panel/panel.js'), 'utf8');
  check(!/^\s+availability:\s*\{/.test(panel), 'the wall is not a side-panel module');
  const palette = fs.readFileSync(path.join(__dirname, 'side-panel/palette/palette.js'), 'utf8');
  check(
    palette.includes("id: 'open:availability'") && palette.includes('openAvailabilityTab'),
    'command palette opens the wall'
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
