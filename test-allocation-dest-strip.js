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

check(/ms-ags-in-today/.test(html), 'In today chip');
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

console.log('\n--- ' + passed + ' passed, ' + failed + ' failed ---');
if (failed) process.exit(1);
