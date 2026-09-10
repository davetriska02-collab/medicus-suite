// Source lock: suite.discoveredAllPatientUrls is capped at 50, matching
// the journal-template CAP (api-discovery.js storeJournalUrl).
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'content-scripts/api-discovery.js'), 'utf8');

const storeUrl = src.match(/function storeUrl\([\s\S]*?\n\}/);
assert(storeUrl, 'storeUrl function found');
assert(/const CAP = 50/.test(storeUrl[0]), 'storeUrl defines CAP = 50');
assert(/ALL_URLS_KEY/.test(storeUrl[0]), 'storeUrl writes ALL_URLS_KEY');
assert(/\.slice\(-CAP\)/.test(storeUrl[0]), 'storeUrl caps the listing URL array with slice(-CAP)');

console.log('test-api-discovery-cap: ok');
