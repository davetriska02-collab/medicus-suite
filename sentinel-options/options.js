// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Sentinel options page — v1.2.0
// Tabs: Display | Custom Rules | Rule Overrides
'use strict';

// Display preferences are applied by shared/display-prefs.js (loaded before this script).

// ── Tab navigation ────────────────────────────────────────────────────────────

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab)?.classList.add('active');
    if (btn.dataset.tab === 'customrules') { renderCrList(); ciRenderList(); }
  });
});

// ── Display tab ───────────────────────────────────────────────────────────────

const KEYS = ['sentinel.config', 'sentinel.rules', 'sentinel.orgRules'];
const BOOL_FIELDS = ['showAchieved','showNoData','showRegisterPills','showViewLabel',
  'showDataSourceLine','showDebugPanel','expandChipsByDefault','autoRefresh'];
const STR_FIELDS = ['chipStyle','density','fontSize','sidebarSide','chipSort','chipGrouping','defaultMode'];
const NUM_FIELDS = ['sidebarWidth'];

function getEl(id) { return document.getElementById(id); }
function escHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escAttr(s) { return escHtml(s).replace(/"/g,'&quot;'); }

// Returns the labels of composite rules that reference the given rule id, so
// delete handlers can warn the user before silently breaking those composites.
async function findCompositesReferencing(ruleId) {
  const r = await chrome.storage.local.get('sentinel.customRules');
  const all = r['sentinel.customRules'] || [];
  return all
    .filter(rule => rule.type === 'composite' && Array.isArray(rule.ruleIds) && rule.ruleIds.includes(ruleId))
    .map(rule => rule.label || rule.id);
}
async function confirmDeleteWithRefs(ruleId, baseMsg) {
  const refs = await findCompositesReferencing(ruleId);
  if (refs.length === 0) return confirm(baseMsg);
  return confirm(`${baseMsg}\n\nThis rule is referenced by ${refs.length} composite alert(s):\n• ${refs.join('\n• ')}\n\nThose composites will silently stop firing. Continue?`);
}

chrome.storage.local.get(['sentinel.config'], res => {
  const cfg = res['sentinel.config'] || {};
  BOOL_FIELDS.forEach(k => { const el = getEl(k); if (el) el.checked = cfg[k] !== false; });
  STR_FIELDS.forEach(k => { const el = getEl(k); if (el && cfg[k]) el.value = cfg[k]; });
  NUM_FIELDS.forEach(k => { const el = getEl(k); if (el && cfg[k]) el.value = cfg[k]; });
});

getEl('saveBtn')?.addEventListener('click', async () => {
  const stored = await chrome.storage.local.get(['sentinel.config']);
  const cfg = { ...(stored['sentinel.config'] || {}) };
  BOOL_FIELDS.forEach(k => { const el = getEl(k); if (el) cfg[k] = el.checked; });
  STR_FIELDS.forEach(k => { const el = getEl(k); if (el) cfg[k] = el.value; });
  NUM_FIELDS.forEach(k => { const el = getEl(k); if (el) cfg[k] = parseInt(el.value, 10); });
  await chrome.storage.local.set({ 'sentinel.config': cfg });
  const msg = getEl('savedMsg');
  if (msg) { msg.classList.add('show'); setTimeout(() => msg.classList.remove('show'), 2000); }
});

// ── Rule Overrides tab ────────────────────────────────────────────────────────

getEl('exportBtn')?.addEventListener('click', async () => {
  const res = await chrome.storage.local.get(['sentinel.rules', 'sentinel.orgRules', 'sentinel.config']);
  const doc = {
    format: 'sentinel-ruleset', formatVersion: 1,
    exportedAt: new Date().toISOString(),
    drugRuleOverrides: res['sentinel.rules'] || {},
    qofRuleOverrides: {},
    orgRuleset: res['sentinel.orgRules'] || null,
    displayConfig: res['sentinel.config'] || {},
  };
  const area = getEl('ioArea');
  if (area) area.value = JSON.stringify(doc, null, 2);
});

getEl('importBtn')?.addEventListener('click', async () => {
  const area = getEl('ioArea');
  if (!area || !area.value.trim()) { alert('Paste exported JSON first.'); return; }
  try {
    const doc = JSON.parse(area.value.trim());
    if (doc.format !== 'sentinel-ruleset') throw new Error('Not a sentinel-ruleset export.');
    const toSet = {};
    if (doc.drugRuleOverrides) toSet['sentinel.rules'] = doc.drugRuleOverrides;
    if (doc.orgRuleset)        toSet['sentinel.orgRules'] = doc.orgRuleset;
    if (doc.displayConfig)     toSet['sentinel.config'] = doc.displayConfig;
    await chrome.storage.local.set(toSet);
    alert('Import successful. Reload any open Medicus tabs for Sentinel to pick up changes.');
    area.value = '';
  } catch (e) {
    alert('Import failed: ' + e.message);
  }
});

// ── Custom Rules tab ──────────────────────────────────────────────────────────

// State
let crEditingId = null;  // null = new rule
let crTestCount = 0;

// Editing state for a partially-built rule (updated on each input event)
function getFormRule() {
  const drugNames = (getEl('crDrugNames')?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
  const excludeNames = (getEl('crExcludeNames')?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
  const drugClass = (getEl('crDrugClass')?.value || '').trim() || null;
  const sharedCare = getEl('crSharedCare')?.checked || false;
  const notes = (getEl('crNotes')?.value || '').trim() || null;
  const source = (getEl('crSource')?.value || '').trim() || null;

  const testCards = document.querySelectorAll('.cr-test-card');
  const tests = Array.from(testCards).map(card => {
    const idx = card.dataset.testIdx;
    const name = (document.getElementById(`crTestName_${idx}`)?.value || '').trim();
    const matchRaw = (document.getElementById(`crTestMatch_${idx}`)?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
    const snomedRaw = (document.getElementById(`crTestSnomed_${idx}`)?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
    const intervalNum = parseInt(document.getElementById(`crTestIntervalNum_${idx}`)?.value || '84', 10);
    const intervalUnit = document.getElementById(`crTestIntervalUnit_${idx}`)?.value || 'weeks';
    const dueSoonNum = parseInt(document.getElementById(`crTestDueSoon_${idx}`)?.value || '28', 10);
    const intervalDays = unitToDays(intervalNum, intervalUnit);
    const test = { name, match: matchRaw.length ? matchRaw : [name.toLowerCase()], intervalDays, dueSoonDays: dueSoonNum };
    if (snomedRaw.length) test.snomed = snomedRaw;
    return test;
  }).filter(t => t.name);

  const rule = {
    type: 'drug-monitoring',
    drug: { match: drugNames, exclude: excludeNames.length ? excludeNames : undefined },
    drugClass,
    sharedCare,
    tests,
    notes,
    source: source || 'Custom rule (user-authored)',
    enabled: true,
  };
  // Optional patient filters — the engine gates drug-monitoring rules on these.
  const dmAgeMin = (getEl('crAgeMin')?.value || '').trim();
  const dmAgeMax = (getEl('crAgeMax')?.value || '').trim();
  if (dmAgeMin || dmAgeMax) {
    rule.ageRange = {};
    if (dmAgeMin) rule.ageRange.min = parseInt(dmAgeMin, 10);
    if (dmAgeMax) rule.ageRange.max = parseInt(dmAgeMax, 10);
  }
  const dmSex = getEl('crSex')?.value || '';
  if (dmSex === 'M' || dmSex === 'F') rule.sex = dmSex;
  const dmLines = id => (getEl(id)?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
  const dmReq = dmLines('crRequiresProblem');
  const dmExc = dmLines('crExcludesProblem');
  if (dmReq.length) rule.requiresProblem = dmReq;
  if (dmExc.length) rule.excludesProblem = dmExc;
  return rule;
}

function unitToDays(n, unit) {
  if (unit === 'days')   return n;
  if (unit === 'weeks')  return n * 7;
  if (unit === 'months') return n * 30;
  return n;
}

function daysToUnit(days) {
  if (days % 30 === 0 && days >= 30) return { n: days / 30, unit: 'months' };
  if (days % 7 === 0)  return { n: days / 7,  unit: 'weeks' };
  return { n: days, unit: 'days' };
}

function defaultDueSoon(intervalDays) {
  if (intervalDays >= 84) return 28;
  return Math.min(Math.round(intervalDays / 6), 30);
}

// Render the custom rules list
async function renderCrList() {
  const res = await chrome.storage.local.get('sentinel.customRules');
  const rules = res['sentinel.customRules'] || [];
  const list = getEl('crList');
  if (!list) return;
  if (rules.length === 0) {
    list.innerHTML = '<div class="cr-empty">No custom rules yet.</div>';
    return;
  }
  list.innerHTML = rules.map(rule => {
    const testCount = (rule.tests || []).length;
    const disabled = rule.enabled === false;
    const editedAgo = rule._authored?.at ? relativeDate(rule._authored.at) : '';
    return `
      <div class="cr-card${disabled ? ' disabled' : ''}" data-rule-id="${escHtml(rule.id)}">
        <div class="cr-card-info">
          <div class="cr-card-name">${escHtml(rule.label || rule.drug?.match?.[0] || rule.id)} ${rule.drugClass ? `<span style="font-size:10px;color:var(--t4)">(${escHtml(rule.drugClass)})</span>` : ''}</div>
          <div class="cr-card-meta">${testCount} test${testCount !== 1 ? 's' : ''} · ${disabled ? 'disabled' : 'enabled'}${editedAgo ? ' · ' + editedAgo : ''}</div>
        </div>
        <div class="cr-card-actions">
          <button class="ghost cr-edit-btn" data-id="${escHtml(rule.id)}">Edit</button>
          <button class="ghost cr-toggle-btn" data-id="${escHtml(rule.id)}">${disabled ? 'Enable' : 'Disable'}</button>
          <button class="ghost danger cr-delete-btn" data-id="${escHtml(rule.id)}">Delete</button>
        </div>
      </div>`;
  }).join('');

  // Bind list actions
  list.querySelectorAll('.cr-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => openCrForm(btn.dataset.id));
  });
  list.querySelectorAll('.cr-toggle-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const r2 = await chrome.storage.local.get('sentinel.customRules');
      const arr = r2['sentinel.customRules'] || [];
      const updated = arr.map(r => r.id === btn.dataset.id ? { ...r, enabled: r.enabled === false } : r);
      await chrome.storage.local.set({ 'sentinel.customRules': updated });
      renderCrList();
    });
  });
  list.querySelectorAll('.cr-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!await confirmDeleteWithRefs(btn.dataset.id, 'Delete this custom rule?')) return;
      const r2 = await chrome.storage.local.get('sentinel.customRules');
      const arr = r2['sentinel.customRules'] || [];
      await chrome.storage.local.set({ 'sentinel.customRules': arr.filter(r => r.id !== btn.dataset.id) });
      renderCrList();
    });
  });
}

function relativeDate(iso) {
  try {
    const diff = (Date.now() - new Date(iso).getTime()) / 86400000;
    if (diff < 1) return 'today';
    if (diff < 2) return '1 day ago';
    if (diff < 30) return `${Math.floor(diff)} days ago`;
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  } catch { return ''; }
}

// Open the form for a new or existing rule
async function openCrForm(editId) {
  crEditingId = editId || null;
  crTestCount = 0;

  getEl('crListView').style.display = 'none';
  getEl('crFormView').style.display = 'block';
  getEl('crFormTitle').textContent = editId ? 'Edit custom rule' : 'New custom rule';
  getEl('crFormError').textContent = '';
  getEl('crTestCards').innerHTML = '';

  if (editId) {
    const res = await chrome.storage.local.get('sentinel.customRules');
    const rule = (res['sentinel.customRules'] || []).find(r => r.id === editId);
    if (rule) populateForm(rule);
  } else {
    getEl('crDrugNames').value = '';
    getEl('crExcludeNames').value = '';
    getEl('crDrugClass').value = '';
    getEl('crSharedCare').checked = false;
    getEl('crNotes').value = '';
    getEl('crSource').value = '';
    ['crAgeMin','crAgeMax','crRequiresProblem','crExcludesProblem'].forEach(id => { const el = getEl(id); if (el) el.value = ''; });
    if (getEl('crSex')) getEl('crSex').value = '';
    addTestCard();
  }
  updatePreview();
}

function closeCrForm() {
  getEl('crFormView').style.display = 'none';
  getEl('crListView').style.display = 'block';
  crEditingId = null;
  crTestCount = 0;
  renderCrList();
}

function populateForm(rule) {
  getEl('crDrugNames').value = (rule.drug?.match || []).join('\n');
  getEl('crExcludeNames').value = (rule.drug?.exclude || []).join('\n');
  getEl('crDrugClass').value = rule.drugClass || '';
  getEl('crSharedCare').checked = !!rule.sharedCare;
  getEl('crNotes').value = rule.notes || '';
  getEl('crSource').value = rule.source === 'Custom rule (user-authored)' ? '' : (rule.source || '');
  if (rule.ageRange?.min != null && getEl('crAgeMin')) getEl('crAgeMin').value = rule.ageRange.min;
  if (rule.ageRange?.max != null && getEl('crAgeMax')) getEl('crAgeMax').value = rule.ageRange.max;
  if (getEl('crSex')) getEl('crSex').value = (rule.sex === 'M' || rule.sex === 'F') ? rule.sex : '';
  if (getEl('crRequiresProblem')) getEl('crRequiresProblem').value = (rule.requiresProblem || []).join('\n');
  if (getEl('crExcludesProblem')) getEl('crExcludesProblem').value = (rule.excludesProblem || []).join('\n');
  (rule.tests || []).forEach(t => addTestCard(t));
  if ((rule.tests || []).length === 0) addTestCard();
}

