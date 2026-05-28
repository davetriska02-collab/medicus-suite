// Sentinel options page — v1.2.0
// Tabs: Display | Custom Rules | Rule Overrides
'use strict';

(function applyDisplayPrefs() {
  function apply(p) {
    p = p || {};
    document.documentElement.setAttribute('data-theme',      p.theme      || 'light');
    document.documentElement.setAttribute('data-size',       p.size       || 'medium');
    document.documentElement.setAttribute('data-colorblind', String(!!p.colorblind));
  }
  chrome.storage.local.get('suite.display', r => apply(r['suite.display'] || {}));
  chrome.storage.onChanged.addListener(c => { if (c['suite.display']) apply(c['suite.display'].newValue || {}); });
})();

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
    const intervalNum = parseInt(document.getElementById(`crTestIntervalNum_${idx}`)?.value || '84', 10);
    const intervalUnit = document.getElementById(`crTestIntervalUnit_${idx}`)?.value || 'weeks';
    const dueSoonNum = parseInt(document.getElementById(`crTestDueSoon_${idx}`)?.value || '28', 10);
    const intervalDays = unitToDays(intervalNum, intervalUnit);
    return { name, match: matchRaw.length ? matchRaw : [name.toLowerCase()], intervalDays, dueSoonDays: dueSoonNum };
  }).filter(t => t.name);

  return {
    type: 'drug-monitoring',
    drug: { match: drugNames, exclude: excludeNames.length ? excludeNames : undefined },
    drugClass,
    sharedCare,
    tests,
    notes,
    source: source || 'Custom rule (user-authored)',
    enabled: true,
  };
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
  card.querySelector('.cr-remove-test')?.addEventListener('click', () => {
    card.remove(); updatePreview();
  });
}

// Debounced preview update
let previewTimer = null;
function updatePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(_doPreview, 300);
}

function _doPreview() {
  const rule = getFormRule();
  const drugName = rule.drug?.match?.[0] || 'Drug';
  const status = getEl('crPreviewStatus')?.value || 'in_date';
  const previewEl = getEl('crPreviewChip');
  if (!previewEl) return;

  if (!drugName || !rule.tests?.length) {
    previewEl.innerHTML = '<span style="color:var(--t4); font-size:11px; font-style:italic;">Enter drug names and at least one test to see a preview.</span>';
    return;
  }

  const CR = window.ChipRenderer;
  if (!CR) return;
  const chip = CR.buildPreviewChip(rule, status, drugName);
  previewEl.innerHTML = CR.renderDrugChip(chip);
}

// Wire form controls
getEl('crAddBtn')?.addEventListener('click', () => openCrForm(null));
getEl('crCancelBtn')?.addEventListener('click', closeCrForm);
getEl('crCancelBtn2')?.addEventListener('click', closeCrForm);
getEl('crAddTestBtn')?.addEventListener('click', () => { addTestCard(); updatePreview(); });
getEl('crPreviewStatus')?.addEventListener('change', updatePreview);

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

  // Client-side validation
  if (!rule.drug?.match?.length) { errEl.textContent = 'Enter at least one drug name.'; return; }
  if (!rule.tests?.length) { errEl.textContent = 'Add at least one test.'; return; }
  for (const [i, t] of rule.tests.entries()) {
    if (!t.name) { errEl.textContent = `Test ${i+1}: name is required.`; return; }
    if (!t.intervalDays || t.intervalDays <= 0 || t.intervalDays > 3650) { errEl.textContent = `Test ${i+1}: interval must be between 1 and 3650 days.`; return; }
  }

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
  if (excludeFrailty) {
    rule.excludeIfProblem = ['moderate frailty', 'severe frailty'];
  }
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
   'ciMedMatch','ciMedExclude','ciWithinObsMatch'].forEach(id => { const el = getEl(id); if (el) el.value = ''; });
  getEl('ciDualThreshold').checked = false;
  getEl('ciExcludeFrailty').checked = false;
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
  getEl('ciExcludeFrailty').checked = !!(rule.excludeIfProblem && rule.excludeIfProblem.length);
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

