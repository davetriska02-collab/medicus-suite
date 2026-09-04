// Medicus Suite — UK bank-holiday calendar tests
// Run with: node test-uk-calendar.js

'use strict';

const path = require('path');
const { pathToFileURL } = require('url');
const { spawnSync } = require('child_process');

(async () => {
  let passed = 0,
    failed = 0;
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

  const calPath = pathToFileURL(path.join(__dirname, 'shared', 'uk-calendar.js')).href;
  const {
    DIVISIONS,
    DEFAULT_DIVISION,
    MIN_HORIZON_MONTHS,
    isBankHoliday,
    isWeekend,
    isWorkingDay,
    firstWorkingDayAfter,
    nextWorkingDayISO,
    holidayBlockContaining,
    closedBlockBefore,
    calendarHorizonISO,
    calendarCoversISO,
    monthsUntilHorizon,
    defaultBankHolidays,
    bankHolidayDates,
  } = await import(calPath);

  console.log('--- divisions / meta ---');
  check(DEFAULT_DIVISION === 'england-and-wales', 'default division is england-and-wales');
  check(DIVISIONS.includes('scotland') && DIVISIONS.includes('northern-ireland'), 'all three divisions listed');
  check(typeof MIN_HORIZON_MONTHS === 'number' && MIN_HORIZON_MONTHS >= 9, 'MIN_HORIZON_MONTHS ≥ 9');

  console.log('\n--- isBankHoliday / isWorkingDay ---');
  check(isBankHoliday('2026-05-25'), 'Spring bank holiday 2026-05-25 recognised');
  check(!isBankHoliday('2026-05-26'), 'day after Spring BH is not a BH');
  check(isWeekend('2026-05-23') && isWeekend('2026-05-24'), 'weekend detection');
  check(!isWorkingDay('2026-05-25'), 'BH Monday is not a working day');
  check(isWorkingDay('2026-05-26'), 'Tue after Spring BH is a working day');
  check(bankHolidayDates('scotland').length > 0, 'scotland division has events');
  check(bankHolidayDates('northern-ireland').length > 0, 'northern-ireland division has events');
  // Scotland summer bank holiday is first Monday in August, not last — different from E&W
  check(
    isBankHoliday('2026-08-03', 'scotland') && !isBankHoliday('2026-08-03', 'england-and-wales'),
    'Scotland 2026-08-03 Summer BH is not an E&W holiday'
  );

  console.log('\n--- firstWorkingDayAfter / blocks ---');
  // Mon BH 2026-05-25 → first working day Tue 2026-05-26
  check(firstWorkingDayAfter('2026-05-25') === '2026-05-26', 'after Spring BH → Tuesday');
  check(
    firstWorkingDayAfter('2026-05-22') === '2026-05-26',
    'Friday before Spring BH weekend → Tuesday (skips Sat/Sun/Mon BH)'
  );

  // Christmas 2026: Fri 25 Dec BH, Sat 26, Sun 27, Mon 28 Boxing Day substitute → Tue 29
  check(isBankHoliday('2026-12-25') && isBankHoliday('2026-12-28'), 'Christmas + Boxing Day substitute 2026');
  check(firstWorkingDayAfter('2026-12-24') === '2026-12-29', 'Thu 24 Dec → first working day Tue 29 Dec');
  check(firstWorkingDayAfter('2026-12-25') === '2026-12-29', 'Christmas Day → Tue 29 Dec');

  const xmasBlock = holidayBlockContaining('2026-12-26');
  check(!!xmasBlock, 'holidayBlockContaining on Sat in Xmas block');
  check(xmasBlock && xmasBlock.start === '2026-12-25' && xmasBlock.end === '2026-12-28', 'Xmas block Fri–Mon');
  check(xmasBlock && xmasBlock.bankHolidays.length === 2, 'Xmas block has 2 bank holidays');
  check(xmasBlock && xmasBlock.closedDays === 4, 'Xmas block is 4 closed days');

  const rebound = closedBlockBefore('2026-12-29');
  check(!!rebound && rebound.end === '2026-12-28', 'closedBlockBefore Tue 29 points at Xmas block');
  check(closedBlockBefore('2026-05-27') === null, 'normal Wed has no closed block before it');

  // Easter 2026: Good Friday 3 Apr, Easter Monday 6 Apr → Tue 7 Apr
  check(firstWorkingDayAfter('2026-04-02') === '2026-04-07', 'Thu before Good Friday → Tue after Easter Monday');

  console.log('\n--- nextWorkingDayISO ---');
  // Pin fromISO so the test is deterministic regardless of "today"
  check(nextWorkingDayISO('england-and-wales', '2026-05-22') === '2026-05-26', 'nextWorkingDayISO from Fri before BH');
  check(
    nextWorkingDayISO('england-and-wales', '2026-05-26') === '2026-05-27',
    'nextWorkingDayISO from a normal Tue → Wed'
  );

  console.log('\n--- horizon / defaults ---');
  const horizon = calendarHorizonISO();
  check(typeof horizon === 'string' && horizon >= '2027-01-01', `horizon reaches at least 2027 (got ${horizon})`);
  check(
    monthsUntilHorizon() >= MIN_HORIZON_MONTHS,
    `monthsUntilHorizon ≥ ${MIN_HORIZON_MONTHS} (got ${monthsUntilHorizon()})`
  );
  const defaults = defaultBankHolidays();
  check(defaults.includes('2026-05-25'), 'defaultBankHolidays includes Spring BH 2026');
  check(defaults.includes('2028-12-26'), 'defaultBankHolidays extends through 2028 Boxing Day');
  check(
    defaults.every((d) => d >= `${new Date().getFullYear()}-01-01`),
    'defaultBankHolidays starts at current year'
  );

  console.log('\n--- regen --check ---');
  const checkRun = spawnSync(process.execPath, ['scripts/regen-bank-holidays.js', '--check'], {
    cwd: __dirname,
    encoding: 'utf8',
  });
  console.log('\n--- calendarCoversISO ---');
  const covHorizonYear = calendarHorizonISO().slice(0, 4);
  check(calendarCoversISO(`${covHorizonYear}-06-15`) === true, 'a date inside the last bundled year is covered');
  check(calendarCoversISO(`${covHorizonYear}-12-31`) === true, 'the last bundled year-end is covered');
  check(
    calendarCoversISO(`${Number(covHorizonYear) + 1}-01-01`) === false,
    'the day after the last bundled year is NOT covered'
  );
  check(calendarCoversISO('2020-01-01') === true, 'an early bundled year is covered');
  check(calendarCoversISO('not-a-date') === false, 'junk is not covered');
  check(
    isBankHoliday(`${Number(covHorizonYear) + 1}-01-01`) === false,
    'isBankHoliday alone still answers "no" past the horizon — which is why callers must check coverage'
  );

  check(checkRun.status === 0, `regen-bank-holidays.js --check exits 0 (status ${checkRun.status})`);
  if (checkRun.status !== 0) {
    console.error(checkRun.stdout || '');
    console.error(checkRun.stderr || '');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