// Add a test card row to the form
function addTestCard(existing) {
  const idx = crTestCount++;
  const intervalDays = existing?.intervalDays || 84;
  const { n, unit } = daysToUnit(intervalDays);
  const dueSoon = existing?.dueSoonDays ?? defaultDueSoon(intervalDays);
  const matchLines = (existing?.match || []).join('\n');

  const card = document.createElement('div');
  card.className = 'cr-test-card test-card';
  card.dataset.testIdx = idx;
  card.innerHTML = `
    <div class="test-card-header">
      <span class="test-card-title">Test ${idx + 1}</span>
      <button class="ghost danger cr-remove-test" data-idx="${idx}" title="Remove test">✕</button>
    </div>
    <div class="field">
      <label for="crTestName_${idx}">Test name</label>
      <input type="text" id="crTestName_${idx}" placeholder="e.g. FBC" value="${escAttr(existing?.name || '')}" />
    </div>
    <div class="field">
      <label for="crTestMatch_${idx}">Match terms (one per line)</label>
      <textarea id="crTestMatch_${idx}" style="height:48px;" placeholder="fbc&#10;full blood count">${escHtml(matchLines)}</textarea>
      <div class="form-hint">Leave blank to use the test name as the only match term.</div>
    </div>
    <div class="field">
      <label for="crTestSnomed_${idx}">SNOMED codes (optional, one per line)</label>
      <textarea id="crTestSnomed_${idx}" style="height:40px;" placeholder="26604007">${escHtml((existing?.snomed || []).join('\n'))}</textarea>
      <div class="form-hint">Matched in addition to the text terms above (codes are more precise).</div>
    </div>
    <div class="interval-row">
      <label>Interval</label>
      <input type="number" id="crTestIntervalNum_${idx}" min="1" max="3650" value="${n}" style="width:64px;" />
      <select id="crTestIntervalUnit_${idx}">
        <option value="days"${unit==='days'?' selected':''}>days</option>
        <option value="weeks"${unit==='weeks'?' selected':''}>weeks</option>
        <option value="months"${unit==='months'?' selected':''}>months</option>
      </select>
    </div>
    <div class="interval-row">
      <label>Due soon</label>
      <input type="number" id="crTestDueSoon_${idx}" min="0" max="365" value="${dueSoon}" style="width:64px;" />
      <span style="font-size:11px; color:var(--t4);">days before due</span>
    </div>`;

  getEl('crTestCards').appendChild(card);

  // Auto-update due-soon when interval changes
  card.querySelector(`#crTestIntervalNum_${idx}`)?.addEventListener('input', () => {
    const numEl = document.getElementById(`crTestIntervalNum_${idx}`);
    const unitEl = document.getElementById(`crTestIntervalUnit_${idx}`);
    const ds = document.getElementById(`crTestDueSoon_${idx}`);
    if (!numEl || !unitEl || !ds) return;
    const days = unitToDays(parseInt(numEl.value || '84', 10), unitEl.value);
    ds.value = defaultDueSoon(days);
    updatePreview();
  });
  card.querySelector(`#crTestIntervalUnit_${idx}`)?.addEventListener('change', () => updatePreview());
  card.querySelector(`#crTestDueSoon_${idx}`)?.addEventListener('input', () => updatePreview());
  card.querySelector(`#crTestName_${idx}`)?.addEventListener('input', () => updatePreview());
  card.querySelector(`#crTestMatch_${idx}`)?.addEventListener('input', () => updatePreview());
  card.querySelector(`#crTestSnomed_${idx}`)?.addEventListener('input', () => updatePreview());
  card.querySelector('.cr-remove-test')?.addEventListener('click', () => {
    card.remove(); updatePreview();
  });
}

// ── Shared engine-backed live preview (editable mock patient) ─────────────────
// Drives the "would this rule fire?" preview for every rule-type form off the
// REAL exported engine (window.SentinelRules.evaluatePatient) — the same
// function the runtime uses — so the preview matches production behaviour.
function mockPanelHtml(p) {
  return `
  <div class="mock-patient">
    <div class="mock-grid">
      <label>Medications<textarea id="${p}MockMeds" placeholder="one per line&#10;Methotrexate 10mg"></textarea></label>
      <label>Observations<textarea id="${p}MockObs" placeholder="name | value | YYYY-MM-DD&#10;FBC | normal | 2024-01-10"></textarea></label>
      <label>Problems<textarea id="${p}MockProblems" placeholder="label | YYYY-MM-DD&#10;Atrial fibrillation | 2020-03-01"></textarea></label>
    </div>
    <div class="mock-row">
      <label>Age <input type="number" id="${p}MockAge" min="0" max="120" /></label>
      <label>Sex <select id="${p}MockSex"><option value="">unknown</option><option value="female">female</option><option value="male">male</option></select></label>
      <label>As of <input type="date" id="${p}MockDate" /></label>
      <button type="button" class="ghost" id="${p}MockSeed">Auto-fill from rule</button>
    </div>
  </div>`;
}

function isoDaysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function readMockPatient(p) {
  const v = (suffix) => (getEl(p + suffix)?.value || '');
  const lines = (txt) => txt.split('\n').map(s => s.trim()).filter(Boolean);
  const cols = (line) => line.split('|').map(x => x.trim());
  const medications = lines(v('MockMeds')).map(name => ({ name }));
  const observations = lines(v('MockObs')).map(l => { const [name, value, date] = cols(l); return { name: name || '', code: null, value: value || '', date: date || null }; });
  const problems = lines(v('MockProblems')).map(l => { const [label, codedDate] = cols(l); return { label: label || '', codedDate: codedDate || null, status: 'active' }; });
  const ageRaw = v('MockAge');
  const ageYears = ageRaw === '' ? null : parseInt(ageRaw, 10);
  const sex = v('MockSex') || null;
  const dateRaw = v('MockDate');
  const now = dateRaw ? new Date(dateRaw + 'T12:00:00').toISOString() : new Date().toISOString();
  // observation-trend / event-count(observations) read observationHistory grouped
  // PER investigation type, each with a nested newest-first history[] of
  // {date, value, rawValue} — mirror the runtime normaliser shape so the preview
  // fires the same way production does. (Previously this was a flat array with no
  // .history, so trend / event-count(observations) previews never fired.)
  const histByName = {};
  observations.forEach(o => {
    const key = String(o.name || '').toLowerCase();
    if (!histByName[key]) histByName[key] = { name: o.name, unit: '', history: [] };
    const num = parseFloat(String(o.value).replace(/[^0-9.\-]/g, ''));
    histByName[key].history.push({ date: o.date, value: isNaN(num) ? o.value : num, rawValue: String(o.value) });
  });
  const observationHistory = Object.values(histByName).map(e => ({
    ...e,
    history: e.history.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))),
  }));
  return { medications, observations, observationHistory, problems, patientContext: { ageYears, sex }, now };
}

function runEnginePreview(rule, mock, extraRules) {
  const RE = window.SentinelRules;
  if (!RE || typeof RE.evaluatePatient !== 'function') return { error: 'Engine not loaded.' };
  const rules = [...(extraRules || []), rule];
  try {
    const chips = RE.evaluatePatient(mock.medications, mock.observations, rules, {
      now: mock.now, problems: mock.problems, patientContext: mock.patientContext, observationHistory: mock.observationHistory
    });
    return { chips: chips || [] };
  } catch (e) { return { error: e.message }; }
}

function renderEnginePreview(p, rule, extraRules) {
  const el = getEl(p + 'PreviewChip');
  if (!el) return;
  rule.id = rule.id || ('custom-preview-' + p);
  // Live validation feedback via the shared schema validator (same one used on save).
  try { if (typeof validateCustomRule === 'function') validateCustomRule(rule); }
  catch (e) { el.innerHTML = `<div class="preview-incomplete">⚠ ${escHtml(e.message)}</div>`; return; }
  const mock = readMockPatient(p);
  const res = runEnginePreview(rule, mock, extraRules);
  if (res.error) { el.innerHTML = `<div class="preview-incomplete">⚠ ${escHtml(res.error)}</div>`; return; }
  const fired = res.chips.find(c => c.ruleId === rule.id);
  if (!fired) {
    el.innerHTML = `<div class="preview-nofire">Would not fire for this test patient. Adjust the rule or the test patient above, or click "Auto-fill from rule".</div>`;
    return;
  }
  const facts = (fired.evidence?.facts || []).map(f =>
    `<li><span>${escHtml(f.label)}:</span> ${escHtml(String(f.value ?? ''))}${f.date ? ` <em>(${escHtml(String(f.date))})</em>` : ''}</li>`).join('');
  el.innerHTML = `<div class="preview-fire preview-${escHtml(fired.status || '')}">`
    + `<strong>✓ Would fire</strong>${fired.status ? ' — ' + escHtml(fired.status) : ''}`
    + (fired.evidence?.summary ? `<div class="preview-summary">${escHtml(fired.evidence.summary)}</div>` : '')
    + (facts ? `<ul class="preview-facts">${facts}</ul>` : '')
    + `</div>`;
}

// Seed the mock patient from the rule(s) under construction so the preview shows
// a firing example. Handles every rule type — and for composites, seeds from the
// referenced child rules (passed as extraRules) since the composite itself has no
// matchable fields.
function seedMockFromRule(p, rule, extraRules) {
  const set = (suffix, val) => { const el = getEl(p + suffix); if (el) el.value = val; };
  const meds = [], probs = [], obs = [];
  let age = null, sex = null;
  for (const r of [rule, ...(extraRules || [])]) {
    (r.drug?.match || []).forEach(m => meds.push(m));
    (r.drugSets || []).forEach(s => { if (s.match && s.match[0]) meds.push(s.match[0]); });
    (r.requiresProblem || []).forEach(x => probs.push(`${x} | ${isoDaysAgo(365)}`));
    (r.tests || []).forEach(t => { const term = (t.match && t.match[0]) || t.name; obs.push(`${term} | normal | ${isoDaysAgo((t.intervalDays || 84) + 60)}`); });
    const ck = r.check;
    if (ck) {
      if (ck.kind === 'medication-present') (ck.medicationMatch || []).forEach(m => meds.push(m));
      else if (ck.kind === 'observation-recent') (ck.observation || []).forEach(o => obs.push(`${o} | 1 | ${isoDaysAgo(Math.max(1, Math.round((ck.withinDays || 30) / 2)))}`));
      else if (ck.kind === 'observation-trend') {
        const term = ck.observation?.[0] || 'value', n = Math.max(2, ck.minPoints || 3), months = ck.withinMonths || 24;
        for (let i = 0; i < n; i++) {
          const val = ck.direction === 'falling' ? (100 - i * 15) : (i * 15 + 1);
          obs.push(`${term} | ${val} | ${isoDaysAgo(Math.round(months * 30 * (n - 1 - i) / (n - 1)))}`);
        }
      } else if (ck.kind === 'observation-alert') {
        const term = ck.observation?.[0] || 'value';
        const val = ck.red != null ? ck.red : (ck.amber != null ? ck.amber : 1);
        obs.push(`${term} | ${val} | ${isoDaysAgo(Math.max(1, Math.round((ck.withinDays || 365) / 2)))}`);
      } else { // observation-threshold
        const term = ck.observation?.[0] || 'value';
        let val = '1';
        if (ck.thresholdSystolic && ck.thresholdDiastolic) val = `${ck.thresholdSystolic}/${ck.thresholdDiastolic}`;
        else if (ck.threshold != null) val = String(ck.threshold);
        obs.push(`${term} | ${val} | ${isoDaysAgo(20)}`);
      }
    }
    if (r.type === 'event-count' && r.match && r.match[0]) {
      const n = Math.max(1, (r.countThreshold || 1)) + 1;
      const within = isoDaysAgo(Math.max(1, Math.round((r.windowMonths || 12) * 30 / 2)));
      for (let i = 0; i < n; i++) {
        if (r.sourceKind === 'observations') obs.push(`${r.match[0]} | 1 | ${within}`);
        else probs.push(`${r.match[0]} | ${within}`);
      }
    }
    if (r.ageRange?.min != null) age = r.ageRange.min + 1;
    if (r.sex === 'F') sex = 'female'; else if (r.sex === 'M') sex = 'male';
  }
  set('MockMeds', meds.join('\n'));
  set('MockProblems', probs.join('\n'));
  if (obs.length) set('MockObs', obs.join('\n'));
  if (age != null) set('MockAge', String(age));
  else if (!getEl(p + 'MockAge')?.value) set('MockAge', '60');
  if (sex) set('MockSex', sex);
}

// Mount the mock-patient panel into a form's preview area and bind live updates.
function mountMockPanel(p, getRuleFn, extraRulesFn) {
  const mount = getEl(p + 'MockMount');
  if (!mount || mount.dataset.mounted) return;
  mount.innerHTML = mockPanelHtml(p);
  mount.dataset.mounted = '1';
  const extra = () => (extraRulesFn ? extraRulesFn() : []);
  const rerun = () => renderEnginePreview(p, getRuleFn(), extra());
  ['MockMeds', 'MockObs', 'MockProblems', 'MockAge', 'MockSex', 'MockDate'].forEach(s => {
    getEl(p + s)?.addEventListener('input', rerun);
    getEl(p + s)?.addEventListener('change', rerun);
  });
  getEl(p + 'MockSeed')?.addEventListener('click', () => { seedMockFromRule(p, getRuleFn(), extra()); rerun(); });
}

// One-call wiring for forms without their own preview machinery: mount the mock
// panel + a delegated, debounced preview on every rule-field change in the form.
const _previewTimers = {};
function wireFormPreview(p, formViewId, getRuleFn, extraRulesFn) {
  mountMockPanel(p, getRuleFn, extraRulesFn);
  const view = getEl(formViewId);
  if (!view || view.dataset.previewWired) return;
  view.dataset.previewWired = '1';
  const schedule = () => {
    clearTimeout(_previewTimers[p]);
    _previewTimers[p] = setTimeout(() => renderEnginePreview(p, getRuleFn(), extraRulesFn ? extraRulesFn() : []), 300);
  };
  view.addEventListener('input', schedule);
  view.addEventListener('change', schedule);
}

// Debounced preview update
let previewTimer = null;
function updatePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(_doPreview, 300);
}

function _doPreview() {
  renderEnginePreview('cr', getFormRule());
}

// Wire form controls
getEl('crAddBtn')?.addEventListener('click', () => openCrForm(null));
getEl('crCancelBtn')?.addEventListener('click', closeCrForm);
getEl('crCancelBtn2')?.addEventListener('click', closeCrForm);
getEl('crAddTestBtn')?.addEventListener('click', () => { addTestCard(); updatePreview(); });
mountMockPanel('cr', getFormRule);

