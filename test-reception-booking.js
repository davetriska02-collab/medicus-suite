// Medicus Suite — reception booking panel tests (plan D2/D3, RECEPTION-FEEDBACK-2026-07-28)
// Run with: node test-reception-booking.js
//
// The reception booking card is the suite's FIRST clinical write surface aimed
// at non-clinical staff (hazard H-051). Nothing books unless all of the
// following hold, so all of them are pinned here rather than left to a UI
// review:
//
//   • bookingGateState() — the gate truth table. Docked panel only; sensitive
//     pathways never; no open record → no booking; any positive OR unanswered
//     red flag suppresses the card. Precedence is asserted over every
//     combination of the five inputs, not just the happy path.
//   • verifyBookingIdentity() — the commit-time comparator. Pinned, freshly
//     detected and currently-displayed patient must agree, on the SITE as well
//     as the uuid, and anything unresolvable fails closed.
//   • windowModeDays() — the date-mode chip → window length mapping, including
//     the fail-closed behaviour for an unknown mode (never a wider window).
//   • recipientPayloadValues() — the create payload carries EXACTLY the ticked
//     confirmation channels, never "everything the form offered".
//   • bookedCaptureLine() — what the reading clinician sees for a booking made
//     by reception, and that buildCaptureText() actually emits it.
//   • Source guards — the booking panel contains no endpoint code of its own
//     (a third copy of the booking flow is what plan section D forbids), it
//     re-verifies BEFORE the create call, and reception destroys the panel on
//     every exit path so no slot is left reserved.
//
// ES modules, loaded via dynamic import() from this CommonJS script (the
// test-booking-core.js / test-api-clients.js pattern).

'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function check(cond, msg) {
  if (cond) {
    console.log(`  OK  ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL  ${msg}`);
    failed++;
    process.exitCode = 1;
  }
}

const modUrl = (rel) => new URL(rel, `file://${process.cwd()}/`).href;
const read = (rel) => fs.readFileSync(path.join(__dirname, rel), 'utf8');

const CORE = 'side-panel/modules/shared/booking-panel-core.js';
const PANEL = 'side-panel/modules/shared/booking-panel.js';
const RECEPTION = 'side-panel/modules/reception/reception.js';

