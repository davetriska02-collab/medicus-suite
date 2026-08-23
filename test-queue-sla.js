// Queue SLA / contract-clock chips (Northstar A1).
// Run with: node test-queue-sla.js
'use strict';

const S = require('./content-scripts/triage-lens/queue-sla.js');

let passed = 0,
  failed = 0;
function check(cond, msg) {
  if (cond) {
    console.log('  OK  ' + msg);
    passed++;
  } else {
    console.error('  FAIL  ' + msg);
    failed++;
  }
}

const now = new Date(2026, 7, 24, 10, 30, 0); // Mon 24 Aug 2026 10:30

console.log('Layer 1: parseCreated');
{
  const d = S.parseCreated('23 Aug 2026 09:12', now);
  check(!!d && d.getDate() === 23 && d.getHours() === 9 && d.getMinutes() === 12, 'parses date + time');
  check(S.parseCreated('23 Aug 2026', now) instanceof Date, 'parses date-only');
  check(S.parseCreated('23 Aug 2026, 14:05', now) instanceof Date, 'parses date, time');
  check(S.parseCreated('not a date', now) === null, 'unparseable → null');
  check(S.parseCreated('25 Aug 2026 09:00', now) === null, 'future timestamp fails closed');
}

console.log('\nLayer 2: urgent same-day / overdue');
{
  const created = new Date(2026, 7, 24, 9, 12, 0);
  const chip = S.composeSlaChip({ priority: 'Urgent', created: created, now: now, isRequestQueue: true });
  check(chip && chip.family === 'sla', 'urgent chip is family sla (never owns the rail)');
  check(chip.state === 'today', 'same-day urgent is due today');
  check(chip.kind === 'amber', 'same-day urgent is amber, not a clinical red');
  check(/must action today/i.test(chip.label), 'label says must action today');
  check(/09:12/.test(chip.label) || /09:12/.test(chip.title), 'received clock is named');
  check(/unvalidated intake flag/.test(chip.title), 'title names the flag as unvalidated');
  check(!/fine|all-clear|low risk/i.test(chip.title + chip.label), 'no reassuring copy');
}

{
  const created = new Date(2026, 7, 23, 16, 2, 0); // Sunday
  const chip = S.composeSlaChip({ priority: 'High', created: created, now: now });
  check(chip.state === 'overdue', 'yesterday urgent is overdue');
  check(chip.kind === 'red', 'overdue urgent is red (contract clock, not a clinical grade)');
  check(/overdue/.test(chip.label), 'overdue label');
}

console.log('\nLayer 3: routine — source named, never “tomorrow is fine”');
{
  const created = new Date(2026, 7, 24, 9, 0, 0);
  const chip = S.composeSlaChip({ priority: 'Routine', created: created, now: now });
  check(chip.state === 'tomorrow', 'Mon routine is due EOD Tuesday');
  check(chip.kind === 'info', 'in-window routine is info, not green');
  check(/due EOD tomorrow/.test(chip.label), 'label is due EOD tomorrow');
  check(/intake-flagged routine/.test(chip.title), 'title states the source');
  check(/not “tomorrow is fine”/.test(chip.title), 'title refuses the safety reading');
}

{
  const fri = new Date(2026, 7, 21, 11, 0, 0); // Fri 21 Aug
  const sat = new Date(2026, 7, 22, 10, 0, 0);
  const chip = S.composeSlaChip({ priority: 'Routine', created: fri, now: sat });
  check(chip.state === 'tomorrow' || chip.due.getDay() === 1, 'Fri routine due Mon (skip weekend)');
}

{
  const created = new Date(2026, 7, 20, 9, 0, 0); // Thu
  const chip = S.composeSlaChip({ priority: 'Routine', created: created, now: now });
  check(chip.state === 'overdue', 'Thu routine is overdue by Monday');
  check(chip.kind === 'amber', 'overdue routine is amber — escalate, never green');
}

console.log('\nLayer 4: fail-visible / gates');
{
  const unknown = S.composeSlaChip({ priority: undefined, created: now, now: now });
  check(unknown && unknown.state === 'unknown', 'missing priority is fail-visible unknown');
  check(/unreadable/.test(unknown.title), 'unknown names the unreadability');
  check(
    S.composeSlaChip({ priority: 'Urgent', created: now, now: now, isRequestQueue: false }) === null,
    'results queue: no SLA chip'
  );
  check(
    S.composeSlaChip({ priority: '', created: now, now: now }).state !== 'unknown',
    'empty-string priority is readable (routine)'
  );
}

console.log('\n--- Results: ' + passed + ' passed, ' + failed + ' failed ---\n');
if (failed > 0) process.exit(1);