// Input listeners for live preview
['crDrugNames','crExcludeNames','crDrugClass','crSharedCare','crNotes'].forEach(id => {
  getEl(id)?.addEventListener('input', updatePreview);
});
getEl('crSharedCare')?.addEventListener('change', updatePreview);

// Save rule
getEl('crSaveBtn')?.addEventListener('click', async () => {
  const rule = getFormRule();
  const errEl = getEl('crFormError');
  errEl.textContent = '';

  // Validate via the shared schema validator (the same one the engine import
  // path uses), so the form can never save an object the engine would reject.
  try { validateCustomRule({ ...rule, id: crEditingId || 'custom-temp' }); }
  catch (e) { errEl.textContent = e.message; return; }

  // Load existing rules
  const res = await chrome.storage.local.get('sentinel.customRules');
  const existing = res['sentinel.customRules'] || [];

  if (crEditingId) {
    // Edit existing
    const updated = existing.map(r => r.id === crEditingId ? {
      ...r, ...rule,
      id: crEditingId,
      _authored: r._authored || { at: new Date().toISOString(), by: 'user' },
      _edited: new Date().toISOString(),
    } : r);
    await chrome.storage.local.set({ 'sentinel.customRules': updated });
  } else {
    // New rule — generate ID
    const slug = rule.drug.match[0].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    const id = `custom-${slug}-${Math.floor(Date.now()/1000)}`;
    // Check uniqueness
    if (existing.some(r => r.id === id)) { errEl.textContent = 'ID collision — try again in a moment.'; return; }
    const newRule = {
      ...rule, id,
      _authored: { at: new Date().toISOString(), by: 'user' },
    };
    await chrome.storage.local.set({ 'sentinel.customRules': [...existing, newRule] });
  }

  closeCrForm();
});

// Custom rules import/export
getEl('crImportBtn')?.addEventListener('click', () => getEl('crImportFile')?.click());
getEl('crImportFile')?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  e.target.value = '';
  try {
    const text = await file.text();
    const raw = JSON.parse(text);
    // Accept either sentinel-backup envelope or bare array
    let incoming = [];
    if (Array.isArray(raw)) {
      incoming = raw;
    } else if (raw.format === 'medicus-suite-backup') {
      incoming = raw.modules?.sentinel?.customRules || [];
    } else if (raw.format === 'sentinel-ruleset') {
      incoming = raw.customRules || [];
    } else {
      throw new Error('Unrecognised format.');
    }
    if (incoming.length === 0) { alert('No custom rules found in this file.'); return; }
    if (!confirm(`Import ${incoming.length} custom rule(s)? Existing rules with the same IDs will be skipped.`)) return;
    const res = await chrome.storage.local.get('sentinel.customRules');
    const existing = res['sentinel.customRules'] || [];
    const existingIds = new Set(existing.map(r => r.id));
    const valid = [];
    const rejected = [];
    incoming.filter(r => !existingIds.has(r.id)).forEach((rule, i) => {
      try {
        if (typeof validateCustomRule === 'function') validateCustomRule(rule, i);
        valid.push(rule);
      } catch (e) {
        rejected.push({ rule, err: e.message });
      }
    });
    await chrome.storage.local.set({ 'sentinel.customRules': [...existing, ...valid] });
    renderCrList();
    let msg = `Imported ${valid.length} rule(s). ${incoming.length - valid.length - rejected.length} skipped (duplicate IDs).`;
    if (rejected.length) msg += `\n${rejected.length} rejected as invalid:\n• ` + rejected.slice(0, 5).map(r => `${r.rule.label || r.rule.id || '(no id)'}: ${r.err}`).join('\n• ');
    alert(msg);
  } catch (err) {
    alert('Import failed: ' + err.message);
  }
});