(async () => {
  const core = await import(modUrl(CORE));
  const rcp = await import(modUrl('side-panel/modules/reception/reception-core.js'));

  // ── 1. bookingGateState — the truth table ─────────────────────────────────
  {
    console.log('\n— bookingGateState: precedence over every input combination —');

    // The gate rules, in the order they are applied. Stated here independently
    // of the implementation so a reordering in booking-panel-core.js fails this
    // test rather than silently changing which patients can be booked.
    const PRECEDENCE = [
      ['popout', 'popout', 'note'],
      ['sensitive', 'sensitive', 'hidden'],
      ['noRecord', 'no-record', 'disabled'],
      ['positive', 'red-flag-positive', 'hidden'],
      ['unanswered', 'red-flag-unanswered', 'hidden'],
    ];

    let combos = 0;
    let mismatches = 0;
    for (let bits = 0; bits < 32; bits++) {
      const flags = {
        popout: !!(bits & 1),
        sensitive: !!(bits & 2),
        noRecord: !!(bits & 4),
        positive: !!(bits & 8),
        unanswered: !!(bits & 16),
      };
      const got = core.bookingGateState({
        isPopOut: flags.popout,
        isSensitivePathway: flags.sensitive,
        hasPatientContext: !flags.noRecord,
        redFlagPositives: flags.positive ? [{ id: 'rf1', ask: 'Chest pain?', escalate: '999' }] : [],
        redFlagUnanswered: flags.unanswered ? ['rf2'] : [],
      });
      const first = PRECEDENCE.find((r) => flags[r[0]]);
      const wantAllowed = !first;
      const wantReason = first ? first[1] : '';
      const wantRender = first ? first[2] : 'panel';
      combos++;
      if (got.allowed !== wantAllowed || got.reason !== wantReason || got.render !== wantRender) {
        mismatches++;
        console.error(
          `      combo ${JSON.stringify(flags)} → ${JSON.stringify(got)} (wanted ${wantReason || 'allowed'}/${wantRender})`
        );
      }
      if (!wantAllowed) {
        if (!got.message || got.message.length < 10) {
          mismatches++;
          console.error(`      combo ${JSON.stringify(flags)} blocked with no usable message`);
        }
      }
    }
    check(combos === 32, 'all 32 input combinations exercised');
    check(mismatches === 0, 'every combination matches the stated gate precedence');

    // The rows that matter most, spelled out.
    const allowed = core.bookingGateState({
      hasPatientContext: true,
      redFlagPositives: [],
      redFlagUnanswered: [],
      isSensitivePathway: false,
      isPopOut: false,
    });
    check(
      allowed.allowed === true && allowed.render === 'panel',
      'open record + all flags answered negative + panel → booking allowed'
    );

    check(
      core.bookingGateState({ hasPatientContext: true, isSensitivePathway: true, isPopOut: false }).reason ===
        'sensitive',
      'sensitive (mental-health) pathway blocks booking even with a clean red-flag screen'
    );
    check(
      core.bookingGateState({ hasPatientContext: false, isSensitivePathway: false, isPopOut: false }).render ===
        'disabled',
      'no open record → the card renders DISABLED (never silently absent)'
    );
    check(
      core.bookingGateState({
        hasPatientContext: true,
        redFlagPositives: [{ id: 'rf1' }],
        redFlagUnanswered: [],
      }).render === 'hidden',
      'a positive red flag HIDES the card (no Book button under an escalation banner)'
    );
    check(
      core.bookingGateState({ hasPatientContext: true, redFlagPositives: [], redFlagUnanswered: ['rf1'] }).reason ===
        'red-flag-unanswered',
      'an unanswered red flag blocks booking (undefined is not a "no")'
    );
    check(
      core.bookingGateState({ hasPatientContext: true, isPopOut: true }).render === 'note',
      'pop-out context renders the "booking lives in the docked panel" note'
    );
    // Fail-closed on junk input: an absent/garbled call must not read as allowed.
    check(core.bookingGateState().allowed === false, 'bookingGateState() with no input fails closed');
    check(
      core.bookingGateState({}).reason === 'no-record',
      'bookingGateState({}) fails closed on the open-record gate'
    );
  }

  // ── 2. windowModeDays — date-mode chip → window length ────────────────────
  {
    console.log('\n— windowModeDays: date-mode mapping —');
    const expect = { day: null, '1wk': 7, '2wk': 14, '3wk': 21, '4wk': 28 };
    for (const [mode, days] of Object.entries(expect)) {
      const got = core.windowModeDays(mode);
      check(got.days === days, `mode "${mode}" → ${days === null ? 'specific day' : `${days} days`}`);
      check(got.isWindow === (days !== null), `mode "${mode}" isWindow=${days !== null}`);
    }
    check(core.windowModeDays('4wk').days === 28, '4 wks is the widest window (= booking-core MAX_WINDOW_DAYS)');
    const bogus = core.windowModeDays('12wk');
    check(bogus.mode === 'day' && bogus.days === null, 'an unknown mode fails CLOSED to a single specific day');
    check(core.windowModeDays(undefined).mode === 'day', 'a missing mode fails closed to a single specific day');
    check(core.BOOKING_DATE_MODES.length === 5, 'five date-mode chips are offered (Specific day, 1–4 wks)');
  }

  // ── 3. Confirmation recipients — checked subset only ──────────────────────
  {
    console.log('\n— recipientPayloadValues: checked channels only —');
    const opts = [
      { value: 'sms', label: 'SMS' },
      { value: 'email', label: 'Email' },
      { value: 'letter', label: 'Letter' },
    ];
    check(
      JSON.stringify(core.defaultRecipientValues(opts)) === JSON.stringify(['sms', 'email', 'letter']),
      'default selection is every offered channel (current suite behaviour, now visible)'
    );
    check(
      JSON.stringify(core.recipientPayloadValues(opts, ['sms', 'letter'])) === JSON.stringify(['sms', 'letter']),
      'payload carries exactly the checked subset'
    );
    check(
      JSON.stringify(core.recipientPayloadValues(opts, [])) === JSON.stringify([]),
      'un-ticking every channel sends NO confirmation (nothing reaches the patient)'
    );
    check(
      JSON.stringify(core.recipientPayloadValues(opts, ['letter', 'sms'])) === JSON.stringify(['sms', 'letter']),
      'output preserves the order Medicus offered, not the tick order'
    );
    check(
      JSON.stringify(core.recipientPayloadValues(opts, ['sms', 'sms'])) === JSON.stringify(['sms']),
      'duplicate ticks collapse'
    );
    check(
      JSON.stringify(core.recipientPayloadValues(opts, ['pigeon', 'email'])) === JSON.stringify(['email']),
      'a value Medicus did not offer is dropped from the payload'
    );
    check(
      JSON.stringify(core.recipientPayloadValues(undefined, ['sms'])) === JSON.stringify([]),
      'no offered options → no recipients (never invents a channel)'
    );
  }

  // ── 4. verifyBookingIdentity — the commit-time comparator matrix ──────────
  {
    console.log('\n— verifyBookingIdentity: wrong-patient / wrong-site matrix —');
    const P = 'aaaaaaaa-1111-2222-3333-444444444444';
    const Q = 'bbbbbbbb-1111-2222-3333-444444444444';
    const A = 'https://ab12cd.api.england.medicus.health';
    const B = 'https://zz99yy.api.england.medicus.health';
    const base = {
      pinnedPatientId: P,
      pinnedApiBase: A,
      detectedPatientId: P,
      detectedApiBase: A,
      contextPatientId: P,
    };
    const v = (over) => core.verifyBookingIdentity(Object.assign({}, base, over));

    check(v({}).ok === true, 'all three sources agree on patient and site → ok');
    check(
      v({ detectedPatientId: Q }).code === 'patient-mismatch',
      'tab now shows a DIFFERENT patient → patient-mismatch'
    );
    check(v({ detectedApiBase: B }).code === 'site-mismatch', 'tab now on a different Medicus site → site-mismatch');
    check(
      v({ contextPatientId: Q }).code === 'context-mismatch',
      'panel shows a different patient than the pin → context-mismatch'
    );
    check(
      v({ detectedPatientId: null }).code === 'unresolved',
      'patient could not be re-resolved → unresolved (fails closed)'
    );
    check(v({ detectedApiBase: null }).code === 'unresolved', 'no Medicus tab at commit → unresolved (fails closed)');
    check(v({ contextPatientId: null }).code === 'context-unresolved', 'panel lost its patient context → fails closed');
    check(v({ pinnedPatientId: null }).code === 'not-pinned', 'nothing was pinned → not-pinned (fails closed)');
    check(v({ pinnedApiBase: null }).code === 'not-pinned', 'no pinned site → not-pinned (fails closed)');
    check(core.verifyBookingIdentity().ok === false, 'verifyBookingIdentity() with no input fails closed');
    check(core.verifyBookingIdentity({}).ok === false, 'verifyBookingIdentity({}) fails closed');

    // Both mismatch classes must be independently fatal — a matching uuid on
    // the wrong instance is still the wrong write.
    check(v({ detectedPatientId: Q, detectedApiBase: B }).ok === false, 'patient AND site both wrong → still refused');
    for (const code of [
      'patient-mismatch',
      'site-mismatch',
      'context-mismatch',
      'unresolved',
      'context-unresolved',
      'not-pinned',
    ]) {
      const r = core.BOOKING_VERIFY_MESSAGES[code] || '';
      check(/nothing was booked/i.test(r), `"${code}" message tells the receptionist nothing was booked`);
    }
  }

  // ── 4b. The component contract (loads, and honours a closed gate) ─────────
  {
    console.log('\n— createBookingPanel contract —');
    // Loading the module for real catches a broken import path or a syntax
    // error that the source-text guards below cannot see.
    const panel = await import(modUrl(PANEL));
    check(typeof panel.createBookingPanel === 'function', 'booking-panel.js exports createBookingPanel');

    // No mountEl and no browser globals: the component must still construct and
    // must NOT do anything when the gate is closed (no DOM writes, no arming).
    let gateCalls = 0;
    const inst = panel.createBookingPanel({
      mountEl: null,
      getPatientContext: () => ({ patientId: 'p1', name: 'A B', dob: '01/01/1980' }),
      getGateState: () => {
        gateCalls++;
        return { allowed: false, reason: 'red-flag-positive', render: 'hidden', message: 'blocked' };
      },
    });
    check(typeof inst.render === 'function' && typeof inst.destroy === 'function', 'returns { render, destroy, ... }');
    const returned = inst.render();
    check(gateCalls > 0, 'render() consults the gate before doing anything');
    check(returned && returned.allowed === false, 'render() hands the gate result back to the host');
    check(inst.isBusy() === false, 'a blocked panel holds no reservation');
    inst.destroy();
    inst.destroy();
    check(true, 'destroy() is idempotent');
  }

  // ── 5. Slot presentation ──────────────────────────────────────────────────
  {
    console.log('\n— slot grouping and formatting —');
    const slot = (dt) => ({ startDateTime: dt, duration: 10 });
    const ordered = core.orderSlotDays({
      '2026-08-05': [slot('2026-08-05 11:00:00'), slot('2026-08-05 09:30:00')],
      '2026-08-03': [],
      '2026-08-04': [slot('2026-08-04 08:00:00')],
    });
    check(
      JSON.stringify(ordered.map((d) => d.date)) === JSON.stringify(['2026-08-03', '2026-08-04', '2026-08-05']),
      'days are ordered earliest first'
    );
    check(ordered[0].slots.length === 0, 'a searched-but-full day is KEPT as an empty day (not silently omitted)');
    check(ordered[2].slots[0].startDateTime === '2026-08-05 09:30:00', 'slots within a day are ordered earliest first');
    check(core.orderSlotDays(undefined).length === 0, 'orderSlotDays tolerates a missing byDay');
    check(core.formatDayLabel('2026-08-03') === 'Mon 3 Aug 2026', 'formatDayLabel renders a UK-readable day');
    check(core.formatDayLabel('nonsense') === 'nonsense', 'formatDayLabel passes unparseable input through');
    check(
      core.slotTime({ startDateTime: '2026-08-03 09:20:00' }) === '09:20',
      'slotTime reads HH:MM from startDateTime'
    );
    check(
      core.slotTime({ start: '09:20', startDateTime: '2026-08-03 09:20:00' }) === '09:20',
      'slotTime prefers the API-provided start'
    );
    check(
      core.slotDate({ startDateTime: '2026-08-03T09:20:00' }) === '2026-08-03',
      'slotDate handles the ISO T separator'
    );
    check(
      core.formatSlotWhen({ startDateTime: '2026-08-03 09:20:00' }) === 'Mon 3 Aug 2026, 09:20',
      'formatSlotWhen is the read-back / capture-line wording'
    );
  }

  // ── 6. bookedCaptureLine + buildCaptureText integration ───────────────────
  {
    console.log('\n— booked summary → capture line —');
    check(
      core.bookedCaptureLine({
        typeLabel: 'GP routine 10min',
        whenText: 'Mon 3 Aug 2026, 09:20',
        reason: 'Sore throat',
      }) === 'Booked: GP routine 10min — Mon 3 Aug 2026, 09:20 — reason: Sore throat',
      'the capture line is "Booked: <type> — <date/time> — reason: <reason>"'
    );
    check(
      core
        .bookedCaptureLine({ typeLabel: 'GP routine', whenText: 'Mon 3 Aug 2026, 09:20', reason: '   ' })
        .endsWith('reason: not recorded'),
      'a blank reason reads "not recorded" rather than collapsing the field'
    );
    check(
      core.bookedCaptureLine({}) ===
        'Booked: appointment type not recorded — date/time not recorded — reason: not recorded',
      'every missing field is explicit — a half-empty line hides a wrong booking'
    );

    const pathway = {
      id: 'sore-throat',
      title: 'Sore throat',
      redFlags: [{ id: 'rf1', ask: 'Difficulty breathing?', escalate: '999' }],
      questions: [],
    };
    const text = rcp.buildCaptureText({
      pathway,
      closingQuestions: [],
      escalations: {},
      ownWords: 'sore throat 3 days',
      redFlagAnswers: { rf1: 'no' },
      questionAnswers: {},
      closingAnswers: {},
      meta: {
        nowIso: '2026-07-28T10:00:00.000Z',
        bookedLines: ['Booked: GP routine 10min — Mon 3 Aug 2026, 09:20 — reason: Sore throat'],
      },
    });
    check(
      text.includes('Booked: GP routine 10min — Mon 3 Aug 2026, 09:20 — reason: Sore throat'),
      'buildCaptureText emits the booked line so the clinician sees what reception booked'
    );
    const noBooking = rcp.buildCaptureText({
      pathway,
      closingQuestions: [],
      escalations: {},
      ownWords: '',
      redFlagAnswers: { rf1: 'no' },
      questionAnswers: {},
      closingAnswers: {},
      meta: { nowIso: '2026-07-28T10:00:00.000Z' },
    });
    check(!/Booked:/.test(noBooking), 'no booking → no Booked: line (nothing is implied)');
    const junk = rcp.buildCaptureText({
      pathway,
      closingQuestions: [],
      escalations: {},
      ownWords: '',
      redFlagAnswers: { rf1: 'no' },
      questionAnswers: {},
      closingAnswers: {},
      meta: { nowIso: '2026-07-28T10:00:00.000Z', bookedLines: ['', '   ', null, 42] },
    });
    check(!/Booked:/.test(junk) && !/42/.test(junk), 'empty / non-string booked lines are dropped');
  }

  // ── 7. Source guards: no endpoint code in the panel ───────────────────────
  {
    console.log('\n— source guards —');
    const panelSrc = read(PANEL);
    const coreSrc = read(CORE);

    // "No third copy" (plan section D). The panel must reach every endpoint
    // through ../slots/booking-api.js, which re-exports the ONE copy in
    // shared/booking-core.js.
    for (const [label, src] of [
      ['booking-panel.js', panelSrc],
      ['booking-panel-core.js', coreSrc],
    ]) {
      check(!/scheduling\//.test(src), `${label} contains no /scheduling/ endpoint path`);
      check(!/\bfetch\s*\(/.test(src), `${label} makes no fetch() call of its own`);
      check(!/credentials\s*:/.test(src), `${label} sets no credentialed request options`);
      // Writes specifically — the prose in these files names chrome.storage to
      // say it is never used, which is exactly the promise being pinned here.
      check(
        !/chrome\.storage\.[a-z]+\.(set|remove|clear)/.test(src),
        `${label} never persists state to chrome.storage`
      );
    }
    check(!/chrome\.[A-Za-z_$]/.test(coreSrc), 'booking-panel-core.js is chrome-free (pure logic)');
    check(!/(document|window)\.[A-Za-z_$]/.test(coreSrc), 'booking-panel-core.js is DOM-free (pure logic)');
    check(
      /from '\.\.\/slots\/booking-api\.js'/.test(panelSrc),
      'booking-panel.js imports the shared booking API shim (single endpoint copy)'
    );
    check(
      /createAppointment/.test(panelSrc) && /reserveSlot/.test(panelSrc) && /releaseReservation/.test(panelSrc),
      'booking-panel.js uses the shim functions rather than re-declaring them'
    );

    // Commit-time re-verification must happen BEFORE the create call.
    const commit = panelSrc.slice(panelSrc.indexOf('async function commit('));
    const detectAt = commit.indexOf('await detectMedicusTab()');
    const verifyAt = commit.indexOf('verifyBookingIdentity(');
    const createAt = commit.indexOf('await createAppointment(');
    check(detectAt !== -1, 'commit() re-detects the Medicus tab');
    check(verifyAt !== -1, 'commit() runs verifyBookingIdentity()');
    check(createAt !== -1, 'commit() calls createAppointment');
    check(detectAt < verifyAt && verifyAt < createAt, 're-detect → verify → create, in that order');
    check(/abortOnIdentity\(verdict\.message\)/.test(commit), 'a failed verdict aborts the booking');
    check(
      /function abortOnIdentity[\s\S]{0,400}releaseHeld\(/.test(panelSrc),
      'the identity abort releases the held reservation'
    );
    check(
      /if \(s\.committing \|\| !s\.reservationId \|\| !s\.selectedSlot \|\| !s\.patientTicked\) return;/.test(panelSrc),
      'commit() refuses to run until the "right patient" box is ticked'
    );
    check(
      /const s = st; \/\/ pin/.test(panelSrc),
      'async actions pin the state instance across awaits (H-043 discipline)'
    );
    check(/pagehide/.test(panelSrc), 'the panel releases its reservation on pagehide');
    check(/removeEventListener\('pagehide'/.test(panelSrc), 'destroy() unregisters the pagehide listener');
    check(/TODO\(D2 spike\)/.test(panelSrc), 'the D2 recipient-default spike is recorded as a TODO');
    check(
      /Choose appointment type/.test(panelSrc) && !/types\[0\]\.value/.test(panelSrc),
      'no appointment type is pre-selected (even when only one exists)'
    );
    check(/bookingConfirmationRecipients: recipients/.test(panelSrc), 'the payload sends the checked recipient set');
  }

  // ── 8. Reception integration guards ───────────────────────────────────────
  {
    console.log('\n— reception integration —');
    const src = read(RECEPTION);
    check(/rcpBookingCard/.test(src), 'reception renders the #rcpBookingCard third card');
    check(/import \{ createBookingPanel \}/.test(src), 'reception mounts the shared booking panel component');
    check(/import \{ bookingGateState \}/.test(src), 'reception gates through the shared pure gate function');
    check(
      /function redFlagState\(form, pathway\) \{\s*return evaluateRedFlags\(/.test(src),
      'the booking gate and the disposition card share ONE red-flag evaluation'
    );
    check(/isPopOut: isPopOutContext\(\)/.test(src), 'reception passes the pop-out context into the gate');
    check(/pop-out\\\//.test(src) || /pop-out\//.test(src), 'reception detects the pop-out shell by path');

    // The card must be created/destroyed WITH the capture form, and every exit
    // path must release the reservation.
    const destroyCalls = (src.match(/destroyBookingCard\(\)/g) || []).length;
    check(destroyCalls >= 5, `destroyBookingCard() is called on every exit path (${destroyCalls} call sites)`);
    for (const [fn, label] of [
      ['function renderPathwayPicker', 'pathway picker / storage-change re-render'],
      ['function cleanup', 'module cleanup()'],
      ['function renderOutput', 'summary output view'],
      ['async function renderCaptureForm', 'capture-form (re)entry'],
    ]) {
      const at = src.indexOf(fn);
      const body = at === -1 ? '' : src.slice(at, at + 1400);
      check(body.includes('destroyBookingCard()'), `${label} tears the booking card down`);
    }
    check(
      /_bookedLines\.push\(summary\.line\)/.test(src),
      'a completed booking appends its line to the capture metadata'
    );
    check(/bookedLines: _bookedLines\.slice\(\)/.test(src), 'the booked lines travel via buildCaptureText meta');
    check(!/chrome\.storage\.local\.set\(\{\s*\[?['"]?reception\.booking/.test(src), 'no booking state is persisted');
    check(
      /getDefaultReason: \(\) => _bookingCtx\?\.pathway\?\.title/.test(src),
      'the reason is pre-filled from the active pathway title'
    );
    check(
      /pc\.patientUuid \|\| pc\.patientId/.test(src),
      'booking identity comes from the snapshot patient uuid (active-tab source)'
    );
    check(
      /updateBookingCard\(form, pathway\)/.test(src),
      'the booking card re-gates on the same form-change hook as the disposition card'
    );
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
