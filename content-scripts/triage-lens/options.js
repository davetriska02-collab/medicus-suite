// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Triage Lens — options page logic

(function applyDisplayPrefs() {
  function apply(p) {
    p = p || {};
    document.documentElement.setAttribute('data-theme', p.theme || 'light');
    document.documentElement.setAttribute('data-size', p.size || 'medium');
    document.documentElement.setAttribute('data-colorblind', String(!!p.colorblind));
  }
  chrome.storage.local.get('suite.display', (r) => apply(r['suite.display'] || {}));
  chrome.storage.onChanged.addListener((c) => {
    if (c['suite.display']) apply(c['suite.display'].newValue || {});
  });
})();

(() => {
  'use strict';

  const FIELDS = [
    { id: 'request', label: 'Request body / preview text' },
    { id: 'problems', label: 'Active problems' },
    { id: 'registers', label: 'Registers' },
    { id: 'meds', label: 'Medications' },
    { id: 'allergies', label: 'Allergies' },
    { id: 'banner', label: 'Banner warnings' },
    { id: 'consultations', label: 'Recent consultations' },
    { id: 'docs', label: 'Recent documents' },
  ];
  const PAGES = [
    { id: 'queue', label: 'Queue list' },
    { id: 'detail', label: 'Task detail' },
    { id: 'record', label: 'Patient record' },
  ];
  const KIND_LABEL = { red: 'RED', amber: 'AMBER', green: 'GREEN', info: 'INFO' };

  // ============================================================
  // STATE
  // ============================================================
  let CONFIG = null; // current edited config
  let DEFAULTS = null; // shipped defaults (read once)
  let editingId = null; // id of rule being edited
  let editingDraft = null; // shallow clone of rule under edit

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];

  const flash = (msg, kind = 'ok') => {
    const el = $('#tlStatus');
    el.textContent = msg;
    el.className = 'tl-status tl-status-' + kind;
    if (msg)
      setTimeout(() => {
        if (el.textContent === msg) {
          el.textContent = '';
        }
      }, 2400);
  };

  // ============================================================
  // STORAGE
  // ============================================================
  const loadConfig = async () => {
    // Phase 0: use namespaced key; fall back to legacy key transparently
    const r = await chrome.storage.local.get(['triagelens.config', 'config']);
    if (r['triagelens.config']) return r['triagelens.config'];
    if (r['config']) return r['config'];
    return await fetchDefaults();
  };

  const fetchDefaults = async () => {
    const url = chrome.runtime.getURL('defaults.json');
    return await fetch(url).then((r) => r.json());
  };

  const saveConfig = async (cfg) => {
    await chrome.storage.local.set({ 'triagelens.config': cfg });
    CONFIG = cfg;
  };

  // ============================================================
  // INITIAL RENDER
  // ============================================================
  // Mirror of the content script's non-destructive defaults migration: when
  // shipped defaults are newer than the stored config, append builtin rules
  // the user doesn't have (honouring removedBuiltins tombstones) and any
  // missing threshold / pref / systemChip keys. Never overwrites user edits.
  // Chip labels shipped in a PRIOR version and SINCE CHANGED. An earlier migration baked
  // the full shipped chip map into each saved config, so once a default label changed the
  // stored (old) label shadowed the new default forever (e.g. the "Urgent:" result-chip
  // prefix, retired in v3.75.0). When a stored chip label still matches a retired default
  // we revert it to the current shipped label. WHEN YOU CHANGE A SHIPPED CHIP LABEL: add
  // its previous value here AND bump defaults.json "version" so this migration runs.
  // Kept in lock-step with the same table in content-scripts/triage-lens/content.js.
  const RETIRED_CHIP_LABELS = {
    'queue.resultUrgent': ['Urgent: {name}'],
    'queue.resultRuleUrgent': ['Urgent: {name} — {rule}', '{name} — {rule}'],
    'queue.resultRuleAbnormal': ['{name} — {rule}'],
  };
  const revertRetiredChipLabels = (chips, shippedChips) => {
    if (!chips || !shippedChips) return;
    for (const id of Object.keys(RETIRED_CHIP_LABELS)) {
      const entry = chips[id];
      const shippedNow = shippedChips[id];
      if (entry && shippedNow && RETIRED_CHIP_LABELS[id].indexOf(entry.label) !== -1) {
        entry.label = shippedNow.label;
      }
    }
  };
  // Builtin result rules that GAINED an abnormalText positive-flag set in a later shipped
  // version. The resultRules migration below is append-only (it adds builtins the user
  // lacks BY ID), so a builtin the user already holds keeps its OLD shape and never
  // receives the new positive flags — leaving the false-calm hazard those flags fix (e.g. a
  // positive blood culture reading "...no growth in anaerobic bottle" being calmed). Adding
  // abnormalText is purely additive (it only ever ADDS a 'review' outcome, never calms), so
  // backfill the shipped abnormalText onto a held builtin that still lacks one. This also
  // repairs a rule whose abnormalText was dropped by an older options edit. Kept in
  // lock-step with content.js; bump defaults.json "version" when you add an id here.
  const RESULT_RULES_GAINED_ABNORMALTEXT = ['msu-culture', 'base-blood-culture'];
  const backfillBuiltinAbnormalText = (resultRules, shippedResultRules) => {
    if (!Array.isArray(resultRules) || !Array.isArray(shippedResultRules)) return;
    for (const id of RESULT_RULES_GAINED_ABNORMALTEXT) {
      const held = resultRules.find((r) => r && r.id === id && r.builtin);
      if (!held || (Array.isArray(held.abnormalText) && held.abnormalText.length)) continue;
      const shippedRule = shippedResultRules.find((r) => r && r.id === id);
      if (shippedRule && Array.isArray(shippedRule.abnormalText) && shippedRule.abnormalText.length) {
        held.abnormalText = [...shippedRule.abnormalText];
      }
    }
  };
  // Builtin result-rule fields (label, and threshold values) shipped in a PRIOR version and
  // SINCE CHANGED. The resultRules merge below is append-by-id only, so a builtin the user
  // already holds keeps its OLD label/thresholds forever — a changed shipped label or
  // threshold value never reaches existing users (the resultRules analogue of the
  // RETIRED_CHIP_LABELS systemChips trap above). For each id we list, per field, the retired
  // shipped value(s). The revert is ATOMIC per id: only when EVERY listed field still equals a
  // retired value (i.e. the user has not customised this rule) do we bring the rule fully up to
  // the current shipped values — so we never overwrite a user's own edit, and never leave a
  // label that disagrees with the live threshold. v17 surfaced each numeric trigger in the chip
  // label and lowered the Hb critical red from 100→80 g/L (CSO-approved). Kept in lock-step with
  // content.js; bump defaults.json "version" when you add an entry here.
  const RETIRED_RESULTRULE_FIELDS = {
    'base-low-haemoglobin': { label: ['Critical low haemoglobin'], red: [100] },
    'base-high-potassium': { label: ['Critical high potassium'] },
    'base-low-sodium': { label: ['Critical low sodium'] },
    'base-low-egfr': { label: ['Critical low eGFR'] },
    'base-low-platelets': { label: ['Critical low platelets'] },
    'base-low-neutrophils': { label: ['Critical low neutrophils'] },
    'base-high-inr': { label: ['High INR'] },
    'base-lithium-toxicity': { label: ['High lithium level — toxicity risk'] },
    'base-digoxin-toxicity': { label: ['High digoxin level — toxicity risk'] },
    'base-low-potassium': { label: ['Critical low potassium'] },
    'base-high-calcium': { label: ['High calcium — hypercalcaemia'] },
    'base-egfr-amber': { label: ['Low eGFR — significant CKD'] },
    'base-low-calcium': { label: ['Low adjusted calcium — hypocalcaemia'] },
    'base-low-magnesium': { label: ['Low magnesium — hypomagnesaemia'] },
    'base-high-tsh': { label: ['High TSH — possible hypothyroidism'] },
    'base-low-tsh': { label: ['Suppressed TSH — possible thyrotoxicosis'] },
    // v21 tightened the bare "gram positive"/"gram negative"/"candida" substrings (they
    // matched NEGATIVE phrasing like "No gram negative organisms isolated" and tripped a
    // false-amber review) to morphology-qualified gram-stain terms and named candida
    // species. A held rule whose abnormalText still deep-equals this OLD 30-element
    // shipped array is un-stuck to the new shipped array; a customised array is left alone.
    'base-blood-culture': {
      abnormalText: [
        [
          'grown in aerobic bottle',
          'grown in anaerobic bottle',
          'positive blood culture',
          'gram positive',
          'gram negative',
          'gram-positive',
          'gram-negative',
          'bacteraemia',
          'bacteremia',
          'fungaemia',
          'sensitive to',
          'resistant to',
          'sensitivities shown',
          'staphylococcus',
          'streptococcus',
          'escherichia',
          'klebsiella',
          'enterococcus',
          'pseudomonas',
          'haemophilus',
          'neisseria',
          'listeria',
          'salmonella',
          'candida',
          'acinetobacter',
          'serratia',
          'enterobacter',
          'proteus',
          'citrobacter',
          'stenotrophomonas',
        ],
      ],
    },
  };
  // A retired field's candidate value may be a scalar (indexOf works) or, for
  // abnormalText, an array of candidate arrays — reference-compare via indexOf never
  // matches two distinct array instances, so deep-compare element-wise when the held
  // value is itself an array.
  const arraysShallowEqual = (a, b) =>
    Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);
  const fieldStillDefault = (candidates, heldValue) => {
    if (Array.isArray(heldValue)) return candidates.some((c) => arraysShallowEqual(c, heldValue));
    return candidates.indexOf(heldValue) !== -1;
  };
  const revertRetiredResultRuleFields = (resultRules, shippedResultRules) => {
    if (!Array.isArray(resultRules) || !Array.isArray(shippedResultRules)) return;
    for (const id of Object.keys(RETIRED_RESULTRULE_FIELDS)) {
      const held = resultRules.find((r) => r && r.id === id && r.builtin);
      const shippedRule = shippedResultRules.find((r) => r && r.id === id);
      if (!held || !shippedRule) continue;
      const fields = RETIRED_RESULTRULE_FIELDS[id];
      const stillDefault = Object.keys(fields).every((f) => fieldStillDefault(fields[f], held[f]));
      if (!stillDefault) continue;
      for (const f of Object.keys(fields)) {
        if (shippedRule[f] === undefined) continue;
        held[f] = Array.isArray(shippedRule[f]) ? [...shippedRule[f]] : shippedRule[f];
      }
    }
  };
  const mergeShippedDefaults = (cfg, shipped) => {
    if (!cfg || !Array.isArray(cfg.rules) || !shipped) return null;
    if ((cfg.version || 0) >= (shipped.version || 0)) return null;
    const out = { ...cfg, rules: [...cfg.rules] };
    const have = new Set(out.rules.map((r) => r && r.id));
    const removed = new Set(out.removedBuiltins || []);
    for (const r of shipped.rules || []) {
      if (r.builtin && !have.has(r.id) && !removed.has(r.id)) out.rules.push(r);
    }
    out.thresholds = { ...(shipped.thresholds || {}), ...(cfg.thresholds || {}) };
    out.prefs = { ...(shipped.prefs || {}), ...(cfg.prefs || {}) };
    out.systemChips = { ...(shipped.systemChips || {}), ...(cfg.systemChips || {}) };
    revertRetiredChipLabels(out.systemChips, shipped.systemChips);
    out.resultRules = [...(Array.isArray(cfg.resultRules) ? cfg.resultRules : [])];
    const haveRR = new Set(out.resultRules.map((r) => r && r.id));
    for (const r of shipped.resultRules || []) {
      if (r.builtin && !haveRR.has(r.id) && !removed.has(r.id)) out.resultRules.push(r);
    }
    backfillBuiltinAbnormalText(out.resultRules, shipped.resultRules);
    // Un-stick result-rule labels/thresholds frozen at a since-changed shipped default.
    revertRetiredResultRuleFields(out.resultRules, shipped.resultRules);
    // OIR user test dictionary: a purely user/practice-authored array (built-in
    // tests live in engine TEST_DEFS, not here). Arrays aren't shallow-merged, so
    // carry it through explicitly or migration would drop the user's customs.
    out.oirTests = Array.isArray(cfg.oirTests) ? [...cfg.oirTests] : [...(shipped.oirTests || [])];
    out.version = shipped.version;
    return out;
  };

  const init = async () => {
    DEFAULTS = await fetchDefaults();
    CONFIG = await loadConfig();
    if (!Array.isArray(CONFIG.resultRules)) CONFIG.resultRules = [];
    const merged = mergeShippedDefaults(CONFIG, DEFAULTS);
    if (merged) {
      await saveConfig(merged);
    }
    $('#tlVersion').textContent = 'v' + (chrome.runtime.getManifest()?.version || '');
    setupTabs();
    setupRulesPane();
    setupEditPane();
    setupSystemChipsPane();
    setupThresholdsPane();
    setupPrefsPane();
    setupPreviewPane();
    setupBackupPane();
    setupLlmPane();
    setupResultRulesPane();
    setupResultEditPane();
    setupResultLlmPane();
    setupOirPane();
    renderRules();
    renderSystemChips();
    renderResultRules();
    populateThresholds();
    populatePrefs();
    populateOir();
    // Deep-link: when this page is embedded as the Suite Settings "Result Rules"
    // section (iframe src ".../options.html#resultRules"), open straight onto the
    // Result rules tab and hide the sibling tab bar so it reads as a dedicated page.
    if (location.hash === '#resultRules') {
      activateTab('resultRules');
      const tabs = $('#tlTabs');
      if (tabs) tabs.style.display = 'none';
    } else if (location.hash === '#oir') {
      // Embedded as the Suite Settings "Outstanding Requests" section. Same
      // dedicated-page treatment as #resultRules: open straight onto the OIR
      // tab and hide the sibling tab bar so it reads as its own page.
      activateTab('oir');
      const tabs = $('#tlTabs');
      if (tabs) tabs.style.display = 'none';
    } else if (location.hash === '#triageLens') {
      // Embedded as the Suite Settings "Triage Lens" section. Result rules and
      // outstanding requests have their OWN dedicated Suite-Settings sections
      // (iframes above), so their tabs here are duplicate editing surfaces for
      // the same CONFIG — two views that drift out of sync and can silently
      // clobber each other on save. Hide them here so each lives in exactly one
      // place; standalone use of this page keeps all tabs.
      const rrTab = $('#tlTabs .tl-tab[data-tab="resultRules"]');
      if (rrTab) rrTab.style.display = 'none';
      const oirTab = $('#tlTabs .tl-tab[data-tab="oir"]');
      if (oirTab) oirTab.style.display = 'none';
      activateTab('rules');
    }
    // Keep every open instance of this page (the two Suite-Settings iframes plus
    // any standalone tab) in sync. Each instance loads CONFIG into memory once and
    // writes the WHOLE object back on save, so without this a rule edited in one
    // view stays stale in the other — and the next save there overwrites the first
    // edit. Re-reading CONFIG on every storage change makes saves merge instead of
    // clobber, and refreshes the list views. We deliberately do NOT re-populate the
    // threshold/preference forms or the open editor, to avoid wiping in-progress,
    // not-yet-saved typing in this instance.
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      const change = changes['triagelens.config'] || changes['config'];
      if (!change || !change.newValue) return;
      CONFIG = change.newValue;
      if (!Array.isArray(CONFIG.rules)) CONFIG.rules = [];
      if (!Array.isArray(CONFIG.resultRules)) CONFIG.resultRules = [];
      renderRules();
      renderResultRules();
      renderSystemChips();
    });
  };

  // ============================================================
  // TABS
  // ============================================================
  const setupTabs = () => {
    $('#tlTabs').addEventListener('click', (e) => {
      const btn = e.target.closest('.tl-tab');
      if (!btn) return;
      activateTab(btn.dataset.tab);
    });
  };
  const activateTab = (name) => {
    // When leaving the edit pane, collapse and clear the LLM section so it
    // starts fresh the next time "New rule" or "Edit" is clicked.
    if (name !== 'edit') {
      const llmDetails = $('#llmDetails');
      if (llmDetails) llmDetails.removeAttribute('open');
      const llmJson = $('#llmJson');
      if (llmJson) llmJson.value = '';
      const llmStatus = $('#llmStatus');
      if (llmStatus) {
        llmStatus.textContent = '';
        llmStatus.className = 'tl-llm-status';
      }
    }
    if (name !== 'resultEdit') {
      const rrLlmDetails = $('#rrLlmDetails');
      if (rrLlmDetails) rrLlmDetails.removeAttribute('open');
      const resultLlmJson = $('#resultLlmJson');
      if (resultLlmJson) resultLlmJson.value = '';
      const resultLlmStatus = $('#resultLlmStatus');
      if (resultLlmStatus) {
        resultLlmStatus.textContent = '';
        resultLlmStatus.className = 'tl-llm-status';
      }
    }
    $$('.tl-tab').forEach((t) => t.classList.toggle('tl-tab-active', t.dataset.tab === name));
    const map = {
      rules: 'paneRules',
      edit: 'paneEdit',
      systemChips: 'paneSystemChips',
      systemEdit: 'paneSystemEdit',
      thresholds: 'paneThresholds',
      prefs: 'panePrefs',
      preview: 'panePreview',
      backup: 'paneBackup',
      about: 'paneAbout',
      resultRules: 'paneResultRules',
      resultEdit: 'paneResultEdit',
      oir: 'paneOir',
    };
    $$('.tl-pane').forEach((p) => p.classList.remove('tl-pane-active'));
    const id = map[name];
    if (id) $('#' + id).classList.add('tl-pane-active');
  };

  // ============================================================
  // RULES TAB
  // ============================================================
  const setupRulesPane = () => {
    $('#btnAddRule').addEventListener('click', () => {
      const newRule = makeBlankRule();
      CONFIG.rules.push(newRule);
      openEditor(newRule.id);
    });
    $('#ruleSearch').addEventListener('input', renderRules);
    $('#filterKind').addEventListener('change', renderRules);
  };

  const makeBlankRule = () => ({
    id: 'rule_' + Math.random().toString(36).slice(2, 9),
    enabled: true,
    label: 'New rule',
    kind: 'amber',
    patterns: [],
    regex: false,
    fields: ['request'],
    pages: ['queue', 'detail', 'record'],
    bumpsTile: null,
    builtin: false,
    actions: [],
    notes: '',
  });

  const renderRules = () => {
    const q = ($('#ruleSearch').value || '').trim().toLowerCase();
    const kFilter = $('#filterKind').value;
    const list = CONFIG.rules.filter((r) => {
      if (kFilter && r.kind !== kFilter) return false;
      if (!q) return true;
      const hay = (r.label + ' ' + (r.patterns || []).join(' ') + ' ' + (r.notes || '')).toLowerCase();
      return hay.includes(q);
    });

    const container = $('#ruleList');
    container.innerHTML = '';
    if (!list.length) {
      $('#ruleListEmpty').style.display = 'block';
      return;
    }
    $('#ruleListEmpty').style.display = 'none';

    for (const rule of list) {
      const row = document.createElement('div');
      row.className = 'tl-rule-row' + (rule.enabled ? '' : ' tl-rule-disabled');
      row.innerHTML = `
        <input type="checkbox" class="tl-rule-toggle" ${rule.enabled ? 'checked' : ''}>
        <span class="tl-rule-kind tl-rule-kind-${escAttr(rule.kind)}">${KIND_LABEL[rule.kind] || rule.kind}</span>
        <span>
          <span class="tl-rule-label">${escHtml(rule.label)}</span>
          <span class="tl-rule-meta">  ${rule.builtin ? '· built-in ' : ''}${rule.notes ? ' · ' + escHtml(rule.notes.slice(0, 50)) : ''}</span>
        </span>
        <span class="tl-rule-meta">${rule.patterns.length} pattern${rule.patterns.length === 1 ? '' : 's'}</span>
        <span class="tl-rule-meta">${rule.actions.length} action${rule.actions.length === 1 ? '' : 's'}</span>
        <span class="tl-rule-actions">
          <button class="tl-btn" data-act="edit">Edit</button>
          <button class="tl-btn tl-btn-danger" data-act="del">×</button>
        </span>`;
      row.querySelector('.tl-rule-toggle').addEventListener('change', async (e) => {
        rule.enabled = e.target.checked;
        await saveConfig(CONFIG);
        flash('Saved');
        renderRules();
      });
      row.querySelector('[data-act="edit"]').addEventListener('click', () => openEditor(rule.id));
      row.querySelector('[data-act="del"]').addEventListener('click', async () => {
        if (!confirm(`Delete rule "${rule.label}"? This can't be undone (unless you reset to defaults).`)) return;
        CONFIG.rules = CONFIG.rules.filter((r) => r.id !== rule.id);
        // Tombstone deleted builtins so the defaults-version merge never
        // resurrects a rule the user deliberately removed.
        if (rule.builtin) {
          CONFIG.removedBuiltins = [...new Set([...(CONFIG.removedBuiltins || []), rule.id])];
        }
        await saveConfig(CONFIG);
        flash('Deleted');
        renderRules();
      });
      container.appendChild(row);
    }
  };

  // ============================================================
  // EDIT PANE
  // ============================================================
  const setupEditPane = () => {
    // Build field & page checkboxes once
    const fc = $('#fFields');
    fc.innerHTML = FIELDS.map(
      (f) => `<label><input type="checkbox" data-field="${f.id}"><span>${f.label}</span></label>`
    ).join('');
    const pc = $('#fPages');
    pc.innerHTML = PAGES.map(
      (p) => `<label><input type="checkbox" data-page="${p.id}"><span>${p.label}</span></label>`
    ).join('');

    $('#btnBackToRules').addEventListener('click', () => {
      editingId = null;
      activateTab('rules');
    });
    $('#btnCancelEdit').addEventListener('click', () => {
      editingId = null;
      // Reload from storage to discard changes
      chrome.storage.local.get(['triagelens.config', 'config']).then((r) => {
        const cfg = r['triagelens.config'] || r['config'];
        if (cfg) CONFIG = cfg;
        renderRules();
        activateTab('rules');
      });
    });
    $('#btnSaveEdit').addEventListener('click', saveCurrentRule);
    $('#btnDeleteRule').addEventListener('click', async () => {
      if (!editingId) return;
      const r = CONFIG.rules.find((x) => x.id === editingId);
      if (!r) return;
      if (!confirm(`Delete rule "${r.label}"?`)) return;
      CONFIG.rules = CONFIG.rules.filter((x) => x.id !== editingId);
      await saveConfig(CONFIG);
      editingId = null;
      flash('Deleted');
      renderRules();
      activateTab('rules');
    });
    $('#btnAddAction').addEventListener('click', () => {
      editingDraft.actions.push({ type: 'note', label: '', text: '' });
      renderActions();
    });
  };

  const openEditor = (id) => {
    const rule = CONFIG.rules.find((r) => r.id === id);
    if (!rule) return;
    editingId = id;
    editingDraft = JSON.parse(JSON.stringify(rule)); // deep clone for actions
    if (!editingDraft.notes) editingDraft.notes = '';
    if (!Array.isArray(editingDraft.actions)) editingDraft.actions = [];

    $('#editTitle').textContent = rule.builtin ? 'Edit built-in rule: ' + rule.label : 'Edit rule: ' + rule.label;
    $('#fLabel').value = editingDraft.label;
    $('#fKind').value = editingDraft.kind;
    $('#fEnabled').checked = !!editingDraft.enabled;
    $('#fPatterns').value = (editingDraft.patterns || []).join('\n');
    $('#fRegex').checked = !!editingDraft.regex;
    $('#fBumpsTile').value = editingDraft.bumpsTile || '';
    $('#fNotes').value = editingDraft.notes || '';

    $$('#fFields input').forEach((c) => {
      c.checked = (editingDraft.fields || []).includes(c.dataset.field);
    });
    $$('#fPages input').forEach((c) => {
      c.checked = (editingDraft.pages || []).includes(c.dataset.page);
    });

    renderActions();
    activateTab('edit');
  };

  const renderActions = () => {
    const cont = $('#actionList');
    cont.innerHTML = '';
    editingDraft.actions.forEach((a, i) => {
      const row = document.createElement('div');
      row.className = 'tl-action-row';
      row.innerHTML = `
        <select data-i="${i}" data-k="type">
          <option value="link"${a.type === 'link' ? ' selected' : ''}>Link</option>
          <option value="snippet"${a.type === 'snippet' ? ' selected' : ''}>Snippet</option>
          <option value="note"${a.type === 'note' ? ' selected' : ''}>Note</option>
        </select>
        <div class="tl-action-fields">
          <input type="text" data-i="${i}" data-k="label" placeholder="Label (e.g. NICE UTI)" value="${escAttr(a.label || '')}">
          ${
            a.type === 'link'
              ? `<input type="url" data-i="${i}" data-k="url" placeholder="https://..." value="${escAttr(a.url || '')}">`
              : `<textarea data-i="${i}" data-k="text" rows="3" placeholder="${a.type === 'snippet' ? 'Text to copy to clipboard' : 'Note text shown in popover'}">${escHtml(a.text || '')}</textarea>`
          }
        </div>
        <button class="tl-action-remove" data-i="${i}" title="Remove action">×</button>`;
      // Wire change listeners
      row.querySelectorAll('input, select, textarea').forEach((input) => {
        input.addEventListener('input', (e) => {
          const idx = +e.target.dataset.i;
          const key = e.target.dataset.k;
          editingDraft.actions[idx][key] = e.target.value;
          if (key === 'type') renderActions(); // re-render on type change to swap url/text input
        });
      });
      row.querySelector('.tl-action-remove').addEventListener('click', () => {
        editingDraft.actions.splice(i, 1);
        renderActions();
      });
      cont.appendChild(row);
    });
  };

  // ============================================================
  // RULE VALIDATION (shared by save path and LLM importer)
  // ============================================================

  const ALLOWED_KINDS = ['red', 'amber', 'green', 'info'];
  const ALLOWED_FIELDS = FIELDS.map((f) => f.id);
  const ALLOWED_PAGES = PAGES.map((p) => p.id);
  const ALLOWED_BUMPS = ['', 'risk', 'monitoring', 'meds', 'openLoops', 'carePlan', 'safeguarding'];
  const ALLOWED_ACTION_TYPES = ['link', 'snippet', 'note'];

  // isSafeActionUrl(url) → boolean
  // Mirrors content.js's executeAction scheme check: only absolute http(s) URLs
  // are allowed for link actions, so an imported/edited config can't smuggle in
  // a javascript:/data: URL that would execute on click.
  const isSafeActionUrl = (url) => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (e) {
      return false;
    }
  };

  // validateTriageRule(rule) → string[]
  // Returns an array of error strings (empty = valid).
  // Used by both saveCurrentRule and the LLM importer.
  const validateTriageRule = (rule) => {
    const errs = [];
    if (!rule || typeof rule !== 'object') {
      errs.push('Rule must be an object.');
      return errs;
    }

    // kind
    if (!ALLOWED_KINDS.includes(rule.kind)) {
      errs.push('kind must be one of: ' + ALLOWED_KINDS.join(', ') + '.');
    }

    // patterns — at least one non-empty
    const patterns = Array.isArray(rule.patterns) ? rule.patterns.filter((p) => typeof p === 'string' && p.trim()) : [];
    if (patterns.length === 0) {
      errs.push('At least one non-empty pattern is required.');
    } else if (rule.regex) {
      for (const p of patterns) {
        try {
          new RegExp(p, 'i');
        } catch (e) {
          errs.push('Invalid regex pattern "' + p + '": ' + e.message);
        }
      }
    }

    // fields — non-empty, from allowed set
    const fields = Array.isArray(rule.fields) ? rule.fields : [];
    if (fields.length === 0) {
      errs.push('At least one field must be selected.');
    } else {
      const bad = fields.filter((f) => !ALLOWED_FIELDS.includes(f));
      if (bad.length)
        errs.push('Unknown field(s): ' + bad.join(', ') + '. Allowed: ' + ALLOWED_FIELDS.join(', ') + '.');
    }

    // pages — non-empty, from allowed set
    const pages = Array.isArray(rule.pages) ? rule.pages : [];
    if (pages.length === 0) {
      errs.push('At least one page must be selected.');
    } else {
      const bad = pages.filter((p) => !ALLOWED_PAGES.includes(p));
      if (bad.length) errs.push('Unknown page(s): ' + bad.join(', ') + '. Allowed: ' + ALLOWED_PAGES.join(', ') + '.');
    }

    // bumpsTile — optional but must be from allowed set if present
    if (rule.bumpsTile != null && rule.bumpsTile !== '' && !ALLOWED_BUMPS.includes(rule.bumpsTile)) {
      errs.push('bumpsTile must be one of: ' + ALLOWED_BUMPS.filter(Boolean).join(', ') + ', or null/empty.');
    }

    // actions — each action must be well-formed
    const actions = Array.isArray(rule.actions) ? rule.actions : [];
    actions.forEach((a, i) => {
      if (!a || typeof a !== 'object') {
        errs.push('actions[' + i + ']: must be an object.');
        return;
      }
      if (!ALLOWED_ACTION_TYPES.includes(a.type)) {
        errs.push('actions[' + i + '].type must be one of: ' + ALLOWED_ACTION_TYPES.join(', ') + '.');
      }
      if (!a.label || typeof a.label !== 'string' || !a.label.trim()) {
        errs.push('actions[' + i + ']: label is required.');
      }
      if (a.type === 'link' && (!a.url || typeof a.url !== 'string')) {
        errs.push('actions[' + i + ']: url is required for link actions.');
      } else if (a.type === 'link' && !isSafeActionUrl(a.url)) {
        errs.push('actions[' + i + ']: url must be an absolute http:// or https:// URL.');
      }
      if ((a.type === 'snippet' || a.type === 'note') && (a.text == null || typeof a.text !== 'string')) {
        errs.push('actions[' + i + ']: text is required for ' + a.type + ' actions.');
      }
    });

    return errs;
  };

  // ============================================================
  // FULL-CONFIG IMPORT VALIDATION (backup file + pasted JSON)
  // ============================================================
  // validateImportedConfig(parsed, currentConfig) → { errors: string[], normalized?: object }
  // Shared by the file-import handler and the "Save pasted JSON" handler so a
  // crafted or corrupt backup is rejected wholesale rather than partially
  // persisted. Runs the SAME per-rule validators the manual editor uses
  // (validateTriageRule / SentinelResultRules.validateResultRule) over every
  // entry, sanity-checks the shape of the other top-level keys, and
  // normalises `version` to a number.
  const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

  const validateImportedConfig = (parsed, currentConfig) => {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { errors: ['Not a valid Triage Lens config: expected a JSON object.'] };
    }

    const errors = [];

    if (!Array.isArray(parsed.rules)) {
      errors.push('rules must be an array.');
    } else {
      for (let i = 0; i < parsed.rules.length && errors.length === 0; i++) {
        const errs = validateTriageRule(parsed.rules[i]);
        if (errs.length > 0) {
          const name = (parsed.rules[i] && (parsed.rules[i].label || parsed.rules[i].id)) || 'untitled';
          errors.push('rules[' + i + '] (' + name + '): ' + errs[0]);
        }
      }
    }

    if (errors.length === 0 && parsed.resultRules !== undefined) {
      if (!Array.isArray(parsed.resultRules)) {
        errors.push('resultRules must be an array.');
      } else {
        const VALIDATE = window.SentinelResultRules && window.SentinelResultRules.validateResultRule;
        if (VALIDATE) {
          for (let i = 0; i < parsed.resultRules.length && errors.length === 0; i++) {
            const errs = VALIDATE(parsed.resultRules[i]);
            if (errs.length > 0) {
              const name = (parsed.resultRules[i] && parsed.resultRules[i].label) || 'untitled';
              errors.push('resultRules[' + i + '] (' + name + '): ' + errs[0]);
            }
          }
        }
      }
    }

    if (errors.length === 0 && parsed.thresholds !== undefined) {
      if (!isPlainObject(parsed.thresholds)) {
        errors.push('thresholds must be an object.');
      } else {
        for (const key of Object.keys(parsed.thresholds)) {
          if (!Number.isFinite(parsed.thresholds[key])) {
            errors.push('thresholds.' + key + ' must be a finite number.');
            break;
          }
        }
      }
    }

    if (errors.length === 0 && parsed.prefs !== undefined && !isPlainObject(parsed.prefs)) {
      errors.push('prefs must be an object.');
    }

    if (errors.length === 0 && parsed.systemChips !== undefined && !isPlainObject(parsed.systemChips)) {
      errors.push('systemChips must be an object.');
    }

    if (errors.length > 0) return { errors };

    // Normalise version to a number. mergeShippedDefaults treats a falsy/NaN
    // version as 0 ("older than anything shipped") and silently merges shipped
    // builtins in on the next options load — so a missing/invalid imported
    // version must NOT be allowed to trigger that; fall back to the
    // pre-import CONFIG.version instead. A genuinely-numeric (even low)
    // imported version is left as-is — that's the existing, intended
    // "import an older backup, then it catches up on next load" behaviour.
    const normalized = { ...parsed };
    const importedVersion = Number(parsed.version);
    normalized.version = Number.isFinite(importedVersion)
      ? importedVersion
      : (currentConfig && currentConfig.version) || 0;

    return { errors: [], normalized };
  };

  // ============================================================
  // LLM RULE AUTHORING TOOL
  // ============================================================

  // triageRuleSchemaPrompt() → string
  // Returns a self-contained LLM instruction string for authoring a single
  // Triage Lens custom alert rule. Embed in an LLM chat, paste JSON back.
  // Embedded EXAMPLE JSON block uses stable markers for test extraction.
  const triageRuleSchemaPrompt =
    () => `You are generating a single Triage Lens custom alert rule for a UK GP practice using Medicus. Output ONLY a JSON object — no prose, no markdown fences, no code blocks. The object must conform exactly to the schema below.

=== CLINICAL SAFETY INSTRUCTIONS ===

1. Unless regex:true, patterns are CASE-INSENSITIVE SUBSTRING matches — "safeguarding" matches "Safeguarding concern re: child".
2. If regex:true, every pattern MUST be a valid JavaScript regular expression. Incorrect regex silently prevents the rule firing.
3. Imported rules arrive DISABLED (enabled:false is forced on import). A clinician must review and enable the rule before it fires.
4. This is display-only decision support — it surfaces existing record text with no synthesis, inference, or record writes.

=== SCHEMA ===

  id          (string)
              Will be replaced on import with a fresh unique id of the form "rule_" + random.
              You may set any placeholder — the importer ignores it.

  enabled     (boolean)
              Set false. The importer forces this regardless.

  label       (string, required)
              Short label shown on the chip, max ~40 characters. e.g. "Safeguarding concern".

  kind        (string, required)
              Severity of the chip. One of: "red" | "amber" | "green" | "info"
              red   = high-risk / urgent
              amber = caution / needs attention
              green = reassuring / positive finding
              info  = neutral information

  patterns    (array of strings, required, non-empty)
              Text to search for. Case-insensitive substring match (unless regex:true).
              Plain patterns: list words or phrases, one per array element.
              Regex patterns: valid JS regex source strings (no slashes, no flags — flags are added internally).

  regex       (boolean, required)
              false = plain substring; true = treat each pattern as a regex.
              Use false unless you need alternation or optional characters.

  fields      (array of strings, required, non-empty)
              Which parts of the patient record to scan. At least one required.
              Allowed values: "request" | "problems" | "registers" | "meds" | "allergies" |
                              "banner" | "consultations" | "docs"
              Note: "request" is the only field available on the queue page.

  pages       (array of strings, required, non-empty)
              Which Medicus pages the rule fires on. At least one required.
              Allowed values: "queue" | "detail" | "record"
              Note: fields other than "request" are only populated on "detail" and "record" pages.

  bumpsTile   (string or null)
              When matched on a detail or record page, optionally highlight one of the six
              built-in tile categories. null = don't bump any tile.
              Allowed values: null | "risk" | "monitoring" | "meds" | "openLoops" | "carePlan" | "safeguarding"

  builtin     (boolean)
              Always false for user-authored rules.

  actions     (array, optional)
              Click-to-fire shortcuts shown when the chip is expanded. Each action:
                type   (string, required)  — "link" | "snippet" | "note"
                label  (string, required)  — Button label, e.g. "NICE safeguarding guidance".
                url    (string)            — Required for type "link". Full URL.
                text   (string)            — Required for type "snippet" and "note".
                       snippet: text copied to clipboard on click.
                       note: informational text shown in a popover.

  notes       (string, optional)
              Your own reference note — not shown in the UI, only in the rule list.

=== EXAMPLE JSON ---

--- EXAMPLE JSON ---
{
  "id": "rule_placeholder",
  "enabled": false,
  "label": "Safeguarding concern",
  "kind": "amber",
  "patterns": ["safeguarding", "child protection", "at risk", "domestic abuse", "domestic violence"],
  "regex": false,
  "fields": ["request", "problems", "consultations"],
  "pages": ["queue", "detail", "record"],
  "bumpsTile": "safeguarding",
  "builtin": false,
  "actions": [
    {
      "type": "note",
      "label": "Safeguarding reminder",
      "text": "Consider whether this presentation raises a safeguarding concern. If in doubt, consult your practice safeguarding lead before proceeding."
    }
  ],
  "notes": "Flags common safeguarding-related terms in request text and problem list."
}
--- END EXAMPLE ---

=== CLOSING REMINDER ===

The rule will be imported DISABLED. A GP or nominated reviewer MUST check the patterns and fields
are appropriate before enabling the rule. A rule that fires on irrelevant content creates alert fatigue;
a rule that silently fails to fire misses a clinical signal. Test it using the Live Preview tab.
`;

  const setupLlmPane = () => {
    const btnCopy = $('#btnLlmCopyPrompt');
    const copiedEl = $('#llmCopied');
    const jsonEl = $('#llmJson');
    const btnImport = $('#btnLlmImport');
    const statusEl = $('#llmStatus');
    if (!btnCopy || !jsonEl || !btnImport || !statusEl) return;

    btnCopy.addEventListener('click', async () => {
      const prompt = triageRuleSchemaPrompt();
      try {
        await navigator.clipboard.writeText(prompt);
      } catch (_) {
        const ta = document.createElement('textarea');
        ta.value = prompt;
        ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand && document.execCommand('copy');
        document.body.removeChild(ta);
      }
      if (copiedEl) {
        copiedEl.style.opacity = '1';
        setTimeout(() => {
          copiedEl.style.opacity = '0';
        }, 2000);
      }
    });

    btnImport.addEventListener('click', async () => {
      statusEl.className = 'tl-llm-status';
      statusEl.textContent = '';
      const raw = (jsonEl.value || '').trim();
      if (!raw) {
        statusEl.className = 'tl-llm-status tl-llm-status-err';
        statusEl.textContent = 'Paste the LLM JSON into the box first.';
        return;
      }

      // Parse JSON
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        statusEl.className = 'tl-llm-status tl-llm-status-err';
        statusEl.textContent = 'Could not parse JSON: ' + escHtml(e.message);
        return;
      }

      // Normalise: single object, array, or {rules:[...]}
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
        statusEl.className = 'tl-llm-status tl-llm-status-err';
        statusEl.textContent = 'Expected a JSON object, an array, or an object with a "rules" array.';
        return;
      }

      if (candidates.length === 0) {
        statusEl.className = 'tl-llm-status tl-llm-status-err';
        statusEl.textContent = 'No rule objects found in the pasted JSON.';
        return;
      }

      // Validate each candidate; abort on first error
      for (let i = 0; i < candidates.length; i++) {
        const errs = validateTriageRule(candidates[i]);
        if (errs.length > 0) {
          statusEl.className = 'tl-llm-status tl-llm-status-err';
          const prefix = candidates.length > 1 ? 'Rule ' + (i + 1) + ': ' : '';
          statusEl.textContent = prefix + errs[0];
          return;
        }
      }

      // Assign fresh ids, force builtin:false, force enabled:false, append
      const toAdd = candidates.map((rule) => ({
        ...rule,
        id: 'rule_' + Math.random().toString(36).slice(2, 9),
        builtin: false,
        enabled: false,
      }));

      CONFIG.rules.push(...toAdd);
      await saveConfig(CONFIG);
      jsonEl.value = '';
      statusEl.className = 'tl-llm-status tl-llm-status-ok';
      statusEl.textContent =
        'Imported ' +
        toAdd.length +
        ' rule' +
        (toAdd.length !== 1 ? 's' : '') +
        ' (disabled — review and enable each one before it fires).';
      renderRules();
    });
  };

  const saveCurrentRule = async () => {
    if (!editingId) return;
    // Read draft state from the DOM
    editingDraft.label = $('#fLabel').value.trim() || 'Untitled rule';
    editingDraft.kind = $('#fKind').value;
    editingDraft.enabled = $('#fEnabled').checked;
    editingDraft.patterns = $('#fPatterns')
      .value.split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    editingDraft.regex = $('#fRegex').checked;
    editingDraft.bumpsTile = $('#fBumpsTile').value || null;
    editingDraft.notes = $('#fNotes').value.trim();
    editingDraft.fields = $$('#fFields input:checked').map((c) => c.dataset.field);
    editingDraft.pages = $$('#fPages input:checked').map((c) => c.dataset.page);

    // Validate via the shared validator; the form builder ensures kind/fields/pages
    // come from the fixed select/checkbox sets, so the main check that can fail here
    // is the regex compilation. Use validateTriageRule for consistency.
    const errs = validateTriageRule(editingDraft);
    if (errs.length > 0) {
      flash(errs[0], 'err');
      return;
    }

    // Persist
    const idx = CONFIG.rules.findIndex((r) => r.id === editingId);
    if (idx >= 0) CONFIG.rules[idx] = editingDraft;
    else CONFIG.rules.push(editingDraft);
    await saveConfig(CONFIG);
    flash('Saved');
    editingId = null;
    renderRules();
    activateTab('rules');
  };

  // ============================================================
  // THRESHOLDS TAB
  // ============================================================
  const setupThresholdsPane = () => {
    $('#btnSaveThresholds').addEventListener('click', async () => {
      $$('#paneThresholds input[data-th]').forEach((inp) => {
        const key = inp.dataset.th;
        const val = +inp.value;
        if (Number.isFinite(val)) CONFIG.thresholds[key] = val;
      });
      await saveConfig(CONFIG);
      flash('Thresholds saved');
    });
    $('#btnResetThresholds').addEventListener('click', async () => {
      if (!confirm('Reset all thresholds to shipped defaults? Rules and prefs are untouched.')) return;
      CONFIG.thresholds = { ...DEFAULTS.thresholds };
      await saveConfig(CONFIG);
      populateThresholds();
      flash('Thresholds reset');
    });
  };
  const populateThresholds = () => {
    $$('#paneThresholds input[data-th]').forEach((inp) => {
      const key = inp.dataset.th;
      const val = CONFIG.thresholds && CONFIG.thresholds[key];
      if (val != null) inp.value = val;
    });
  };

  // ============================================================
  // PREFS TAB
  // ============================================================
  const setupPrefsPane = () => {
    $('#btnSavePrefs').addEventListener('click', async () => {
      $$('#panePrefs [data-pref]').forEach((inp) => {
        const key = inp.dataset.pref;
        if (inp.type === 'checkbox') CONFIG.prefs[key] = inp.checked;
        else if (inp.type === 'number') CONFIG.prefs[key] = +inp.value;
        else CONFIG.prefs[key] = inp.value;
      });
      await saveConfig(CONFIG);
      flash('Preferences saved');
    });
  };
  const populatePrefs = () => {
    $$('#panePrefs [data-pref]').forEach((inp) => {
      const key = inp.dataset.pref;
      const val = CONFIG.prefs?.[key];
      if (val == null) return;
      if (inp.type === 'checkbox') inp.checked = !!val;
      else inp.value = val;
    });
  };

  // ============================================================
  // PREVIEW TAB
  // ============================================================
  const setupPreviewPane = () => {
    $('#previewInput').addEventListener('input', renderPreview);
    $$('input[name="previewPage"]').forEach((r) => r.addEventListener('change', renderPreview));
  };
  // Use the SAME compiler the live content script uses (rule-match.js,
  // window.TriageLensMatch, loaded before this script in options.html), so the
  // preview can never disagree with what actually fires on the page.
  const compileRule = (rule) => window.TriageLensMatch.compileRule(rule);
  const renderPreview = () => {
    const text = $('#previewInput').value;
    const page = $$('input[name="previewPage"]').find((r) => r.checked)?.value || 'detail';
    const cont = $('#previewMatches');
    if (!text.trim()) {
      cont.innerHTML = '<div class="tl-preview-empty">Type some sample text above to see which rules match.</div>';
      return;
    }
    const matches = [];
    const errors = [];
    for (const rule of CONFIG.rules) {
      const c = compileRule(rule);
      if (!c) continue;
      // Surface (don't swallow) any pattern that failed to compile.
      for (const err of c._errors || []) errors.push(`${rule.label || rule.id}: ${err}`);
      if (!rule.pages.includes(page)) continue;
      // Treat the preview input as the request field (most common). Uses the
      // shared matcher so the fire/no-fire result matches the runtime exactly.
      if (rule.fields.includes('request') && window.TriageLensMatch.ruleMatchesText(c, text)) {
        matches.push(rule);
      }
    }
    const errorHtml = errors.length
      ? `<div class="tl-preview-error">⚠ ${errors.length} pattern${errors.length === 1 ? '' : 's'} failed to compile and were skipped:<ul>${errors
          .map((e) => `<li>${escHtml(e)}</li>`)
          .join('')}</ul></div>`
      : '';
    if (!matches.length) {
      cont.innerHTML = errorHtml + '<div class="tl-preview-empty">No rules match.</div>';
      return;
    }
    cont.innerHTML =
      errorHtml +
      matches
        .map(
          (r) => `
      <div class="tl-preview-match">
        <span class="tl-rule-kind tl-rule-kind-${escAttr(r.kind)}">${KIND_LABEL[r.kind]}</span>
        <span class="tl-rule-label">${escHtml(r.label)}</span>
        <span class="tl-rule-meta">${r.actions.length} action${r.actions.length === 1 ? '' : 's'}</span>
      </div>`
        )
        .join('');
  };

  // ============================================================
  // BACKUP TAB
  // ============================================================
  const setupBackupPane = () => {
    $('#btnExport').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(CONFIG, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const date = new Date().toISOString().slice(0, 10);
      a.download = `triage-lens-config-${date}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    $('#btnImport').addEventListener('click', () => $('#importFile').click());
    $('#importFile').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      if (f.size > 10 * 1024 * 1024) {
        alert('File is too large (max 10 MB). Import cancelled.');
        return;
      }
      const text = await f.text();
      try {
        const parsed = JSON.parse(text);
        const { errors, normalized } = validateImportedConfig(parsed, CONFIG);
        if (errors.length > 0) throw new Error(errors[0]);
        if (!confirm(`Import config with ${normalized.rules.length} rules? Your current rules will be replaced.`))
          return;
        await saveConfig(normalized);
        flash('Imported');
        renderRules();
        populateThresholds();
        populatePrefs();
        populateOir();
        $('#rawJson').value = JSON.stringify(normalized, null, 2);
      } catch (e) {
        flash('Import failed: ' + e.message, 'err');
      }
      e.target.value = '';
    });
    $('#btnReset').addEventListener('click', async () => {
      if (
        !confirm('Reset all rules, thresholds and preferences to shipped defaults? Your customisations will be lost.')
      )
        return;
      const fresh = await fetchDefaults();
      await saveConfig(fresh);
      flash('Reset to defaults');
      renderRules();
      populateThresholds();
      populatePrefs();
      populateOir();
      $('#rawJson').value = JSON.stringify(fresh, null, 2);
    });

    // Raw JSON viewer
    $('#rawJson').value = JSON.stringify(CONFIG, null, 2);
    $('#btnReloadJson').addEventListener('click', async () => {
      CONFIG = await loadConfig();
      $('#rawJson').value = JSON.stringify(CONFIG, null, 2);
      renderRules();
      populateThresholds();
      populatePrefs();
      populateOir();
      flash('Reloaded');
    });
    $('#btnSaveJson').addEventListener('click', async () => {
      try {
        const parsed = JSON.parse($('#rawJson').value);
        const { errors, normalized } = validateImportedConfig(parsed, CONFIG);
        if (errors.length > 0) throw new Error(errors[0]);
        await saveConfig(normalized);
        renderRules();
        populateThresholds();
        populatePrefs();
        populateOir();
        flash('Saved JSON');
      } catch (e) {
        flash('Invalid JSON: ' + e.message, 'err');
      }
    });
  };

  // ============================================================
  // SYSTEM CHIPS TAB
  // ============================================================
  // Static metadata: id → human description, page group, available {vars}.
  // Order here drives display order in the list. Defaults are shipped in
  // defaults.json under `systemChips`; the user's customisations live in
  // CONFIG.systemChips. The editor merges over the defaults.
  const SYSTEM_CHIP_META = [
    // Queue
    { id: 'queue.child', page: 'Queue', desc: 'Patient under the configured "child" age threshold', vars: ['{age}'] },
    { id: 'queue.elder', page: 'Queue', desc: 'Patient at or over the "elder" age threshold', vars: ['{age}'] },
    {
      id: 'queue.taskAgeAmber',
      page: 'Queue',
      desc: 'Task open ≥ taskAgeAmber but < taskAgeRed days',
      vars: ['{days}'],
    },
    { id: 'queue.taskAgeRed', page: 'Queue', desc: 'Task open ≥ taskAgeRed days', vars: ['{days}'] },
    { id: 'queue.priority', page: 'Queue', desc: 'Task priority is High or Urgent', vars: ['{priority}'] },
    // Detail
    { id: 'detail.statusAwaiting', page: 'Detail', desc: 'Task status contains "awaiting"', vars: ['{status}'] },
    { id: 'detail.statusReplyReceived', page: 'Detail', desc: 'Task status is "reply received"', vars: ['{status}'] },
    { id: 'detail.statusClosed', page: 'Detail', desc: 'Task is closed / completed / resolved', vars: ['{status}'] },
    { id: 'detail.statusOther', page: 'Detail', desc: 'Any other status text', vars: ['{status}'] },
    { id: 'detail.priority', page: 'Detail', desc: 'Task priority is High or Urgent', vars: ['{priority}'] },
    { id: 'detail.daysOpenInfo', page: 'Detail', desc: 'Task open less than taskAgeAmber days', vars: ['{days}'] },
    {
      id: 'detail.daysOpenAmber',
      page: 'Detail',
      desc: 'Task open ≥ taskAgeAmber but < taskAgeRed days',
      vars: ['{days}'],
    },
    { id: 'detail.daysOpenRed', page: 'Detail', desc: 'Task open ≥ taskAgeRed days', vars: ['{days}'] },
    { id: 'detail.today', page: 'Detail', desc: 'Task created today', vars: [] },
    { id: 'detail.proxy', page: 'Detail', desc: 'Request submitted by a non-self proxy', vars: ['{relationship}'] },
    { id: 'detail.attachments', page: 'Detail', desc: 'Request has one or more attachments', vars: ['{count}'] },
    {
      id: 'detail.monitoringDueAmber',
      page: 'Detail',
      desc: 'High-risk drug monitoring due soon (Sentinel engine)',
      vars: ['{count}'],
    },
    {
      id: 'detail.monitoringDueRed',
      page: 'Detail',
      desc: 'High-risk drug monitoring overdue / severely overdue (Sentinel engine)',
      vars: ['{count}'],
    },
    {
      id: 'detail.docType',
      page: 'Detail',
      desc: 'Document type label on document task pages (e.g. "Clinical letter")',
      vars: ['{docType}'],
    },
    {
      id: 'detail.docSpecialty',
      page: 'Detail',
      desc: 'Clinical specialty or sender on document task pages',
      vars: ['{specialty}'],
    },
    {
      id: 'queue.monitoringDueRed',
      page: 'Queue',
      desc: 'High-risk drug monitoring overdue on queue rows (requires network per row — off by default)',
      vars: ['{count}'],
    },
    {
      id: 'queue.monitoringDueAmber',
      page: 'Queue',
      desc: 'High-risk drug monitoring due soon on queue rows (requires network per row — off by default)',
      vars: ['{count}'],
    },
    {
      id: 'queue.resultUrgent',
      page: 'Queue',
      desc: 'Investigation result has an urgent/critical analyte (lab flag or user threshold rule)',
      vars: ['{name}', '{count}'],
    },
    {
      id: 'queue.resultAbnormal',
      page: 'Queue',
      desc: 'Investigation result has out-of-range analytes',
      vars: ['{count}'],
    },
    {
      id: 'queue.resultRuleUrgent',
      page: 'Queue',
      desc: 'A user/base threshold rule (not the lab flag) raised a result to urgent — names the rule',
      vars: ['{name}', '{rule}'],
    },
    {
      id: 'queue.resultRuleAbnormal',
      page: 'Queue',
      desc: 'A user/base threshold rule (not the lab flag) raised a result to abnormal — names the rule',
      vars: ['{name}', '{rule}'],
    },
    {
      id: 'queue.resultMisprioritised',
      page: 'Queue',
      desc: 'Result severity outranks the task priority (under-prioritised)',
      vars: [],
    },
    {
      id: 'queue.resultUnmatched',
      page: 'Queue',
      desc: 'Investigation report not matched to a patient record',
      vars: [],
    },
    {
      id: 'queue.resultReview',
      page: 'Queue',
      desc: 'Microbiology/culture result needs review (no normal phrase found in the result text)',
      vars: ['{count}'],
    },
    {
      id: 'queue.resultReviewRule',
      page: 'Queue',
      desc: 'A text rule flagged a result for review and named it (e.g. bowel screening non-responder) — shows the rule label',
      vars: ['{rule}'],
    },
    {
      id: 'queue.resultNoGrowth',
      page: 'Queue',
      desc: 'Culture result matched a normal phrase (e.g. No growth) — calm info chip',
      vars: ['{count}'],
    },
    {
      id: 'queue.resultNoGrowthRule',
      page: 'Queue',
      desc: "A text rule with a custom normal label (e.g. Negative, Not detected) matched a normal phrase — shows that rule's normal label",
      vars: ['{label}'],
    },
    // Record
    { id: 'record.age', page: 'Record', desc: 'Patient age from banner', vars: ['{age}'] },
    { id: 'record.palliative', page: 'Record', desc: 'Patient on palliative register', vars: [] },
    { id: 'record.riskToSelf', page: 'Record', desc: 'Banner contains "risk to self"', vars: [] },
    { id: 'record.frailtyAmber', page: 'Record', desc: 'Frailty hits ≥ frailtyHitsAmber', vars: ['{count}'] },
    { id: 'record.frailtyRed', page: 'Record', desc: 'Frailty hits ≥ frailtyHitsRed', vars: ['{count}'] },
    {
      id: 'record.recentAdmissionAmber',
      page: 'Record',
      desc: 'Discharge summary in last recentDischargeAmber days',
      vars: ['{days}'],
    },
    {
      id: 'record.recentAdmissionRed',
      page: 'Record',
      desc: 'Discharge summary in last recentDischargeRed days',
      vars: ['{days}'],
    },
    { id: 'record.polypharmacyAmber', page: 'Record', desc: 'Repeat count ≥ polypharmacyAmber', vars: ['{count}'] },
    { id: 'record.polypharmacyRed', page: 'Record', desc: 'Repeat count ≥ polypharmacyRed', vars: ['{count}'] },
    {
      id: 'record.monitoringDueAmber',
      page: 'Record',
      desc: 'High-risk drug monitoring due soon (Sentinel engine)',
      vars: ['{count}'],
    },
    {
      id: 'record.monitoringDueRed',
      page: 'Record',
      desc: 'High-risk drug monitoring overdue / severely overdue (Sentinel engine)',
      vars: ['{count}'],
    },
  ];

  let sysEditingId = null;
  let sysEditingDraft = null;

  const getSysChipResolved = (id) => {
    const def = (DEFAULTS.systemChips || {})[id] || {};
    const cfg = (CONFIG.systemChips || {})[id] || {};
    return { ...def, ...cfg };
  };

  const setupSystemChipsPane = () => {
    $('#btnBackToSystem').addEventListener('click', () => {
      sysEditingId = null;
      activateTab('systemChips');
    });
    $('#btnCancelSystemEdit').addEventListener('click', () => {
      sysEditingId = null;
      activateTab('systemChips');
    });
    $('#btnSaveSystemEdit').addEventListener('click', saveSystemChip);
    $('#btnResetSystemChip').addEventListener('click', resetSystemChip);
    $('#btnAddSysAction').addEventListener('click', () => {
      sysEditingDraft.actions.push({ type: 'note', label: '', text: '' });
      renderSysActions();
    });
  };

  const renderSystemChips = () => {
    const container = $('#systemChipList');
    container.innerHTML = '';
    let lastPage = null;
    for (const meta of SYSTEM_CHIP_META) {
      if (meta.page !== lastPage) {
        const heading = document.createElement('div');
        heading.className = 'tl-rule-row tl-system-heading';
        heading.innerHTML = `<span></span><span></span><span><strong>${meta.page} chips</strong></span><span></span><span></span><span></span>`;
        container.appendChild(heading);
        lastPage = meta.page;
      }
      const cfg = getSysChipResolved(meta.id);
      const row = document.createElement('div');
      row.className = 'tl-rule-row' + (cfg.enabled === false ? ' tl-rule-disabled' : '');
      row.innerHTML = `
        <input type="checkbox" class="tl-rule-toggle" ${cfg.enabled !== false ? 'checked' : ''}>
        <span class="tl-rule-kind tl-rule-kind-${escAttr(cfg.kind || 'info')}">${KIND_LABEL[cfg.kind] || cfg.kind || 'INFO'}</span>
        <span>
          <span class="tl-rule-label">${escHtml(cfg.label || '')}</span>
          <span class="tl-rule-meta">  · ${escHtml(meta.desc)}</span>
        </span>
        <span class="tl-rule-meta">${meta.id}</span>
        <span class="tl-rule-meta">${(cfg.actions || []).length} action${(cfg.actions || []).length === 1 ? '' : 's'}</span>
        <span class="tl-rule-actions">
          <button class="tl-btn" data-act="edit">Edit</button>
        </span>`;
      row.querySelector('.tl-rule-toggle').addEventListener('change', async (e) => {
        if (!CONFIG.systemChips) CONFIG.systemChips = {};
        if (!CONFIG.systemChips[meta.id]) CONFIG.systemChips[meta.id] = { ...getSysChipResolved(meta.id) };
        CONFIG.systemChips[meta.id].enabled = e.target.checked;
        await saveConfig(CONFIG);
        flash('Saved');
        renderSystemChips();
      });
      row.querySelector('[data-act="edit"]').addEventListener('click', () => openSystemChipEditor(meta.id));
      container.appendChild(row);
    }
  };

  const openSystemChipEditor = (id) => {
    const meta = SYSTEM_CHIP_META.find((m) => m.id === id);
    if (!meta) return;
    const cfg = getSysChipResolved(id);
    sysEditingId = id;
    sysEditingDraft = { ...cfg, actions: JSON.parse(JSON.stringify(cfg.actions || [])) };

    $('#systemEditTitle').textContent = meta.page + ' · ' + id;
    $('#sysLabel').value = sysEditingDraft.label || '';
    $('#sysKind').value = sysEditingDraft.kind || 'info';
    $('#sysEnabled').checked = sysEditingDraft.enabled !== false;
    const varHelp = meta.vars.length
      ? 'Available variables: ' + meta.vars.join(', ')
      : 'No variables for this chip — label is shown as-is.';
    $('#systemVarHelp').textContent = varHelp;
    $('#sysIdHelp').innerHTML =
      '<strong>Trigger:</strong> ' +
      escHtml(meta.desc) +
      '<br><strong>System ID:</strong> <code>' +
      escHtml(id) +
      '</code> · cannot be changed.';
    renderSysActions();
    activateTab('systemEdit');
  };

  const renderSysActions = () => {
    const cont = $('#sysActionList');
    cont.innerHTML = '';
    sysEditingDraft.actions.forEach((a, i) => {
      const row = document.createElement('div');
      row.className = 'tl-action-row';
      row.innerHTML = `
        <select data-i="${i}" data-k="type">
          <option value="link"${a.type === 'link' ? ' selected' : ''}>Link</option>
          <option value="snippet"${a.type === 'snippet' ? ' selected' : ''}>Snippet</option>
          <option value="note"${a.type === 'note' ? ' selected' : ''}>Note</option>
        </select>
        <div class="tl-action-fields">
          <input type="text" data-i="${i}" data-k="label" placeholder="Label" value="${escAttr(a.label || '')}">
          ${
            a.type === 'link'
              ? `<input type="url" data-i="${i}" data-k="url" placeholder="https://..." value="${escAttr(a.url || '')}">`
              : `<textarea data-i="${i}" data-k="text" rows="3" placeholder="${a.type === 'snippet' ? 'Text to copy' : 'Note text'}">${escHtml(a.text || '')}</textarea>`
          }
        </div>
        <button class="tl-action-remove" data-i="${i}">×</button>`;
      row.querySelectorAll('input, select, textarea').forEach((input) => {
        input.addEventListener('input', (e) => {
          const idx = +e.target.dataset.i;
          const key = e.target.dataset.k;
          sysEditingDraft.actions[idx][key] = e.target.value;
          if (key === 'type') renderSysActions();
        });
      });
      row.querySelector('.tl-action-remove').addEventListener('click', () => {
        sysEditingDraft.actions.splice(i, 1);
        renderSysActions();
      });
      cont.appendChild(row);
    });
  };

  const saveSystemChip = async () => {
    if (!sysEditingId) return;
    sysEditingDraft.label = $('#sysLabel').value;
    sysEditingDraft.kind = $('#sysKind').value;
    sysEditingDraft.enabled = $('#sysEnabled').checked;
    if (!CONFIG.systemChips) CONFIG.systemChips = {};
    CONFIG.systemChips[sysEditingId] = sysEditingDraft;
    await saveConfig(CONFIG);
    flash('Saved');
    sysEditingId = null;
    renderSystemChips();
    activateTab('systemChips');
  };

  const resetSystemChip = async () => {
    if (!sysEditingId) return;
    if (!confirm('Reset this baseline chip to its shipped default?')) return;
    if (CONFIG.systemChips && CONFIG.systemChips[sysEditingId]) {
      delete CONFIG.systemChips[sysEditingId];
      await saveConfig(CONFIG);
      flash('Reset');
      // Re-open the editor showing fresh defaults
      openSystemChipEditor(sysEditingId);
      renderSystemChips();
    }
  };

  // ============================================================
  // RESULT RULES TAB
  // ============================================================
  let rrEditingId = null;
  let rrEditingDraft = null;

  // Bridge to the combo-condition builder, whose state + render machinery lives in
  // the setupResultEditPane closure. The module-scope editor save / populate paths
  // (saveCurrentResultRule / openResultRuleEditor) drive the builder through this.
  // Assigned once inside setupResultEditPane; null until then.
  //   reset()                  → blank two-condition state
  //   syncAllFromDom()         → read condition cards back into state
  //   readConditionForms()     → array of flat condition form-bags (for buildComboRuleFromForm)
  //   loadFromRule(rule)       → populate level + conditions from a saved combo rule
  let _rrComboApi = null;

  // ── In-session suggestion state ─────────────────────────────────────────────
  // These live ONLY in this closure — never written to chrome.storage.
  // They are populated by the result inspector when the user pastes and parses a
  // report. If the user never runs the inspector the lists stay empty and the
  // suggestion UI is hidden.
  let _rrSessionNames = []; // string[] — result.name values seen this session
  let _rrSessionSpecimens = []; // string[] — result.specimen values seen this session

  /**
   * extractResultFields(parsedReport)
   * Pure helper: given the output of normaliseInvestigationReport, return an
   * array of { name, specimen, text } objects — one per result line — with
   * null/empty values preserved so the inspector can display them faithfully.
   * Exported as window.SentinelInspectorHelpers for unit tests.
   */
  function extractResultFields(parsedReport) {
    if (!parsedReport || !Array.isArray(parsedReport.results)) return [];
    return parsedReport.results.map((r) => ({
      name: typeof r.name === 'string' && r.name ? r.name : null,
      specimen: typeof r.specimen === 'string' && r.specimen ? r.specimen : null,
      text: typeof r.text === 'string' ? r.text : '',
    }));
  }

  /**
   * formatRecentResultTime(capturedAt, now)
   * Pure helper: turn a captured-at epoch-ms into a short relative label
   * ("just now", "3 min ago", "2 h ago", "5 d ago"). `now` is injectable for
   * tests. Non-finite / future timestamps fall back to "just now".
   * Exported on window.SentinelInspectorHelpers for unit tests.
   */
  function formatRecentResultTime(capturedAt, now) {
    const nowMs = typeof now === 'number' && isFinite(now) ? now : Date.now();
    if (typeof capturedAt !== 'number' || !isFinite(capturedAt)) return '';
    const diff = nowMs - capturedAt;
    if (diff < 45 * 1000) return 'just now';
    const mins = Math.round(diff / 60000);
    if (mins < 60) return mins + ' min ago';
    const hrs = Math.round(diff / 3600000);
    if (hrs < 24) return hrs + ' h ago';
    const days = Math.round(diff / 86400000);
    return days + ' d ago';
  }

  /**
   * formatRecentPickerRow(entry, now)
   * Pure helper: given a recent-result entry { label, capturedAt, lines } produce
   * the picker row's display strings. Returns { label, lineCount, lineSummary, time }.
   * `now` injectable for tests. Exported on window.SentinelInspectorHelpers.
   */
  function formatRecentPickerRow(entry, now) {
    const e = entry || {};
    const lines = Array.isArray(e.lines) ? e.lines : [];
    const label = typeof e.label === 'string' && e.label.trim() ? e.label.trim() : 'Untitled result';
    const n = lines.length;
    return {
      label,
      lineCount: n,
      lineSummary: n + ' line' + (n === 1 ? '' : 's'),
      time: formatRecentResultTime(e.capturedAt, now),
    };
  }

  /**
   * pickerEmptyState(tabCount, resultCount)
   * Pure helper: decide which state the picker area should show.
   * Returns one of: 'no-tabs' | 'no-results' | 'has-results'.
   * Exported on window.SentinelInspectorHelpers.
   */
  function pickerEmptyState(tabCount, resultCount) {
    if (!tabCount) return 'no-tabs';
    if (!resultCount) return 'no-results';
    return 'has-results';
  }

  /**
   * inspectorRowData(field, index)
   * Pure helper: map one { name, specimen, text } field to the display cells the
   * inspector table renders — { idx, name, specimen, specimenNull, text,
   * truncated, fullText }. Used by BOTH the paste path and the picker path so the
   * two render identically. Exported on window.SentinelInspectorHelpers for tests.
   */
  function inspectorRowData(field, index) {
    const f = field || {};
    const text = typeof f.text === 'string' ? f.text : '';
    const SHORT = 160;
    const truncated = text.length > SHORT;
    return {
      idx: index + 1,
      name: f.name != null && f.name !== '' ? f.name : '(none)',
      specimen: f.specimen != null && f.specimen !== '' ? f.specimen : '(none — rule will fail-open)',
      specimenNull: !(f.specimen != null && f.specimen !== ''),
      text: (truncated ? text.slice(0, SHORT) + '…' : text) || '(empty)',
      truncated,
      fullText: text,
    };
  }

  /**
   * appendUniqueLine(current, value)
   * Pure helper: append `value` as a new line to a newline-separated list string,
   * deduped case-insensitively (trimmed). Returns the new string, or null when the
   * value is blank or already present (caller should treat null as "no change").
   * Shared by the suggestion pills and the click-to-add parsed-table cells, and
   * exported on window.SentinelInspectorHelpers for unit tests.
   */
  function appendUniqueLine(current, value) {
    const v = (value == null ? '' : String(value)).trim();
    if (!v) return null;
    const lines = String(current || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    if (lines.some((l) => l.toLowerCase() === v.toLowerCase())) return null;
    return [...lines, v].join('\n');
  }

  /**
   * splitLines(str)
   * Pure helper: split a newline-separated string into trimmed, non-empty lines.
   */
  function splitLines(str) {
    return String(str == null ? '' : str)
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /**
   * buildComboCondition(form)
   * Pure helper: assemble ONE combo condition object from a flat form-field bag.
   * Returns { condition } on success or { error } (human-readable) on failure.
   *
   * form = {
   *   match:    string,    // newline-separated analyte match terms (required, ≥1)
   *   exclude:  string,    // newline-separated (optional)
   *   specimen: string,    // newline-separated (optional)
   *   type:     'numeric' | 'text',
   *   comparator: 'above'|'below',  // numeric only
   *   value:    string|number,      // numeric only
   *   contains: string,             // text only — newline-separated phrases (≥1)
   * }
   *
   * Exactly one of the numeric/text forms is emitted per the fixed contract.
   */
  function buildComboCondition(form) {
    const f = form || {};
    const match = splitLines(f.match);
    if (!match.length) return { error: 'Each condition needs at least one analyte match term.' };
    const analyte = { match };
    const exclude = splitLines(f.exclude);
    if (exclude.length) analyte.exclude = exclude;
    const specimen = splitLines(f.specimen);
    if (specimen.length) analyte.specimen = specimen;

    if (f.type === 'text') {
      const contains = splitLines(f.contains);
      if (!contains.length) return { error: 'A text condition needs at least one "contains" phrase.' };
      return { condition: { analyte, contains } };
    }

    // Numeric (default)
    const comparator = f.comparator === 'below' ? 'below' : 'above';
    const valStr = f.value == null ? '' : String(f.value).trim();
    if (valStr === '' || !Number.isFinite(+valStr)) {
      return { error: 'A numeric condition needs a finite value.' };
    }
    return { condition: { analyte, comparator, value: +valStr } };
  }

  /**
   * buildComboRuleFromForm(form)
   * Pure helper: assemble the full combo-rule object from the builder form fields.
   * Returns { rule } on success or { error } (first human-readable problem) on failure.
   * Mirrors the user-rule conventions in this file: a fresh id, builtin:false and
   * enabled:false (combo rules import DISABLED, escalate-only, clinician-reviewed).
   *
   * form = {
   *   id?:     string,             // optional — generated when absent
   *   label:   string,             // required, ≤60
   *   level:   'amber' | 'red',    // default 'amber'
   *   conditions: Array<conditionForm>  // ≥2 (see buildComboCondition)
   * }
   *
   * Exported on window.SentinelInspectorHelpers for unit tests.
   */
  function buildComboRuleFromForm(form) {
    const f = form || {};
    const label = (f.label == null ? '' : String(f.label)).trim();
    if (!label) return { error: 'Give the combo rule a label.' };
    if (label.length > 60) return { error: 'Label should be 60 characters or fewer.' };

    const level = f.level === 'red' ? 'red' : 'amber';

    const condForms = Array.isArray(f.conditions) ? f.conditions : [];
    if (condForms.length < 2) return { error: 'A combo rule needs at least two conditions.' };

    const conditions = [];
    for (let i = 0; i < condForms.length; i++) {
      const r = buildComboCondition(condForms[i]);
      if (r.error) return { error: 'Condition ' + (i + 1) + ': ' + r.error };
      conditions.push(r.condition);
    }

    return {
      rule: {
        id: typeof f.id === 'string' && f.id ? f.id : 'rrule_' + Math.random().toString(36).slice(2, 9),
        enabled: false,
        builtin: false,
        kind: 'combo',
        label,
        level,
        conditions,
      },
    };
  }

  if (typeof window !== 'undefined') {
    window.SentinelInspectorHelpers = {
      extractResultFields,
      formatRecentResultTime,
      formatRecentPickerRow,
      pickerEmptyState,
      inspectorRowData,
      appendUniqueLine,
      splitLines,
      buildComboCondition,
      buildComboRuleFromForm,
    };
  }

  /**
   * _rrFillRuleField(fieldId, value)
   * DOM helper: append `value` to a rule-editor textarea (deduped via
   * appendUniqueLine). Re-runs the test-match advisory when the analyte-match field
   * changes. Used by the suggestion pills and the click-to-add parsed-table cells so
   * the user can build a rule straight from what the engine surfaced.
   */
  function _rrFillRuleField(fieldId, value) {
    const ta = $('#' + fieldId);
    if (!ta) return;
    const next = appendUniqueLine(ta.value, value);
    if (next == null) return;
    ta.value = next;
    if (fieldId === 'rrAnalyteMatch' && typeof rrUpdateTestMatch === 'function') rrUpdateTestMatch();
  }

  /**
   * _rrMakeCellClickable(cell, title, onAdd)
   * Turn a parsed-table cell into a keyboard-accessible button that runs `onAdd`
   * (add this value to the rule being edited) with a brief confirmation flash.
   */
  function _rrMakeCellClickable(cell, title, onAdd) {
    if (!cell) return;
    cell.classList.add('tl-rr-cell-clickable');
    cell.setAttribute('role', 'button');
    cell.setAttribute('tabindex', '0');
    cell.title = title;
    const fire = () => {
      onAdd();
      cell.classList.add('tl-rr-cell-added');
      setTimeout(() => cell.classList.remove('tl-rr-cell-added'), 700);
    };
    cell.addEventListener('click', fire);
    cell.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fire();
      }
    });
  }

  /** Collect unique name/specimen strings from a result-fields array into the session lists. */
  function _rrAccumulateSession(fields) {
    for (const f of fields) {
      if (f.name && !_rrSessionNames.includes(f.name)) _rrSessionNames.push(f.name);
      if (f.specimen && !_rrSessionSpecimens.includes(f.specimen)) _rrSessionSpecimens.push(f.specimen);
    }
  }

  /** Render suggestion pill rows under the analyte-match and specimen-scope fields. */
  function rrRenderSuggestions() {
    const matchEl = $('#rrMatchSuggestions');
    const specEl = $('#rrSpecimenSuggestions');

    if (matchEl) {
      matchEl.innerHTML = '';
      if (_rrSessionNames.length) {
        const label = document.createElement('span');
        label.className = 'tl-rr-suggestion-label';
        label.textContent = 'Seen this session:';
        matchEl.appendChild(label);
        for (const name of _rrSessionNames) {
          const pill = document.createElement('button');
          pill.type = 'button';
          pill.className = 'tl-rr-suggestion-pill';
          pill.title = 'Add "' + name + '" to analyte match strings';
          pill.textContent = name;
          pill.addEventListener('click', () => _rrFillRuleField('rrAnalyteMatch', name));
          matchEl.appendChild(pill);
        }
        matchEl.style.display = 'flex';
      } else {
        matchEl.style.display = 'none';
      }
    }

    if (specEl) {
      specEl.innerHTML = '';
      if (_rrSessionSpecimens.length) {
        const label = document.createElement('span');
        label.className = 'tl-rr-suggestion-label';
        label.textContent = 'Seen this session:';
        specEl.appendChild(label);
        for (const spec of _rrSessionSpecimens) {
          const pill = document.createElement('button');
          pill.type = 'button';
          pill.className = 'tl-rr-suggestion-pill';
          pill.title = 'Add "' + spec + '" to specimen scope';
          pill.textContent = spec;
          pill.addEventListener('click', () => _rrFillRuleField('rrAnalyteSpecimen', spec));
          specEl.appendChild(pill);
        }
        specEl.style.display = 'flex';
      } else {
        specEl.style.display = 'none';
      }
    }
  }

  const makeBlankResultRule = () => ({
    id: 'rrule_' + Math.random().toString(36).slice(2, 9),
    enabled: false,
    builtin: false,
    label: 'New result rule',
    analyte: { match: [] },
    comparator: 'above',
    amber: null,
    red: null,
    unit: null,
  });

  /** Summarise one combo condition for the list row (e.g. "pus cell ≥ 40" or "culture ∋ no growth"). */
  const rrComboCondSummary = (cond) => {
    const c = cond || {};
    const name = ((c.analyte && c.analyte.match) || []).join('/') || '?';
    if (Array.isArray(c.contains)) {
      const phr = c.contains.slice(0, 2).join(', ') + (c.contains.length > 2 ? ' …' : '');
      return name + ' ∋ “' + phr + '”';
    }
    const cmp = c.comparator === 'below' ? '≤' : '≥';
    return name + ' ' + cmp + ' ' + (c.value != null ? c.value : '?');
  };

  /**
   * Pure one-line summary of a combo rule for the LLM-import preview list, e.g.
   * 'Sterile pyuria — Combo (amber): 2 conditions, all must match — will import
   * DISABLED · pus cell ≥ 40 AND culture ∋ "no growth"'. Kept pure (no DOM) so the
   * preview string is unit-testable.
   */
  const rrComboImportPreview = (rule) => {
    const r = rule || {};
    const conds = Array.isArray(r.conditions) ? r.conditions : [];
    const level = r.level === 'red' ? 'red' : 'amber';
    const detail = conds.map(rrComboCondSummary).join(' AND ');
    return (
      (r.label || 'Untitled') +
      ' — Combo (' +
      level +
      '): ' +
      conds.length +
      ' condition' +
      (conds.length === 1 ? '' : 's') +
      ', all must match — will import DISABLED' +
      (detail ? ' · ' + detail : '')
    );
  };

  const rrSeveritySummary = (rule) => {
    if (rule.kind === 'combo') {
      const conds = Array.isArray(rule.conditions) ? rule.conditions : [];
      return 'Combo · ' + conds.map(rrComboCondSummary).join(' AND ');
    }
    if (rule.kind === 'text') {
      const phrases = Array.isArray(rule.normalText) ? rule.normalText : [];
      const shown = phrases.slice(0, 3).join(', ');
      const more = phrases.length > 3 ? ' …' : '';
      return (
        'Text · “' + escHtml(rule.label || 'Needs review') + '” unless result text contains: ' + escHtml(shown) + more
      );
    }
    const parts = [];
    const cmp = rule.comparator === 'above' ? '≥' : '≤';
    if (rule.red != null) parts.push(cmp + rule.red + ' red');
    if (rule.amber != null) parts.push(cmp + rule.amber + ' amber');
    const unit = rule.unit ? ' ' + rule.unit : '';
    return parts.join(' / ') + unit;
  };

  const setupResultRulesPane = () => {
    $('#btnAddResultRule').addEventListener('click', () => {
      const newRule = makeBlankResultRule();
      CONFIG.resultRules.push(newRule);
      openResultRuleEditor(newRule.id);
    });
  };

  const renderResultRules = () => {
    const container = $('#resultRuleList');
    if (!container) return;
    container.innerHTML = '';
    const list = CONFIG.resultRules || [];
    if (!list.length) {
      $('#resultRuleListEmpty').style.display = 'block';
      return;
    }
    $('#resultRuleListEmpty').style.display = 'none';

    for (const rule of list) {
      const row = document.createElement('div');
      row.className = 'tl-rule-row' + (rule.enabled ? '' : ' tl-rule-disabled');
      const summary = rrSeveritySummary(rule);
      const _rrKind =
        rule.kind === 'combo'
          ? rule.level === 'red'
            ? 'red'
            : 'amber'
          : rule.red != null
            ? 'red'
            : rule.amber != null
              ? 'amber'
              : rule.kind === 'text'
                ? 'info'
                : 'info';
      // Direction glyph so a high/low pair (e.g. high vs low calcium) is distinguishable at a glance.
      const _rrDir =
        rule.kind === 'text' || rule.kind === 'combo'
          ? ''
          : rule.comparator === 'above'
            ? '↑'
            : rule.comparator === 'below'
              ? '↓'
              : '';
      const _rrDirTitle = _rrDir === '↑' ? 'Fires on a HIGH value' : _rrDir === '↓' ? 'Fires on a LOW value' : '';
      row.innerHTML = `
        <input type="checkbox" class="tl-rule-toggle" ${rule.enabled ? 'checked' : ''} aria-label="Enable ${escAttr(rule.label)}">
        <span class="tl-rule-kind tl-rule-kind-${_rrKind}">${KIND_LABEL[_rrKind] || _rrKind.toUpperCase()}</span>
        <span>
          ${_rrDir ? `<span class="tl-rr-dir" title="${_rrDirTitle}">${_rrDir}</span> ` : ''}<span class="tl-rule-label">${escHtml(rule.label)}</span>
          ${!rule.enabled ? '<span class="tl-rr-unreviewed" title="Not yet enabled. Review this rule\'s analyte match strings and thresholds, then tick the box to let it fire.">Unreviewed</span>' : ''}
          <span class="tl-rule-meta">${rule.builtin ? '<span class="tl-builtin-badge" title="Shipped with the suite using UK-standard reference / critical values — verify against your own lab before relying on it. To silence one, untick it (it stays in the list, greyed). Delete removes it for good.">built-in</span>' : ''}${summary ? '<span class="tl-rr-summary">' + escHtml(summary) + '</span>' : ''}</span>
        </span>
        <span class="tl-rule-meta tl-rr-analyte">${escHtml(((rule.analyte && rule.analyte.match) || []).join(', '))}</span>
        <span></span>
        <span class="tl-rule-actions">
          <button class="tl-btn" data-act="edit" aria-label="Edit ${escAttr(rule.label)}">Edit</button>
          <button class="tl-btn tl-btn-danger" data-act="del" aria-label="Delete ${escAttr(rule.label)}">×</button>
        </span>`;
      row.querySelector('.tl-rule-toggle').addEventListener('change', async (e) => {
        rule.enabled = e.target.checked;
        await saveConfig(CONFIG);
        flash('Saved');
        renderResultRules();
      });
      row.querySelector('[data-act="edit"]').addEventListener('click', () => openResultRuleEditor(rule.id));
      row.querySelector('[data-act="del"]').addEventListener('click', async () => {
        const msg = rule.builtin
          ? `Delete built-in result rule "${rule.label}"? It will NOT return on the next update. (To silence it instead, just untick it.)`
          : `Delete result rule "${rule.label}"? This can't be undone.`;
        if (!confirm(msg)) return;
        CONFIG.resultRules = CONFIG.resultRules.filter((r) => r.id !== rule.id);
        // Tombstone a deleted builtin so mergeShippedDefaults doesn't resurrect it on update
        // (mirrors the alert-rule delete path).
        if (rule.builtin) {
          CONFIG.removedBuiltins = [...new Set([...(CONFIG.removedBuiltins || []), rule.id])];
        }
        await saveConfig(CONFIG);
        flash('Deleted');
        renderResultRules();
      });
      container.appendChild(row);
    }
  };

  const rrApplyKindVisibility = (kind) => {
    const isText = kind === 'text';
    const isCombo = kind === 'combo';
    // The single-analyte block (match / exclude / specimen + advisory Test match)
    // doesn't apply to a combo — each combo condition carries its own analyte.
    document.querySelectorAll('.rr-fields-single').forEach((el) => {
      el.style.display = isCombo ? 'none' : '';
    });
    document.querySelectorAll('.rr-fields-threshold').forEach((el) => {
      el.style.display = isText || isCombo ? 'none' : '';
    });
    document.querySelectorAll('.rr-fields-text').forEach((el) => {
      el.style.display = isText ? '' : 'none';
    });
    document.querySelectorAll('.rr-fields-combo').forEach((el) => {
      el.style.display = isCombo ? '' : 'none';
    });
    // Initialise the builder's two starter conditions the first time combo is
    // selected on a non-combo rule (an edit of an existing combo is seeded by
    // openResultRuleEditor instead).
    if (isCombo && _rrComboApi && rrEditingDraft && rrEditingDraft.kind !== 'combo') {
      _rrComboApi.reset();
    }
  };

  const rrUpdateTestMatch = () => {
    const testEl = $('#rrTestName');
    const resultEl = $('#rrTestResult');
    if (!testEl || !resultEl) return;
    const testName = testEl.value.trim();
    if (!testName) {
      resultEl.textContent = '';
      resultEl.className = 'tl-rr-test-result';
      return;
    }
    const matchLines = ($('#rrAnalyteMatch').value || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!matchLines.length) {
      resultEl.textContent = '✗ no match strings defined';
      resultEl.className = 'tl-rr-test-result tl-rr-test-nomatch';
      return;
    }
    const excludeLines = ($('#rrAnalyteExclude').value || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const nameLower = testName.toLowerCase();
    const matched = matchLines.some((m) => nameLower.includes(m.toLowerCase()));
    const excluded = excludeLines.some((e) => nameLower.includes(e.toLowerCase()));
    if (matched && !excluded) {
      resultEl.textContent = '✓ would match';
      resultEl.className = 'tl-rr-test-result tl-rr-test-match';
    } else if (matched && excluded) {
      resultEl.textContent = '✗ excluded (matches an exclude term)';
      resultEl.className = 'tl-rr-test-result tl-rr-test-nomatch';
    } else {
      resultEl.textContent = '✗ would not match';
      resultEl.className = 'tl-rr-test-result tl-rr-test-nomatch';
    }
  };

  const setupResultEditPane = () => {
    $('#btnBackToResultRules').addEventListener('click', () => {
      rrEditingId = null;
      activateTab('resultRules');
    });
    $('#btnCancelResultEdit').addEventListener('click', () => {
      rrEditingId = null;
      chrome.storage.local.get(['triagelens.config', 'config']).then((r) => {
        const cfg = r['triagelens.config'] || r['config'];
        if (cfg) CONFIG = cfg;
        if (!Array.isArray(CONFIG.resultRules)) CONFIG.resultRules = [];
        renderResultRules();
        activateTab('resultRules');
      });
    });
    $('#btnSaveResultEdit').addEventListener('click', saveCurrentResultRule);
    $('#btnDeleteResultRule').addEventListener('click', async () => {
      if (!rrEditingId) return;
      const r = CONFIG.resultRules.find((x) => x.id === rrEditingId);
      if (!r) return;
      const msg = r.builtin
        ? `Delete built-in result rule "${r.label}"? It will NOT return on the next update. (To silence it instead, untick Enabled.)`
        : `Delete result rule "${r.label}"?`;
      if (!confirm(msg)) return;
      CONFIG.resultRules = CONFIG.resultRules.filter((x) => x.id !== rrEditingId);
      if (r.builtin) {
        CONFIG.removedBuiltins = [...new Set([...(CONFIG.removedBuiltins || []), r.id])];
      }
      await saveConfig(CONFIG);
      rrEditingId = null;
      flash('Deleted');
      renderResultRules();
      activateTab('resultRules');
    });
    $('#rrAnalyteMatch').addEventListener('input', rrUpdateTestMatch);
    $('#rrAnalyteExclude').addEventListener('input', rrUpdateTestMatch);
    $('#rrTestName').addEventListener('input', rrUpdateTestMatch);
    $('#rrKind').addEventListener('change', (e) => rrApplyKindVisibility(e.target.value));

    // ── Inspector ─────────────────────────────────────────────────────────────
    const inspectBtn = $('#btnRrInspect');
    const clearBtn = $('#btnRrInspectorClear');
    const statusEl = $('#rrInspectorStatus');
    const resultsEl = $('#rrInspectorResults');
    const inputEl = $('#rrInspectorInput');
    const loadRecentBtn = $('#btnRrLoadRecent');
    const pickerEl = $('#rrRecentPicker');

    // Recent results pulled from the live content script live ONLY here, for the
    // page session — never written to chrome.storage (matches the suggestion-pill
    // privacy contract above).
    let _rrRecentResults = [];

    // Set up by the combo-rule builder below; lets the inspector render seam route
    // result-cell clicks to the active combo condition while the builder is open.
    // null until the builder section initialises.
    let _rrComboSeedHook = null;

    /**
     * renderInspectorFields(lines, { sourceLabel })
     * THE single render seam — called by BOTH the paste path and the picker path.
     * Takes a fields array ({ name, specimen, text }[]) — already the shape the
     * picker delivers and that extractResultFields returns — renders the parsed
     * table into #rrInspectorResults, sets the status line, and accumulates the
     * suggestion pills. Returns true if anything rendered.
     */
    function renderInspectorFields(lines, opts) {
      const sourceLabel = (opts && opts.sourceLabel) || '';
      if (!statusEl || !resultsEl) return false;
      statusEl.textContent = '';
      statusEl.className = 'tl-rr-inspector-status';
      resultsEl.style.display = 'none';
      resultsEl.innerHTML = '';

      // Defensive: tolerate a malformed payload whose lines array contains null /
      // non-object entries (a hostile or buggy producer) — drop them before any
      // field access so the render never throws and half-draws the table.
      const fields = (Array.isArray(lines) ? lines : []).filter((f) => f && typeof f === 'object');
      if (!fields.length) {
        statusEl.className = 'tl-rr-inspector-status tl-rr-inspector-err';
        statusEl.textContent = 'No result lines found. Check it is a valid investigation-report response.';
        return false;
      }

      // Accumulate into session suggestion lists (memory only — never persisted)
      _rrAccumulateSession(fields);
      rrRenderSuggestions();

      // Build result table
      const table = document.createElement('table');
      table.className = 'tl-rr-inspector-table';
      const thead = table.createTHead();
      const hrow = thead.insertRow();
      ['#', 'name (analyte match)', 'specimen (specimen scope)', 'text (phrase search)'].forEach((h) => {
        const th = document.createElement('th');
        th.textContent = h;
        hrow.appendChild(th);
      });
      const tbody = table.createTBody();
      fields.forEach((f, i) => {
        const rd = inspectorRowData(f, i);
        const tr = tbody.insertRow();
        tr.className = 'tl-rr-inspector-row';
        const tdIdx = tr.insertCell();
        tdIdx.className = 'tl-rr-inspector-idx';
        tdIdx.textContent = String(rd.idx);
        const tdName = tr.insertCell();
        tdName.className = 'tl-rr-inspector-name';
        tdName.textContent = rd.name;
        // Click a real analyte name to add it to the rule's Analyte match list —
        // or, while the combo builder is open, to the active combo condition.
        if (f.name) {
          _rrMakeCellClickable(tdName, 'Click to add “' + f.name + '” to this rule’s Analyte match', () => {
            if (_rrComboSeedHook && _rrComboSeedHook.isOpen()) _rrComboSeedHook.seedMatch(f.name);
            else _rrFillRuleField('rrAnalyteMatch', f.name);
          });
        }
        const tdSpec = tr.insertCell();
        tdSpec.className = rd.specimenNull ? 'tl-rr-inspector-spec tl-rr-inspector-null' : 'tl-rr-inspector-spec';
        tdSpec.textContent = rd.specimen;
        // Click a specimen header to SCOPE the rule to that specimen group — this is
        // what stops a "Culture" rule firing on urine/blood as well as throat swabs.
        // While the combo builder is open it scopes the active combo condition instead.
        if (f.specimen) {
          _rrMakeCellClickable(tdSpec, 'Click to scope this rule to “' + f.specimen + '” (Specimen scope)', () => {
            if (_rrComboSeedHook && _rrComboSeedHook.isOpen()) _rrComboSeedHook.seedSpecimen(f.specimen);
            else _rrFillRuleField('rrAnalyteSpecimen', f.specimen);
          });
        }
        const tdText = tr.insertCell();
        tdText.className = 'tl-rr-inspector-text';
        tdText.textContent = rd.text;
        if (rd.truncated) tdText.title = rd.fullText;
      });

      resultsEl.appendChild(table);

      const summary = document.createElement('p');
      summary.className = 'tl-rr-inspector-count';
      const specCount = fields.filter((f) => f.specimen).length;
      summary.textContent =
        fields.length +
        ' result line' +
        (fields.length !== 1 ? 's' : '') +
        ' parsed. ' +
        specCount +
        ' with a specimen header. ' +
        'Click a name to add it to Analyte match, or a specimen header to scope the rule to it.';
      resultsEl.appendChild(summary);

      resultsEl.style.display = 'block';
      statusEl.className = 'tl-rr-inspector-status tl-rr-inspector-ok';
      statusEl.textContent = sourceLabel ? 'Loaded "' + sourceLabel + '".' : 'Parsed.';
      return true;
    }

    // ── Recent-result picker ──────────────────────────────────────────────────
    /** Render a friendly empty state into the picker area. */
    function rrPickerEmpty(message) {
      if (!pickerEl) return;
      pickerEl.innerHTML = '';
      const div = document.createElement('div');
      div.className = 'tl-rr-recent-empty';
      div.textContent = message;
      pickerEl.appendChild(div);
      pickerEl.style.display = 'block';
    }

    /** Render the clickable list of recent results into the picker area. */
    function rrRenderRecentList(entries) {
      if (!pickerEl) return;
      pickerEl.innerHTML = '';
      const list = document.createElement('div');
      list.className = 'tl-rr-recent-list';
      entries.forEach((entry) => {
        const view = formatRecentPickerRow(entry);
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'tl-rr-recent-row';
        const main = document.createElement('span');
        main.className = 'tl-rr-recent-label';
        main.textContent = view.label;
        const meta = document.createElement('span');
        meta.className = 'tl-rr-recent-meta';
        meta.textContent = view.lineSummary + (view.time ? ' · ' + view.time : '');
        row.appendChild(main);
        row.appendChild(meta);
        row.addEventListener('click', () => {
          [...list.querySelectorAll('.tl-rr-recent-row')].forEach((r) => r.classList.remove('tl-rr-recent-active'));
          row.classList.add('tl-rr-recent-active');
          const lines = Array.isArray(entry.lines) ? entry.lines : [];
          renderInspectorFields(lines, { sourceLabel: view.label });
        });
        list.appendChild(row);
      });
      pickerEl.appendChild(list);
      pickerEl.style.display = 'block';
    }

    /** Query Medicus tabs and pull recent results from the content script. */
    async function rrLoadRecentResults() {
      if (!pickerEl) return;
      rrPickerEmpty('Loading recent results…');
      let tabs = [];
      try {
        tabs = await chrome.tabs.query({ url: 'https://*.medicus.health/*' });
      } catch (_) {
        tabs = [];
      }

      // Merge results across tabs; tolerate tabs with no listener (try/catch each).
      let merged = [];
      for (const tab of tabs) {
        if (!tab || !tab.id) continue;
        try {
          const resp = await chrome.tabs.sendMessage(tab.id, { action: 'getRecentInvestigationResults' });
          if (resp && resp.ok && Array.isArray(resp.results)) {
            merged = merged.concat(resp.results);
          }
        } catch (_) {
          // Tab has no Sentinel content script listening — skip it.
        }
      }
      _rrRecentResults = merged;

      const state = pickerEmptyState(tabs.length, merged.length);
      if (state === 'no-tabs') {
        rrPickerEmpty(
          'No Medicus tab found. Keep your Medicus results queue open in a SEPARATE window from this Settings page — ' +
            'if Settings opened over your Medicus tab it closes that session, so there is nothing to read. ' +
            'Then click Load again, or paste a response manually below.'
        );
        return;
      }
      if (state === 'no-results') {
        rrPickerEmpty(
          'A Medicus tab is open but no results are loaded. Open your result QUEUE (the task list) so the rows load — ' +
            'and keep it in a separate window from this Settings page — then click Load again, or paste manually below.'
        );
        return;
      }
      // Newest first.
      const sorted = merged.slice().sort((a, b) => (Number(b && b.capturedAt) || 0) - (Number(a && a.capturedAt) || 0));
      rrRenderRecentList(sorted);
    }

    if (loadRecentBtn) {
      loadRecentBtn.addEventListener('click', () => {
        rrLoadRecentResults();
      });
    }

    // ── Combo-rule builder ────────────────────────────────────────────────────
    // Authors a kind:'combo' rule INLINE in the main rule editor (Rule type =
    // Combo). Conditions live in this closure as plain form bags; the pure helper
    // buildComboRuleFromForm assembles the fixed-contract object, which is
    // validated with the same SentinelResultRules.validateResultRule call the
    // single-rule editor uses and persisted via the SAME CONFIG.resultRules +
    // saveConfig path the footer Save button drives. There is ONE save path
    // (saveCurrentResultRule) and ONE conditions container — no duplicate builder.
    const comboCondsEl = $('#rrComboConditions');
    const comboLevelEl = $('#rrComboLevel');

    // condition state: [{ match, exclude, specimen, type, comparator, value, contains }]
    let _rrComboConds = [];
    let _rrComboActive = 0; // index of the condition that inspector clicks seed

    const blankComboCond = () => ({
      match: '',
      exclude: '',
      specimen: '',
      type: 'numeric',
      comparator: 'above',
      value: '',
      contains: '',
    });

    /** Read condition card #i back out of the DOM into its state bag. */
    const rrComboSyncCondFromDom = (i) => {
      if (!comboCondsEl) return;
      const card = comboCondsEl.querySelector('.tl-rr-combo-cond[data-i="' + i + '"]');
      if (!card) return;
      const c = _rrComboConds[i];
      if (!c) return;
      const val = (sel) => {
        const el = card.querySelector(sel);
        return el ? el.value : '';
      };
      c.match = val('.rr-cc-match');
      c.exclude = val('.rr-cc-exclude');
      c.specimen = val('.rr-cc-specimen');
      const typeEl = card.querySelector('.rr-cc-type');
      c.type = typeEl && typeEl.value === 'text' ? 'text' : 'numeric';
      c.comparator = val('.rr-cc-comparator') === 'below' ? 'below' : 'above';
      c.value = val('.rr-cc-value');
      c.contains = val('.rr-cc-contains');
    };

    /** Read every condition card back out of the DOM (before save / re-render). */
    const rrComboSyncAllFromDom = () => {
      for (let i = 0; i < _rrComboConds.length; i++) rrComboSyncCondFromDom(i);
    };

    /** Render the condition cards from _rrComboConds. */
    const rrComboRenderConditions = () => {
      if (!comboCondsEl) return;
      comboCondsEl.innerHTML = '';
      if (_rrComboActive >= _rrComboConds.length) _rrComboActive = 0;
      _rrComboConds.forEach((c, i) => {
        const card = document.createElement('div');
        card.className = 'tl-rr-combo-cond' + (i === _rrComboActive ? ' tl-rr-combo-cond-active' : '');
        card.dataset.i = String(i);
        const isText = c.type === 'text';
        const canRemove = _rrComboConds.length > 2;
        card.innerHTML = `
          <div class="tl-rr-combo-cond-head">
            <label class="tl-rr-combo-active">
              <input type="radio" name="rrComboActive" class="rr-cc-active" ${i === _rrComboActive ? 'checked' : ''}>
              <span>Condition ${i + 1}${i === _rrComboActive ? ' — active (clicks seed this)' : ''}</span>
            </label>
            <span class="tl-spacer"></span>
            <button type="button" class="tl-btn tl-btn-danger rr-cc-remove" ${canRemove ? '' : 'disabled'}
              aria-label="Remove condition ${i + 1}" title="${canRemove ? 'Remove this condition' : 'A combo needs at least two conditions'}">×</button>
          </div>
          <label class="tl-rr-combo-field">
            <span class="tl-rr-combo-flabel">Analyte match terms (one per line)</span>
            <textarea class="rr-cc-match tl-rr-combo-ta" rows="2" spellcheck="false"
              placeholder="e.g. pus cells">${escHtml(c.match)}</textarea>
          </label>
          <div class="tl-rr-combo-row2">
            <label class="tl-rr-combo-field">
              <span class="tl-rr-combo-flabel">Specimen scope (optional)</span>
              <textarea class="rr-cc-specimen tl-rr-combo-ta" rows="1" spellcheck="false"
                placeholder="e.g. urine">${escHtml(c.specimen)}</textarea>
            </label>
            <label class="tl-rr-combo-field">
              <span class="tl-rr-combo-flabel">Exclude (optional)</span>
              <textarea class="rr-cc-exclude tl-rr-combo-ta" rows="1" spellcheck="false"
                placeholder="look-alike to skip">${escHtml(c.exclude)}</textarea>
            </label>
          </div>
          <div class="tl-rr-combo-row2">
            <label class="tl-rr-combo-field">
              <span class="tl-rr-combo-flabel">Condition type</span>
              <select class="rr-cc-type tl-rr-combo-input">
                <option value="numeric" ${isText ? '' : 'selected'}>Numeric (value above / below)</option>
                <option value="text" ${isText ? 'selected' : ''}>Text (result text contains)</option>
              </select>
            </label>
            <div class="tl-rr-combo-field rr-cc-numeric" style="${isText ? 'display:none' : ''}">
              <span class="tl-rr-combo-flabel">Numeric test</span>
              <div class="tl-rr-combo-numrow">
                <select class="rr-cc-comparator tl-rr-combo-input">
                  <option value="above" ${c.comparator === 'below' ? '' : 'selected'}>at or above</option>
                  <option value="below" ${c.comparator === 'below' ? 'selected' : ''}>at or below</option>
                </select>
                <input type="number" step="any" class="rr-cc-value tl-rr-combo-input" placeholder="40"
                  value="${escAttr(c.value)}">
              </div>
            </div>
            <label class="tl-rr-combo-field rr-cc-textwrap" style="${isText ? '' : 'display:none'}">
              <span class="tl-rr-combo-flabel">Result text contains (one per line)</span>
              <textarea class="rr-cc-contains tl-rr-combo-ta" rows="2" spellcheck="false"
                placeholder="e.g. no growth">${escHtml(c.contains)}</textarea>
            </label>
          </div>`;

        // Active radio — make this the seed target
        card.querySelector('.rr-cc-active').addEventListener('change', () => {
          rrComboSyncAllFromDom();
          _rrComboActive = i;
          rrComboRenderConditions();
        });
        // Type toggle — show numeric vs text fields (sync first so edits aren't lost)
        card.querySelector('.rr-cc-type').addEventListener('change', () => {
          rrComboSyncAllFromDom();
          rrComboRenderConditions();
        });
        // Remove
        card.querySelector('.rr-cc-remove').addEventListener('click', () => {
          if (_rrComboConds.length <= 2) return;
          rrComboSyncAllFromDom();
          _rrComboConds.splice(i, 1);
          if (_rrComboActive >= _rrComboConds.length) _rrComboActive = _rrComboConds.length - 1;
          rrComboRenderConditions();
        });
        comboCondsEl.appendChild(card);
      });
    };

    /** Reset the builder to its blank two-condition state. */
    const rrComboReset = () => {
      _rrComboConds = [blankComboCond(), blankComboCond()];
      _rrComboActive = 0;
      if (comboLevelEl) comboLevelEl.value = 'amber';
      rrComboRenderConditions();
    };

    /** Populate the builder (level + conditions) from a saved combo rule for editing. */
    const rrComboLoadFromRule = (rule) => {
      const conds = Array.isArray(rule && rule.conditions) ? rule.conditions : [];
      _rrComboConds = conds.map((cond) => {
        const a = (cond && cond.analyte) || {};
        const isText = Array.isArray(cond && cond.contains);
        return {
          match: (a.match || []).join('\n'),
          exclude: (a.exclude || []).join('\n'),
          specimen: (a.specimen || []).join('\n'),
          type: isText ? 'text' : 'numeric',
          comparator: cond && cond.comparator === 'below' ? 'below' : 'above',
          value: cond && cond.value != null ? String(cond.value) : '',
          contains: isText ? (cond.contains || []).join('\n') : '',
        };
      });
      // A combo always carries ≥2 conditions, but stay defensive: never drop below the floor.
      while (_rrComboConds.length < 2) _rrComboConds.push(blankComboCond());
      _rrComboActive = 0;
      if (comboLevelEl) comboLevelEl.value = rule && rule.level === 'red' ? 'red' : 'amber';
      rrComboRenderConditions();
    };

    /** Read every condition card into a flat form-bag array for buildComboRuleFromForm. */
    const rrComboReadConditionForms = () => {
      rrComboSyncAllFromDom();
      return _rrComboConds.map((c) => ({
        match: c.match,
        exclude: c.exclude,
        specimen: c.specimen,
        type: c.type,
        comparator: c.comparator,
        value: c.value,
        contains: c.contains,
      }));
    };

    // True when the main editor's Rule type is Combo — inspector clicks seed the
    // active condition rather than the single-analyte editor field.
    const rrComboIsOpen = () => {
      const kindEl = $('#rrKind');
      return !!(kindEl && kindEl.value === 'combo');
    };

    /** Seed the active condition's analyte-match list with a clicked result name. */
    const rrComboSeedMatch = (name) => {
      const c = _rrComboConds[_rrComboActive];
      if (!c) return;
      rrComboSyncAllFromDom();
      const next = appendUniqueLine(c.match, name);
      if (next == null) return;
      c.match = next;
      rrComboRenderConditions();
    };

    /** Seed the active condition's specimen scope with a clicked specimen header. */
    const rrComboSeedSpecimen = (spec) => {
      const c = _rrComboConds[_rrComboActive];
      if (!c) return;
      rrComboSyncAllFromDom();
      const next = appendUniqueLine(c.specimen, spec);
      if (next == null) return;
      c.specimen = next;
      rrComboRenderConditions();
    };

    // Expose to the inspector render seam (so result-cell clicks can seed conditions).
    _rrComboSeedHook = { isOpen: rrComboIsOpen, seedMatch: rrComboSeedMatch, seedSpecimen: rrComboSeedSpecimen };

    // Bridge the builder to the module-scope editor save / populate paths
    // (saveCurrentResultRule / openResultRuleEditor) — see _rrComboApi declaration.
    _rrComboApi = {
      reset: rrComboReset,
      syncAllFromDom: rrComboSyncAllFromDom,
      readConditionForms: rrComboReadConditionForms,
      loadFromRule: rrComboLoadFromRule,
    };

    const comboAddBtn = $('#btnRrComboAddCond');
    if (comboAddBtn) {
      comboAddBtn.addEventListener('click', () => {
        rrComboSyncAllFromDom();
        _rrComboConds.push(blankComboCond());
        rrComboRenderConditions();
      });
    }

    // ── Paste fallback ──────────────────────────────────────────────────────
    if (inspectBtn) {
      inspectBtn.addEventListener('click', () => {
        if (!inputEl || !statusEl || !resultsEl) return;
        statusEl.textContent = '';
        statusEl.className = 'tl-rr-inspector-status';
        resultsEl.style.display = 'none';
        resultsEl.innerHTML = '';

        const raw = (inputEl.value || '').trim();
        if (!raw) {
          statusEl.className = 'tl-rr-inspector-status tl-rr-inspector-err';
          statusEl.textContent = 'Paste a JSON investigation-report payload first.';
          return;
        }

        let payload;
        try {
          payload = JSON.parse(raw);
        } catch (e) {
          statusEl.className = 'tl-rr-inspector-status tl-rr-inspector-err';
          statusEl.textContent = 'Could not parse JSON: ' + e.message;
          return;
        }

        const NORM = window.SentinelNormalisers;
        if (!NORM || typeof NORM.normaliseInvestigationReport !== 'function') {
          statusEl.className = 'tl-rr-inspector-status tl-rr-inspector-err';
          statusEl.textContent = 'normaliseInvestigationReport not loaded — check normalisers.js script tag.';
          return;
        }

        let parsed;
        try {
          parsed = NORM.normaliseInvestigationReport(payload);
        } catch (e) {
          statusEl.className = 'tl-rr-inspector-status tl-rr-inspector-err';
          statusEl.textContent = 'Normaliser threw: ' + e.message;
          return;
        }

        const fields = extractResultFields(parsed);
        if (!fields.length) {
          statusEl.className = 'tl-rr-inspector-status tl-rr-inspector-err';
          statusEl.textContent =
            'No result lines found in the payload. Check it is a valid investigation-report response.';
          return;
        }

        renderInspectorFields(fields, {});
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (inputEl) inputEl.value = '';
        if (statusEl) {
          statusEl.textContent = '';
          statusEl.className = 'tl-rr-inspector-status';
        }
        if (resultsEl) {
          resultsEl.style.display = 'none';
          resultsEl.innerHTML = '';
        }
      });
    }
  };

  const openResultRuleEditor = (id) => {
    const rule = CONFIG.resultRules.find((r) => r.id === id);
    if (!rule) return;
    rrEditingId = id;
    rrEditingDraft = JSON.parse(JSON.stringify(rule));

    $('#rrEditTitle').textContent = rule.builtin
      ? 'Edit built-in result rule: ' + rule.label
      : 'Edit result rule: ' + rule.label;
    // Built-in chip labels ARE user-editable and the edit persists across suite updates
    // (mergeShippedDefaults appends builtins by id only, and revertRetiredResultRuleFields
    // reverts a builtin's label ONLY while it still exactly equals a retired shipped
    // default — i.e. the user hasn't customised it). Surface that affordance explicitly so
    // a clinician knows they can rename/shorten a flag (e.g. strip a redundant "high").
    const builtinHint = $('#rrLabelBuiltinHint');
    if (builtinHint) builtinHint.style.display = rule.builtin ? '' : 'none';
    $('#rrLabel').value = rrEditingDraft.label || '';
    $('#rrAnalyteMatch').value = ((rrEditingDraft.analyte && rrEditingDraft.analyte.match) || []).join('\n');
    $('#rrAnalyteExclude').value = ((rrEditingDraft.analyte && rrEditingDraft.analyte.exclude) || []).join('\n');
    $('#rrAnalyteSpecimen').value = ((rrEditingDraft.analyte && rrEditingDraft.analyte.specimen) || []).join('\n');
    const kind = rrEditingDraft.kind === 'text' ? 'text' : rrEditingDraft.kind === 'combo' ? 'combo' : 'threshold';
    $('#rrKind').value = kind;
    if (kind === 'combo' && _rrComboApi) _rrComboApi.loadFromRule(rrEditingDraft);
    $('#rrComparator').value = rrEditingDraft.comparator || 'above';
    $('#rrAmber').value = rrEditingDraft.amber != null ? rrEditingDraft.amber : '';
    $('#rrRed').value = rrEditingDraft.red != null ? rrEditingDraft.red : '';
    $('#rrUnit').value = rrEditingDraft.unit || '';
    $('#rrNormalText').value = Array.isArray(rrEditingDraft.normalText) ? rrEditingDraft.normalText.join('\n') : '';
    $('#rrNormalLabel').value = rrEditingDraft.normalLabel || '';
    $('#rrEnabled').checked = !!rrEditingDraft.enabled;
    rrApplyKindVisibility(kind);

    // Reset test-match indicator when opening editor
    const testEl = $('#rrTestName');
    const testResEl = $('#rrTestResult');
    if (testEl) testEl.value = '';
    if (testResEl) {
      testResEl.textContent = '';
      testResEl.className = 'tl-rr-test-result';
    }

    // Refresh in-session suggestion pills (non-persisted)
    rrRenderSuggestions();

    activateTab('resultEdit');
  };

  const saveCurrentResultRule = async () => {
    if (!rrEditingId) return;
    const selectedKind = $('#rrKind').value;
    const enabled = $('#rrEnabled').checked;

    // ── Combo (multi-condition) — built by the inline combo builder ───────────
    if (selectedKind === 'combo') {
      if (!_rrComboApi) return;
      const built = buildComboRuleFromForm({
        id: rrEditingDraft.id,
        label: $('#rrLabel').value.trim(),
        level: $('#rrComboLevel').value,
        conditions: _rrComboApi.readConditionForms(),
      });
      if (built.error) {
        flash(built.error, 'err');
        return;
      }
      // Honour the editor's Enabled checkbox (the manual editor lets a clinician
      // enable after review; the LLM-import path is the one that forces disabled).
      const rule = { ...built.rule, enabled };
      const VALIDATE = window.SentinelResultRules && window.SentinelResultRules.validateResultRule;
      if (VALIDATE) {
        const errs = VALIDATE(rule);
        if (errs.length > 0) {
          flash(errs[0], 'err');
          return;
        }
      }
      const cIdx = CONFIG.resultRules.findIndex((r) => r.id === rrEditingId);
      if (cIdx >= 0) CONFIG.resultRules[cIdx] = rule;
      else CONFIG.resultRules.push(rule);
      await saveConfig(CONFIG);
      flash('Saved');
      rrEditingId = null;
      renderResultRules();
      activateTab('resultRules');
      return;
    }

    const label = $('#rrLabel').value.trim() || 'Untitled result rule';
    const analyteMatch = $('#rrAnalyteMatch')
      .value.split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const analyteExclude = ($('#rrAnalyteExclude').value || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const analyteSpecimen = ($('#rrAnalyteSpecimen').value || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const analyte = { match: analyteMatch };
    if (analyteExclude.length) analyte.exclude = analyteExclude;
    if (analyteSpecimen.length) analyte.specimen = analyteSpecimen;

    if (selectedKind === 'text') {
      const normalText = ($('#rrNormalText').value || '')
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      const normalLabel = $('#rrNormalLabel').value.trim() || 'No growth';
      // Preserve abnormalText (positive-flag phrases — e.g. the culture/blood-culture
      // safety flags, or the bowel-screening non-responder phrases). The editor has no
      // field for it, so carry forward the existing value rather than silently dropping it
      // on every save (which would strip the positive-flag guard and re-open the
      // false-calm hazard). Captured before rrEditingDraft is reassigned below.
      const keptAbnormalText =
        Array.isArray(rrEditingDraft.abnormalText) && rrEditingDraft.abnormalText.length
          ? rrEditingDraft.abnormalText
          : null;
      rrEditingDraft = {
        id: rrEditingDraft.id,
        builtin: rrEditingDraft.builtin || false,
        kind: 'text',
        label,
        normalLabel,
        analyte,
        normalText,
        enabled,
      };
      if (keptAbnormalText) rrEditingDraft.abnormalText = keptAbnormalText;
    } else {
      rrEditingDraft.label = label;
      rrEditingDraft.analyte = analyte;
      rrEditingDraft.comparator = $('#rrComparator').value;
      const amberVal = $('#rrAmber').value.trim();
      const redVal = $('#rrRed').value.trim();
      rrEditingDraft.amber = amberVal !== '' && Number.isFinite(+amberVal) ? +amberVal : null;
      rrEditingDraft.red = redVal !== '' && Number.isFinite(+redVal) ? +redVal : null;
      const unitVal = $('#rrUnit').value.trim();
      rrEditingDraft.unit = unitVal || null;
      rrEditingDraft.enabled = enabled;
      // Remove text-only / combo-only fields if switching to threshold
      delete rrEditingDraft.kind;
      delete rrEditingDraft.normalText;
      delete rrEditingDraft.normalLabel;
      delete rrEditingDraft.conditions;
      delete rrEditingDraft.level;
    }

    const VALIDATE = window.SentinelResultRules && window.SentinelResultRules.validateResultRule;
    if (VALIDATE) {
      const errs = VALIDATE(rrEditingDraft);
      if (errs.length > 0) {
        flash(errs[0], 'err');
        return;
      }
    }

    const idx = CONFIG.resultRules.findIndex((r) => r.id === rrEditingId);
    if (idx >= 0) CONFIG.resultRules[idx] = rrEditingDraft;
    else CONFIG.resultRules.push(rrEditingDraft);
    await saveConfig(CONFIG);
    flash('Saved');
    rrEditingId = null;
    renderResultRules();
    activateTab('resultRules');
  };

  const setupResultLlmPane = () => {
    const btnCopy = $('#btnResultLlmCopyPrompt');
    const copiedEl = $('#resultLlmCopied');
    const jsonEl = $('#resultLlmJson');
    const btnImport = $('#btnResultLlmImport');
    const statusEl = $('#resultLlmStatus');
    const previewEl = $('#resultLlmPreview');
    const previewList = $('#resultLlmPreviewList');
    const btnConfirm = $('#btnResultLlmConfirm');
    const btnCancel = $('#btnResultLlmCancel');
    if (!btnCopy || !jsonEl || !btnImport || !statusEl) return;

    // Pending candidates awaiting confirm
    let rrPendingCandidates = null;

    const clearPreview = () => {
      rrPendingCandidates = null;
      if (previewEl) previewEl.style.display = 'none';
      if (previewList) previewList.innerHTML = '';
    };

    btnCopy.addEventListener('click', async () => {
      const PROMPT = window.SentinelResultRules && window.SentinelResultRules.resultRuleSchemaPrompt;
      if (!PROMPT) {
        flash('result-rules.js not loaded', 'err');
        return;
      }
      const prompt = PROMPT();
      try {
        await navigator.clipboard.writeText(prompt);
      } catch (_) {
        const ta = document.createElement('textarea');
        ta.value = prompt;
        ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand && document.execCommand('copy');
        document.body.removeChild(ta);
      }
      if (copiedEl) {
        copiedEl.style.opacity = '1';
        setTimeout(() => {
          copiedEl.style.opacity = '0';
        }, 2000);
      }
    });

    btnImport.addEventListener('click', async () => {
      clearPreview();
      statusEl.className = 'tl-llm-status';
      statusEl.textContent = '';
      const raw = (jsonEl.value || '').trim();
      if (!raw) {
        statusEl.className = 'tl-llm-status tl-llm-status-err';
        statusEl.textContent = 'Paste the LLM JSON into the box first.';
        return;
      }

      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        statusEl.className = 'tl-llm-status tl-llm-status-err';
        statusEl.textContent = 'Could not parse JSON: ' + e.message;
        return;
      }

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
        statusEl.className = 'tl-llm-status tl-llm-status-err';
        statusEl.textContent = 'Expected a JSON object, an array, or an object with a "rules" array.';
        return;
      }

      if (candidates.length === 0) {
        statusEl.className = 'tl-llm-status tl-llm-status-err';
        statusEl.textContent = 'No rule objects found in the pasted JSON.';
        return;
      }

      const VALIDATE = window.SentinelResultRules && window.SentinelResultRules.validateResultRule;
      if (VALIDATE) {
        for (let i = 0; i < candidates.length; i++) {
          const errs = VALIDATE(candidates[i]);
          if (errs.length > 0) {
            statusEl.className = 'tl-llm-status tl-llm-status-err';
            const prefix = candidates.length > 1 ? 'Rule ' + (i + 1) + ': ' : '';
            statusEl.textContent = prefix + errs[0];
            return;
          }
        }
      }

      // Build preview — show before committing
      rrPendingCandidates = candidates;
      if (previewEl && previewList) {
        previewList.innerHTML = '';
        for (const c of candidates) {
          let summary;
          if (c.kind === 'combo') {
            summary = rrComboImportPreview(c);
          } else if (c.kind === 'text') {
            const phrases = Array.isArray(c.normalText) ? c.normalText : [];
            const shownPhrases = phrases.slice(0, 3).join(', ') || '(none)';
            const morePhrases = phrases.length > 3 ? ' …' : '';
            summary =
              (c.label || 'Untitled') +
              ' — Text: "' +
              (c.label || 'Needs review') +
              '" unless: ' +
              shownPhrases +
              morePhrases +
              ' — will import DISABLED';
          } else {
            const cmp = c.comparator === 'above' ? '≥' : '≤';
            const parts = [];
            if (c.red != null) parts.push(cmp + c.red + ' red');
            if (c.amber != null) parts.push(cmp + c.amber + ' amber');
            const unit = c.unit ? ' (' + c.unit + ')' : '';
            const numSummary = parts.join(' / ') + unit;
            summary =
              (c.label || 'Untitled') +
              ' — ' +
              (c.comparator === 'above' ? 'at or above' : 'at or below') +
              ': ' +
              numSummary +
              ' — will import DISABLED';
          }
          const item = document.createElement('div');
          item.className = 'tl-rr-llm-preview-item';
          item.textContent = summary;
          previewList.appendChild(item);
        }
        if (btnConfirm)
          btnConfirm.textContent =
            'Add ' + candidates.length + ' rule' + (candidates.length !== 1 ? 's' : '') + ', disabled';
        previewEl.style.display = 'block';
        statusEl.className = 'tl-llm-status';
        statusEl.textContent = '';
      }
    });

    if (btnConfirm) {
      btnConfirm.addEventListener('click', async () => {
        if (!rrPendingCandidates) return;
        const toAdd = rrPendingCandidates.map((rule) => ({
          ...rule,
          id: 'rrule_' + Math.random().toString(36).slice(2, 9),
          builtin: false,
          enabled: false,
        }));
        CONFIG.resultRules.push(...toAdd);
        await saveConfig(CONFIG);
        jsonEl.value = '';
        clearPreview();
        statusEl.className = 'tl-llm-status tl-llm-status-ok';
        statusEl.textContent =
          'Imported ' +
          toAdd.length +
          ' rule' +
          (toAdd.length !== 1 ? 's' : '') +
          ' (disabled — review and enable each before it fires).';
        renderResultRules();
      });
    }

    if (btnCancel) {
      btnCancel.addEventListener('click', () => {
        clearPreview();
        statusEl.className = 'tl-llm-status';
        statusEl.textContent = '';
      });
    }
  };

  // ============================================================
  // OUTSTANDING REQUESTS TAB
  // ============================================================
  const setupOirPane = () => {
    // Save behaviour settings
    $('#btnSaveOir').addEventListener('click', async () => {
      if (!CONFIG.prefs) CONFIG.prefs = {};
      $$('#paneOir [data-pref]').forEach((inp) => {
        const key = inp.dataset.pref;
        const isNumber = inp.dataset.prefType === 'number';
        if (inp.type === 'checkbox') CONFIG.prefs[key] = inp.checked;
        else if (inp.type === 'number') CONFIG.prefs[key] = Number(inp.value);
        else if (isNumber) CONFIG.prefs[key] = Number(inp.value);
        else CONFIG.prefs[key] = inp.value;
      });
      await saveConfig(CONFIG);
      flash('OIR settings saved');
    });

    // Built-in summary
    const summaryEl = $('#oirBuiltinSummary');
    if (summaryEl) {
      const defs = window.SentinelOutstandingMatch ? window.SentinelOutstandingMatch.TEST_DEFS : null;
      if (defs && defs.length) {
        summaryEl.textContent =
          'Built-in tests (always active unless disabled below): ' +
          defs.map((d) => d.label).join(', ') +
          '. Use the form below to extend a built-in (add extra synonym terms for your lab) or disable one entirely.';
      } else {
        summaryEl.textContent = 'Built-in test definitions not available in this context.';
      }
    }

    // Mode picker visibility
    const modeEl = $('#oirFormMode');
    const builtinRow = $('#oirFormBuiltinRow');
    const labelRow = $('#oirFormLabelRow');
    const reqRow = $('#oirFormReqRow');
    const repRow = $('#oirFormRepRow');
    const analytesRow = $('#oirFormAnalytesRow');
    const singleRow = $('#oirFormSingleRow');

    const applyModeVisibility = (mode) => {
      const isNew = mode === 'new';
      const isDisable = mode === 'disable';
      if (builtinRow) builtinRow.style.display = isNew ? 'none' : '';
      if (labelRow) labelRow.style.display = isDisable ? 'none' : '';
      if (reqRow) reqRow.style.display = isDisable ? 'none' : '';
      if (repRow) repRow.style.display = isDisable ? 'none' : '';
      if (analytesRow) analytesRow.style.display = isDisable ? 'none' : '';
      if (singleRow) singleRow.style.display = isNew && !isDisable ? '' : 'none';
    };
    applyModeVisibility(modeEl ? modeEl.value : 'new');
    if (modeEl) {
      modeEl.addEventListener('change', () => applyModeVisibility(modeEl.value));
    }

    // Populate built-in dropdown
    const builtinKeyEl = $('#oirFormBuiltinKey');
    const populateBuiltinDropdown = () => {
      if (!builtinKeyEl) return;
      builtinKeyEl.innerHTML = '';
      const defs = window.SentinelOutstandingMatch ? window.SentinelOutstandingMatch.TEST_DEFS : [];
      for (const d of defs || []) {
        const opt = document.createElement('option');
        opt.value = escAttr(d.key);
        opt.textContent = d.label + ' (' + d.key + ')';
        builtinKeyEl.appendChild(opt);
      }
    };
    populateBuiltinDropdown();

    // Cancel edit
    const cancelBtn = $('#btnCancelOirTest');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        resetOirForm();
      });
    }

    // Save test
    $('#btnSaveOirTest').addEventListener('click', async () => {
      const mode = modeEl ? modeEl.value : 'new';
      const editKey = $('#oirFormEditKey') ? $('#oirFormEditKey').value : '';
      const statusEl = $('#oirFormStatus');

      const splitTerms = (val) =>
        String(val || '')
          .split(/[\n,]/)
          .map((s) => s.trim())
          .filter(Boolean);

      let entry;
      if (mode === 'disable') {
        const key = builtinKeyEl ? builtinKeyEl.value : '';
        if (!key) {
          if (statusEl) statusEl.textContent = 'Select a built-in test to disable.';
          return;
        }
        entry = { key, disabled: true, label: '', req: [], rep: [], analytes: [], singleAnalyte: false };
      } else if (mode === 'extend') {
        const key = builtinKeyEl ? builtinKeyEl.value : '';
        if (!key) {
          if (statusEl) statusEl.textContent = 'Select a built-in test to extend.';
          return;
        }
        const label = $('#oirFormLabel') ? $('#oirFormLabel').value.trim() : '';
        const req = splitTerms($('#oirFormReq') ? $('#oirFormReq').value : '');
        const rep = splitTerms($('#oirFormRep') ? $('#oirFormRep').value : '');
        const analytes = splitTerms($('#oirFormAnalytes') ? $('#oirFormAnalytes').value : '');
        entry = { key, disabled: false, label, req, rep, analytes, singleAnalyte: false };
      } else {
        // new
        const labelVal = $('#oirFormLabel') ? $('#oirFormLabel').value.trim() : '';
        if (!labelVal) {
          if (statusEl) statusEl.textContent = 'Label is required.';
          return;
        }
        const req = splitTerms($('#oirFormReq') ? $('#oirFormReq').value : '');
        if (!req.length) {
          if (statusEl) statusEl.textContent = 'At least one request term is required for a new custom test.';
          return;
        }
        const rep = splitTerms($('#oirFormRep') ? $('#oirFormRep').value : '');
        const analytes = splitTerms($('#oirFormAnalytes') ? $('#oirFormAnalytes').value : '');
        const singleAnalyte = $('#oirFormSingle') ? $('#oirFormSingle').checked : false;
        // Derive key from label if not editing an existing entry
        const key =
          editKey ||
          labelVal
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_|_$/g, '');
        if (!key) {
          if (statusEl) statusEl.textContent = 'Label must contain at least one letter or number.';
          return;
        }
        entry = { key, disabled: false, label: labelVal, req, rep, analytes, singleAnalyte };
      }

      if (!Array.isArray(CONFIG.oirTests)) CONFIG.oirTests = [];

      // Conflict check: only for entries that have req terms (not disable-mode).
      if (mode !== 'disable') {
        const conflicts = findOirReqConflicts(entry, CONFIG.oirTests, editKey);
        if (conflicts.length) {
          showOirMergeDialog(entry, conflicts, editKey);
          return;
        }
      }

      const existingIdx = editKey
        ? CONFIG.oirTests.findIndex((t) => t.key === editKey)
        : CONFIG.oirTests.findIndex((t) => t.key === entry.key);
      if (existingIdx >= 0) {
        CONFIG.oirTests[existingIdx] = entry;
      } else {
        CONFIG.oirTests.push(entry);
      }
      await saveConfig(CONFIG);
      flash('Test saved');
      resetOirForm();
      renderOirTests();
    });

    // Clear audit
    const clearAuditBtn = $('#btnClearOirAudit');
    if (clearAuditBtn) {
      clearAuditBtn.addEventListener('click', async () => {
        if (!confirm('Clear the entire OIR audit log? This cannot be undone.')) return;
        if (typeof chrome !== 'undefined' && chrome.storage) {
          await chrome.storage.local.remove('triagelens.oir.auditLog');
        }
        renderOirAudit();
        flash('Audit log cleared');
      });
    }

    renderOirTests();
    renderOirAudit();
  };

  const resetOirForm = () => {
    const modeEl = $('#oirFormMode');
    if (modeEl) modeEl.value = 'new';
    const editKeyEl = $('#oirFormEditKey');
    if (editKeyEl) editKeyEl.value = '';
    const labelEl = $('#oirFormLabel');
    if (labelEl) labelEl.value = '';
    const reqEl = $('#oirFormReq');
    if (reqEl) reqEl.value = '';
    const repEl = $('#oirFormRep');
    if (repEl) repEl.value = '';
    const analytesEl = $('#oirFormAnalytes');
    if (analytesEl) analytesEl.value = '';
    const singleEl = $('#oirFormSingle');
    if (singleEl) singleEl.checked = false;
    const statusEl = $('#oirFormStatus');
    if (statusEl) statusEl.textContent = '';
    const cancelBtn = $('#btnCancelOirTest');
    if (cancelBtn) cancelBtn.style.display = 'none';
    // Re-apply mode visibility
    const builtinRow = $('#oirFormBuiltinRow');
    if (builtinRow) builtinRow.style.display = 'none';
    const singleRow = $('#oirFormSingleRow');
    if (singleRow) singleRow.style.display = '';
    const labelRow = $('#oirFormLabelRow');
    if (labelRow) labelRow.style.display = '';
    const reqRow = $('#oirFormReqRow');
    if (reqRow) reqRow.style.display = '';
    const repRow = $('#oirFormRepRow');
    if (repRow) repRow.style.display = '';
    const analytesRow = $('#oirFormAnalytesRow');
    if (analytesRow) analytesRow.style.display = '';
  };

  // Returns custom entries whose req terms overlap with entry's req terms,
  // excluding the entry itself and the entry being edited (by editKey).
  const findOirReqConflicts = (entry, tests, editKey) => {
    const norm = (s) =>
      String(s || '')
        .toLowerCase()
        .trim();
    const newReq = (entry.req || []).map(norm).filter(Boolean);
    if (!newReq.length) return [];
    return (tests || []).filter((t) => {
      if (!t || t.key === entry.key) return false;
      if (editKey && t.key === editKey) return false;
      return (t.req || []).map(norm).some((r) => newReq.includes(r));
    });
  };

  // Builds a merged entry from a new entry and one or more conflicting existing entries.
  // Key/label: taken from the entry whose key matches a built-in (if any), otherwise the
  // first conflict (existing entry). singleAnalyte only if all merged entries agree.
  const buildMergedOirEntry = (newEntry, conflicts) => {
    const defs = window.SentinelOutstandingMatch ? window.SentinelOutstandingMatch.TEST_DEFS : [];
    const newIsBuiltin = (defs || []).some((d) => d.key === newEntry.key);
    const conflictIsBuiltin = !newIsBuiltin && conflicts.some((c) => (defs || []).some((d) => d.key === c.key));
    const base = newIsBuiltin
      ? newEntry
      : conflictIsBuiltin
        ? conflicts.find((c) => (defs || []).some((d) => d.key === c.key))
        : conflicts[0];
    const all = [newEntry, ...conflicts];
    const unionArr = (field) => {
      const seen = new Set();
      const out = [];
      for (const e of all) {
        for (const t of e[field] || []) {
          const k = String(t).toLowerCase().trim();
          if (k && !seen.has(k)) {
            seen.add(k);
            out.push(t);
          }
        }
      }
      return out;
    };
    return {
      key: base.key,
      label: base.label || base.key,
      req: unionArr('req'),
      rep: unionArr('rep'),
      analytes: unionArr('analytes'),
      singleAnalyte: all.every((e) => !!e.singleAnalyte),
      disabled: false,
    };
  };

  // Shows the merge dialog. Replaces button nodes to avoid stale listener accumulation.
  const showOirMergeDialog = (newEntry, conflicts, editKey) => {
    const overlay = $('#oirMergeOverlay');
    if (!overlay) return;
    const merged = buildMergedOirEntry(newEntry, conflicts);
    const conflictNames = conflicts.map((c) => `"${c.label || c.key}"`).join(', ');
    $('#oirMergeDesc').textContent =
      `Request term(s) overlap with ${conflictNames}. Merge combines all terms into one entry, or save as a separate entry.`;
    $('#oirMergeLabel').value = merged.label;
    $('#oirMergeReq').value = merged.req.join('\n');
    $('#oirMergeRep').value = merged.rep.join('\n');
    $('#oirMergeAnalytes').value = merged.analytes.join('\n');
    $('#oirMergeSingle').checked = merged.singleAnalyte;
    overlay.style.display = 'flex';

    const hide = () => {
      overlay.style.display = 'none';
    };

    const replaceBtn = (id, listener) => {
      const old = $(`#${id}`);
      if (!old) return;
      const fresh = old.cloneNode(true);
      old.parentNode.replaceChild(fresh, old);
      fresh.addEventListener('click', listener);
    };

    replaceBtn('btnOirMergeConfirm', async () => {
      hide();
      const label = ($('#oirMergeLabel').value || '').trim() || merged.label;
      const finalEntry = { ...merged, label };
      // Remove the conflicting entries and any prior entry for the merged key
      const keysToRemove = new Set([finalEntry.key, ...conflicts.map((c) => c.key)]);
      if (editKey) keysToRemove.add(editKey);
      CONFIG.oirTests = (CONFIG.oirTests || []).filter((t) => !keysToRemove.has(t.key));
      CONFIG.oirTests.push(finalEntry);
      await saveConfig(CONFIG);
      flash('Entries merged and saved');
      resetOirForm();
      renderOirTests();
    });

    replaceBtn('btnOirMergeSeparate', async () => {
      hide();
      if (!Array.isArray(CONFIG.oirTests)) CONFIG.oirTests = [];
      const existingIdx = editKey
        ? CONFIG.oirTests.findIndex((t) => t.key === editKey)
        : CONFIG.oirTests.findIndex((t) => t.key === newEntry.key);
      if (existingIdx >= 0) {
        CONFIG.oirTests[existingIdx] = newEntry;
      } else {
        CONFIG.oirTests.push(newEntry);
      }
      await saveConfig(CONFIG);
      flash('Test saved');
      resetOirForm();
      renderOirTests();
    });

    replaceBtn('btnOirMergeCancel', hide);
  };

  const renderOirTests = () => {
    const container = $('#oirTestList');
    const emptyEl = $('#oirTestListEmpty');
    if (!container) return;
    container.innerHTML = '';
    const tests = Array.isArray(CONFIG.oirTests) ? CONFIG.oirTests : [];
    if (!tests.length) {
      if (emptyEl) emptyEl.style.display = 'block';
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';
    const defs = window.SentinelOutstandingMatch ? window.SentinelOutstandingMatch.TEST_DEFS : [];
    const sorted = [...tests].sort((a, b) => (a.label || a.key).localeCompare(b.label || b.key));
    for (const t of sorted) {
      const isBuiltinKey = (defs || []).some((d) => d.key === t.key);
      let typeLabel;
      if (t.disabled) {
        typeLabel = 'Disable built-in';
      } else if (isBuiltinKey) {
        typeLabel = 'Extend built-in';
      } else {
        typeLabel = 'Custom test';
      }
      const termSummary = t.disabled
        ? 'Built-in disabled — requests for this test will stay outstanding.'
        : [
            t.req && t.req.length ? 'req: ' + t.req.slice(0, 3).join(', ') : '',
            t.rep && t.rep.length ? 'rep: ' + t.rep.slice(0, 2).join(', ') : '',
            t.analytes && t.analytes.length ? 'analytes: ' + t.analytes.slice(0, 3).join(', ') : '',
          ]
            .filter(Boolean)
            .join(' · ');
      const row = document.createElement('div');
      // tl-rule-row-oir: a compact 4-column variant. The shared .tl-rule-row grid
      // reserves two extra columns (patterns/actions counts) the OIR list never
      // fills, whose dead width helped shove the Edit/× actions off a narrow panel.
      row.className = 'tl-rule-row tl-rule-row-oir' + (t.disabled ? ' tl-rule-disabled' : '');
      row.innerHTML =
        '<span></span>' +
        '<span class="tl-rule-kind tl-rule-kind-' +
        (t.disabled ? 'amber' : 'info') +
        '">' +
        escHtml(typeLabel) +
        '</span>' +
        '<span>' +
        '<span class="tl-rule-label">' +
        escHtml(t.key) +
        (t.label ? ' — ' + escHtml(t.label) : '') +
        '</span>' +
        '<span class="tl-rule-meta"> · ' +
        escHtml(termSummary) +
        '</span>' +
        '</span>' +
        '<span class="tl-rule-actions">' +
        '<button class="tl-btn" data-act="edit">Edit</button>' +
        '<button class="tl-btn tl-btn-danger" data-act="del">×</button>' +
        '</span>';
      row.querySelector('[data-act="edit"]').addEventListener('click', () => {
        // Populate form for editing
        const modeEl = $('#oirFormMode');
        const isBuiltin = (defs || []).some((d) => d.key === t.key);
        if (modeEl) {
          if (t.disabled) modeEl.value = 'disable';
          else if (isBuiltin) modeEl.value = 'extend';
          else modeEl.value = 'new';
          modeEl.dispatchEvent(new Event('change'));
        }
        const builtinKeyEl = $('#oirFormBuiltinKey');
        if (builtinKeyEl && (t.disabled || isBuiltin)) builtinKeyEl.value = t.key;
        const labelEl = $('#oirFormLabel');
        if (labelEl) labelEl.value = t.label || '';
        const reqEl = $('#oirFormReq');
        if (reqEl) reqEl.value = (t.req || []).join('\n');
        const repEl = $('#oirFormRep');
        if (repEl) repEl.value = (t.rep || []).join('\n');
        const analytesEl = $('#oirFormAnalytes');
        if (analytesEl) analytesEl.value = (t.analytes || []).join('\n');
        const singleEl = $('#oirFormSingle');
        if (singleEl) singleEl.checked = !!t.singleAnalyte;
        const editKeyEl = $('#oirFormEditKey');
        if (editKeyEl) editKeyEl.value = t.key;
        const cancelBtn = $('#btnCancelOirTest');
        if (cancelBtn) cancelBtn.style.display = '';
        const statusEl = $('#oirFormStatus');
        if (statusEl) statusEl.textContent = '';
        // Scroll form into view
        const formEl = $('#oirTestForm');
        if (formEl) formEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      row.querySelector('[data-act="del"]').addEventListener('click', async () => {
        if (!confirm('Remove this test entry?')) return;
        CONFIG.oirTests = CONFIG.oirTests.filter((x) => x.key !== t.key);
        await saveConfig(CONFIG);
        flash('Removed');
        renderOirTests();
      });
      container.appendChild(row);
    }
  };

  const renderOirAudit = () => {
    const container = $('#oirAuditList');
    if (!container) return;
    container.innerHTML = '';
    if (typeof chrome === 'undefined' || !chrome.storage) {
      container.innerHTML = '<div class="tl-empty">chrome.storage not available.</div>';
      return;
    }
    chrome.storage.local.get('triagelens.oir.auditLog', (r) => {
      const log = r['triagelens.oir.auditLog'];
      if (!Array.isArray(log) || !log.length) {
        container.innerHTML =
          '<div class="tl-empty" style="padding:14px 0;font-style:italic;color:var(--text-4)">No tick-offs recorded yet.</div>';
        return;
      }
      // kind → { tag: short badge text, verb: sentence verb }. 'bulk' (the
      // pre-existing clinician-confirmed path) has no badge, to keep its
      // rendering unchanged. 'auto' and 'auto-review' (Phase 1.4 — machine
      // auto-tick + its Review action) get an explicit badge so this viewer
      // reads honestly: 'auto-review' is a REVIEW, not a reversal (ticking
      // writes to Medicus immediately — see recordOirAudit's doc comment).
      const KIND_META = {
        bulk: { tag: '', verb: 'ticked off' },
        auto: { tag: 'AUTO', verb: 'auto-ticked' },
        'auto-review': {
          tag: 'REVIEW',
          verb: 'reviewed (auto-ticked, not reversed)',
        },
      };
      const list = document.createElement('div');
      list.className = 'tl-rule-list';
      const shown = log.slice(0, 20);
      for (const entry of shown) {
        const row = document.createElement('div');
        row.style.cssText =
          'padding:8px 14px;border-bottom:1px solid var(--border);font-size:12px;display:flex;gap:12px;align-items:baseline;';
        const ts = entry.ts ? new Date(entry.ts).toLocaleString() : 'Unknown time';
        const count =
          typeof entry.count === 'number' ? entry.count : Array.isArray(entry.items) ? entry.items.length : '?';
        const names = Array.isArray(entry.items)
          ? entry.items
              .map((it) => escHtml(it.name || it.key || ''))
              .filter(Boolean)
              .join(', ')
          : '';
        const meta = KIND_META[entry.kind] || KIND_META.bulk;
        const badge = meta.tag
          ? '<span style="font-size:9px;font-weight:700;letter-spacing:.04em;color:var(--text-4);border:1px solid var(--border);border-radius:3px;padding:1px 4px;white-space:nowrap;">' +
            escHtml(meta.tag) +
            '</span>'
          : '';
        row.innerHTML =
          '<span style="color:var(--text-4);white-space:nowrap;font-size:11px;">' +
          escHtml(ts) +
          '</span>' +
          badge +
          '<span>' +
          escHtml(String(count)) +
          ' ' +
          escHtml(meta.verb) +
          (names ? ': ' + names : '') +
          '</span>';
        list.appendChild(row);
      }
      if (log.length > 20) {
        const more = document.createElement('div');
        more.style.cssText = 'padding:6px 14px;font-size:11px;color:var(--text-4);font-style:italic;';
        more.textContent = '… and ' + (log.length - 20) + ' older entries (clear to reset).';
        list.appendChild(more);
      }
      container.appendChild(list);
    });
  };

  const populateOir = () => {
    $$('#paneOir [data-pref]').forEach((inp) => {
      const key = inp.dataset.pref;
      const isNumber = inp.dataset.prefType === 'number';
      const val = CONFIG.prefs && CONFIG.prefs[key] != null ? CONFIG.prefs[key] : null;
      if (val == null) return;
      if (inp.type === 'checkbox') inp.checked = !!val;
      else if (isNumber) inp.value = String(val);
      else inp.value = val;
    });
  };

  // ============================================================
  // UTIL
  // ============================================================
  const escHtml = (s) =>
    String(s == null ? '' : s).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
  const escAttr = (s) => escHtml(s);

  // ============================================================
  // GO
  // ============================================================
  init().catch((e) => {
    console.error('[TriageLens options] init failed', e);
    flash('Init failed: ' + e.message, 'err');
  });
})();