getEl('crExportBtn')?.addEventListener('click', async () => {
  const res = await chrome.storage.local.get('sentinel.customRules');
  const rules = res['sentinel.customRules'] || [];
  if (rules.length === 0) { alert('No custom rules to export.'); return; }
  const blob = new Blob([JSON.stringify(rules, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `sentinel-custom-rules-${new Date().toISOString().slice(0,10)}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
});

// ── LLM rule authoring tool ────────────────────────────────────────────────────

getEl('crLlmCopyPrompt')?.addEventListener('click', async () => {
  const prompt = (typeof customRuleSchemaPrompt === 'function') ? customRuleSchemaPrompt() : '';
  const copiedEl = getEl('crLlmCopied');
  try {
    await navigator.clipboard.writeText(prompt);
  } catch (_) {
    // execCommand fallback for extension contexts without clipboard permission
    const ta = document.createElement('textarea');
    ta.value = prompt;
    ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    document.execCommand && document.execCommand('copy');
    document.body.removeChild(ta);
  }
  if (copiedEl) {
    copiedEl.style.opacity = '1';
    setTimeout(() => { copiedEl.style.opacity = '0'; }, 2000);
  }
});

getEl('crLlmImport')?.addEventListener('click', async () => {
  const statusEl = getEl('crLlmStatus');
  const jsonEl   = getEl('crLlmJson');
  if (!statusEl || !jsonEl) return;

  const raw = (jsonEl.value || '').trim();
  if (!raw) {
    statusEl.style.color = 'var(--red)';
    statusEl.textContent = 'Paste the LLM JSON into the box first.';
    return;
  }

  // Parse JSON
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    statusEl.style.color = 'var(--red)';
    statusEl.textContent = 'Could not parse JSON: ' + escHtml(e.message);
    return;
  }

  // Normalise: accept single object, array, or {rules:[...]}
  let candidates = [];
  if (Array.isArray(parsed)) {
    candidates = parsed;
  } else if (parsed && typeof parsed === 'object') {
    if (Array.isArray(parsed.rules)) {
      candidates = parsed.rules;
    } else {
      candidates = [parsed];
    }
  } else {
    statusEl.style.color = 'var(--red)';
    statusEl.textContent = 'Expected a JSON object, an array, or an object with a "rules" array.';
    return;
  }

  if (candidates.length === 0) {
    statusEl.style.color = 'var(--red)';
    statusEl.textContent = 'No rule objects found in the pasted JSON.';
    return;
  }

  // Load existing rules for id de-duplication
  const res = await chrome.storage.local.get('sentinel.customRules');
  const existing = res['sentinel.customRules'] || [];
  const taken = new Set(existing.map(r => r.id));

  // Validate each candidate via the shared validator; abort on first error
  for (let i = 0; i < candidates.length; i++) {
    const rule = candidates[i];
    // Ensure id starts with custom-
    if (!rule.id || typeof rule.id !== 'string' || !rule.id.startsWith('custom-')) {
      rule.id = 'custom-' + (rule.id || 'rule');
    }
    // Force disabled — imported rules must be reviewed before firing
    rule.enabled = false;
    try {
      if (typeof validateCustomRule === 'function') validateCustomRule(rule, i);
    } catch (e) {
      statusEl.style.color = 'var(--red)';
      statusEl.textContent = 'Rule ' + (candidates.length > 1 ? (i + 1) + ': ' : '') + escHtml(e.message);
      return;
    }
  }

  // De-duplicate ids and append
  const toAdd = [];
  for (const rule of candidates) {
    let id = rule.id;
    let n = 2;
    while (taken.has(id)) id = rule.id + '-' + n++;
    rule.id = id;
    taken.add(id);
    toAdd.push(rule);
  }

  await chrome.storage.local.set({ 'sentinel.customRules': [...existing, ...toAdd] });
  jsonEl.value = '';
  statusEl.style.color = 'var(--green)';
  statusEl.textContent = 'Imported ' + toAdd.length + ' rule' + (toAdd.length !== 1 ? 's' : '') + ' (disabled — review and enable each one before it fires).';
  renderCrList();
});

// Render list on load if Custom Rules tab is already active
if (document.querySelector('.tab-btn.active')?.dataset.tab === 'customrules') renderCrList();

// ── Custom Indicators (v1.2) ──────────────────────────────────────────────────

let ciEditingId = null;

function ciGetFormRule() {
  const indicatorCode = (getEl('ciIndicatorCode')?.value || '').trim();
  const indicatorName = (getEl('ciIndicatorName')?.value || '').trim();
  const pointsRaw = (getEl('ciPoints')?.value || '').trim();
  const points = pointsRaw ? parseFloat(pointsRaw) : null;
  const requiresRegister = getEl('ciRequiresRegister')?.value || null;
  const ageMinRaw = (getEl('ciAgeMin')?.value || '').trim();
  const ageMaxRaw = (getEl('ciAgeMax')?.value || '').trim();
  const excludeFrailty = getEl('ciExcludeFrailty')?.checked || false;
  const sex = getEl('ciSex')?.value || '';
  const linesOf = id => (getEl(id)?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
  const requiresProblem = linesOf('ciRequiresProblem');
  const requiresAnyProblem = linesOf('ciRequiresAnyProblem');
  const excludeProblems = linesOf('ciExcludeProblems');
  const notes = (getEl('ciNotes')?.value || '').trim() || null;
  const source = (getEl('ciSource')?.value || '').trim() || null;

  const kind = document.querySelector('input[name="ciKind"]:checked')?.value || 'observation-threshold';

  let check = { kind };
  let useQofYearFloor = true;

  if (kind === 'observation-threshold') {
    const obsMatch = (getEl('ciThresholdObsMatch')?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
    check.observation = obsMatch;
    const dual = getEl('ciDualThreshold')?.checked;
    if (dual) {
      const sys = parseFloat(getEl('ciThresholdSys')?.value);
      const dia = parseFloat(getEl('ciThresholdDia')?.value);
      if (!isNaN(sys)) check.thresholdSystolic = sys;
      if (!isNaN(dia)) check.thresholdDiastolic = dia;
    } else {
      const t = parseFloat(getEl('ciThreshold')?.value);
      const op = getEl('ciOperator')?.value;
      if (!isNaN(t)) check.threshold = t;
      if (op) check.operator = op;
    }
    const windowMode = document.querySelector('input[name="ciWindowThreshold"]:checked')?.value || 'qof';
    if (windowMode === 'rolling') {
      check.withinDays = parseInt(getEl('ciWithinDaysT')?.value || '365', 10);
      useQofYearFloor = false;
    } else {
      check.withinDays = 365;
      useQofYearFloor = true;
    }
  } else if (kind === 'medication-present') {
    const medMatch = (getEl('ciMedMatch')?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
    const medExclude = (getEl('ciMedExclude')?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
    check.medicationMatch = medMatch;
    if (medExclude.length) check.medicationExclude = medExclude;
  } else if (kind === 'observation-recent') {
    const obsMatch = (getEl('ciWithinObsMatch')?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
    check.observation = obsMatch;
    const windowMode = document.querySelector('input[name="ciWindowWithin"]:checked')?.value || 'qof';
    if (windowMode === 'rolling') {
      check.withinDays = parseInt(getEl('ciWithinDaysW')?.value || '365', 10);
      useQofYearFloor = false;
    } else {
      check.withinDays = 365;
      useQofYearFloor = true;
    }
  }

  const rule = {
    type: 'qof-indicator',
    enabled: true,
    indicatorCode,
    indicatorName,
    check,
    useQofYearFloor,
    requiresRegister: requiresRegister || null,
    points: points != null && !isNaN(points) ? points : null,
    notes,
    source: source || 'Custom indicator (user-authored)',
  };
  if (ageMinRaw || ageMaxRaw) {
    rule.ageRange = {};
    if (ageMinRaw) rule.ageRange.min = parseInt(ageMinRaw, 10);
    if (ageMaxRaw) rule.ageRange.max = parseInt(ageMaxRaw, 10);
  }
  if (sex === 'M' || sex === 'F') rule.sex = sex;
  if (requiresProblem.length) rule.requiresProblem = requiresProblem;
  if (requiresAnyProblem.length) rule.requiresAnyProblem = requiresAnyProblem;
  // Combine the free-text exclusions with the frailty convenience checkbox.
  const excludeIfProblem = [...excludeProblems];
  if (excludeFrailty) {
    for (const t of ['moderate frailty', 'severe frailty']) {
      if (!excludeIfProblem.includes(t)) excludeIfProblem.push(t);
    }
  }
  if (excludeIfProblem.length) rule.excludeIfProblem = excludeIfProblem;
  return rule;
}

async function ciRenderList() {
  const res = await chrome.storage.local.get('sentinel.customRules');
  const all = res['sentinel.customRules'] || [];
  const indicators = all.filter(r => r.type === 'qof-indicator');
  const list = getEl('ciList');
  if (!list) return;
  if (indicators.length === 0) {
    list.innerHTML = '<div class="cr-empty">No custom indicators yet.</div>';
    return;
  }
  list.innerHTML = indicators.map(rule => {
    const disabled = rule.enabled === false;
    const kindLabel = rule.check?.kind === 'observation-threshold' ? 'threshold'
      : rule.check?.kind === 'medication-present' ? 'med-presence'
      : rule.check?.kind === 'observation-recent' ? 'obs-window'
      : rule.check?.kind || '';
    const regLabel = rule.requiresRegister || 'Any';
    return `
      <div class="cr-card${disabled ? ' disabled' : ''}" data-rule-id="${escHtml(rule.id)}">
        <div class="cr-card-info">
          <div class="cr-card-name">${escHtml(rule.indicatorName || rule.indicatorCode || rule.id)}${rule.indicatorCode ? ` <span style="font-size:10px;color:var(--t4)">${escHtml(rule.indicatorCode)}</span>` : ''}</div>
          <div class="cr-card-meta">${escHtml(kindLabel)} · register: ${escHtml(regLabel)} · ${disabled ? 'disabled' : 'enabled'}</div>
        </div>
        <div class="cr-card-actions">
          <button class="ghost ci-edit-btn" data-id="${escHtml(rule.id)}">Edit</button>
          <button class="ghost ci-toggle-btn" data-id="${escHtml(rule.id)}">${disabled ? 'Enable' : 'Disable'}</button>
          <button class="ghost danger ci-delete-btn" data-id="${escHtml(rule.id)}">Delete</button>
        </div>
      </div>`;
  }).join('');

  list.querySelectorAll('.ci-edit-btn').forEach(btn => btn.addEventListener('click', () => ciOpenForm(btn.dataset.id)));
  list.querySelectorAll('.ci-toggle-btn').forEach(btn => btn.addEventListener('click', async () => {
    const r2 = await chrome.storage.local.get('sentinel.customRules');
    const arr = r2['sentinel.customRules'] || [];
    const updated = arr.map(r => r.id === btn.dataset.id ? { ...r, enabled: r.enabled === false } : r);
    await chrome.storage.local.set({ 'sentinel.customRules': updated });
    ciRenderList();
  }));
  list.querySelectorAll('.ci-delete-btn').forEach(btn => btn.addEventListener('click', async () => {
    if (!await confirmDeleteWithRefs(btn.dataset.id, 'Delete this custom indicator?')) return;
    const r2 = await chrome.storage.local.get('sentinel.customRules');
    const arr = r2['sentinel.customRules'] || [];
    await chrome.storage.local.set({ 'sentinel.customRules': arr.filter(r => r.id !== btn.dataset.id) });
    ciRenderList();
  }));
}

function ciSwitchKindSection() {
  const kind = document.querySelector('input[name="ciKind"]:checked')?.value || 'observation-threshold';
  getEl('ciSectionThreshold').style.display = kind === 'observation-threshold' ? 'block' : 'none';
  getEl('ciSectionMedPresent').style.display = kind === 'medication-present' ? 'block' : 'none';
  getEl('ciSectionObsWithin').style.display = kind === 'observation-recent' ? 'block' : 'none';
}

function ciSwitchDualThreshold() {
  const dual = getEl('ciDualThreshold')?.checked;
  getEl('ciSingleThreshold').style.display = dual ? 'none' : 'block';
  getEl('ciDualThresholdInputs').style.display = dual ? 'block' : 'none';
}

async function ciOpenForm(editId) {
  ciEditingId = editId || null;
  getEl('ciListView').style.display = 'none';
  getEl('ciFormView').style.display = 'block';
  getEl('ciFormTitle').textContent = editId ? 'Edit custom indicator' : 'New custom indicator';
  getEl('ciFormError').textContent = '';

  // Reset all fields
  ['ciIndicatorCode','ciIndicatorName','ciPoints','ciAgeMin','ciAgeMax','ciNotes','ciSource',
   'ciThresholdObsMatch','ciThreshold','ciThresholdSys','ciThresholdDia',
   'ciMedMatch','ciMedExclude','ciWithinObsMatch',
   'ciRequiresProblem','ciRequiresAnyProblem','ciExcludeProblems'].forEach(id => { const el = getEl(id); if (el) el.value = ''; });
  getEl('ciDualThreshold').checked = false;
  getEl('ciExcludeFrailty').checked = false;
  if (getEl('ciSex')) getEl('ciSex').value = '';
  getEl('ciRequiresRegister').value = '';
  getEl('ciOperator').value = '<=';
  getEl('ciKindThreshold').checked = true;
  document.querySelector('input[name="ciWindowThreshold"][value="qof"]').checked = true;
  document.querySelector('input[name="ciWindowWithin"][value="qof"]').checked = true;
  getEl('ciWithinDaysT').value = 365;
  getEl('ciWithinDaysW').value = 365;

  if (editId) {
    const res = await chrome.storage.local.get('sentinel.customRules');
    const rule = (res['sentinel.customRules'] || []).find(r => r.id === editId);
    if (rule) ciPopulateForm(rule);
  }

  ciSwitchKindSection();
  ciSwitchDualThreshold();
  ciUpdatePreview();
}

function ciPopulateForm(rule) {
  getEl('ciIndicatorCode').value = rule.indicatorCode || '';
  getEl('ciIndicatorName').value = rule.indicatorName || '';
  if (rule.points != null) getEl('ciPoints').value = rule.points;
  getEl('ciRequiresRegister').value = rule.requiresRegister || '';
  if (rule.ageRange?.min != null) getEl('ciAgeMin').value = rule.ageRange.min;
  if (rule.ageRange?.max != null) getEl('ciAgeMax').value = rule.ageRange.max;
  if (getEl('ciSex')) getEl('ciSex').value = (rule.sex === 'M' || rule.sex === 'F') ? rule.sex : '';
  if (getEl('ciRequiresProblem')) getEl('ciRequiresProblem').value = (rule.requiresProblem || []).join('\n');
  if (getEl('ciRequiresAnyProblem')) getEl('ciRequiresAnyProblem').value = (rule.requiresAnyProblem || []).join('\n');
  // The frailty checkbox is just a convenience for the two frailty terms; any
  // other excludeIfProblem terms populate the free-text box.
  {
    const excl = rule.excludeIfProblem || [];
    const hasFrailty = excl.includes('moderate frailty') && excl.includes('severe frailty');
    getEl('ciExcludeFrailty').checked = hasFrailty;
    const rest = hasFrailty ? excl.filter(t => t !== 'moderate frailty' && t !== 'severe frailty') : excl;
    if (getEl('ciExcludeProblems')) getEl('ciExcludeProblems').value = rest.join('\n');
  }
  getEl('ciNotes').value = rule.notes || '';
  getEl('ciSource').value = rule.source === 'Custom indicator (user-authored)' ? '' : (rule.source || '');

  const kind = rule.check?.kind || 'observation-threshold';
  document.querySelector(`input[name="ciKind"][value="${kind}"]`)?.click();

  if (kind === 'observation-threshold') {
    getEl('ciThresholdObsMatch').value = (rule.check?.observation || []).join('\n');
    if (rule.check?.thresholdSystolic && rule.check?.thresholdDiastolic) {
      getEl('ciDualThreshold').checked = true;
      getEl('ciThresholdSys').value = rule.check.thresholdSystolic;
      getEl('ciThresholdDia').value = rule.check.thresholdDiastolic;
    } else {
      getEl('ciDualThreshold').checked = false;
      if (rule.check?.threshold != null) getEl('ciThreshold').value = rule.check.threshold;
      if (rule.check?.operator) getEl('ciOperator').value = rule.check.operator;
    }
    if (rule.useQofYearFloor === false) {
      document.querySelector('input[name="ciWindowThreshold"][value="rolling"]').checked = true;
      getEl('ciWithinDaysT').value = rule.check?.withinDays || 365;
    } else {
      document.querySelector('input[name="ciWindowThreshold"][value="qof"]').checked = true;
    }
  } else if (kind === 'medication-present') {
    getEl('ciMedMatch').value = (rule.check?.medicationMatch || []).join('\n');
    getEl('ciMedExclude').value = (rule.check?.medicationExclude || []).join('\n');
  } else if (kind === 'observation-recent') {
    getEl('ciWithinObsMatch').value = (rule.check?.observation || []).join('\n');
    if (rule.useQofYearFloor === false) {
      document.querySelector('input[name="ciWindowWithin"][value="rolling"]').checked = true;
      getEl('ciWithinDaysW').value = rule.check?.withinDays || 365;
    }
  }
}

function ciCloseForm() {
  getEl('ciFormView').style.display = 'none';
  getEl('ciListView').style.display = 'block';
  ciEditingId = null;
  ciRenderList();
}

let ciPreviewTimer = null;
function ciUpdatePreview() {
  clearTimeout(ciPreviewTimer);
  ciPreviewTimer = setTimeout(_ciDoPreview, 300);
}

// Reads the observation-alert form fields into a check object (shared by the
// live preview and the save handler).
function ciBuildAlertCheck() {
  const observation = (getEl('ciAlertObsMatch')?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
  const comparator = getEl('ciAlertComparator')?.value || 'above';
  const check = { kind: 'observation-alert', observation, comparator };
  const amberRaw = (getEl('ciAlertAmber')?.value || '').trim();
  const redRaw = (getEl('ciAlertRed')?.value || '').trim();
  const unit = (getEl('ciAlertUnit')?.value || '').trim();
  const withinRaw = (getEl('ciAlertWithinDays')?.value || '').trim();
  if (amberRaw !== '' && !isNaN(parseFloat(amberRaw))) check.amber = parseFloat(amberRaw);
  if (redRaw !== '' && !isNaN(parseFloat(redRaw))) check.red = parseFloat(redRaw);
  if (unit) check.unit = unit;
  if (withinRaw !== '' && !isNaN(parseInt(withinRaw, 10))) check.withinDays = parseInt(withinRaw, 10);
  return check;
}

// Builds the rule incl. the observation-trend check (which ciGetFormRule omits —
// it's assembled in the save handler), so the live preview covers all kinds.
function ciGetFormRuleFull() {
  const rule = ciGetFormRule();
  const kind = document.querySelector('input[name="ciKind"]:checked')?.value;
  if (kind === 'observation-trend') {
    const observation = (getEl('ciTrendObsMatch')?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
    const direction = document.querySelector('input[name="ciTrendDirection"]:checked')?.value || 'rising';
    const minPoints = parseInt(getEl('ciTrendMinPoints')?.value || '3', 10);
    const withinMonths = parseInt(getEl('ciTrendWithinMonths')?.value || '24', 10);
    const minDeltaRaw = (getEl('ciTrendMinDelta')?.value || '').trim();
    rule.check = { kind: 'observation-trend', observation, direction, minPoints, withinMonths };
    if (minDeltaRaw !== '' && !isNaN(parseFloat(minDeltaRaw))) rule.check.minDelta = parseFloat(minDeltaRaw);
  } else if (kind === 'observation-alert') {
    rule.check = ciBuildAlertCheck();
  }
  return rule;
}

function _ciDoPreview() {
  renderEnginePreview('ci', ciGetFormRuleFull());
}

// Wire indicator form controls
getEl('ciAddBtn')?.addEventListener('click', () => ciOpenForm(null));
getEl('ciCancelBtn')?.addEventListener('click', ciCloseForm);
getEl('ciCancelBtn2')?.addEventListener('click', ciCloseForm);
document.querySelectorAll('input[name="ciKind"]').forEach(r => r.addEventListener('change', () => { ciSwitchKindSection(); ciUpdatePreview(); }));
getEl('ciDualThreshold')?.addEventListener('change', () => { ciSwitchDualThreshold(); ciUpdatePreview(); });
mountMockPanel('ci', ciGetFormRuleFull);

// Inputs that should retrigger preview
['ciIndicatorCode','ciIndicatorName','ciPoints','ciThresholdObsMatch','ciThreshold','ciThresholdSys','ciThresholdDia',
 'ciMedMatch','ciMedExclude','ciWithinObsMatch','ciWithinDaysT','ciWithinDaysW','ciNotes','ciSource'].forEach(id => {
  getEl(id)?.addEventListener('input', ciUpdatePreview);
});
getEl('ciOperator')?.addEventListener('change', ciUpdatePreview);
getEl('ciRequiresRegister')?.addEventListener('change', ciUpdatePreview);
document.querySelectorAll('input[name="ciWindowThreshold"], input[name="ciWindowWithin"]').forEach(r => r.addEventListener('change', ciUpdatePreview));

getEl('ciSaveBtn')?.addEventListener('click', async () => {
  const rule = ciGetFormRule();
  const errEl = getEl('ciFormError');
  errEl.textContent = '';

  // Generate ID for new rules
  if (!ciEditingId) {
    const slug = (rule.indicatorCode || 'indicator').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    rule.id = `custom-${slug}-${Math.floor(Date.now()/1000)}`;
  } else {
    rule.id = ciEditingId;
  }

  // Validate via the shared validator
  // Inline minimal validation since validateCustomRule isn't loaded as a module here
  if (!rule.indicatorCode) { errEl.textContent = 'Indicator code is required.'; return; }
  if (!rule.indicatorName) { errEl.textContent = 'Indicator name is required.'; return; }
  if (rule.check.kind === 'observation-threshold') {
    if (!rule.check.observation?.length) { errEl.textContent = 'Add at least one observation match term.'; return; }
    const hasBp = rule.check.thresholdSystolic && rule.check.thresholdDiastolic;
    const hasSingle = rule.check.threshold != null && rule.check.operator;
    if (!hasBp && !hasSingle) { errEl.textContent = 'Set a threshold value (or both systolic and diastolic).'; return; }
  }
  if (rule.check.kind === 'medication-present' && !rule.check.medicationMatch?.length) {
    errEl.textContent = 'Add at least one medication match term.'; return;
  }
  if (rule.check.kind === 'observation-recent' && !rule.check.observation?.length) {
    errEl.textContent = 'Add at least one observation match term.'; return;
  }

  // Load existing rules and save
  const res = await chrome.storage.local.get('sentinel.customRules');
  const existing = res['sentinel.customRules'] || [];
  if (ciEditingId) {
    const updated = existing.map(r => r.id === ciEditingId ? {
      ...r, ...rule,
      _authored: r._authored || { at: new Date().toISOString(), by: 'user' },
      _edited: new Date().toISOString(),
    } : r);
    await chrome.storage.local.set({ 'sentinel.customRules': updated });
  } else {
    rule._authored = { at: new Date().toISOString(), by: 'user' };
    await chrome.storage.local.set({ 'sentinel.customRules': [...existing, rule] });
  }
  ciCloseForm();
});

// Render indicator list on load if Custom Rules tab is already active
if (document.querySelector('.tab-btn.active')?.dataset.tab === 'customrules') ciRenderList();

// ── observation-trend: extend ciSwitchKindSection & save ─────────────────

// Patch ciSwitchKindSection to include observation-trend section
(function patchCiSwitchKindSection() {
  const orig = ciSwitchKindSection;
  // Override the existing function reference used by event listeners
  window._ciSwitchKindSection = function () {
    const kind = document.querySelector('input[name="ciKind"]:checked')?.value || 'observation-threshold';
    getEl('ciSectionThreshold').style.display  = kind === 'observation-threshold' ? 'block' : 'none';
    getEl('ciSectionMedPresent').style.display = kind === 'medication-present'    ? 'block' : 'none';
    getEl('ciSectionObsWithin').style.display  = kind === 'observation-recent'    ? 'block' : 'none';
    getEl('ciSectionTrend').style.display      = kind === 'observation-trend'     ? 'block' : 'none';
    getEl('ciSectionAlert').style.display      = kind === 'observation-alert'     ? 'block' : 'none';
  };
  // Replace event listeners already bound in the existing code.
  // The existing code binds 'change' on each ciKind radio, so we patch by
  // listening on the name group with a capture listener that fires first.
  document.querySelectorAll('input[name="ciKind"]').forEach(r => {
    r.addEventListener('change', () => {
      window._ciSwitchKindSection();
      ciUpdatePreview();
    }, true);
  });
})();

// Extend ciGetFormRule to handle observation-trend
(function patchCiGetFormRule() {
  const origOpenForm = ciOpenForm;
  // We inject trend reading into save handler instead of patching ciGetFormRule
  // (since it's a plain function, not easily monkey-patchable without duplication).
  // The save button handler is what actually calls ciGetFormRule.
  // We'll replace the save listener below.
})();

// Extend the QOF save handler to support observation-trend
(function extendCiSaveHandler() {
  const ciSaveBtn = getEl('ciSaveBtn');
  if (!ciSaveBtn) return;

  // Clone to remove the original listener, then add combined one
  const freshBtn = ciSaveBtn.cloneNode(true);
  ciSaveBtn.parentNode.replaceChild(freshBtn, ciSaveBtn);

  freshBtn.addEventListener('click', async () => {
    const rule = ciGetFormRule();
    const errEl = getEl('ciFormError');
    errEl.textContent = '';

    // Handle observation-trend separately — ciGetFormRule won't set it
    const kind = document.querySelector('input[name="ciKind"]:checked')?.value || 'observation-threshold';
    if (kind === 'observation-trend') {
      const obsMatch = (getEl('ciTrendObsMatch')?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
      const direction = document.querySelector('input[name="ciTrendDirection"]:checked')?.value || 'rising';
      const minPoints = parseInt(getEl('ciTrendMinPoints')?.value || '3', 10);
      const withinMonths = parseInt(getEl('ciTrendWithinMonths')?.value || '24', 10);
      const minDeltaRaw = (getEl('ciTrendMinDelta')?.value || '').trim();
      const minDelta = minDeltaRaw !== '' ? parseFloat(minDeltaRaw) : null;

      rule.check = { kind: 'observation-trend', observation: obsMatch, direction, minPoints, withinMonths };
      if (minDelta !== null && !isNaN(minDelta)) rule.check.minDelta = minDelta;

      // Validate
      if (!obsMatch.length) { errEl.textContent = 'Add at least one observation match term.'; return; }
      if (isNaN(minPoints) || minPoints < 2) { errEl.textContent = 'Minimum data points must be 2 or more.'; return; }
      if (isNaN(withinMonths) || withinMonths <= 0) { errEl.textContent = 'Within months must be a positive number.'; return; }
    }
    if (kind === 'observation-alert') {
      const alertCheck = ciBuildAlertCheck();
      rule.check = alertCheck;
      if (!alertCheck.observation.length) { errEl.textContent = 'Add at least one observation match term.'; return; }
      if (alertCheck.amber == null && alertCheck.red == null) { errEl.textContent = 'Set an amber threshold, a red threshold, or both.'; return; }
    }

    // Generate ID for new rules
    if (!ciEditingId) {
      const slug = (rule.indicatorCode || 'indicator').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
      rule.id = `custom-${slug}-${Math.floor(Date.now()/1000)}`;
    } else {
      rule.id = ciEditingId;
    }

    // Inline validation (mirrors existing)
    if (!rule.indicatorCode) { errEl.textContent = 'Indicator code is required.'; return; }
    if (!rule.indicatorName) { errEl.textContent = 'Indicator name is required.'; return; }
    if (kind === 'observation-threshold') {
      if (!rule.check.observation?.length) { errEl.textContent = 'Add at least one observation match term.'; return; }
      const hasBp = rule.check.thresholdSystolic && rule.check.thresholdDiastolic;
      const hasSingle = rule.check.threshold != null && rule.check.operator;
      if (!hasBp && !hasSingle) { errEl.textContent = 'Set a threshold value (or both systolic and diastolic).'; return; }
    }
    if (kind === 'medication-present' && !rule.check.medicationMatch?.length) {
      errEl.textContent = 'Add at least one medication match term.'; return;
    }
    if (kind === 'observation-recent' && !rule.check.observation?.length) {
      errEl.textContent = 'Add at least one observation match term.'; return;
    }

    try { validateCustomRule(rule); } catch (e) { errEl.textContent = e.message; return; }

    const res = await chrome.storage.local.get('sentinel.customRules');
    const existing = res['sentinel.customRules'] || [];
    if (ciEditingId) {
      const updated = existing.map(r => r.id === ciEditingId ? {
        ...r, ...rule,
        _authored: r._authored || { at: new Date().toISOString(), by: 'user' },
        _edited: new Date().toISOString(),
      } : r);
      await chrome.storage.local.set({ 'sentinel.customRules': updated });
    } else {
      rule._authored = { at: new Date().toISOString(), by: 'user' };
      await chrome.storage.local.set({ 'sentinel.customRules': [...existing, rule] });
    }
    ciCloseForm();
  });
})();

// Extend ciOpenForm to populate trend fields on edit
(function extendCiOpenFormForTrend() {
  const origOpenForm = ciOpenForm;
  ciOpenForm = async function (editId) {
    await origOpenForm(editId);
    // Reset trend fields
    if (getEl('ciTrendObsMatch')) getEl('ciTrendObsMatch').value = '';
    if (getEl('ciTrendMinPoints')) getEl('ciTrendMinPoints').value = 3;
    if (getEl('ciTrendWithinMonths')) getEl('ciTrendWithinMonths').value = 24;
    if (getEl('ciTrendMinDelta')) getEl('ciTrendMinDelta').value = '';
    const risingEl = document.querySelector('input[name="ciTrendDirection"][value="rising"]');
    if (risingEl) risingEl.checked = true;
    // Reset alert fields
    if (getEl('ciAlertObsMatch')) getEl('ciAlertObsMatch').value = '';
    if (getEl('ciAlertComparator')) getEl('ciAlertComparator').value = 'above';
    if (getEl('ciAlertAmber')) getEl('ciAlertAmber').value = '';
    if (getEl('ciAlertRed')) getEl('ciAlertRed').value = '';
    if (getEl('ciAlertUnit')) getEl('ciAlertUnit').value = '';
    if (getEl('ciAlertWithinDays')) getEl('ciAlertWithinDays').value = 180;

    if (editId) {
      const res = await chrome.storage.local.get('sentinel.customRules');
      const rule = (res['sentinel.customRules'] || []).find(r => r.id === editId);
      if (rule && rule.check?.kind === 'observation-trend') {
        if (getEl('ciTrendObsMatch')) getEl('ciTrendObsMatch').value = (rule.check.observation || []).join('\n');
        const dir = rule.check.direction || 'rising';
        const dirEl = document.querySelector(`input[name="ciTrendDirection"][value="${dir}"]`);
        if (dirEl) dirEl.checked = true;
        if (rule.check.minPoints != null && getEl('ciTrendMinPoints')) getEl('ciTrendMinPoints').value = rule.check.minPoints;
        if (rule.check.withinMonths != null && getEl('ciTrendWithinMonths')) getEl('ciTrendWithinMonths').value = rule.check.withinMonths;
        if (rule.check.minDelta != null && getEl('ciTrendMinDelta')) getEl('ciTrendMinDelta').value = rule.check.minDelta;
      }
      if (rule && rule.check?.kind === 'observation-alert') {
        if (getEl('ciAlertObsMatch')) getEl('ciAlertObsMatch').value = (rule.check.observation || []).join('\n');
        if (getEl('ciAlertComparator')) getEl('ciAlertComparator').value = rule.check.comparator || 'above';
        if (rule.check.amber != null && getEl('ciAlertAmber')) getEl('ciAlertAmber').value = rule.check.amber;
        if (rule.check.red != null && getEl('ciAlertRed')) getEl('ciAlertRed').value = rule.check.red;
        if (rule.check.unit && getEl('ciAlertUnit')) getEl('ciAlertUnit').value = rule.check.unit;
        if (rule.check.withinDays != null && getEl('ciAlertWithinDays')) getEl('ciAlertWithinDays').value = rule.check.withinDays;
      }
    }
    // Re-apply section visibility (trend radio may now be selected)
    window._ciSwitchKindSection && window._ciSwitchKindSection();
  };
})();

// Wire trend input changes into preview
['ciTrendObsMatch','ciTrendMinPoints','ciTrendWithinMonths','ciTrendMinDelta'].forEach(id => {
  getEl(id)?.addEventListener('input', ciUpdatePreview);
});
document.querySelectorAll('input[name="ciTrendDirection"]').forEach(r => r.addEventListener('change', ciUpdatePreview));

// Wire alert input changes into preview
['ciAlertObsMatch','ciAlertAmber','ciAlertRed','ciAlertUnit','ciAlertWithinDays'].forEach(id => {
  getEl(id)?.addEventListener('input', ciUpdatePreview);
});
getEl('ciAlertComparator')?.addEventListener('change', ciUpdatePreview);

// ── Alert Library ─────────────────────────────────────────────────────────

(function initAlertLibrary() {
  const panel = getEl('alertLibraryPanel');
  const toggleBtn = getEl('libToggleBtn');
  const body = getEl('libBody');
  const placeholder = getEl('libPlaceholder');
  const toast = getEl('libToast');
  const unlockBanner = getEl('libUnlockBanner');
  const unlockBtn = getEl('libUnlockBtn');
  const addAllBar = getEl('libAddAllBar');
  const addAllBtn = getEl('libAddAllBtn');
  const addAllCount = getEl('libAddAllCount');
  if (!panel || !toggleBtn) return;

  const ACK_KEY = 'sentinel.alertLibrary.acknowledged';
  let libData = null;  // cached library JSON
  let libLoaded = false;
  let acknowledged = false;

  async function loadAcknowledgement() {
    const r = await chrome.storage.local.get(ACK_KEY);
    acknowledged = r[ACK_KEY] === true;
    applyLockState();
  }
  function applyLockState() {
    if (!body || !unlockBanner) return;
    if (acknowledged) {
      body.classList.remove('lib-locked');
      unlockBanner.hidden = true;
    } else {
      body.classList.add('lib-locked');
      unlockBanner.hidden = false;
    }
  }
  unlockBtn?.addEventListener('click', () => {
    acknowledged = true;
    applyLockState();
    showToast('Library enabled — review each alert before relying on it');
    chrome.storage.local.set({ [ACK_KEY]: true }).catch(() => {});
  });
  chrome.storage.onChanged.addListener(changes => {
    if (changes[ACK_KEY]) {
      acknowledged = changes[ACK_KEY].newValue === true;
      applyLockState();
    }
  });
  loadAcknowledgement();

  function showToast(msg) {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2800);
  }

  function sourceBadgeClass(src) {
    if (!src) return 'other';
    const s = src.toUpperCase();
    if (s.includes('PINCER')) return 'pincer';
    return 'other';
  }

  function typeLabel(type) {
    const m = { 'drug-monitoring': 'drug-mon', 'qof-indicator': 'qof', 'drug-combo': 'drug-combo', 'event-count': 'event-count', 'composite': 'composite' };
    return m[type] || type || '';
  }

  async function getExistingRuleTitles() {
    const res = await chrome.storage.local.get('sentinel.customRules');
    const rules = res['sentinel.customRules'] || [];
    // Match by label (drug-combo/event-count/composite) or drug.match[0] for drug-monitoring, or indicatorName for qof
    const keys = new Set();
    rules.forEach(r => {
      if (r.label)         keys.add(r.label.toLowerCase().trim());
      if (r.indicatorName) keys.add(r.indicatorName.toLowerCase().trim());
      if (r.drug?.match?.[0]) keys.add(r.drug.match[0].toLowerCase().trim());
    });
    return keys;
  }

  function isAlreadyAdded(entry, existingKeys) {
    const titleKey = (entry.title || '').toLowerCase().trim();
    const labelKey = (entry.rule?.label || entry.rule?.indicatorName || '').toLowerCase().trim();
    return existingKeys.has(titleKey) || (labelKey && existingKeys.has(labelKey));
  }

  async function renderLibrary() {
    if (!libData) { placeholder.textContent = 'Library coming soon.'; return; }
    const existingKeys = await getExistingRuleTitles();
    const library = libData.library || [];
    if (library.length === 0) { placeholder.textContent = 'Library coming soon.'; return; }

    // Group by category
    const groups = {};
    library.forEach(entry => {
      const cat = entry.category || 'Other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(entry);
    });

    placeholder.style.display = 'none';

    // Remove previous renders
    body.querySelectorAll('.lib-category').forEach(el => el.remove());

    Object.entries(groups).forEach(([cat, entries]) => {
      const catEl = document.createElement('div');
      catEl.className = 'lib-category';
      const srcBadge = (entry) => {
        const cls = sourceBadgeClass(entry.source);
        return `<span class="lib-source-badge ${cls}">${escHtml(entry.source || 'Other')}</span>`;
      };
      catEl.innerHTML = `
        <div class="lib-category-title">${escHtml(cat)}</div>
        <div class="lib-cards">
          ${entries.map(entry => {
            const added = isAlreadyAdded(entry, existingKeys);
            return `
              <div class="lib-card" data-lib-id="${escAttr(entry.libId)}">
                <div class="lib-card-body">
                  <div class="lib-card-title">${escHtml(entry.title)}</div>
                  <div class="lib-card-desc">${escHtml(entry.description || '')}</div>
                  <div class="lib-card-meta">
                    ${srcBadge(entry)}
                    <span class="lib-type-badge">${escHtml(typeLabel(entry.rule?.type))}</span>
                    ${entry.subcategory ? `<span style="font-size:10px;color:var(--t5);">${escHtml(entry.subcategory)}</span>` : ''}
                  </div>
                </div>
                <div class="lib-card-action">
                  <button class="lib-add-btn${added ? ' added' : ''}" data-lib-id="${escAttr(entry.libId)}" ${added ? 'disabled' : ''}>
                    ${added ? '✓ Added' : '+ Add'}
                  </button>
                </div>
              </div>`;
          }).join('')}
        </div>`;
      body.appendChild(catEl);
    });

    // Bind add buttons
    body.querySelectorAll('.lib-add-btn:not(.added)').forEach(btn => {
      btn.addEventListener('click', () => addLibraryEntry(btn.dataset.libId));
    });

    // Update "Add all" bar
    const unadded = library.filter(e => e.rule && !isAlreadyAdded(e, existingKeys));
    if (addAllBar) {
      addAllBar.hidden = unadded.length === 0;
      if (addAllCount) addAllCount.textContent = unadded.length > 0 ? `${unadded.length} not yet added` : '';
    }
  }

  async function addLibraryEntry(libId) {
    if (!acknowledged) { showToast('Acknowledge the alpha-feature notice first'); return; }
    if (!libData) return;
    const entry = (libData.library || []).find(e => e.libId === libId);
    if (!entry || !entry.rule) return;

    const rule = JSON.parse(JSON.stringify(entry.rule)); // deep copy
    rule.id = `custom-${libId}-${Date.now().toString(36)}`;
    rule.enabled = true;
    if (!rule.label && !rule.indicatorName) rule.label = entry.title;
    rule._authored = { at: new Date().toISOString(), by: 'library', libId };

    // Validate
    try {
      if (typeof validateCustomRule === 'function') validateCustomRule(rule);
    } catch (e) {
      alert('Library rule validation error: ' + e.message);
      return;
    }

    const res = await chrome.storage.local.get('sentinel.customRules');
    const existing = res['sentinel.customRules'] || [];
    await chrome.storage.local.set({ 'sentinel.customRules': [...existing, rule] });

    showToast('Added — edit in the section below');

    if (rule.type === 'composite') {
      const hasPlaceholder = (rule.ruleIds || []).some(id => id.includes('replace-with'));
      if (hasPlaceholder) {
        setTimeout(() => showToast('⚠ Edit this composite to select your actual rules'), 1500);
      }
    }

    // Re-render library cards to mark as added
    await renderLibrary();

    // Focus the relevant section and highlight the new card
    const type = rule.type;
    const sectionMap = {
      'drug-monitoring': 'crList',
      'qof-indicator':   'ciList',
      'drug-combo':      'dcList',
      'event-count':     'ecList',
      'composite':       'cmList',
    };
    const listId = sectionMap[type];
    if (listId) {
      // Re-render the appropriate list
      if (type === 'drug-monitoring')  { await renderCrList();  focusNewCard('crList', rule.id); }
      else if (type === 'qof-indicator') { await ciRenderList(); focusNewCard('ciList', rule.id); }
      else if (type === 'drug-combo')  { await dcRenderList();  focusNewCard('dcList', rule.id); }
      else if (type === 'event-count') { await ecRenderList();  focusNewCard('ecList', rule.id); }
      else if (type === 'composite')   { await cmRenderList();  focusNewCard('cmList', rule.id); }
    }
  }

  async function addAllLibraryEntries() {
    if (!acknowledged) { showToast('Acknowledge the alpha-feature notice first'); return; }
    if (!libData) return;
    const existingKeys = await getExistingRuleTitles();
    const toAdd = (libData.library || []).filter(e => e.rule && !isAlreadyAdded(e, existingKeys));
    if (toAdd.length === 0) { showToast('All alerts already added'); return; }

    const res = await chrome.storage.local.get('sentinel.customRules');
    const existing = res['sentinel.customRules'] || [];
    const newRules = [];
    for (const entry of toAdd) {
      const rule = JSON.parse(JSON.stringify(entry.rule));
      rule.id = `custom-${entry.libId}-${Date.now().toString(36)}`;
      rule.enabled = true;
      if (!rule.label && !rule.indicatorName) rule.label = entry.title;
      rule._authored = { at: new Date().toISOString(), by: 'library', libId: entry.libId };
      try {
        if (typeof validateCustomRule === 'function') validateCustomRule(rule);
        newRules.push(rule);
      } catch (_) { /* skip invalid */ }
    }
    const skipped = toAdd.length - newRules.length;
    await chrome.storage.local.set({ 'sentinel.customRules': [...existing, ...newRules] });
    const skippedNote = skipped > 0 ? `, ${skipped} skipped (invalid)` : '';
    showToast(`Added ${newRules.length} alert${newRules.length !== 1 ? 's' : ''}${skippedNote} — edit in the sections below`);
    await renderLibrary();
    await renderCrList();
    await ciRenderList();
    await dcRenderList();
    await ecRenderList();
    await cmRenderList();
  }

  addAllBtn?.addEventListener('click', addAllLibraryEntries);

  function focusNewCard(listId, ruleId) {
    const card = document.querySelector(`#${listId} .cr-card[data-rule-id="${CSS.escape(ruleId)}"]`);
    if (card) {
      card.classList.add('flash');
      setTimeout(() => card.classList.remove('flash'), 1500);
    }
  }

  async function loadLibrary() {
    if (libLoaded) { await renderLibrary(); return; }
    try {
      const url = chrome.runtime.getURL('rules/alert-library.json');
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      libData = await resp.json();
      libLoaded = true;
    } catch (e) {
      libData = null;
      libLoaded = true; // don't retry on error
      placeholder.textContent = 'Library coming soon — alert-library.json not yet available.';
      placeholder.style.display = 'block';
      return;
    }
    await renderLibrary();
  }

  toggleBtn.addEventListener('click', async () => {
    const isOpen = panel.classList.toggle('open');
    toggleBtn.setAttribute('aria-expanded', String(isOpen));
    if (isOpen) await loadLibrary();
  });

  // Also reload library when the custom rules tab is activated (in case rules were added)
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.tab === 'customrules' && panel.classList.contains('open')) {
        renderLibrary();
      }
    });
  });
})();

