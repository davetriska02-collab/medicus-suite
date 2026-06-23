// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// GP Forge — output validation tests. Run: node test/test-validate.js

import { harness } from './helpers.js';
import { parseJson, validateAdminDraft } from '../src/validate.js';

const { check, finish } = harness();

check(parseJson('{"a":1}').ok === true, 'parseJson accepts valid JSON');
check(parseJson('not json').ok === false, 'parseJson rejects invalid JSON');

const good = validateAdminDraft({ title: 'Invitation', body: 'Dear [PATIENT NAME], please contact [PRACTICE NAME].', placeholders: ['[PATIENT NAME]', '[PRACTICE NAME]'] });
check(good.ok === true, 'well-formed administrative draft validates');

check(validateAdminDraft({ title: '', body: 'x', placeholders: [] }).ok === false, 'empty title rejected');
check(validateAdminDraft({ title: 'T', body: 'ok', placeholders: 'nope' }).ok === false, 'non-array placeholders rejected');
check(validateAdminDraft(null).ok === false, 'non-object rejected');

const leak = validateAdminDraft({ title: 'T', body: 'You should start 5mg of the medication twice daily.', placeholders: [] });
check(leak.ok === false, 'clinical-advice leakage into an admin draft is rejected (format-not-facts defence in depth)');

finish();
