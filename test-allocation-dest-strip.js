// Medicus Suite — dest-set strip HTML tests
'use strict';

const S = require('./shared/allocation-dest-strip.js');

let passed = 0;
let failed = 0;
function check(cond, msg) {
  if (cond) {
    console.log('  OK  ' + msg);
    passed++;
  } else {
    console.error('  FAIL  ' + msg);
    failed++;
  }
}

const html = S.destSetStripHtml({
  destKind: 'group',
  destGroupId: 'aaaaaaaa-bbbb-cccc-dddd-000000000001',
  inTodayCount: 4,
  visibleGroups: [{ id: 'aaaaaaaa-bbbb-cccc-dddd-000000000001', name: 'Morning triage' }],
  destPhrase: 'Dr Dave Triska and Dr Sarah Chen',
  skippedPhrase: 'Dr Tom Hale is away — skipped.',
  canSave: true,
});

check(/ms-ags-in-today/.test(html), 'Working today chip keeps #ms-ags-in-today');
check(/Working today \(4\)/.test(html), 'Working today chip shows the book count');
check(/Everyone with a session on the appointment book for that day/.test(html), 'Working today title names the book');
check(/<button type="button"[^>]*id="ms-ags-new-group"/.test(html), 'New group is a button');
check(/aria-pressed="true"/.test(html), 'selected chips carry aria-pressed');
check(/✓ Morning triage/.test(html), 'selected chip has a check glyph');
check(/Every saved group, including ones outside their hours/.test(html), 'All groups title lists hours rename delete');
check(/Morning triage/.test(html), 'visible group chip');
check(/ms-ags-new-group/.test(html), 'New group well');
check(/All groups/.test(html), 'All groups overflow');
check(/Save as group/.test(html), 'Save as group when custom');
check(/To: Dr Dave Triska/.test(html), 'names destinations');
check(/away — skipped/.test(html), 'names skipped away people');
check(!/\b(Done|Sent|Allocated|Submitted)\b/.test(html), 'copy ban');

const actions = S.splitActionsHtml({
  destCount: 2,
  poolN: 5,
  haveWork: false,
  destPhrase: 'Dr A and Dr B',
  dayPhrase: 'today',
});
check(/Split equally/.test(actions), 'unallocated pile and dests → Split equally');
check(!/Distribute equally/.test(actions), 'Distribute equally is not the default when dests have no sitting work');

const counted = S.destSetStripHtml({
  destKind: 'group',
  destGroupId: 'aaaaaaaa-bbbb-cccc-dddd-000000000001',
  visibleGroups: [
    {
      id: 'aaaaaaaa-bbbb-cccc-dddd-000000000001',
      name: 'Morning triage',
      memberIds: ['a', 'b', 'c'],
    },
  ],
});
check(/Morning triage \(3\)/.test(counted), 'group chip shows headcount');

const morningPreset = {
  id: 'aaaaaaaa-bbbb-cccc-dddd-000000000001',
  name: 'Morning triage',
  memberIds: ['a', 'b', 'c'],
  schedule: { days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '08:00', end: '13:00' },
};
const timed = S.destSetStripHtml({
  destKind: 'group',
  destGroupId: morningPreset.id,
  visibleGroups: [morningPreset],
});
check(/Morning triage \(3\) \u00b7 08:00\u201313:00/.test(timed), 'group chip with a complete window shows hours');
check(
  S.groupChipLabel(morningPreset) === 'Morning triage (3) \u00b7 08:00\u201313:00',
  'groupChipLabel is name (n) · HH:MM–HH:MM'
);
check(
  S.groupChipTitle(morningPreset) === 'Mon, Tue, Wed, Thu, Fri. Split onto the people in this group.',
  'group chip title still explains days'
);
check(
  S.destFlagLabel({ destKind: 'group', destGroupName: 'Morning triage' }) === 'Morning triage',
  'dest flag for a named group is the group name'
);
check(S.destFlagLabel({ destKind: 'in-today' }) === 'Working today', 'dest flag for Working today stays Working today');
check(
  S.destFlagLabel({ destKind: 'in-today', workDateISO: '2026-09-08', calendarTodayISO: '2026-09-07' }) ===
    'Working 8 Sep',
  'dest flag for a dated Working today is Working d MMM'
);