// ── Drug-Combo Alerts ─────────────────────────────────────────────────────

let dcEditingId = null;
let dcSetCount = 0;

function dcGetFormRule() {
  const label = (getEl('dcLabel')?.value || '').trim();
  const severity = document.querySelector('input[name="dcSeverity"]:checked')?.value || 'red';
  const notes = (getEl('dcNotes')?.value || '').trim() || null;
  const source = (getEl('dcSource')?.value || '').trim() || null;
  const sex = document.querySelector('input[name="dcSex"]:checked')?.value || 'any';

  const ageMinRaw = (getEl('dcAgeMin')?.value || '').trim();
  const ageMaxRaw = (getEl('dcAgeMax')?.value || '').trim();
  const requiresProblem = (getEl('dcRequiresProblem')?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
  const excludesProblem = (getEl('dcExcludesProblem')?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
  const mustNotBePresent = (getEl('dcMustNotBePresent')?.value || '').split('\n').map(s => s.trim()).filter(Boolean);

  const setCards = document.querySelectorAll('.dc-set-card');
  const drugSets = Array.from(setCards).map(card => {
    const idx = card.dataset.setIdx;
    const name = (document.getElementById(`dcSetName_${idx}`)?.value || '').trim();
    const match = (document.getElementById(`dcSetMatch_${idx}`)?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
    const exclude = (document.getElementById(`dcSetExclude_${idx}`)?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
    return { name, match, exclude };
  }).filter(s => s.name || s.match.length);

  const rule = {
    type: 'drug-combo',
    enabled: true,
    label,
    drugSets,
    severity,
    sex,
    notes,
    source: source || 'Custom rule (user-authored)',
  };
  if (ageMinRaw || ageMaxRaw) {
    rule.ageRange = {};
    if (ageMinRaw) rule.ageRange.min = parseInt(ageMinRaw, 10);
    if (ageMaxRaw) rule.ageRange.max = parseInt(ageMaxRaw, 10);
  }
  if (requiresProblem.length) rule.requiresProblem = requiresProblem;
  if (excludesProblem.length) rule.excludesProblem = excludesProblem;
  if (mustNotBePresent.length) rule.mustNotBePresent = mustNotBePresent;
  return rule;
}

function dcAddSetCard(existing) {
  const idx = dcSetCount++;
  const card = document.createElement('div');
  card.className = 'dc-set-card';
  card.dataset.setIdx = idx;
  card.innerHTML = `
    <div class="dc-set-header">
      <span class="dc-set-title">Drug set ${idx + 1}</span>
      <button class="ghost danger dc-remove-set" data-idx="${idx}" title="Remove set">✕</button>
    </div>
    <div class="field">
      <label for="dcSetName_${idx}">Set name (e.g. Anticoagulant)</label>
      <input type="text" id="dcSetName_${idx}" placeholder="e.g. NSAID" value="${escAttr(existing?.name || '')}" />
    </div>
    <div class="field">
      <label for="dcSetMatch_${idx}">Match terms (one per line)</label>
      <textarea id="dcSetMatch_${idx}" rows="3" style="height:56px;" placeholder="warfarin&#10;apixaban">${escHtml((existing?.match || []).join('\n'))}</textarea>
    </div>
    <div class="field">
      <label for="dcSetExclude_${idx}">Exclude terms (optional, one per line)</label>
      <textarea id="dcSetExclude_${idx}" rows="2" style="height:40px;" placeholder="topical">${escHtml((existing?.exclude || []).join('\n'))}</textarea>
    </div>`;
  card.querySelector('.dc-remove-set').addEventListener('click', () => card.remove());
  getEl('dcSetCards').appendChild(card);
}

async function dcRenderList() {
  const res = await chrome.storage.local.get('sentinel.customRules');
  const rules = (res['sentinel.customRules'] || []).filter(r => r.type === 'drug-combo');
  const list = getEl('dcList');
  if (!list) return;
  if (rules.length === 0) { list.innerHTML = '<div class="cr-empty">No drug-combo alerts yet.</div>'; return; }
  list.innerHTML = rules.map(rule => {
    const disabled = rule.enabled === false;
    const setsLabel = (rule.drugSets || []).map(s => s.name || s.match?.[0] || '?').join(' + ');
    const sevClass = rule.severity || 'info';
    return `
      <div class="cr-card${disabled ? ' disabled' : ''}" data-rule-id="${escHtml(rule.id)}">
        <div class="cr-card-info">
          <div class="cr-card-name">${escHtml(rule.label || rule.id)} <span class="sev-badge ${sevClass}">${escHtml(sevClass)}</span></div>
          <div class="cr-card-meta">${escHtml(setsLabel)} · ${disabled ? 'disabled' : 'enabled'}</div>
        </div>
        <div class="cr-card-actions">
          <button class="ghost dc-edit-btn" data-id="${escHtml(rule.id)}">Edit</button>
          <button class="ghost dc-toggle-btn" data-id="${escHtml(rule.id)}">${disabled ? 'Enable' : 'Disable'}</button>
          <button class="ghost danger dc-delete-btn" data-id="${escHtml(rule.id)}">Delete</button>
        </div>
      </div>`;
  }).join('');
  list.querySelectorAll('.dc-edit-btn').forEach(btn => btn.addEventListener('click', () => dcOpenForm(btn.dataset.id)));
  list.querySelectorAll('.dc-toggle-btn').forEach(btn => btn.addEventListener('click', async () => {
    const r2 = await chrome.storage.local.get('sentinel.customRules');
    const arr = r2['sentinel.customRules'] || [];
    await chrome.storage.local.set({ 'sentinel.customRules': arr.map(r => r.id === btn.dataset.id ? { ...r, enabled: r.enabled === false } : r) });
    dcRenderList();
  }));
  list.querySelectorAll('.dc-delete-btn').forEach(btn => btn.addEventListener('click', async () => {
    if (!await confirmDeleteWithRefs(btn.dataset.id, 'Delete this drug-combo alert?')) return;
    const r2 = await chrome.storage.local.get('sentinel.customRules');
    const arr = r2['sentinel.customRules'] || [];
    await chrome.storage.local.set({ 'sentinel.customRules': arr.filter(r => r.id !== btn.dataset.id) });
    dcRenderList();
  }));
}

async function dcOpenForm(editId) {
  dcEditingId = editId || null;
  dcSetCount = 0;
  getEl('dcListView').style.display = 'none';
  getEl('dcFormView').style.display = 'block';
  getEl('dcFormTitle').textContent = editId ? 'Edit drug-combo alert' : 'New drug-combo alert';
  getEl('dcFormError').textContent = '';
  getEl('dcSetCards').innerHTML = '';
  // Reset fields
  getEl('dcLabel').value = '';
  getEl('dcNotes').value = '';
  getEl('dcSource').value = '';
  getEl('dcAgeMin').value = '';
  getEl('dcAgeMax').value = '';
  getEl('dcRequiresProblem').value = '';
  getEl('dcExcludesProblem').value = '';
  if (getEl('dcMustNotBePresent')) getEl('dcMustNotBePresent').value = '';
  document.querySelector('input[name="dcSeverity"][value="red"]').checked = true;
  document.querySelector('input[name="dcSex"][value="any"]').checked = true;

  if (editId) {
    const res = await chrome.storage.local.get('sentinel.customRules');
    const rule = (res['sentinel.customRules'] || []).find(r => r.id === editId);
    if (rule) {
      getEl('dcLabel').value = rule.label || '';
      getEl('dcNotes').value = rule.notes || '';
      getEl('dcSource').value = rule.source === 'Custom rule (user-authored)' ? '' : (rule.source || '');
      if (rule.ageRange?.min != null) getEl('dcAgeMin').value = rule.ageRange.min;
      if (rule.ageRange?.max != null) getEl('dcAgeMax').value = rule.ageRange.max;
      getEl('dcRequiresProblem').value = (rule.requiresProblem || []).join('\n');
      getEl('dcExcludesProblem').value = (rule.excludesProblem || []).join('\n');
      if (getEl('dcMustNotBePresent')) getEl('dcMustNotBePresent').value = (rule.mustNotBePresent || []).join('\n');
      const sevEl = document.querySelector(`input[name="dcSeverity"][value="${rule.severity || 'red'}"]`);
      if (sevEl) sevEl.checked = true;
      const sexEl = document.querySelector(`input[name="dcSex"][value="${rule.sex || 'any'}"]`);
      if (sexEl) sexEl.checked = true;
      (rule.drugSets || []).forEach(s => dcAddSetCard(s));
    }
    if (!getEl('dcSetCards').children.length) dcAddSetCard();
  } else {
    dcAddSetCard();
    dcAddSetCard();
  }
}

function dcCloseForm() {
  getEl('dcFormView').style.display = 'none';
  getEl('dcListView').style.display = 'block';
  dcEditingId = null;
  dcSetCount = 0;
  dcRenderList();
}

// Wire dc form
getEl('dcAddBtn')?.addEventListener('click', () => dcOpenForm(null));
getEl('dcCancelBtn')?.addEventListener('click', dcCloseForm);
getEl('dcCancelBtn2')?.addEventListener('click', dcCloseForm);
getEl('dcAddSetBtn')?.addEventListener('click', () => dcAddSetCard());

// Patient filters toggle
(function initDcFilters() {
  const toggle = getEl('dcFiltersToggle');
  const body = getEl('dcFiltersBody');
  if (!toggle || !body) return;
  toggle.addEventListener('click', () => {
    const open = toggle.classList.toggle('open');
    body.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
  });
})();

getEl('dcSaveBtn')?.addEventListener('click', async () => {
  const rule = dcGetFormRule();
  const errEl = getEl('dcFormError');
  errEl.textContent = '';

  if (!rule.label) { errEl.textContent = 'Alert label is required.'; return; }
  if (!rule.drugSets || rule.drugSets.length === 0) { errEl.textContent = 'Add at least one drug set.'; return; }
  for (const [i, s] of rule.drugSets.entries()) {
    if (!s.name) { errEl.textContent = `Drug set ${i+1}: name is required.`; return; }
    if (!s.match.length) { errEl.textContent = `Drug set ${i+1}: add at least one match term.`; return; }
  }

  try { validateCustomRule({ ...rule, id: dcEditingId || 'custom-temp' }); } catch (e) { errEl.textContent = e.message; return; }

  const res = await chrome.storage.local.get('sentinel.customRules');
  const existing = res['sentinel.customRules'] || [];

  if (dcEditingId) {
    const updated = existing.map(r => r.id === dcEditingId ? {
      ...r, ...rule, id: dcEditingId,
      _authored: r._authored || { at: new Date().toISOString(), by: 'user' },
      _edited: new Date().toISOString(),
    } : r);
    await chrome.storage.local.set({ 'sentinel.customRules': updated });
  } else {
    const slug = rule.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    rule.id = `custom-dc-${slug}-${Math.floor(Date.now()/1000)}`;
    rule._authored = { at: new Date().toISOString(), by: 'user' };
    await chrome.storage.local.set({ 'sentinel.customRules': [...existing, rule] });
  }
  dcCloseForm();
});

wireFormPreview('dc', 'dcFormView', dcGetFormRule);

// ── Event-Count Alerts ────────────────────────────────────────────────────

let ecEditingId = null;

function ecGetFormRule() {
  const label = (getEl('ecLabel')?.value || '').trim();
  const severity = document.querySelector('input[name="ecSeverity"]:checked')?.value || 'amber';
  const sourceKind = document.querySelector('input[name="ecSourceKind"]:checked')?.value || 'problems';
  const match = (getEl('ecMatch')?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
  const exclude = (getEl('ecExclude')?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
  const windowMonths = parseFloat(getEl('ecWindowMonths')?.value || '12');
  const operator = getEl('ecOperator')?.value || '>=';
  const countThreshold = parseFloat(getEl('ecCountThreshold')?.value || '3');
  const sex = document.querySelector('input[name="ecSex"]:checked')?.value || 'any';
  const ageMinRaw = (getEl('ecAgeMin')?.value || '').trim();
  const ageMaxRaw = (getEl('ecAgeMax')?.value || '').trim();
  const notes = (getEl('ecNotes')?.value || '').trim() || null;

  const rule = {
    type: 'event-count',
    enabled: true,
    label,
    sourceKind,
    match,
    windowMonths,
    operator,
    countThreshold,
    severity,
    sex,
    notes,
  };
  if (exclude.length) rule.exclude = exclude;
  if (ageMinRaw || ageMaxRaw) {
    rule.ageRange = {};
    if (ageMinRaw) rule.ageRange.min = parseInt(ageMinRaw, 10);
    if (ageMaxRaw) rule.ageRange.max = parseInt(ageMaxRaw, 10);
  }
  return rule;
}

async function ecRenderList() {
  const res = await chrome.storage.local.get('sentinel.customRules');
  const rules = (res['sentinel.customRules'] || []).filter(r => r.type === 'event-count');
  const list = getEl('ecList');
  if (!list) return;
  if (rules.length === 0) { list.innerHTML = '<div class="cr-empty">No event-count alerts yet.</div>'; return; }
  list.innerHTML = rules.map(rule => {
    const disabled = rule.enabled === false;
    const sevClass = rule.severity || 'info';
    const matchDesc = (rule.match || []).slice(0,2).join(', ');
    const meta = `${rule.operator || '>='}${rule.countThreshold} of "${matchDesc}" in ${rule.windowMonths}mo`;
    return `
      <div class="cr-card${disabled ? ' disabled' : ''}" data-rule-id="${escHtml(rule.id)}">
        <div class="cr-card-info">
          <div class="cr-card-name">${escHtml(rule.label || rule.id)} <span class="sev-badge ${sevClass}">${escHtml(sevClass)}</span></div>
          <div class="cr-card-meta">${escHtml(meta)} · ${disabled ? 'disabled' : 'enabled'}</div>
        </div>
        <div class="cr-card-actions">
          <button class="ghost ec-edit-btn" data-id="${escHtml(rule.id)}">Edit</button>
          <button class="ghost ec-toggle-btn" data-id="${escHtml(rule.id)}">${disabled ? 'Enable' : 'Disable'}</button>
          <button class="ghost danger ec-delete-btn" data-id="${escHtml(rule.id)}">Delete</button>
        </div>
      </div>`;
  }).join('');
  list.querySelectorAll('.ec-edit-btn').forEach(btn => btn.addEventListener('click', () => ecOpenForm(btn.dataset.id)));
  list.querySelectorAll('.ec-toggle-btn').forEach(btn => btn.addEventListener('click', async () => {
    const r2 = await chrome.storage.local.get('sentinel.customRules');
    const arr = r2['sentinel.customRules'] || [];
    await chrome.storage.local.set({ 'sentinel.customRules': arr.map(r => r.id === btn.dataset.id ? { ...r, enabled: r.enabled === false } : r) });
    ecRenderList();
  }));
  list.querySelectorAll('.ec-delete-btn').forEach(btn => btn.addEventListener('click', async () => {
    if (!await confirmDeleteWithRefs(btn.dataset.id, 'Delete this event-count alert?')) return;
    const r2 = await chrome.storage.local.get('sentinel.customRules');
    const arr = r2['sentinel.customRules'] || [];
    await chrome.storage.local.set({ 'sentinel.customRules': arr.filter(r => r.id !== btn.dataset.id) });
    ecRenderList();
  }));
}

async function ecOpenForm(editId) {
  ecEditingId = editId || null;
  getEl('ecListView').style.display = 'none';
  getEl('ecFormView').style.display = 'block';
  getEl('ecFormTitle').textContent = editId ? 'Edit event-count alert' : 'New event-count alert';
  getEl('ecFormError').textContent = '';

  // Reset
  getEl('ecLabel').value = '';
  getEl('ecMatch').value = '';
  getEl('ecExclude').value = '';
  getEl('ecWindowMonths').value = 12;
  getEl('ecCountThreshold').value = 3;
  getEl('ecOperator').value = '>=';
  getEl('ecNotes').value = '';
  getEl('ecAgeMin').value = '';
  getEl('ecAgeMax').value = '';
  document.querySelector('input[name="ecSeverity"][value="amber"]').checked = true;
  document.querySelector('input[name="ecSourceKind"][value="problems"]').checked = true;
  document.querySelector('input[name="ecSex"][value="any"]').checked = true;
  getEl('ecObsHint').style.display = 'none';

  if (editId) {
    const res = await chrome.storage.local.get('sentinel.customRules');
    const rule = (res['sentinel.customRules'] || []).find(r => r.id === editId);
    if (rule) {
      getEl('ecLabel').value = rule.label || '';
      getEl('ecMatch').value = (rule.match || []).join('\n');
      getEl('ecExclude').value = (rule.exclude || []).join('\n');
      getEl('ecWindowMonths').value = rule.windowMonths || 12;
      getEl('ecCountThreshold').value = rule.countThreshold ?? 3;
      getEl('ecOperator').value = rule.operator || '>=';
      getEl('ecNotes').value = rule.notes || '';
      if (rule.ageRange?.min != null) getEl('ecAgeMin').value = rule.ageRange.min;
      if (rule.ageRange?.max != null) getEl('ecAgeMax').value = rule.ageRange.max;
      const sevEl = document.querySelector(`input[name="ecSeverity"][value="${rule.severity || 'amber'}"]`);
      if (sevEl) sevEl.checked = true;
      const srcEl = document.querySelector(`input[name="ecSourceKind"][value="${rule.sourceKind || 'problems'}"]`);
      if (srcEl) srcEl.checked = true;
      const sexEl = document.querySelector(`input[name="ecSex"][value="${rule.sex || 'any'}"]`);
      if (sexEl) sexEl.checked = true;
      getEl('ecObsHint').style.display = rule.sourceKind === 'observations' ? 'block' : 'none';
    }
  }
}

function ecCloseForm() {
  getEl('ecFormView').style.display = 'none';
  getEl('ecListView').style.display = 'block';
  ecEditingId = null;
  ecRenderList();
}

// Wire ec form
getEl('ecAddBtn')?.addEventListener('click', () => ecOpenForm(null));
getEl('ecCancelBtn')?.addEventListener('click', ecCloseForm);
getEl('ecCancelBtn2')?.addEventListener('click', ecCloseForm);

document.querySelectorAll('input[name="ecSourceKind"]').forEach(r => {
  r.addEventListener('change', () => {
    getEl('ecObsHint').style.display = r.value === 'observations' && r.checked ? 'block' : 'none';
  });
});

(function initEcFilters() {
  const toggle = getEl('ecFiltersToggle');
  const body = getEl('ecFiltersBody');
  if (!toggle || !body) return;
  toggle.addEventListener('click', () => {
    const open = toggle.classList.toggle('open');
    body.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
  });
})();

getEl('ecSaveBtn')?.addEventListener('click', async () => {
  const rule = ecGetFormRule();
  const errEl = getEl('ecFormError');
  errEl.textContent = '';

  if (!rule.label) { errEl.textContent = 'Alert label is required.'; return; }
  if (!rule.match.length) { errEl.textContent = 'Add at least one match term.'; return; }
  if (isNaN(rule.windowMonths) || rule.windowMonths <= 0) { errEl.textContent = 'Window months must be a positive number.'; return; }
  if (isNaN(rule.countThreshold) || rule.countThreshold < 0) { errEl.textContent = 'Count threshold must be a non-negative number.'; return; }

  try { validateCustomRule({ ...rule, id: ecEditingId || 'custom-temp' }); } catch (e) { errEl.textContent = e.message; return; }

  const res = await chrome.storage.local.get('sentinel.customRules');
  const existing = res['sentinel.customRules'] || [];

  if (ecEditingId) {
    const updated = existing.map(r => r.id === ecEditingId ? {
      ...r, ...rule, id: ecEditingId,
      _authored: r._authored || { at: new Date().toISOString(), by: 'user' },
      _edited: new Date().toISOString(),
    } : r);
    await chrome.storage.local.set({ 'sentinel.customRules': updated });
  } else {
    const slug = rule.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    rule.id = `custom-ec-${slug}-${Math.floor(Date.now()/1000)}`;
    rule._authored = { at: new Date().toISOString(), by: 'user' };
    await chrome.storage.local.set({ 'sentinel.customRules': [...existing, rule] });
  }
  ecCloseForm();
});

wireFormPreview('ec', 'ecFormView', ecGetFormRule);

// ── Composite Alerts ──────────────────────────────────────────────────────

let cmEditingId = null;
let _cmAllRules = []; // cache of all custom rules, refreshed when the selector builds

// Build the composite rule from the form (for the live preview / validation).
function cmGetFormRule() {
  return {
    type: 'composite', enabled: true,
    label: (getEl('cmLabel')?.value || '').trim(),
    operator: document.querySelector('input[name="cmOperator"]:checked')?.value || 'AND',
    ruleIds: Array.from(document.querySelectorAll('input[name="cmRuleId"]:checked')).map(cb => cb.value),
    severity: document.querySelector('input[name="cmSeverity"]:checked')?.value || 'red',
    notes: (getEl('cmNotes')?.value || '').trim() || null,
  };
}
// The referenced child rules — passed to the engine so the composite can resolve them.
function cmExtraRules() {
  const ids = new Set(Array.from(document.querySelectorAll('input[name="cmRuleId"]:checked')).map(cb => cb.value));
  return _cmAllRules.filter(r => ids.has(r.id) && r.type !== 'composite');
}

async function cmRenderList() {
  const res = await chrome.storage.local.get('sentinel.customRules');
  const rules = (res['sentinel.customRules'] || []).filter(r => r.type === 'composite');
  const list = getEl('cmList');
  if (!list) return;
  if (rules.length === 0) { list.innerHTML = '<div class="cr-empty">No composite alerts yet.</div>'; return; }
  const all = res['sentinel.customRules'] || [];
  const idToLabel = {};
  all.forEach(r => { idToLabel[r.id] = r.label || r.indicatorCode || r.drug?.match?.[0] || r.id; });
  list.innerHTML = rules.map(rule => {
    const disabled = rule.enabled === false;
    const sevClass = rule.severity || 'info';
    const refLabels = (rule.ruleIds || []).map(id => idToLabel[id] || id).join(` ${rule.operator || 'AND'} `);
    return `
      <div class="cr-card${disabled ? ' disabled' : ''}" data-rule-id="${escHtml(rule.id)}">
        <div class="cr-card-info">
          <div class="cr-card-name">${escHtml(rule.label || rule.id)} <span class="sev-badge ${sevClass}">${escHtml(sevClass)}</span></div>
          <div class="cr-card-meta">${escHtml(refLabels)} · ${disabled ? 'disabled' : 'enabled'}</div>
        </div>
        <div class="cr-card-actions">
          <button class="ghost cm-edit-btn" data-id="${escHtml(rule.id)}">Edit</button>
          <button class="ghost cm-toggle-btn" data-id="${escHtml(rule.id)}">${disabled ? 'Enable' : 'Disable'}</button>
          <button class="ghost danger cm-delete-btn" data-id="${escHtml(rule.id)}">Delete</button>
        </div>
      </div>`;
  }).join('');
  list.querySelectorAll('.cm-edit-btn').forEach(btn => btn.addEventListener('click', () => cmOpenForm(btn.dataset.id)));
  list.querySelectorAll('.cm-toggle-btn').forEach(btn => btn.addEventListener('click', async () => {
    const r2 = await chrome.storage.local.get('sentinel.customRules');
    const arr = r2['sentinel.customRules'] || [];
    await chrome.storage.local.set({ 'sentinel.customRules': arr.map(r => r.id === btn.dataset.id ? { ...r, enabled: r.enabled === false } : r) });
    cmRenderList();
  }));
  list.querySelectorAll('.cm-delete-btn').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('Delete this composite alert?')) return;
    const r2 = await chrome.storage.local.get('sentinel.customRules');
    const arr = r2['sentinel.customRules'] || [];
    await chrome.storage.local.set({ 'sentinel.customRules': arr.filter(r => r.id !== btn.dataset.id) });
    cmRenderList();
  }));
}

async function cmBuildRuleSelector(selectedIds, currentEditId) {
  const ruleList = getEl('cmRuleList');
  if (!ruleList) return;
  const res = await chrome.storage.local.get('sentinel.customRules');
  _cmAllRules = res['sentinel.customRules'] || [];
  const all = _cmAllRules.filter(r => r.id !== currentEditId);
  // Non-composite rules only
  const eligible = all.filter(r => r.type !== 'composite');
  const composites = all.filter(r => r.type === 'composite');
  if (eligible.length === 0 && composites.length === 0) {
    ruleList.innerHTML = '<div class="cm-rule-empty">No eligible rules yet — create drug-monitoring, drug-combo, or event-count rules first.</div>';
    return;
  }
  const selectedSet = new Set(selectedIds || []);
  const rows = eligible.map(r => {
    const label = r.label || r.indicatorCode || r.drug?.match?.[0] || r.id;
    const type = r.type;
    const checked = selectedSet.has(r.id) ? 'checked' : '';
    return `
      <label class="cm-rule-item">
        <input type="checkbox" name="cmRuleId" value="${escAttr(r.id)}" ${checked} />
        <span class="cm-rule-item-label">${escHtml(label)}</span>
        <span class="cm-rule-item-type">${escHtml(type)}</span>
      </label>`;
  });
  // Add composites (marked, will trigger warning if selected)
  const compositeRows = composites.map(r => {
    const label = r.label || r.id;
    const checked = selectedSet.has(r.id) ? 'checked' : '';
    return `
      <label class="cm-rule-item">
        <input type="checkbox" name="cmRuleId" value="${escAttr(r.id)}" ${checked} data-is-composite="1" />
        <span class="cm-rule-item-label">${escHtml(label)}</span>
        <span class="cm-rule-item-type">composite ⚠</span>
      </label>`;
  });
  ruleList.innerHTML = [...rows, ...compositeRows].join('') || '<div class="cm-rule-empty">No eligible rules.</div>';

  // Wire composite warning
  ruleList.querySelectorAll('input[name="cmRuleId"]').forEach(cb => {
    cb.addEventListener('change', cmCheckCompositeWarn);
  });
}

function cmCheckCompositeWarn() {
  const anyCompositeChecked = Array.from(document.querySelectorAll('input[name="cmRuleId"][data-is-composite="1"]')).some(cb => cb.checked);
  getEl('cmCompositeWarn').style.display = anyCompositeChecked ? 'block' : 'none';
}

async function cmOpenForm(editId) {
  cmEditingId = editId || null;
  getEl('cmListView').style.display = 'none';
  getEl('cmFormView').style.display = 'block';
  getEl('cmFormTitle').textContent = editId ? 'Edit composite alert' : 'New composite alert';
  getEl('cmFormError').textContent = '';
  getEl('cmCompositeWarn').style.display = 'none';
  // Reset
  getEl('cmLabel').value = '';
  getEl('cmNotes').value = '';
  document.querySelector('input[name="cmSeverity"][value="red"]').checked = true;
  document.querySelector('input[name="cmOperator"][value="AND"]').checked = true;

  let selectedIds = [];
  if (editId) {
    const res = await chrome.storage.local.get('sentinel.customRules');
    const rule = (res['sentinel.customRules'] || []).find(r => r.id === editId);
    if (rule) {
      getEl('cmLabel').value = rule.label || '';
      getEl('cmNotes').value = rule.notes || '';
      const sevEl = document.querySelector(`input[name="cmSeverity"][value="${rule.severity || 'red'}"]`);
      if (sevEl) sevEl.checked = true;
      const opEl = document.querySelector(`input[name="cmOperator"][value="${rule.operator || 'AND'}"]`);
      if (opEl) opEl.checked = true;
      selectedIds = rule.ruleIds || [];
    }
  }
  await cmBuildRuleSelector(selectedIds, editId);
}

function cmCloseForm() {
  getEl('cmFormView').style.display = 'none';
  getEl('cmListView').style.display = 'block';
  cmEditingId = null;
  cmRenderList();
}

// Wire cm form
getEl('cmAddBtn')?.addEventListener('click', () => cmOpenForm(null));
getEl('cmCancelBtn')?.addEventListener('click', cmCloseForm);
getEl('cmCancelBtn2')?.addEventListener('click', cmCloseForm);

getEl('cmSaveBtn')?.addEventListener('click', async () => {
  const errEl = getEl('cmFormError');
  errEl.textContent = '';
  const label = (getEl('cmLabel')?.value || '').trim();
  const severity = document.querySelector('input[name="cmSeverity"]:checked')?.value || 'red';
  const operator = document.querySelector('input[name="cmOperator"]:checked')?.value || 'AND';
  const notes = (getEl('cmNotes')?.value || '').trim() || null;

  const checkedBoxes = Array.from(document.querySelectorAll('input[name="cmRuleId"]:checked'));
  const ruleIds = checkedBoxes.map(cb => cb.value);
  const hasComposite = checkedBoxes.some(cb => cb.dataset.isComposite === '1');

  if (!label) { errEl.textContent = 'Alert label is required.'; return; }
  if (ruleIds.length < 2) { errEl.textContent = 'Select at least two rules to combine.'; return; }
  if (hasComposite) { errEl.textContent = 'Remove composite rules from the selection — nesting composites is not allowed.'; return; }

  const rule = { type: 'composite', enabled: true, label, operator, ruleIds, severity, notes };

  try { validateCustomRule({ ...rule, id: cmEditingId || 'custom-temp' }); } catch (e) { errEl.textContent = e.message; return; }

  const res = await chrome.storage.local.get('sentinel.customRules');
  const existing = res['sentinel.customRules'] || [];
  if (cmEditingId) {
    const updated = existing.map(r => r.id === cmEditingId ? {
      ...r, ...rule, id: cmEditingId,
      _authored: r._authored || { at: new Date().toISOString(), by: 'user' },
      _edited: new Date().toISOString(),
    } : r);
    await chrome.storage.local.set({ 'sentinel.customRules': updated });
  } else {
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    rule.id = `custom-cm-${slug}-${Math.floor(Date.now()/1000)}`;
    rule._authored = { at: new Date().toISOString(), by: 'user' };
    await chrome.storage.local.set({ 'sentinel.customRules': [...existing, rule] });
  }
  cmCloseForm();
});

wireFormPreview('cm', 'cmFormView', cmGetFormRule, cmExtraRules);

// ── Patch tab switch to render all new lists ──────────────────────────────

// The tab-nav listener at the top calls renderCrList() and ciRenderList().
// Extend it to also render the three new section lists.
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.tab === 'customrules') {
      dcRenderList();
      ecRenderList();
      cmRenderList();
    }
  });
});