function _ciDoPreview() {
  const rule = ciGetFormRule();
  const status = getEl('ciPreviewStatus')?.value || 'achieved';
  const previewEl = getEl('ciPreviewChip');
  if (!previewEl) return;
  if (!rule.indicatorCode || !rule.check) {
    previewEl.innerHTML = '<span style="color:var(--t4); font-size:11px; font-style:italic;">Fill in code, name, and check details to see a preview.</span>';
    return;
  }
  const CR = window.ChipRenderer;
  if (!CR) return;
  const chip = CR.buildQofPreviewChip(rule, status);
  previewEl.innerHTML = CR.renderQofIndicatorChip(chip);
}

// Wire indicator form controls
getEl('ciAddBtn')?.addEventListener('click', () => ciOpenForm(null));
getEl('ciCancelBtn')?.addEventListener('click', ciCloseForm);
getEl('ciCancelBtn2')?.addEventListener('click', ciCloseForm);
document.querySelectorAll('input[name="ciKind"]').forEach(r => r.addEventListener('change', () => { ciSwitchKindSection(); ciUpdatePreview(); }));
getEl('ciDualThreshold')?.addEventListener('change', () => { ciSwitchDualThreshold(); ciUpdatePreview(); });
getEl('ciPreviewStatus')?.addEventListener('change', ciUpdatePreview);

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

// ── Alert Library ─────────────────────────────────────────────────────────

(function initAlertLibrary() {
  const panel = getEl('alertLibraryPanel');
  const toggleBtn = getEl('libToggleBtn');
  const body = getEl('libBody');
  const placeholder = getEl('libPlaceholder');
  const toast = getEl('libToast');
  const unlockBanner = getEl('libUnlockBanner');
  const unlockBtn = getEl('libUnlockBtn');
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
  unlockBtn?.addEventListener('click', async () => {
    acknowledged = true;
    await chrome.storage.local.set({ [ACK_KEY]: true });
    applyLockState();
    showToast('Library enabled — review each alert before relying on it');
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

  function focusNewCard(listId, ruleId) {
    const card = document.querySelector(`#${listId} .cr-card[data-rule-id="${CSS.escape(ruleId)}"]`);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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

function dcOpenForm(editId) {
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
  document.querySelector('input[name="dcSeverity"][value="red"]').checked = true;
  document.querySelector('input[name="dcSex"][value="any"]').checked = true;

  if (editId) {
    chrome.storage.local.get('sentinel.customRules', res => {
      const rule = (res['sentinel.customRules'] || []).find(r => r.id === editId);
      if (rule) {
        getEl('dcLabel').value = rule.label || '';
        getEl('dcNotes').value = rule.notes || '';
        getEl('dcSource').value = rule.source === 'Custom rule (user-authored)' ? '' : (rule.source || '');
        if (rule.ageRange?.min != null) getEl('dcAgeMin').value = rule.ageRange.min;
        if (rule.ageRange?.max != null) getEl('dcAgeMax').value = rule.ageRange.max;
        getEl('dcRequiresProblem').value = (rule.requiresProblem || []).join('\n');
        getEl('dcExcludesProblem').value = (rule.excludesProblem || []).join('\n');
        const sevEl = document.querySelector(`input[name="dcSeverity"][value="${rule.severity || 'red'}"]`);
        if (sevEl) sevEl.checked = true;
        const sexEl = document.querySelector(`input[name="dcSex"][value="${rule.sex || 'any'}"]`);
        if (sexEl) sexEl.checked = true;
        (rule.drugSets || []).forEach(s => dcAddSetCard(s));
      }
      if (!getEl('dcSetCards').children.length) dcAddSetCard();
    });
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

// ── Composite Alerts ──────────────────────────────────────────────────────

let cmEditingId = null;

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
  const all = (res['sentinel.customRules'] || []).filter(r => r.id !== currentEditId);
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
