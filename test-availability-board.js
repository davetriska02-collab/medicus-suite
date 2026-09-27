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

function pad2(n) {
  return String(n).padStart(2, '0');
}
let at = (isoDay, hh, mm) => {
  const [y, m, d] = isoDay.split('-').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
};

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
  at = (isoDay, hh, mm) => core.parseLocalDateTime(`${isoDay} ${pad2(hh)}:${pad2(mm)}:00`);

  console.log('\n--- parsing ---');
  const today = '2026-09-26';
  const now = new Date(at(today, 13, 0));
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
              patient: { name: 'Patient Alpha', nhsNumber: '1234567890' },
              compiledReasonForAppointment: 'chest pain',
            }),
            entry('slot', '2026-09-26 12:00:00', 'GP Appointment'),
            entry('slot', '2026-09-26 14:40:00', 'On the day'),
          ]),
          session('Morning', [entry('slot', '2026-09-26 14:10:00', 'GP Appointment')]),
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
  check(!dumped.includes('1234567890'), 'NHS number is not kept');
  check(!dumped.includes('chest pain'), 'appointment reason is not kept');
  check(
    extracted.slots.every(
      (s) =>
        Object.keys(s).sort().join(',') ===
        'clinician,dateISO,delivery,endMs,id,roleHints,sessionHaystack,sessionName,site,slotType,startMs'
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
  const cfg = core.normaliseConfig({ confirmed: true });
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
    byLabel['On-the-day GP'].remaining === 2 && byLabel['On-the-day GP'].nextLabel === '14:40',
    'on the day and duty beat a registrar role'
  );
  check(
    byLabel['Registrar / additional GP'].remaining === 1 && byLabel['Registrar / additional GP'].nextLabel === '14:10',
    'a registrar routine slot stays on the registrar tile'
  );
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
  const reg = redViews.tiles.find((t) => t.id === 'otd-gp');
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
  check(hiddenViews.offScreen > views.offScreen, 'a hidden tile is counted as not on this screen');

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
  check(core.REQUESTS_PER_REFRESH === 7, 'a cold week read is still seven day GETs');
  const openNow = at('2026-09-28', 9, 0);
  const cold = core.planRefresh({ now: openNow, lastWeekAt: null, todayISO: '2026-09-28' });
  check(cold.quiet === false && cold.dates.length === 7, 'the first read inside hours asks for seven dates');
  const later = core.planRefresh({ now: openNow, lastWeekAt: openNow - 5 * 60 * 1000, todayISO: '2026-09-28' });
  check(later.dates.length === 1 && later.dates[0] === '2026-09-28', 'a later tick asks for today only');
  const night = core.planRefresh({ now: at('2026-09-28', 21, 0), lastWeekAt: null, todayISO: '2026-09-28' });
  check(night.quiet === true && night.dates.length === 0, 'nothing is fetched from 19:00 to 07:00');
  check(core.practiceOpen(at('2026-09-28', 7, 0)) === true, '07:00 London is inside practice hours');
  check(core.practiceOpen(at('2026-09-28', 18, 59)) === true, '18:59 London is inside practice hours');
  check(core.backoffMs(core.DEFAULT_POLL_MS, 0) === core.DEFAULT_POLL_MS, 'the first poll uses the base interval');
  check(core.backoffMs(core.DEFAULT_POLL_MS, 3) === core.DEFAULT_POLL_MS * 8, 'backoff stops at 8×');
  check(core.WEEK_POLL_MS === 30 * 60 * 1000, 'days 2–7 wait 30 minutes');
  check(core.STALE_MS === 10 * 60 * 1000, 'a reading older than 10 minutes is not current');
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

  console.log('\n--- blockers ---');
  const confirmed = core.normaliseConfig({ confirmed: true });
  const guess = core.normaliseConfig(null);
  check(guess.confirmed === false, 'a saved mapping is required before tiles are confirmed');
  const unconfirmed = core.todayViews(extracted.slots, guess, now, false);
  check(unconfirmed.unconfirmed === true && unconfirmed.tiles.length === 0, 'guessed tiles are not painted');
  check(unconfirmed.unmapped === extracted.slots.length, 'until setup, every free slot is unmapped');

  const chanpreet = core.extractFreeSlots(
    {
      staffSchedules: [
        {
          name: 'Dr Chanpreet Singh',
          schedule: [session('Morning', [entry('slot', '2026-09-26 16:00:00', 'GP Appointment')])],
        },
      ],
    },
    { now, dateISO: today }
  );
  check(core.tileForSlot(chanpreet.slots[0], confirmed.tiles) == null, 'a generic GP type stays unmapped');
  check(
    !/anp/i.test(JSON.stringify(core.tileForSlot(chanpreet.slots[0], confirmed.tiles) || {})),
    'Chanpreet is not an ANP'
  );

  const visiting = {
    startMs: at(today, 16, 0),
    endMs: at(today, 16, 10),
    slotType: 'GP Appointment',
    sessionName: 'Visiting locum',
    sessionHaystack: 'Visiting locum Dr Chanpreet Singh',
    clinician: 'Dr Chanpreet Singh',
    roleHints: [],
    delivery: '',
    site: '',
    dateISO: today,
  };
  check(core.tileForSlot(visiting, confirmed.tiles) == null, 'visiting is not a home visit');

  function lone(name, service, type) {
    return core.extractFreeSlots(
      { staffSchedules: [{ name, schedule: [session(service, [entry('slot', '2026-09-28 09:00:00', type)])] }] },
      { now: new Date(at('2026-09-28', 8, 0)), dateISO: '2026-09-28' }
    ).slots[0];
  }
  const embargoDiary = lone('3-day GP', 'Morning', 'GP Appointment');
  const aheadDiary = lone('Book ahead 3 days', 'Morning', 'GP consultation');
  check(core.tileForSlot(embargoDiary, confirmed.tiles).id === 'embargo-gp', 'a diary named 3-day GP is embargo');
  check(core.tileForSlot(aheadDiary, confirmed.tiles).id === 'embargo-gp', 'Book ahead 3 days is embargo');
  const embargoWeek = core.weekView([{ date: '2026-09-28', slots: [embargoDiary, aheadDiary] }], confirmed);
  check(embargoWeek.totalRoutine === 0 && embargoWeek.days[0].routine === 0, 'diary-only embargo is not routine GP');

  const hubDiary = lone('Saturday Hub', 'General Appointments', 'GP Appointment');
  const extDiary = lone('Extended access', 'General Appointments', 'GP Appointment');
  check(core.tileForSlot(hubDiary, confirmed.tiles).id === 'extended', 'a diary named hub is extended access');
  check(core.tileForSlot(extDiary, confirmed.tiles).id === 'extended', 'a diary named extended access is not routine');
  const hubWeek = core.weekView([{ date: '2026-09-26', slots: [hubDiary, extDiary] }], confirmed);
  check(hubWeek.totalRoutine === 0 && hubWeek.totalExtended === 2, 'diary-only hub stays on the extended total');

  const smithIndex = core.roleIndex([
    { name: 'John Smith', employmentType: 'registrar' },
    { name: 'Anna', role: 'anp' },
    { name: 'Joanna', role: 'hca' },
  ]);
  const smithson = core.extractFreeSlots(
    {
      staffSchedules: [
        { name: 'John Smithson', schedule: [session('Routine', [entry('slot', '2026-09-28 10:00:00', 'Routine')])] },
        { name: 'Annabelle Crowe', schedule: [session('Routine', [entry('slot', '2026-09-28 10:10:00', 'Routine')])] },
        { name: 'Jo', schedule: [session('Routine', [entry('slot', '2026-09-28 10:20:00', 'Routine')])] },
      ],
    },
    { now: new Date(at('2026-09-28', 8, 0)), dateISO: '2026-09-28', roleIndex: smithIndex }
  );
  check(
    smithson.slots.every((s) => s.roleHints.length === 0),
    'Smith does not match Smithson, Anna does not match Annabelle, Jo does not match Joanna'
  );

  const routineTile = confirmed.tiles.find((t) => t.id === 'routine-gp');
  function faceFor(startH, startM, nowH, nowM, endExtraMin, date) {
    const day = date || today;
    const start = at(day, startH, startM);
    const slot = {
      startMs: start,
      endMs: start + endExtraMin * 60000,
      dateISO: day,
      slotType: 'Routine',
      sessionName: 'Routine',
      sessionHaystack: 'Routine',
      clinician: 'Dr Day',
      roleHints: [],
      site: 'Example Surgery',
      delivery: 'face to face',
    };
    const view = core.tileView(
      routineTile,
      [slot],
      new Date(at(day, nowH, nowM) + (nowM === startM && nowH === startH ? 0 : 0)),
      false
    );
    return { view, face: core.tileFace(view) };
  }
  const at30 = faceFor(14, 30, 14, 0, 15);
  check(
    at30.view.tone === 'amber' && at30.face.primary === '14:30' && /30 min/.test(at30.face.cue),
    'exactly 30 min is amber with a text cue'
  );
  const at60 = faceFor(15, 0, 14, 0, 15);
  check(at60.view.tone === 'amber' && /1 hr/.test(at60.face.cue), 'exactly 60 min is amber with a text cue');
  const atStart = core.tileView(
    routineTile,
    [
      {
        startMs: at(today, 14, 0),
        endMs: at(today, 14, 10),
        dateISO: today,
        slotType: 'Routine',
        sessionName: 'Routine',
        sessionHaystack: 'Routine',
        clinician: 'Dr Day',
        roleHints: [],
        delivery: '',
        site: '',
      },
    ],
    new Date(at(today, 14, 0)),
    false
  );
  const startFace = core.tileFace(atStart);
  check(
    startFace.primary === 'Now' && atStart.tone === 'red' && atStart.remaining === 1,
    'a slot at its start reads Now'
  );
  const justAfter = core.tileView(
    routineTile,
    [
      {
        startMs: at(today, 14, 0),
        endMs: at(today, 14, 0) + 10 * 60000,
        dateISO: today,
        slotType: 'Routine',
        sessionName: 'Routine',
        sessionHaystack: 'Routine',
        clinician: 'Dr Day',
        roleHints: [],
        delivery: '',
        site: '',
      },
    ],
    new Date(at(today, 14, 0) + 1000),
    false
  );
  const justFace = core.tileFace(justAfter);
  check(
    justFace.primary === 'Now' &&
      justAfter.tone === 'red' &&
      justAfter.tone !== 'empty' &&
      justFace.primary !== 'None left',
    'one second after the start is still Now, not None left'
  );
  const underMinute = core.countdownLabel(0.4);
  check(underMinute === '<1 min', 'under a minute is not 0 min');
  const laterSlot = {
    startMs: at('2026-09-28', 9, 0),
    endMs: at('2026-09-28', 9, 10),
    dateISO: '2026-09-28',
    slotType: 'GP Appointment',
    sessionName: '3-day GP',
    sessionHaystack: '3-day GP',
    clinician: '3-day GP',
    roleHints: [],
    delivery: '',
    site: '',
  };
  const laterView = core.tileView(
    confirmed.tiles.find((t) => t.id === 'embargo-gp'),
    [laterSlot],
    new Date(at(today, 13, 0)),
    false
  );
  const laterFace = core.tileFace(laterView);
  check(
    laterFace.primary === 'Mon 28 Sep' && /First available in 2 days/.test(laterFace.cue),
    'a later day shows the date, not a bare time'
  );
  const soonEmbargo = {
    startMs: at(today, 13, 20),
    endMs: at(today, 13, 30),
    dateISO: today,
    slotType: 'GP Appointment',
    sessionName: '3-day GP',
    sessionHaystack: '3-day GP',
    clinician: '3-day GP',
    roleHints: [],
    delivery: '',
    site: '',
  };
  const soonView = core.tileView(
    confirmed.tiles.find((t) => t.id === 'embargo-gp'),
    [soonEmbargo],
    new Date(at(today, 13, 0)),
    false
  );
  check(
    soonView.tone === 'red' && soonView.flash === false && soonView.icon === true,
    'a same-day embargo tile stays steady red and does not flash'
  );
  const horizon = core.horizonSlots(
    {
      [today]: { slots: [], stale: false },
      '2026-09-28': { slots: [laterSlot], stale: false },
      '2026-09-27': { slots: [{ startMs: 1, endMs: 2, dateISO: '2026-09-27' }], stale: true },
    },
    today,
    new Date(at(today, 13, 0)),
    false
  );
  const horizonViews = core.todayViews(horizon, confirmed, new Date(at(today, 13, 0)), false);
  const horizonEmbargo = horizonViews.tiles.find((t) => t.id === 'embargo-gp');
  check(
    horizon.length === 1 && horizonEmbargo && horizonEmbargo.later && horizonEmbargo.dayHeading === 'Mon 28 Sep',
    'a later-day embargo slot is the tile, and a stale other day is left out'
  );
  const todayRoutine = {
    ...laterSlot,
    dateISO: today,
    startMs: at(today, 16, 0),
    endMs: at(today, 16, 10),
    slotType: 'Routine',
    sessionName: 'Routine',
    sessionHaystack: 'Routine',
    clinician: 'Dr Day',
  };
  const laterRoutine = {
    ...todayRoutine,
    dateISO: '2026-09-28',
    startMs: at('2026-09-28', 9, 0),
    endMs: at('2026-09-28', 9, 10),
  };
  const mixed = core.todayViews(
    core.horizonSlots(
      { [today]: { slots: [todayRoutine] }, '2026-09-28': { slots: [laterRoutine] } },
      today,
      new Date(at(today, 13, 0)),
      false
    ),
    confirmed,
    new Date(at(today, 13, 0)),
    false
  );
  const mixedRoutine = mixed.tiles.find((t) => t.id === 'routine-gp');
  check(
    mixedRoutine && mixedRoutine.remaining === 1 && mixedRoutine.later === false,
    'a later routine slot does not inflate the count on today'
  );

  const phone = {
    ...laterSlot,
    dateISO: today,
    startMs: at(today, 16, 0),
    endMs: at(today, 16, 10),
    slotType: 'Routine',
    sessionName: 'Routine',
    sessionHaystack: 'Routine',
    clinician: 'Dr Day',
    delivery: 'telephone',
  };
  check(core.tileForSlot(phone, confirmed.tiles) == null, 'a telephone slot is not on a face-to-face tile');

  const witley = { ...phone, delivery: '', site: 'Example Surgery', sessionHaystack: 'Routine', slotType: 'Routine' };
  const milford = { ...witley, site: 'Other Surgery', startMs: at(today, 16, 20), endMs: at(today, 16, 30) };
  const multi = core.todayViews([witley, milford], confirmed, now, false);
  check(multi.multiSite === true && multi.tiles.some((t) => t.site), 'more than one site is labelled');

  const shaped = core.extractFreeSlots({ message: 'unauthorised' }, { now });
  check(shaped.ok === false, 'a 200 without staffSchedules is not a book');
  const kept = core.mergeSnapshots(
    { fetchedAt: 1000, days: { [today]: { slots: extracted.slots, fetchedAt: 1000, stale: false } } },
    {
      fetchedAt: 9000,
      today,
      days: { [today]: { ok: false }, '2026-09-27': { ok: true, slots: [{ startMs: 1, endMs: 2 }] } },
    },
    { today, keep: [today, '2026-09-27'] }
  );
  check(kept.fetchedAt === 1000, 'a failed today does not move Last updated');
  check(
    kept.days[today].slots.length === extracted.slots.length && kept.days[today].stale === true,
    'today keeps the previous slots and is marked old'
  );
  check(
    kept.staleDates.includes(today) && !kept.staleDates.includes('2026-09-27'),
    'the banner names only the stale day'
  );
  const aged = core.weekView(
    [
      { date: today, slots: extracted.slots, stale: true },
      { date: '2026-09-27', slots: null },
    ],
    confirmed
  );
  check(aged.totalRoutine === 0 && aged.incomplete === true, 'an old day is not added to the week total as current');

  const xmas = core.weekView(
    [
      { date: '2026-12-25', slots: [] },
      { date: '2026-12-28', slots: [] },
    ],
    confirmed
  );
  check(
    xmas.days[0].holiday === true && xmas.days[1].holiday === true,
    'Christmas and the Boxing Day substitute are bank holidays'
  );
  check(
    core.weekDates('2026-12-22').includes('2026-12-25') && core.weekDates('2026-12-22').includes('2026-12-28'),
    'bank holidays stay inside the seven days'
  );
  const unreadSat = core.weekView([{ date: '2026-09-26', slots: null }], confirmed);
  check(
    unreadSat.days[0].routine === null && unreadSat.days[0].extended === null,
    'an unread day is not a known weekend count'
  );
  check(unreadSat.incomplete === true, 'an unread day makes the extended total N+ as well');

  const emptySession = core.extractFreeSlots(
    {
      staffSchedules: [
        {
          name: 'Dr Example',
          schedule: [
            {
              scheduleType: 'diary',
              startDateTime: '2026-09-27 09:00:00',
              endDateTime: '2026-09-27 12:00:00',
              summary: {
                status: { isCancelled: false },
                service: { name: 'Morning' },
                usualAppointmentDuration: 10,
                name: 'Patient Example',
              },
              entries: [],
            },
          ],
        },
      ],
    },
    { now, dateISO: '2026-09-27', dropPast: false }
  );
  check(
    emptySession.ok === true && emptySession.unexpanded === true && emptySession.slots.length === 0,
    'an empty session with a duration is not a confident zero'
  );
  check(!JSON.stringify(emptySession).includes('Patient Example'), 'summary.name is not kept on the slot');

  const dupes = core.extractFreeSlots(
    {
      staffSchedules: [
        {
          name: 'Dr Example',
          schedule: [
            session('Routine', [
              entry('slot', '2026-09-28 11:00:00', 'Routine', { id: 'same', isStaffBreakAssignment: false }),
              entry('slot', '2026-09-28 11:00:00', 'Routine', { id: 'same' }),
              entry('slot', '2026-09-28 11:15:00', 'Routine', { isStaffBreakAssignment: true }),
              entry('slot', '2026-09-28 11:30:00', 'Routine', { patient: { id: 'p1' } }),
              entry('slot', '2026-09-28 11:45:00', 'Routine', { slotReservationId: 'hold-1' }),
              {
                diaryEntryType: { isSlot: true },
                startDateTime: '2026-09-28 12:00:00',
                appointmentType: { name: 'Routine' },
              },
            ]),
          ],
        },
      ],
    },
    { now: new Date(at('2026-09-28', 8, 0)), dateISO: '2026-09-28' }
  );
  check(dupes.slots.length === 1, 'breaks, holds, patient ids, isSlot-only rows and duplicate ids are dropped');

  const ids = core.normaliseConfig({
    confirmed: true,
    tiles: [
      { id: 'custom-1', label: 'A', match: { types: ['routine'] } },
      { id: 'custom-2', label: 'B', match: { types: ['nurse'] } },
      { id: 'custom-1', label: 'C', match: { types: ['visit'] } },
    ],
  });
  check(new Set(ids.tiles.map((t) => t.id)).size === 3, 'custom tile ids stay unique');
  const short = core.normaliseConfig({
    confirmed: true,
    tiles: [{ id: 'routine-gp', label: 'Routine', match: { types: ['gp', 'routine'] } }],
  });
  check(
    !short.tiles[0].match.types.includes('gp') && short.tiles[0].match.types.includes('routine'),
    'needles shorter than 3 characters are rejected'
  );

  check(
    core.parseLocalDateTime('2026-06-15T12:00:00Z') === Date.parse('2026-06-15T12:00:00Z'),
    'Z is the real instant'
  );
  check(
    core.clockLabel(core.parseLocalDateTime('2026-06-15T12:00:00Z')) === '13:00',
    'a Z stamp is shown in Europe/London'
  );
  check(
    core.clockLabel(core.parseLocalDateTime('2026-01-15 12:00:00')) === '12:00',
    'winter wall-clock digits stay 12:00 in London'
  );
  check(
    core.clockProblem(Date.now(), null) === (core.hostIsLondon() ? null : 'zone'),
    'a PC that is not on UK time is reported'
  );
  check(
    core.isNotCurrent(1000, 1000 + core.STALE_MS, core.STALE_MS) === true,
    'ten minutes after the read is not current'
  );

  const pastToday = core.extractFreeSlots(
    {
      staffSchedules: [
        {
          name: 'Dr Day',
          schedule: [
            session('Routine', [
              entry('slot', '2026-09-26 09:00:00', 'Routine'),
              entry('slot', '2026-09-26 15:00:00', 'Routine'),
            ]),
          ],
        },
      ],
    },
    { now: new Date(at(today, 13, 0)), dateISO: today }
  );
  check(
    pastToday.slots.length === 1 && pastToday.slots[0].startMs === at(today, 15, 0),
    'today keeps the 15:00 routine slot and drops the 09:00 one'
  );

  console.log('\n--- page contract ---');
  const wall = fs.readFileSync(path.join(__dirname, 'availability/wall.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, 'availability/wall.css'), 'utf8');
  check(
    wall.includes('fetchSchedulingOverview') && wall.includes('bypassCache: true'),
    'the wall uses the shared book GET and bypasses the 5-minute cache'
  );
  const apiSrc = fs.readFileSync(path.join(__dirname, 'shared/medicus-api.js'), 'utf8');
  check(apiSrc.includes("cache: 'no-store'"), 'the book GET does not use the HTTP cache');
  check(wall.includes('navigator.locks'), 'only one wall tab polls');
  check(wall.includes('planRefresh'), 'the wall splits today from the rest of the week');
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