// Render on load if already on customrules tab
if (document.querySelector('.tab-btn.active')?.dataset.tab === 'customrules') {
  dcRenderList();
  ecRenderList();
  cmRenderList();
}

// ── Hidden / Snoozed Alerts + Manage Alerts (Display tab) ─────────────────────
// Hidden Alerts lists everything in sentinel.hiddenRules with an Enable button.
// Manage Alerts hard-toggles the bundled vaccine rules on/off (a permanent hide
// recorded in the same sentinel.hiddenRules map, with until: null).

let _vaccineRulesCache = null;

async function loadVaccineRules() {
  if (_vaccineRulesCache) return _vaccineRulesCache;
  try {
    const url = chrome.runtime.getURL('rules/vaccine-rules.json');
    const res = await fetch(url);
    const json = await res.json();
    _vaccineRulesCache = json.rules || [];
  } catch {
    _vaccineRulesCache = [];
  }
  return _vaccineRulesCache;
}

// Resolve a friendly display name for a hidden rule id, falling back to the id.
function ruleDisplayName(ruleId, vaccineRules) {
  const v = (vaccineRules || []).find(r => r.id === ruleId);
  return v?.displayName || ruleId;
}

// Human-readable label for a statusAtDismissal value (mirrors STATUS_LABEL in sentinel.js
// and shared/chip-renderer.js). Used in the hidden-alerts review screen.
const HIDDEN_STATUS_LABEL = {
  overdue: 'OVERDUE', not_met: 'NOT MET', alert: 'ALERT', stale: 'SEVERELY OVERDUE',
  due_soon: 'DUE SOON', caution: 'CAUTION', no_data: 'NO DATA', noted: 'NOTED',
  recently_initiated: 'NEW', achieved: 'MET', in_date: 'IN DATE',
  vax_due: 'DUE', vax_given: 'GIVEN', vax_declined: 'DECLINED',
};

