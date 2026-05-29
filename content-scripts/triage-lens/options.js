// Triage Lens — options page logic

(function applyDisplayPrefs() {
  function apply(p) {
    p = p || {};
    document.documentElement.setAttribute('data-theme', p.theme || 'light');
    document.documentElement.setAttribute('data-size', p.size || 'medium');
    document.documentElement.setAttribute('data-colorblind', String(!!p.colorblind));
  }
  chrome.storage.local.get('suite.display', r => apply(r['suite.display'] || {}));
  chrome.storage.onChanged.addListener(c => { if (c['suite.display']) apply(c['suite.display'].newValue || {}); });
})();

(() => {
  'use strict';

  const FIELDS = [
    { id: 'request',       label: 'Request body / preview text' },
    { id: 'problems',      label: 'Active problems' },
    { id: 'registers',     label: 'Registers' },
    { id: 'meds',          label: 'Medications' },
    { id: 'allergies',     label: 'Allergies' },
    { id: 'banner',        label: 'Banner warnings' },
    { id: 'consultations', label: 'Recent consultations' },
    { id: 'docs',          label: 'Recent documents' }
  ];
  const PAGES = [
    { id: 'queue',  label: 'Queue list' },
    { id: 'detail', label: 'Task detail' },
    { id: 'record', label: 'Patient record' }
  ];
  const KIND_LABEL = { red: 'RED', amber: 'AMBER', green: 'GREEN', info: 'INFO' };

  // ============================================================
  // STATE
  // ============================================================
  let CONFIG = null;        // current edited config
  let DEFAULTS = null;      // shipped defaults (read once)
  let editingId = null;     // id of rule being edited
  let editingDraft = null;  // shallow clone of rule under edit

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];

  const flash = (msg, kind = 'ok') => {
    const el = $('#tlStatus');
    el.textContent = msg;
    el.className = 'tl-status tl-status-' + kind;
    if (msg) setTimeout(() => { if (el.textContent === msg) { el.textContent = ''; } }, 2400);
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
    return await fetch(url).then(r => r.json());
  };

  const saveConfig = async (cfg) => {
    await chrome.storage.local.set({ 'triagelens.config': cfg });
    CONFIG = cfg;
  };

  // ============================================================
  // INITIAL RENDER
  // ============================================================
  const init = async () => {
    DEFAULTS = await fetchDefaults();
    CONFIG = await loadConfig();
    $('#tlVersion').textContent = 'v' + (chrome.runtime.getManifest()?.version || '');
    setupTabs();
    setupRulesPane();
    setupEditPane();
    setupSystemChipsPane();
    setupThresholdsPane();
    setupPrefsPane();
    setupPreviewPane();
    setupBackupPane();
    renderRules();
    renderSystemChips();
    populateThresholds();
    populatePrefs();
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
    $$('.tl-tab').forEach(t => t.classList.toggle('tl-tab-active', t.dataset.tab === name));
    const map = { rules: 'paneRules', edit: 'paneEdit', systemChips: 'paneSystemChips', systemEdit: 'paneSystemEdit', thresholds: 'paneThresholds', prefs: 'panePrefs', preview: 'panePreview', backup: 'paneBackup', about: 'paneAbout' };
    $$('.tl-pane').forEach(p => p.classList.remove('tl-pane-active'));
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
    notes: ''
  });

  const renderRules = () => {
    const q = ($('#ruleSearch').value || '').trim().toLowerCase();
    const kFilter = $('#filterKind').value;
    const list = CONFIG.rules.filter(r => {
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
          <span class="tl-rule-meta">  ${rule.builtin ? '· built-in ' : ''}${(rule.notes ? ' · ' + escHtml(rule.notes.slice(0, 50)) : '')}</span>
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
        CONFIG.rules = CONFIG.rules.filter(r => r.id !== rule.id);
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
    fc.innerHTML = FIELDS.map(f => `<label><input type="checkbox" data-field="${f.id}"><span>${f.label}</span></label>`).join('');
    const pc = $('#fPages');
    pc.innerHTML = PAGES.map(p => `<label><input type="checkbox" data-page="${p.id}"><span>${p.label}</span></label>`).join('');

    $('#btnBackToRules').addEventListener('click', () => {
      editingId = null;
      activateTab('rules');
    });
    $('#btnCancelEdit').addEventListener('click', () => {
      editingId = null;
      // Reload from storage to discard changes
      chrome.storage.local.get(['triagelens.config', 'config']).then(r => {
        const cfg = r['triagelens.config'] || r['config'];
        if (cfg) CONFIG = cfg;
        renderRules(); activateTab('rules');
      });
    });
    $('#btnSaveEdit').addEventListener('click', saveCurrentRule);
    $('#btnDeleteRule').addEventListener('click', async () => {
      if (!editingId) return;
      const r = CONFIG.rules.find(x => x.id === editingId);
      if (!r) return;
      if (!confirm(`Delete rule "${r.label}"?`)) return;
      CONFIG.rules = CONFIG.rules.filter(x => x.id !== editingId);
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
    const rule = CONFIG.rules.find(r => r.id === id);
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

    $$('#fFields input').forEach(c => { c.checked = (editingDraft.fields || []).includes(c.dataset.field); });
    $$('#fPages input').forEach(c => { c.checked = (editingDraft.pages || []).includes(c.dataset.page); });

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
          ${a.type === 'link'
            ? `<input type="url" data-i="${i}" data-k="url" placeholder="https://..." value="${escAttr(a.url || '')}">`
            : `<textarea data-i="${i}" data-k="text" rows="3" placeholder="${a.type === 'snippet' ? 'Text to copy to clipboard' : 'Note text shown in popover'}">${escHtml(a.text || '')}</textarea>`}
        </div>
        <button class="tl-action-remove" data-i="${i}" title="Remove action">×</button>`;
      // Wire change listeners
      row.querySelectorAll('input, select, textarea').forEach(input => {
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

  const saveCurrentRule = async () => {
    if (!editingId) return;
    // Read draft state from the DOM
    editingDraft.label = $('#fLabel').value.trim() || 'Untitled rule';
    editingDraft.kind = $('#fKind').value;
    editingDraft.enabled = $('#fEnabled').checked;
    editingDraft.patterns = $('#fPatterns').value.split('\n').map(s => s.trim()).filter(Boolean);
    editingDraft.regex = $('#fRegex').checked;
    editingDraft.bumpsTile = $('#fBumpsTile').value || null;
    editingDraft.notes = $('#fNotes').value.trim();
    editingDraft.fields = $$('#fFields input:checked').map(c => c.dataset.field);
    editingDraft.pages = $$('#fPages input:checked').map(c => c.dataset.page);

    // Validate regex if enabled
    if (editingDraft.regex) {
      for (const p of editingDraft.patterns) {
        try { new RegExp(p, 'i'); }
        catch (e) {
          flash('Invalid regex: ' + p, 'err');
          return;
        }
      }
    }

    // Persist
    const idx = CONFIG.rules.findIndex(r => r.id === editingId);
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
      $$('#paneThresholds input[data-th]').forEach(inp => {
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
    $$('#paneThresholds input[data-th]').forEach(inp => {
      const key = inp.dataset.th;
      const val = (CONFIG.thresholds && CONFIG.thresholds[key]);
      if (val != null) inp.value = val;
    });
  };

  // ============================================================
  // PREFS TAB
  // ============================================================
  const setupPrefsPane = () => {
    $('#btnSavePrefs').addEventListener('click', async () => {
      $$('#panePrefs [data-pref]').forEach(inp => {
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
    $$('#panePrefs [data-pref]').forEach(inp => {
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
    $$('input[name="previewPage"]').forEach(r => r.addEventListener('change', renderPreview));
  };
  const compileRule = (rule) => {
    if (!rule || !rule.enabled) return null;
    const compiled = [];
    for (const p of rule.patterns || []) {
      const s = (p || '').trim();
      if (!s) continue;
      try {
        const src = rule.regex ? s : s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const wrapped = rule.regex ? ('\\b' + src + '\\b') : ('\\b' + src);
        compiled.push(new RegExp(wrapped, 'i'));
      } catch (e) {}
    }
    return compiled.length ? { rule, compiled } : null;
  };
  const renderPreview = () => {
    const text = $('#previewInput').value;
    const page = $$('input[name="previewPage"]').find(r => r.checked)?.value || 'detail';
    const cont = $('#previewMatches');
    if (!text.trim()) {
      cont.innerHTML = '<div class="tl-preview-empty">Type some sample text above to see which rules match.</div>';
      return;
    }
    const matches = [];
    for (const rule of CONFIG.rules) {
      const c = compileRule(rule);
      if (!c) continue;
      if (!rule.pages.includes(page)) continue;
      // For preview, treat the input text as the request field (most common)
      // and also test if the rule scans 'request' specifically
      if (rule.fields.includes('request') && c.compiled.some(re => re.test(text))) {
        matches.push(rule);
      }
    }
    if (!matches.length) {
      cont.innerHTML = '<div class="tl-preview-empty">No rules match.</div>';
      return;
    }
    cont.innerHTML = matches.map(r => `
      <div class="tl-preview-match">
        <span class="tl-rule-kind tl-rule-kind-${escAttr(r.kind)}">${KIND_LABEL[r.kind]}</span>
        <span class="tl-rule-label">${escHtml(r.label)}</span>
        <span class="tl-rule-meta">${r.actions.length} action${r.actions.length === 1 ? '' : 's'}</span>
      </div>`).join('');
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
      const text = await f.text();
      try {
        const parsed = JSON.parse(text);
        if (!parsed || !Array.isArray(parsed.rules)) throw new Error('Not a valid Triage Lens config');
        if (!confirm(`Import config with ${parsed.rules.length} rules? Your current rules will be replaced.`)) return;
        await saveConfig(parsed);
        flash('Imported');
        renderRules();
        populateThresholds();
        populatePrefs();
        $('#rawJson').value = JSON.stringify(parsed, null, 2);
      } catch (e) {
        flash('Import failed: ' + e.message, 'err');
      }
      e.target.value = '';
    });
    $('#btnReset').addEventListener('click', async () => {
      if (!confirm('Reset all rules, thresholds and preferences to shipped defaults? Your customisations will be lost.')) return;
      const fresh = await fetchDefaults();
      await saveConfig(fresh);
      flash('Reset to defaults');
      renderRules();
      populateThresholds();
      populatePrefs();
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
      flash('Reloaded');
    });
    $('#btnSaveJson').addEventListener('click', async () => {
      try {
        const parsed = JSON.parse($('#rawJson').value);
        if (!parsed || !Array.isArray(parsed.rules)) throw new Error('Missing rules array');
        await saveConfig(parsed);
        renderRules();
        populateThresholds();
        populatePrefs();
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
    { id: 'queue.child',         page: 'Queue',  desc: 'Patient under the configured "child" age threshold',     vars: ['{age}'] },
    { id: 'queue.elder',         page: 'Queue',  desc: 'Patient at or over the "elder" age threshold',           vars: ['{age}'] },
    { id: 'queue.taskAgeAmber',  page: 'Queue',  desc: 'Task open ≥ taskAgeAmber but < taskAgeRed days',         vars: ['{days}'] },
    { id: 'queue.taskAgeRed',    page: 'Queue',  desc: 'Task open ≥ taskAgeRed days',                            vars: ['{days}'] },
    { id: 'queue.priority',      page: 'Queue',  desc: 'Task priority is High or Urgent',                        vars: ['{priority}'] },
    // Detail
    { id: 'detail.statusAwaiting',      page: 'Detail', desc: 'Task status contains "awaiting"',                 vars: ['{status}'] },
    { id: 'detail.statusReplyReceived', page: 'Detail', desc: 'Task status is "reply received"',                 vars: ['{status}'] },
    { id: 'detail.statusClosed',        page: 'Detail', desc: 'Task is closed / completed / resolved',           vars: ['{status}'] },
    { id: 'detail.statusOther',         page: 'Detail', desc: 'Any other status text',                           vars: ['{status}'] },
    { id: 'detail.priority',            page: 'Detail', desc: 'Task priority is High or Urgent',                 vars: ['{priority}'] },
    { id: 'detail.daysOpenInfo',        page: 'Detail', desc: 'Task open less than taskAgeAmber days',           vars: ['{days}'] },
    { id: 'detail.daysOpenAmber',       page: 'Detail', desc: 'Task open ≥ taskAgeAmber but < taskAgeRed days',  vars: ['{days}'] },
    { id: 'detail.daysOpenRed',         page: 'Detail', desc: 'Task open ≥ taskAgeRed days',                     vars: ['{days}'] },
    { id: 'detail.today',               page: 'Detail', desc: 'Task created today',                              vars: [] },
    { id: 'detail.proxy',               page: 'Detail', desc: 'Request submitted by a non-self proxy',           vars: ['{relationship}'] },
    { id: 'detail.attachments',         page: 'Detail', desc: 'Request has one or more attachments',             vars: ['{count}'] },
    { id: 'detail.monitoringDueAmber',  page: 'Detail', desc: 'High-risk drug monitoring due soon (Sentinel engine)',         vars: ['{count}'] },
    { id: 'detail.monitoringDueRed',    page: 'Detail', desc: 'High-risk drug monitoring overdue / severely overdue (Sentinel engine)', vars: ['{count}'] },
    { id: 'detail.docType',             page: 'Detail', desc: 'Document type label on document task pages (e.g. "Clinical letter")',    vars: ['{docType}'] },
    { id: 'detail.docSpecialty',        page: 'Detail', desc: 'Clinical specialty or sender on document task pages',                   vars: ['{specialty}'] },
    // Record
    { id: 'record.age',                  page: 'Record', desc: 'Patient age from banner',                        vars: ['{age}'] },
    { id: 'record.palliative',           page: 'Record', desc: 'Patient on palliative register',                 vars: [] },
    { id: 'record.riskToSelf',           page: 'Record', desc: 'Banner contains "risk to self"',                 vars: [] },
    { id: 'record.frailtyAmber',         page: 'Record', desc: 'Frailty hits ≥ frailtyHitsAmber',                vars: ['{count}'] },
    { id: 'record.frailtyRed',           page: 'Record', desc: 'Frailty hits ≥ frailtyHitsRed',                  vars: ['{count}'] },
    { id: 'record.recentAdmissionAmber', page: 'Record', desc: 'Discharge summary in last recentDischargeAmber days',  vars: ['{days}'] },
    { id: 'record.recentAdmissionRed',   page: 'Record', desc: 'Discharge summary in last recentDischargeRed days',    vars: ['{days}'] },
    { id: 'record.polypharmacyAmber',    page: 'Record', desc: 'Repeat count ≥ polypharmacyAmber',               vars: ['{count}'] },
    { id: 'record.polypharmacyRed',      page: 'Record', desc: 'Repeat count ≥ polypharmacyRed',                 vars: ['{count}'] },
    { id: 'record.monitoringDueAmber',   page: 'Record', desc: 'High-risk drug monitoring due soon (Sentinel engine)',         vars: ['{count}'] },
    { id: 'record.monitoringDueRed',     page: 'Record', desc: 'High-risk drug monitoring overdue / severely overdue (Sentinel engine)', vars: ['{count}'] }
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
    const meta = SYSTEM_CHIP_META.find(m => m.id === id);
    if (!meta) return;
    const cfg = getSysChipResolved(id);
    sysEditingId = id;
    sysEditingDraft = { ...cfg, actions: JSON.parse(JSON.stringify(cfg.actions || [])) };

    $('#systemEditTitle').textContent = meta.page + ' · ' + id;
    $('#sysLabel').value = sysEditingDraft.label || '';
    $('#sysKind').value = sysEditingDraft.kind || 'info';
    $('#sysEnabled').checked = sysEditingDraft.enabled !== false;
    const varHelp = meta.vars.length ? 'Available variables: ' + meta.vars.join(', ') : 'No variables for this chip — label is shown as-is.';
    $('#systemVarHelp').textContent = varHelp;
    $('#sysIdHelp').innerHTML = '<strong>Trigger:</strong> ' + escHtml(meta.desc) + '<br><strong>System ID:</strong> <code>' + escHtml(id) + '</code> · cannot be changed.';
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
          ${a.type === 'link'
            ? `<input type="url" data-i="${i}" data-k="url" placeholder="https://..." value="${escAttr(a.url || '')}">`
            : `<textarea data-i="${i}" data-k="text" rows="3" placeholder="${a.type === 'snippet' ? 'Text to copy' : 'Note text'}">${escHtml(a.text || '')}</textarea>`}
        </div>
        <button class="tl-action-remove" data-i="${i}">×</button>`;
      row.querySelectorAll('input, select, textarea').forEach(input => {
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
  // UTIL
  // ============================================================
  const escHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const escAttr = (s) => escHtml(s);

  // ============================================================
  // GO
  // ============================================================
  init().catch(e => { console.error('[TriageLens options] init failed', e); flash('Init failed: ' + e.message, 'err'); });
})();
