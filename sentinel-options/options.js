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
          <div class="cr-card-name">${escHtml(rule.drug?.match?.[0] || rule.id)} ${rule.drugClass ? `<span style="font-size:10px;color:var(--t4)">(${escHtml(rule.drugClass)})</span>` : ''}</div>
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
      if (!confirm('Delete this custom rule?')) return;
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
    const toAdd = incoming.filter(r => !existingIds.has(r.id));
    await chrome.storage.local.set({ 'sentinel.customRules': [...existing, ...toAdd] });
    renderCrList();
    alert(`Imported ${toAdd.length} rule(s). ${incoming.length - toAdd.length} skipped (duplicate IDs).`);
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
          <div class="cr-card-name">${escHtml(rule.indicatorCode || rule.id)} <span style="font-size:10px;color:var(--t4)">${escHtml(rule.indicatorName || '')}</span></div>
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
    if (!confirm('Delete this custom indicator?')) return;
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