async function renderHiddenRulesList() {
  const list = getEl('hiddenRulesList');
  if (!list) return;
  const [res, vaccineRules] = await Promise.all([
    chrome.storage.local.get('sentinel.hiddenRules'),
    loadVaccineRules(),
  ]);
  const hidden = res['sentinel.hiddenRules'] || {};
  const ids = Object.keys(hidden);
  if (ids.length === 0) {
    list.innerHTML = '<div class="cr-empty">No alerts are currently hidden.</div>';
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  list.innerHTML = ids.map(id => {
    const entry = hidden[id] || {};
    const untilText = entry.until ? `hidden until ${escHtml(entry.until)}` : 'permanently hidden';
    // Dismissal date and age
    let dismissMeta = '';
    if (entry.dismissedAt) {
      const daysDiff = Math.round((new Date(today) - new Date(entry.dismissedAt)) / 86400000);
      const ageText = daysDiff === 0 ? 'today' : daysDiff === 1 ? '1 day ago' : `${daysDiff} days ago`;
      dismissMeta = ` · dismissed ${escHtml(entry.dismissedAt)} (${ageText})`;
    } else {
      dismissMeta = ' · dismissed before v3.37';
    }
    // Status at dismissal
    let statusMeta = '';
    if (entry.statusAtDismissal) {
      const lbl = HIDDEN_STATUS_LABEL[entry.statusAtDismissal] || escHtml(entry.statusAtDismissal.toUpperCase());
      statusMeta = ` · was ${escHtml(lbl)}`;
    }
    return `
      <div class="cr-card" data-rule-id="${escAttr(id)}">
        <div class="cr-card-info">
          <div class="cr-card-name">${escHtml(ruleDisplayName(id, vaccineRules))}</div>
          <div class="cr-card-meta">${escHtml(id)} · ${untilText}${dismissMeta}${statusMeta}</div>
        </div>
        <div class="cr-card-actions">
          <button class="ghost hidden-enable-btn" data-id="${escAttr(id)}">Enable</button>
        </div>
      </div>`;
  }).join('');
  list.querySelectorAll('.hidden-enable-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const r = await chrome.storage.local.get('sentinel.hiddenRules');
      const h = r['sentinel.hiddenRules'] || {};
      delete h[btn.dataset.id];
      await chrome.storage.local.set({ 'sentinel.hiddenRules': h });
      renderHiddenRulesList();
      renderManageRulesList();
    });
  });
}