const hostile = S.destSetStripHtml({
  destKind: 'group',
  destGroupId: 'aaaaaaaa-bbbb-cccc-dddd-000000000001',
  visibleGroups: [
    {
      id: 'aaaaaaaa-bbbb-cccc-dddd-000000000001',
      name: 'x" onmouseover="alert(1)',
    },
  ],
  destPhrase: '<script>x</script>',
  skippedPhrase: '<img src=x onerror=alert(1)>',
});
check(/&quot;/.test(hostile), 'group name quotes are escaped');
check(!/<script>/.test(hostile), 'dest phrase does not emit raw HTML');
check(!/<img /.test(hostile), 'skipped phrase does not emit raw HTML');

const clash = S.splitActionsHtml({
  destCount: 2,
  poolN: 5,
  collisionPhrase: 'Dr Jane Smith and Dr John Smith share a name — split refused.',
});
check(/share a name/.test(clash), 'collision phrase replaces Split equally');
check(!/Split equally/.test(clash), 'colliding dests do not offer Split equally');

const dated = S.destSetStripHtml({
  destKind: 'in-today',
  inTodayCount: 12,
  workDateISO: '2026-09-08',
  calendarTodayISO: '2026-09-07',
});
check(/Working 8 Sep \(12\)/.test(dated), 'working day that is not today uses d MMM');
check(/aria-pressed="true"/.test(dated), 'Working today selected is pressed');

const custom = S.destSetStripHtml({ destKind: 'custom', inTodayCount: 12 });
check(/Drag a person's name onto New group/.test(custom), 'selected New group shows the save hint');

check(
  S.evenSplitDistributionPhrase(47, 12, 'requests') === '47 requests would sit with 12 people: 11 with 4, 1 with 3.',
  '47/12 even-split phrase without titles keeps the count fallback'
);
const titles47 = [];
for (let i = 0; i < 11; i++) titles47.push('Dr ' + i);
titles47.push('Dr Tomasz Kowalski');
check(
  S.evenSplitDistributionPhrase(47, 12, 'requests', titles47) ===
    '47 requests would sit with 12 people: 11 with 4, Dr Tomasz Kowalski with 3.',
  '47/12 with dest titles names the smaller pile'
);
const countRows47 = titles47.map(function (title, i) {
  return { count: i < 11 ? 4 : 3, title: title };
});
check(
  S.evenSplitDistributionPhrase(47, 12, 'requests', countRows47) ===
    '47 requests would sit with 12 people: 11 with 4, Dr Tomasz Kowalski with 3.',
  '47/12 with {count, title} rows names the smaller pile'
);
check(
  S.evenSplitDistributionPhrase(10, 3, 'items') === '10 items would sit with 3 people: 1 with 4, 2 with 3.',
  '10/3 even-split phrase'
);
check(
  S.evenSplitDistributionPhrase(5, 5, 'items') === '5 items would sit with 5 people: 1 each.',
  '5/5 even-split phrase'
);
check(
  S.evenSplitDistributionPhrase(3, 4, 'items') === '3 items would sit with 4 people: 3 with 1, 1 with none.',
  '3/4 more people than items'
);

const proposed = S.splitActionsHtml({
  destCount: 12,
  poolN: 0,
  haveWork: true,
  stagedN: 47,
  surfaceNoun: 'requests',
  destPhrase: 'twelve people',
});
check(/Proposal, not written yet/.test(proposed), 'proposal line uses a comma, not a completion verb');
check(
  /47 requests would sit with 12 people: 11 with 4, 1 with 3/.test(proposed),
  'proposal names the even-split numbers'
);
const namedProposed = S.splitActionsHtml({
  destCount: 12,
  poolN: 0,
  haveWork: true,
  stagedN: 47,
  surfaceNoun: 'requests',
  destPhrase: 'twelve people',
  destTitles: titles47,
});
check(
  /47 requests would sit with 12 people: 11 with 4, Dr Tomasz Kowalski with 3/.test(namedProposed),
  'proposal names the remainder person when dest titles are passed'
);
check(/Drag a patient from one person onto another/.test(proposed), 'proposal keeps the drag hint');
check(/Split equally/.test(proposed), 'after a split the even-split button stays Split equally');
check(!/Distribute equally/.test(proposed), 'after a split does not rename to Distribute equally');

const emptyBook = S.splitActionsHtml({
  destCount: 0,
  destKind: 'in-today',
  inTodayCount: 0,
  poolN: 5,
});
check(
  /No one is on the book for this day\. Type a name below to add them, or pick a saved group/.test(emptyBook),
  'empty Working today dests name the book and add-a-name'
);
check(!/id="ms-ags-split"/.test(emptyBook), 'Split equally is not offered when dests.length is 0');
check(!/No people to share out to/.test(emptyBook), 'old empty-dest copy is gone');

console.log('\n--- ' + passed + ' passed, ' + failed + ' failed ---');
if (failed) process.exit(1);
