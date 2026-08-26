// Medicus Suite — risk-flag-cleanup-core tests
// Run with: node test-risk-flag-cleanup.js
'use strict';

const C = require('./shared/risk-flag-cleanup-core.js');

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

const snomed = { conceptId: '225337009', description: 'Suicide risk', descriptionId: '338801016' };

const wrappedOrg = {
  label: 'Imperial College Health Centre',
  value: {
    organisationName: 'Imperial College Health Centre',
    organisationIdentifierType: 'nhs-england-ods-code',
    organisationIdentifierValue: 'E87677',
  },
};

const flatOrg = {
  organisationName: 'Park Road Surgery',
  organisationIdentifierType: 'nhs-england-ods-code',
  organisationIdentifierValue: 'H84002',
};

console.log('--- unwrapRecordedByOrganisation ---');
{
  const unwrapped = C.unwrapRecordedByOrganisation(wrappedOrg);
  check(
    unwrapped && unwrapped.organisationName === 'Imperial College Health Centre',
    'wrapped org unwraps to {organisationName,…}'
  );
  check(!('label' in unwrapped) && !('value' in unwrapped), 'wrapped org has no leftover .label/.value');
  check(C.unwrapRecordedByOrganisation(flatOrg).organisationName === 'Park Road Surgery', 'flat org passes through');
  check(C.unwrapRecordedByOrganisation(flatOrg) === flatOrg, 'flat org is the same object, not org.value');
  check(C.unwrapRecordedByOrganisation(null) === null, 'null -> null, never throws');
}

console.log('\n--- buildClearBannerFlagPayload ---');
{
  const prefill = {
    noteId: 'note-1',
    note: 'Low suicide risk',
    noteSNOMEDct: snomed,
    hiddenFromPatientFacingServices: false,
    confidentialFromThirdParties: true,
    flagOnPatientBanner: true,
    recordedByOrganisation: wrappedOrg,
    recordedByPractitioner: 'Dr Jane Cole',
    recordedByStaff: 'staff-1',
    recordDate: '2024-10-30',
    flags: [{ code: 'risk-to-self' }],
    linkedClinicalCase: { defaultClinicalCaseId: 'case-1' },
    linkedProblemIds: ['p1'],
  };
  const payload = C.buildClearBannerFlagPayload(prefill);

  check(payload.flagOnPatientBanner === false, 'flagOnPatientBanner always false even if prefill true');
  check(payload.noteSNOMEDct === snomed, 'noteSNOMEDct preserved from the prefill');
  check(
    JSON.stringify(payload.recordedByOrganisation) ===
      JSON.stringify({
        organisationName: 'Imperial College Health Centre',
        organisationIdentifierType: 'nhs-england-ods-code',
        organisationIdentifierValue: 'E87677',
      }),
    'wrapped recordedByOrganisation is unwrapped in the payload'
  );
  check(JSON.stringify(C.buildClearBannerFlagPayload({ flags: undefined }).flags) === '[]', 'flags missing -> []');
  check(JSON.stringify(C.buildClearBannerFlagPayload({ flags: 'nope' }).flags) === '[]', 'non-array flags -> []');
  check(
    C.buildClearBannerFlagPayload({ flagOnPatientBanner: false }).flagOnPatientBanner === false,
    'flagOnPatientBanner stays false when prefill is already false'
  );
  check(
    C.buildClearBannerFlagPayload({
      recordedByOrganisation: flatOrg,
    }).recordedByOrganisation.organisationName === 'Park Road Surgery',
    'flat recordedByOrganisation passes through the payload builder'
  );
}

console.log('\n--- POST_KEYS ---');
{
  check(C.POST_KEYS.length === 13, 'POST_KEYS length 13');
  const keys = Object.keys(C.buildClearBannerFlagPayload({}));
  check(keys.join(',') === C.POST_KEYS.join(','), 'payload keys match POST_KEYS order');
}

console.log('\n--- visiblePendingSelected ---');
{
  const rows = [
    {
      noteId: 'a',
      status: 'pending',
      description: 'Low suicide risk',
      category: 'Risk to self',
    },
    {
      noteId: 'b',
      status: 'pending',
      description: 'Subject of MARAC',
      category: 'Risk from others',
    },
    {
      noteId: 'c',
      status: 'removed',
      description: 'Low suicide risk',
      category: 'Risk to self',
    },
    {
      noteId: 'd',
      status: 'pending',
      description: 'Reasonable adjustment',
      category: 'Reasonable adjustment',
    },
  ];
  const selected = new Set(['a', 'b', 'c', 'd']);
  const filtered = C.visiblePendingSelected(rows, selected, 'suicide');
  check(filtered.length === 1 && filtered[0].noteId === 'a', 'filter hides a selected row from the write set');
  check(
    C.visiblePendingSelected(rows, selected, '')
      .map(function (r) {
        return r.noteId;
      })
      .join(',') === 'a,b,d',
    'empty filter = all selected pending (removed row excluded)'
  );
  check(
    C.visiblePendingSelected(rows, new Set(['b']), 'suicide').length === 0,
    'a selected row that does not match the filter is not written'
  );
  check(
    C.visiblePendingSelected(rows, selected, 'RISK TO SELF').length === 1,
    'filter matches category case-insensitively'
  );
}

console.log('\n--- source locks ---');
{
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, 'content-scripts/risk-flag-cleanup.js'), 'utf8');
  const manifest = fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8');
  check(src.indexOf('window.confirm') === -1 && !/\bconfirm\s*\(/.test(src), 'no window.confirm');
  check(src.indexOf('requestBody') === -1, 'does not log requestBody');
  check(src.indexOf('style=') === -1 && src.indexOf('cssText') === -1, 'no inline style strings');
  check(src.indexOf('Core.buildClearBannerFlagPayload') !== -1, 'removeBannerFlag uses the core payload builder');
  check(src.indexOf('Core.visiblePendingSelected') !== -1, 'write set is visiblePendingSelected');
  const coreAt = manifest.indexOf('shared/risk-flag-cleanup-core.js');
  const scriptAt = manifest.indexOf('content-scripts/risk-flag-cleanup.js');
  check(coreAt !== -1 && scriptAt !== -1 && coreAt < scriptAt, 'core is in the manifest immediately before the script');
  check(manifest.indexOf('content-scripts/risk-flag-cleanup.css') !== -1, 'css is in the manifest');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