async function renderManageRulesList() {
  const list = getEl('manageRulesList');
  if (!list) return;
  const [res, vaccineRules] = await Promise.all([
    chrome.storage.local.get('sentinel.hiddenRules'),
    loadVaccineRules(),
  ]);
  const hidden = res['sentinel.hiddenRules'] || {};
  if (vaccineRules.length === 0) {
    list.innerHTML = '<div class="cr-empty">No bundled alerts found.</div>';
    return;
  }
  // A rule is "off" here only when permanently hidden (until null). A snooze is
  // managed from the Hidden Alerts section above, not toggled here.
  list.innerHTML = vaccineRules.map(rule => {
    const entry = hidden[rule.id];
    const off = !!entry && entry.until == null;
    return `
      <div class="cr-card${off ? ' disabled' : ''}" data-rule-id="${escAttr(rule.id)}">
        <div class="cr-card-info">
          <div class="cr-card-name">${escHtml(rule.displayName || rule.id)}</div>
          <div class="cr-card-meta">${escHtml(rule.id)} · ${off ? 'off' : 'on'}</div>
        </div>
        <div class="cr-card-actions">
          <button class="ghost manage-toggle-btn" data-id="${escAttr(rule.id)}">${off ? 'Enable' : 'Disable'}</button>
        </div>
      </div>`;
  }).join('');
  list.querySelectorAll('.manage-toggle-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const r = await chrome.storage.local.get('sentinel.hiddenRules');
      const h = r['sentinel.hiddenRules'] || {};
      const id = btn.dataset.id;
      if (h[id] && h[id].until == null) delete h[id]; // currently off → turn on
      else h[id] = { until: null };                   // turn permanently off
      await chrome.storage.local.set({ 'sentinel.hiddenRules': h });
      renderManageRulesList();
      renderHiddenRulesList();
    });
  });
}

// Re-render the Display-tab lists whenever hidden rules change elsewhere.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes['sentinel.hiddenRules']) {
    renderHiddenRulesList();
    renderManageRulesList();
  }
});

renderHiddenRulesList();
renderManageRulesList();
