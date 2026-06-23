// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// GP Forge — Phase-1 scope guard tests. Run: node test/test-phase1-guard.js

import { harness } from './helpers.js';
import { guardRequest, buildPrompt, SYSTEM_PROMPT } from '../src/phase1.js';

const { check, finish } = harness();

check(guardRequest({ task: 'admin_draft', context: { kind: 'recall', freeText: 'invite eligible patients to the seasonal flu clinic' } }).ok === true,
  'admin_draft with administrative context is allowed');

const clinical = guardRequest({ task: 'admin_draft', context: 'please diagnose this rash and suggest treatment' });
check(clinical.ok === false && clinical.code === 'clinical_intent', 'clinical-advice request is refused (clinical_intent)');

const prescribe = guardRequest({ task: 'admin_draft', context: { freeText: 'what antibiotic should I prescribe for this UTI?' } });
check(prescribe.ok === false && prescribe.code === 'clinical_intent', 'prescribing request is refused');

const wrongTask = guardRequest({ task: 'clinical_summary', context: 'summarise this consultation' });
check(wrongTask.ok === false && wrongTask.code === 'out_of_scope_task', 'non-allowlisted task is refused (out_of_scope_task)');

check(guardRequest({}).ok === false, 'missing task is refused');

check(typeof buildPrompt({ kind: 'recall', context: { a: 1 } }) === 'string'
  && buildPrompt({ kind: 'recall', context: {} }).includes('recall'),
  'buildPrompt returns a string mentioning the kind');

check(SYSTEM_PROMPT.includes('NON-CLINICAL'), 'system prompt asserts NON-CLINICAL scope');

finish();
