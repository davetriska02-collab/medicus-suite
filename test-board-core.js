// Medicus Suite — Note display board core tests
// Run with: node test-board-core.js
//
// Pins the public-TV PII rule (H-067): a snapshot built for a public
// audience must never carry patient names, initials, summaries, reasons,
// or staff-by-patient rows, even when the Condor-shaped streams are full
// of them (demoStreams() plants obvious fixtures).

'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  let passed = 0;
  let failed = 0;
  function check(cond, msg) {
    if (cond) {
      passed++;
      console.log(`  OK    ${msg}`);
    } else {
      failed++;
      console.error(`  FAIL  ${msg}`);
    }
  }

  const corePath = pathToFileURL(path.join(__dirname, 'board', 'board-core.js')).href;
  const {
    sanitiseMessage,
    sanitiseConfig,
    sanitiseThresholds,
    resolveProfile,
    widgetsForProfile,
    waitMinutes,
    waitBand,
    deriveTempo,
    formatFlapRows,
    buildSnapshot,
    buildTickerLines,
    forbiddenSnapshotKeys,
    snapshotLeaves,
    demoStreams,
    DEFAULT_CONFIG,
    DEFAULT_PROFILES,
    MAX_MESSAGE_CHARS,
    FLAP_COLS,
    PUBLIC_WIDGETS,
    STAFF_ONLY_WIDGETS,
    TEMPO_LABEL,
    PUBLIC_TEMPO_LABEL,
    tempoLabelFor,
    sanitiseCopy,
    fillCopy,
    newCustomProfile,
    isCustomProfileId,
    newCustomProfileId,
    DEFAULT_COPY,
    feedIsDegraded,
    MAX_CUSTOM_PROFILES,
    BOARD_STYLES,
    BOARD_COLOURS,
    DEFAULT_STYLE_ID,
    DEFAULT_COLOUR_ID,
    sanitiseStyleId,
    sanitiseColourId,
    resolveStyleAndColour,
    sanitiseYoutubeList,
    youtubeEmbedUrl,
  } = await import(corePath);

  const NOW = Date.parse('2026-08-29T11:00:00+01:00');

  console.log('\n--- message sanitise ---');
  check(sanitiseMessage('  Hello   world  ') === 'Hello world', 'collapses whitespace');
  check(sanitiseMessage('<b>Hi</b>') === 'Hi', 'strips HTML tags');
  check(sanitiseMessage('a'.repeat(MAX_MESSAGE_CHARS + 20)).length === MAX_MESSAGE_CHARS, 'clamps length');
  check(sanitiseMessage('line\u0000break') === 'linebreak', 'strips control chars');
  check(sanitiseMessage(null) === '', 'null becomes empty');

  console.log('\n--- config sanitise ---');
  {
    const cfg = sanitiseConfig(null);
    check(cfg.activeProfileId === 'waiting-room', 'default active profile is waiting-room');
    check(
      cfg.thresholds.amberWaitMin === 10 && cfg.thresholds.busyWaiting === 5,
      'ships default wait and busy thresholds'
    );
    const customTh = sanitiseConfig({
      thresholds: { amberWaitMin: 15, redWaitMin: 30, busyWaiting: 6, veryBusyWaiting: 10 },
    });
    check(
      customTh.thresholds.amberWaitMin === 15 && customTh.thresholds.busyWaiting === 6,
      'practice thresholds survive sanitise'
    );
    check(cfg.profiles.length === DEFAULT_PROFILES.length, 'ships all three profiles');
    check(
      cfg.profiles.every((p) => p.id && p.audience && Array.isArray(p.widgets)),
      'each profile has id, audience, widgets'
    );
  }
  {
    const cfg = sanitiseConfig({
      activeProfileId: 'ops',
      pollSeconds: 5,
      profiles: [
        {
          id: 'waiting-room',
          audience: 'staff',
          widgets: ['pressure', 'flap', 'tempo', 'waiting', 'bogus'],
          message: '<em>Sit</em> please',
        },
      ],
    });
    const wr = cfg.profiles.find((p) => p.id === 'waiting-room');
    check(wr.audience === 'public', 'backup cannot flip waiting-room to staff');
    check(!wr.widgets.includes('pressure'), 'staff-only widgets stripped from public profile');
    check(wr.widgets.includes('flap') && wr.widgets.includes('tempo'), 'keeps allowed public widgets');
    check(!wr.widgets.includes('bogus'), 'unknown widgets dropped');
    check(wr.message === 'Sit please', 'message sanitised on import');
    check(cfg.pollSeconds === 10, 'pollSeconds clamped to minimum');
    check(cfg.activeProfileId === 'ops', 'honours a known activeProfileId');
    const named = sanitiseConfig({
      profiles: [{ id: 'waiting-room', name: 'Front hall' }],
    });
    check(
      named.profiles.find((p) => p.id === 'waiting-room').name === 'Front hall',
      'practice can rename a shipped board'
    );
    const extra = sanitiseConfig({
      profiles: [
        {
          id: 'c-abc1234',
          name: 'Pharmacy',
          audience: 'public',
          widgets: ['pressure', 'flap', 'tempo'],
        },
      ],
    });
    const pharm = extra.profiles.find((p) => p.id === 'c-abc1234');
    check(Boolean(pharm), 'custom public board is kept');
    check(pharm.name === 'Pharmacy', 'custom board keeps its name');
    check(pharm.audience === 'public', 'custom public board stays public');
    check(!pharm.widgets.includes('pressure'), 'custom public board cannot grow staff tiles');
    check(isCustomProfileId(newCustomProfile('staff').id), 'new staff board gets a custom id');
    check(newCustomProfileId() !== newCustomProfileId(), 'two ids minted back-to-back never collide');
    {
      // A duplicate id among 7 distinct incoming boards must not eat one of
      // the cap's 6 real slots — de-dupe has to run before the cap, not after.
      const seven = Array.from({ length: 7 }, (_, i) => ({
        id: `c-board${i}xx`,
        name: `Board ${i}`,
        audience: 'public',
      }));
      const withDupe = [seven[0], ...seven];
      const capped = sanitiseConfig({ profiles: withDupe });
      const customCount = capped.profiles.filter((p) => isCustomProfileId(p.id)).length;
      check(
        customCount === MAX_CUSTOM_PROFILES,
        `a duplicate id still leaves all ${MAX_CUSTOM_PROFILES} cap slots usable (got ${customCount})`
      );
    }
    const words = sanitiseCopy({ waitUnder: 'Usually under {n} min', tempoPublicSteady: '<b>Calm</b>' });
    check(words.waitUnder === 'Usually under {n} min', 'wait sentence keeps the {n} hole');
    check(words.tempoPublicSteady === 'Calm', 'copy strips markup');
    check(fillCopy(words.waitUnder, 12) === 'Usually under 12 min', 'fillCopy substitutes {n}');
    check(
      waitBand(2, 4, { amberWaitMin: 10, redWaitMin: 20 }, { waitUnder: 'Usually under {n} min' }).label ===
        'Usually under 10 min',
      'wait band uses practice wording'
    );
    check(DEFAULT_COPY.failTitle.length > 0, 'shipped fail copy is present');
    check(DEFAULT_CONFIG.styleId === 'standard', 'default style is Standard');
    check(DEFAULT_CONFIG.colourId === 'flap', 'default Standard colour is Split-flap');
    check(sanitiseStyleId('clear') === 'clear', 'known style is kept');
    check(sanitiseStyleId('harbour') === DEFAULT_STYLE_ID, 'old colour id migrates to Standard');
    check(sanitiseStyleId('neon-club') === DEFAULT_STYLE_ID, 'unknown style falls back to Standard');
    check(sanitiseColourId('harbour') === 'harbour', 'known colour is kept');
    check(sanitiseColourId('neon-club') === DEFAULT_COLOUR_ID, 'unknown colour falls back to flap');
    check(BOARD_STYLES.length === 10, 'ships ten styles');
    check(BOARD_COLOURS.length === 10, 'ships ten Standard colours');
    check(new Set(BOARD_STYLES.map((s) => s.id)).size === 10, 'each style has a distinct id');
    check(
      BOARD_STYLES.every((s) => s.name && s.blurb),
      'each style has a name and blurb'
    );
    check(
      BOARD_COLOURS.every((c) => c.name && c.blurb && c.swatches.length === 3),
      'each colour has a name, blurb and three swatches'
    );
    const migrated = sanitiseConfig({ styleId: 'harbour' });
    check(migrated.styleId === 'standard' && migrated.colourId === 'harbour', 'old look id becomes Standard + colour');
    const resolved = resolveStyleAndColour({ styleId: 'clear', colourId: 'daylight' });
    check(resolved.styleId === 'clear' && resolved.colourId === 'daylight', 'style and colour resolve independently');
    const fullCopy = sanitiseCopy(null);
    check(fullCopy.failBody === DEFAULT_COPY.failBody, 'default fail body is not clipped to the flap limit');
    check(fullCopy.failBody.length > 80, 'fail body is allowed to be longer than a flap line');
    const demandOn = sanitiseConfig({ publicCountsRequests: true });
    check(demandOn.publicCountsRequests === true, 'practice can let public TVs count requests');
    check(sanitiseConfig({}).publicCountsRequests === false, 'public TVs ignore request volume by default');
  }
  {
    const cfg = sanitiseConfig({ activeProfileId: 'not-a-profile' });
    check(cfg.activeProfileId === DEFAULT_CONFIG.activeProfileId, 'unknown activeProfileId falls back');
  }

  console.log('\n--- profile resolve + widget lock ---');
  {
    const cfg = sanitiseConfig({ activeProfileId: 'ops' });
    check(resolveProfile(cfg, 'waiting-room').id === 'waiting-room', 'requested id wins');
    check(resolveProfile(cfg, null).id === 'ops', 'falls back to active');
    const publicWidgets = widgetsForProfile({ audience: 'public', widgets: [...STAFF_ONLY_WIDGETS, 'tempo'] });
    check(
      publicWidgets.every((w) => PUBLIC_WIDGETS.includes(w)),
      'widgetsForProfile strips staff-only on public'
    );
    check(publicWidgets.includes('tempo'), 'keeps the public widget that was listed');
    check(PUBLIC_WIDGETS.includes('youtube'), 'youtube playlist is a public widget');
    check(!STAFF_ONLY_WIDGETS.includes('youtube'), 'youtube is not staff-only');
    const ytCustom = sanitiseConfig({
      profiles: [
        {
          id: 'c-abc1234',
          audience: 'public',
          widgets: ['youtube', 'flap', 'pressure'],
          youtubeListId: 'https://www.youtube.com/playlist?list=PLtestlistid1234567890',
        },
      ],
    });
    const ytBoard = ytCustom.profiles.find((p) => p.id === 'c-abc1234');
    check(ytBoard.widgets.includes('youtube'), 'custom public board can show a playlist');
    check(!ytBoard.widgets.includes('pressure'), 'playlist does not unlock staff tiles');
    check(ytBoard.youtubeListId === 'PLtestlistid1234567890', 'playlist URL is stored as an id');
    const shipped = sanitiseConfig(null).profiles.find((p) => p.id === 'waiting-room');
    check(!shipped.widgets.includes('youtube'), 'waiting room does not ship the playlist on');
  }

  console.log('\n--- youtube playlist sanitise ---');
  {
    const good = 'PLtestlistid1234567890';
    check(sanitiseYoutubeList(good) === good, 'bare playlist id is kept');
    check(sanitiseYoutubeList(`https://www.youtube.com/playlist?list=${good}`) === good, 'playlist URL yields the id');
    check(
      sanitiseYoutubeList(`https://www.youtube.com/watch?v=abc123&list=${good}`) === good,
      'watch URL with list= yields the id'
    );
    check(sanitiseYoutubeList(`https://youtu.be/dQw4w9wg?list=${good}`) === good, 'youtu.be with list= yields the id');
    check(
      sanitiseYoutubeList(`www.youtube.com/playlist?list=${good}`) === good,
      'scheme-less playlist URL is accepted'
    );
    check(
      sanitiseYoutubeList(`https://music.youtube.com/playlist?list=${good}`) === good,
      'music.youtube.com playlist URL is accepted'
    );
    check(
      sanitiseYoutubeList(`https://m.youtube.com/playlist?list=${good}`) === good,
      'm.youtube.com playlist URL is accepted'
    );
    check(
      sanitiseYoutubeList(`https://www.youtube-nocookie.com/embed/videoseries?list=${good}`) === good,
      'youtube-nocookie embed URL yields the id'
    );
    check(sanitiseYoutubeList('') === '' && sanitiseYoutubeList(null) === '', 'empty or null becomes none');
    check(sanitiseYoutubeList('https://evil.example/playlist?list=' + good) === '', 'foreign host is rejected');
    check(
      sanitiseYoutubeList('https://youtube.com.evil.example/playlist?list=' + good) === '',
      'lookalike host is rejected'
    );
    check(sanitiseYoutubeList('javascript:alert(1)') === '', 'javascript: is rejected');
    check(sanitiseYoutubeList('data:text/html,<iframe>') === '', 'data: is rejected');
    check(sanitiseYoutubeList('https://www.youtube.com/playlist?list=WL') === '', 'short personal list id is rejected');
    const embed = youtubeEmbedUrl('https://evil.example/?list=' + good);
    check(embed === '', 'embed URL refuses an unsanitised host');
    const src = youtubeEmbedUrl(`https://www.youtube.com/playlist?list=${good}`);
    check(src.startsWith('https://www.youtube-nocookie.com/embed/videoseries?'), 'embed is youtube-nocookie only');
    check(src.includes(`list=${good}`), 'embed carries the sanitised id');
    check(src.includes('mute=1') && src.includes('autoplay=1'), 'embed starts muted so autoplay can run');
    check(!/[&?]playlist=/.test(src), 'embed does not pass playlist= on a videoseries URL');
    check(!src.includes('evil'), 'embed never interpolates a rejected host');
  }

  console.log('\n--- wait math ---');
  check(waitMinutes(new Date(NOW - 8 * 60000).toISOString(), NOW) === 8, '8 minutes waiting');
  check(waitMinutes(new Date(NOW + 60000).toISOString(), NOW) === 0, 'future start clamps to 0');
  check(waitMinutes(null, NOW) === null, 'missing start is null');
  check(waitMinutes('not-a-date', NOW) === null, 'invalid start is null');
  {
    const none = waitBand(0, 40, null);
    check(none.label === 'No one waiting' && none.tone === 'quiet', 'empty room is quiet / no one waiting');
    const short = waitBand(3, 8, null);
    check(
      short.label === 'Most waits are under 10 minutes' && short.tone === 'quiet',
      'under amber is a band, not a number'
    );
    const mid = waitBand(3, 15, null);
    check(mid.label === 'Most waits are under 20 minutes', 'under red is the next band');
    const long = waitBand(3, 25, null);
    check(
      long.label === 'Some waits are over 20 minutes' && long.tone === 'busy',
      'over red does not name the longest wait'
    );
    check(!/\d{2,}/.test(long.label.replace('20', '')), 'band label does not leak the 25-minute figure');
  }

  console.log('\n--- tempo ---');
  check(deriveTempo({ waitingCount: 0, maxWaitMinutes: 0, demandAll: 0 }) === 'quiet', 'empty practice is quiet');
  check(deriveTempo({ waitingCount: 2, maxWaitMinutes: 4, demandAll: 12 }) === 'steady', 'a few waiting is steady');
  check(deriveTempo({ waitingCount: 5, maxWaitMinutes: 4, demandAll: 12 }) === 'busy', '5 waiting is busy');
  check(
    deriveTempo({ waitingCount: 1, maxWaitMinutes: 20, demandAll: 0 }) === 'very-busy',
    '20-minute wait is very busy'
  );
  check(
    deriveTempo({ waitingCount: 0, maxWaitMinutes: 0, demandAll: 60 }, null, 'staff') === 'very-busy',
    '60 demand is very busy (staff, where demand counts)'
  );
  check(
    deriveTempo({ waitingCount: 0, maxWaitMinutes: 0, demandAll: 60 }, null, 'public') === 'quiet',
    'an unrecognised or public mode never lets demand alone read busy'
  );
  check(
    deriveTempo({ waitingCount: 4, maxWaitMinutes: 8, demandAll: 42 }, null, 'public') === 'steady',
    'public tempo ignores back-office request volume'
  );
  check(
    deriveTempo({ waitingCount: 0, maxWaitMinutes: 0, demandAll: 60 }, null, 'public') === 'quiet',
    'empty public room stays quiet even on a heavy request day'
  );
  check(TEMPO_LABEL.quiet === 'Quiet', 'tempo labels are sentence case');

  console.log('\n--- flap layout ---');
  {
    const rows = formatFlapRows('Please take a seat', 22, 2);
    check(rows.length === 2, 'two flap rows');
    check(
      rows.every((row) => row.length === FLAP_COLS),
      'each row is 22 tiles'
    );
    check(rows.join('').includes('PLEASE'), 'uppercases');
    check(rows.join('').includes('SEAT'), 'keeps the words');
    check(!rows.join('').includes('<'), 'no markup on flaps');
    const blank = formatFlapRows('', 22, 2);
    check(
      blank.every((row) => /^ +$/.test(row)),
      'empty message is blank tiles'
    );
    const weird = formatFlapRows('Hello 😊 world', 22, 1);
    check(!weird[0].includes('😊'), 'unknown glyphs become blanks');
  }

  console.log('\n--- public snapshot strips PII ---');
  {
    const streams = demoStreams(NOW);
    const snap = buildSnapshot(streams, { nowMs: NOW, audience: 'public' });
    const json = JSON.stringify(snap);
    check(snap.audience === 'public', 'public audience stamped');
    check(snap.waiting.count === 4, 'arrived count survives');
    check(typeof snap.waiting.band === 'string' && snap.waiting.band.length > 0, 'wait band present');
    check(!json.includes('Alice Smith'), 'patient name Alice Smith stripped');
    check(!json.includes('Bob Jones'), 'patient name Bob Jones stripped');
    check(!json.includes('Cara Patel'), 'patient name Cara Patel stripped');
    check(!json.includes('Dee Walsh'), 'patient name Dee Walsh stripped');
    check(!json.includes('Evan Cole'), 'booked-not-arrived name stripped');
    check(!json.includes('chest pain'), 'appointment reason stripped');
    check(!json.includes('Wants antibiotics'), 'request summary stripped');
    check(!json.includes('"AS"'), 'patient initials stripped');
    check(!json.includes('Dr Alice Example'), 'staff-by-name row stripped');
    check(!json.includes('Dr Example'), 'waiting-room staff name stripped');
    check(!('triage' in snap), 'public snapshot omits triage inbox');
    check(!('pressure' in snap), 'public snapshot omits PPI');
    check(!('slots' in snap), 'public snapshot omits slot remainder');
    check(!('activity' in snap), 'public snapshot omits activity');
    check(forbiddenSnapshotKeys(snap).length === 0, 'no forbidden keys on public snapshot');
    check(Array.isArray(snap.ticker) && snap.ticker.length > 0, 'ticker lines built');
    check(
      snap.ticker.every((line) => !/Alice|Bob|Cara|Dee|Evan|antibiotics|chest pain/i.test(line)),
      'ticker lines carry no fixture PII'
    );
    check(
      snap.ticker.every((line) => !/medical|admin request/i.test(line)),
      'public snapshot ticker omits request volume'
    );
    check(snap.demand.medical === 28 && snap.demand.admin === 14, 'demand totals copied');
    check(snap.tempo === 'steady', 'public demo room is steady, not busy-from-demand');
    const demandSnap = buildSnapshot(streams, { nowMs: NOW, audience: 'public', publicCountsRequests: true });
    check(demandSnap.tempo === 'busy', 'public tempo can count requests when the practice turns that on');
    check(snap.tempoLabel === 'Normal', 'public tempo word is Normal, not Steady');
    check(tempoLabelFor('steady', 'public') === 'Normal', 'public helper maps Steady to Normal');
    check(tempoLabelFor('steady', 'staff') === 'Steady', 'staff helper keeps Steady');
    check(PUBLIC_TEMPO_LABEL.steady === 'Normal' && TEMPO_LABEL.steady === 'Steady', 'label maps stay split');
  }

  console.log('\n--- staff snapshot is still aggregate-only ---');
  {
    const streams = demoStreams(NOW);
    const snap = buildSnapshot(streams, {
      nowMs: NOW,
      audience: 'staff',
      ppi: { ppi: 42, band: 'AMBER' },
    });
    const json = JSON.stringify(snap);
    check(snap.audience === 'staff', 'staff audience stamped');
    check(
      snap.tempoLabel === 'Steady' ||
        snap.tempoLabel === 'Busy' ||
        snap.tempoLabel === 'Very busy' ||
        snap.tempoLabel === 'Quiet',
      'staff tempo word is not Normal'
    );
    check(snap.tempoLabel !== 'Normal', 'staff snapshot does not use the public Normal word');
    check(snap.triage.total === 9 && snap.triage.urgent === 1, 'triage counts copied');
    check(snap.slots.total === 24 && snap.slots.am === 6, 'slot totals copied');
    check(snap.activity.consultations === 41, 'activity totals copied');
    check(snap.pressure.ppi === 42 && snap.pressure.band === 'AMBER', 'ppi attached');
    check(!json.includes('Alice Smith'), 'staff snapshot still has no patient names');
    check(!json.includes('Wants antibiotics'), 'staff snapshot still has no summaries');
    check(!json.includes('Dr Alice Example'), 'staff snapshot does not list clinicians by name');
    check(forbiddenSnapshotKeys(snap).length === 0, 'no forbidden keys on staff snapshot');
    check(
      snap.ticker.some((line) => /triage inbox/.test(line)),
      'staff ticker mentions the inbox'
    );
  }

  console.log('\n--- ticker + thresholds ---');
  {
    const t = sanitiseThresholds({ amberWaitMin: 99, redWaitMin: 1 });
    check(t.amberWaitMin === 10 && t.redWaitMin === 20, 'inverted wait pair falls back');
    const lines = buildTickerLines({
      audience: 'public',
      tempo: 'steady',
      tempoLabel: 'Normal',
      waiting: { count: 1, band: 'Most waits are under 10 minutes' },
      demand: { medical: 1, admin: 0 },
    });
    check(lines.includes('1 person waiting'), 'singular waiting line');
    check(lines.includes('This room is normal'), 'public ticker names the room, not the practice');
    check(!lines.some((line) => /medical|admin request/i.test(line)), 'public ticker omits request volume');
    check(!lines.some((line) => /Most waits|under \d+ minutes/i.test(line)), 'public ticker omits wait-band minutes');
    const staffLines = buildTickerLines({
      audience: 'staff',
      tempo: 'busy',
      tempoLabel: 'Busy',
      waiting: { count: 1, band: 'Most waits are under 10 minutes' },
      demand: { medical: 1, admin: 0 },
    });
    check(staffLines.includes('Most waits are under 10 minutes'), 'staff ticker may keep the wait band');
    check(staffLines.includes('1 medical request today'), 'staff ticker keeps singular medical line');
    check(staffLines.includes('The practice is busy'), 'staff ticker may name the practice');
    const empty = buildTickerLines({
      audience: 'public',
      tempo: 'quiet',
      waiting: { count: 0 },
    });
    check(empty.includes('No one waiting'), 'zero waiting is a sentence, not a count');
    check(feedIsDegraded({ errors: ['timeout'] }), 'errors mark the feed degraded');
    check(!feedIsDegraded({ errors: [] }), 'empty errors is a live feed');
    check(!feedIsDegraded(null), 'missing snapshot is not degraded');
  }

  console.log('\n--- snapshot leaf walker ---');
  {
    const leaves = snapshotLeaves({ a: 1, b: { c: 'x' } });
    check(
      leaves.some((l) => l.path === 'a' && l.value === 1) && leaves.some((l) => l.path === 'b.c' && l.value === 'x'),
      'walks nested values'
    );
  }

  console.log('\n--- renderer must not reach into raw streams ---');
  {
    const renderer = fs.readFileSync(path.join(__dirname, 'board', 'board.js'), 'utf8');
    check(!/patientName/.test(renderer), 'board.js never mentions patientName');
    check(!/\.appointments/.test(renderer), 'board.js does not walk waitingRoom.appointments');
    check(!/\.summary/.test(renderer), 'board.js does not read request summaries');
    check(renderer.includes('buildSnapshot'), 'board.js paints via buildSnapshot');
    check(renderer.includes('failTitle'), 'public dead feed paints practice fail copy');
    check(!renderer.includes('Not a promise for you'), 'public tile does not lecture about promises');
    check(!renderer.includes('suite.waitingRoom.thresholds'), 'Note owns its own wait thresholds');
    check(renderer.includes('Live figures failed'), 'fail-loud chrome does not say Showing live');
    check(renderer.includes('pressureSub'), 'pressure tile uses practice caption');
    check(renderer.includes('tempoSubSteady'), 'public tempo uses practice subtitle');
    check(renderer.includes('confirmStaffProfile'), 'Ops open from a public profile confirms');
    const css = fs.readFileSync(path.join(__dirname, 'board', 'board.css'), 'utf8');
    check(
      /note-fail-body[\s\S]*?font-size:\s*clamp\(22px,\s*2\.8vw,\s*36px\)/.test(css),
      'fail-loud body matches Please ask reception size'
    );
    check(css.includes('.note-body.is-fullscreen .note-chrome'), 'fullscreen hides setup chrome by default');
    check(
      css.includes(".note-body.is-fullscreen[data-style='service'] .note-chrome") &&
        css.includes(".note-body.is-fullscreen[data-style='notice'] .note-chrome"),
      'Service and Notice keep the masthead in fullscreen'
    );
    check(
      css.includes(".note-body.is-fullscreen[data-style='service'] .note-chrome-actions") &&
        css.includes(".note-body.is-fullscreen[data-style='notice'] .note-chrome-actions"),
      'Service and Notice hide only the setup buttons in fullscreen'
    );
    const plain = fs.readFileSync(path.join(__dirname, 'board', 'styles', 'plain.css'), 'utf8');
    const lobby = fs.readFileSync(path.join(__dirname, 'board', 'styles', 'lobby.css'), 'utf8');
    const plaque = fs.readFileSync(path.join(__dirname, 'board', 'styles', 'plaque.css'), 'utf8');
    check(plain.includes(':has(.note-board-fail)') && plain.includes('#9b1c1c'), 'Plain dead feed floods the page');
    check(lobby.includes(':has(.note-board-fail)') && lobby.includes('#9f1239'), 'Lobby dead feed floods the page');
    check(plaque.includes(':has(.note-board-fail)') && plaque.includes('#8a1420'), 'Plaque dead feed floods the wall');
    const companion = fs.readFileSync(path.join(__dirname, 'side-panel', 'modules', 'board', 'board.js'), 'utf8');
    check(!/patientName/.test(companion), 'companion never mentions patientName');
    check(companion.includes('Do not type patient names'), 'companion warns against names on the flap');
    check(companion.includes('This text goes on the staff-room board.'), 'staff flap warning names the staff room');
    check(companion.includes('Add a public board'), 'practice can add a public board');
    check(companion.includes('Add a staff board'), 'practice can add a staff board');
    check(companion.includes('Words on the board'), 'practice can edit the words');
    check(companion.includes('You will be asked to confirm'), 'Ops confirm is named on the companion');
    check(companion.includes('plugged into the TV'), 'companion names the computer on the TV');
    check(companion.includes('Open it anyway?'), 'companion confirms before opening a staff board');
    check(companion.includes('When this room looks busy'), 'companion exposes wait and busy thresholds');
    check(companion.includes('data-th="amberWaitMin"'), 'practice can set the wait-band minutes');
    check(companion.includes('data-th="busyWaiting"'), 'practice can set when the room reads Busy');
    check(companion.includes('noteModPublicDemand'), 'practice can let public TVs count requests');
    check(companion.includes('Style of the board'), 'companion exposes the style picker');
    check(companion.includes('data-look='), 'companion writes the chosen style');
    check(companion.includes('Colour of Standard'), 'companion exposes Standard colours');
    check(companion.includes('data-colour='), 'companion writes the chosen colour');
    check(
      DEFAULT_CONFIG.styleId && DEFAULT_CONFIG.profiles.every((p) => !Object.hasOwn(p, 'styleId')),
      'one style for the whole practice, not per board'
    );
    check(renderer.includes('dataset.style'), 'kiosk applies the chosen style');
    check(renderer.includes('dataset.colour'), 'kiosk applies the chosen colour');
    check(renderer.includes('youtubeEmbedUrl'), 'kiosk builds the playlist iframe from the sanitised helper');
    check(renderer.includes('function ensureYtPane'), 'kiosk keeps the playlist iframe across poll ticks');
    check(renderer.includes('ytFrame.src === src'), 'kiosk leaves an unchanged player alone');
    check(renderer.includes('note-yt'), 'kiosk paints the playlist pane');
    check(
      !/iframe[\s\S]{0,400}youtubeListId/.test(renderer),
      'kiosk never interpolates the raw playlist field into an iframe'
    );
    check(!renderer.includes('youtube.com/embed'), 'kiosk does not embed youtube.com');
    const failFn = renderer.slice(
      renderer.indexOf('function failLoudHtml'),
      renderer.indexOf('function wantsYoutubePane')
    );
    check(!failFn.includes('note-yt') && !failFn.includes('youtube'), 'fail-loud HTML has no playlist player');
    const ioSrc = fs.readFileSync(path.join(__dirname, 'shared', 'io', 'board-io.js'), 'utf8');
    const coreSrc = fs.readFileSync(path.join(__dirname, 'board', 'board-core.js'), 'utf8');
    const listRe = 'YOUTUBE_LIST_RE = /^[A-Za-z0-9_-]{10,80}$/';
    check(coreSrc.includes(listRe) && ioSrc.includes(listRe), 'playlist id regex is locked across core and import IO');
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));
    check(
      manifest.content_security_policy.extension_pages.includes("frame-src 'self' https://www.youtube-nocookie.com"),
      'CSP allows youtube-nocookie iframes and keeps extension-page frames'
    );
    check(!(manifest.host_permissions || []).some((p) => /youtube/i.test(p)), 'YouTube is not a host permission');
    check(companion.includes('YouTube playlist'), 'companion exposes the playlist field');
    check(companion.includes('This plays on a public TV'), 'companion warns the playlist is for a public TV');
    check(companion.includes('starts muted'), 'companion says the TV starts muted');
    check(companion.includes('noteModYoutube'), 'companion writes the playlist field');
    check(companion.includes("That's not a YouTube playlist link"), 'companion names a bad playlist paste');
    check(companion.includes('music or TV licence'), 'companion names the waiting-room licence');
    const html = fs.readFileSync(path.join(__dirname, 'board.html'), 'utf8');
    for (const style of BOARD_STYLES.filter((s) => s.id !== 'standard')) {
      check(html.includes(`board/styles/${style.id}.css`), `kiosk loads ${style.id}.css`);
      const sheet = fs.readFileSync(path.join(__dirname, 'board', 'styles', `${style.id}.css`), 'utf8');
      check(
        sheet.includes(`[data-style='${style.id}']`) || sheet.includes(`[data-style="${style.id}"]`),
        `${style.id} CSS is scoped to its style`
      );
    }
    for (const colour of BOARD_COLOURS) {
      check(html.includes(`board/styles/${colour.id}.css`), `kiosk loads colour ${colour.id}.css`);
      const sheet = fs.readFileSync(path.join(__dirname, 'board', 'styles', `${colour.id}.css`), 'utf8');
      check(
        sheet.includes(`[data-colour='${colour.id}']`) || sheet.includes(`[data-colour="${colour.id}"]`),
        `${colour.id} CSS is scoped to Standard + that colour`
      );
    }
  }

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(`  FAIL  could not load board-core.js: ${e && e.stack ? e.stack : e}`);
  process.exit(1);
});
