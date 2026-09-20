// Medicus Suite — tidy write-core (W9 vs W19) executable tests
// Run with: node test-tidy-write-core.js
'use strict';

const Tidy = require('./shared/tidy-write-core.js');
const panel = require('./content-scripts/problem-description-cleanup.js');

let passed = 0,
  failed = 0;
function check(cond, msg) {
  if (cond) {
    console.log(`  OK  ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL  ${msg}`);
    failed++;
  }
}

const prefill = {
  onsetDate: '2012-01-01',
  contextId: 'ctx',
  contextType: 'problem',
  significance: { label: 'Significant', value: 'significant' },
  episode: { label: 'First', value: 'first' },
  additionalInformation: 'note',
  hiddenFromPatientFacingServices: false,
  confidentialFromThirdParties: false,
  endDate: null,
  reasonEnded: null,
  recordDate: '2012-01-02',
  recordedAtAnotherOrganisation: false,
  recordedByStaff: { label: 'Dr A', value: 'staff-1' },
};

console.log('--- W9 buildEditProblemPayload ---');
{
  const p = Tidy.buildEditProblemPayload(prefill, { conceptId: '123', description: 'Asthma' });
  check(p.problemCode.conceptId === '123', 'W9 writes the supplied problemCode');
  check(p.significance === 'significant', 'W9 unwraps significance option');
  check(p.recordedByStaff === 'staff-1', 'W9 unwraps recordedByStaff');
  check(!('recordedByOrganisation' in p), 'W9 local author has no org field');
  const onset = Tidy.buildEditProblemPayload(prefill, p.problemCode, undefined, '2010-06-01');
  check(onset.onsetDate === '2010-06-01', 'optional 4th arg overrides onset only');
  const info = Tidy.buildEditProblemPayload(prefill, p.problemCode, 'stripped');
  check(info.additionalInformation === 'stripped', 'optional 3rd arg overrides additionalInformation');
}

console.log('--- W9 GP2GP wrapped organisation ---');
{
  const gp2gp = Object.assign({}, prefill, {
    recordedAtAnotherOrganisation: true,
    recordedByOrganisation: {
      label: 'Park Road Surgery',
      value: {
        organisationName: 'Park Road Surgery',
        organisationIdentifierType: 'nhs-england-ods-code',
        organisationIdentifierValue: 'H84002',
      },
    },
    recordedByPractitioner: 'Dr B',
  });
  const p = Tidy.buildEditProblemPayload(gp2gp, { conceptId: '1' });
  check(p.recordedByOrganisation.organisationName === 'Park Road Surgery', 'W9 unwraps {label,value} org');
  check(!p.recordedByOrganisation.label, 'W9 does not round-trip the wrapper label');
  check(p.recordedByPractitioner === 'Dr B', 'W9 keeps practitioner');
  check(!('recordedByStaff' in p), 'W9 other-org path has no recordedByStaff');
}

console.log('--- W19 buildChangeNotePayload ---');
{
  const notePrefill = {
    noteId: 'n1',
    note: 'journal text',
    hiddenFromPatientFacingServices: true,
    confidentialFromThirdParties: false,
    flagOnPatientBanner: false,
    recordedByOrganisation: {
      label: 'Park Road Surgery',
      value: { organisationName: 'Park Road Surgery' },
    },
    recordedByPractitioner: null,
    recordedByStaff: 'staff-9',
    recordDate: '2020-01-01',
    flags: ['f1'],
    linkedClinicalCase: { defaultClinicalCaseId: 'case-1' },
    linkedProblemIds: ['p1'],
  };
  const p = Tidy.buildChangeNotePayload(notePrefill, {
    description: 'Asthma',
    conceptId: '195967001',
    descriptionId: 'd1',
  });
  check(p.noteId === 'n1' && p.note === 'journal text', 'W19 keeps note id and text');
  check(p.noteSNOMEDct.conceptId === '195967001', 'W19 writes the problem code onto the note');
  check(p.recordedByOrganisation.organisationName === 'Park Road Surgery', 'W19 unwraps org the same way as W9');
  check(p.clinicalCaseId === 'case-1', 'W19 reads defaultClinicalCaseId');
  check(p.linkedProblemIds[0] === 'p1', 'W19 resends linked problems');
  check(p.hiddenFromPatientFacingServices === true, 'W19 resends hidden flag');
}

console.log('--- W9 vs W19 stay separate ---');
{
  const w9 = Tidy.buildEditProblemPayload(prefill, { conceptId: '1' });
  const w19 = Tidy.buildChangeNotePayload({ noteId: 'n', note: 'x' }, { conceptId: '1' });
  check('problemCode' in w9 && !('noteSNOMEDct' in w9), 'W9 payload is edit-problem shaped');
  check('noteSNOMEDct' in w19 && !('problemCode' in w19), 'W19 payload is change-note shaped');
}

console.log('--- problem-description-cleanup re-exports the same builders ---');
check(typeof panel.buildEditProblemPayload === 'function', 'cleanup still exports buildEditProblemPayload');
check(typeof panel.buildChangeNotePayload === 'function', 'cleanup still exports buildChangeNotePayload');
{
  const a = Tidy.buildEditProblemPayload(prefill, { conceptId: '9' });
  const b = panel.buildEditProblemPayload(prefill, { conceptId: '9' });
  check(JSON.stringify(a) === JSON.stringify(b), 'cleanup W9 builder matches tidy-write-core');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
