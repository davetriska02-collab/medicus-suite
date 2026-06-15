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
    'queue.resultRuleUrgent': ['Urgent: {name} — {rule}'],
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
    renderRules();
    renderSystemChips();
    renderResultRules();
    populateThresholds();
    populatePrefs();
    // Deep-link: when this page is embedded as the Suite Settings "Result Rules"
    // section (iframe src ".../options.html#resultRules"), open straight onto the
    // Result rules tab and hide the sibling tab bar so it reads as a dedicated page.
    if (location.hash === '#resultRules') {
      activateTab('resultRules');
      const tabs = $('#tlTabs');
      if (tabs) tabs.style.display = 'none';
    }
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
      }
      if ((a.type === 'snippet' || a.type === 'note') && (a.text == null || typeof a.text !== 'string')) {
        errs.push('actions[' + i + ']: text is required for ' + a.type + ' actions.');
      }
    });

    return errs;
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
  const compileRule = (rule) => {
    if (!rule || !rule.enabled) return null;
    const compiled = [];
    for (const p of rule.patterns || []) {
      const s = (p || '').trim();
      if (!s) continue;
      try {
        const src = rule.regex ? s : s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const wrapped = rule.regex ? '\\b' + src + '\\b' : '\\b' + src;
        compiled.push(new RegExp(wrapped, 'i'));
      } catch (e) {}
    }
    return compiled.length ? { rule, compiled } : null;
  };
  const renderPreview = () => {
    const text = $('#previewInput').value;
    const page = $$('input[name="previewPage"]').find((r) => r.checked)?.value || 'detail';
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
      if (rule.fields.includes('request') && c.compiled.some((re) => re.test(text))) {
        matches.push(rule);
      }
    }
    if (!matches.length) {
      cont.innerHTML = '<div class="tl-preview-empty">No rules match.</div>';
      return;
    }
    cont.innerHTML = matches
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

  if (typeof window !== 'undefined') {
    window.SentinelInspectorHelpers = { extractResultFields };
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
          pill.addEventListener('click', () => {
            const ta = $('#rrAnalyteMatch');
            if (!ta) return;
            const current = ta.value
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean);
            if (!current.includes(name)) {
              ta.value = [...current, name].join('\n');
              rrUpdateTestMatch();
            }
          });
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
          pill.addEventListener('click', () => {
            const ta = $('#rrAnalyteSpecimen');
            if (!ta) return;
            const current = ta.value
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean);
            if (!current.includes(spec)) {
              ta.value = [...current, spec].join('\n');
            }
          });
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

  const rrSeveritySummary = (rule) => {
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
      const _rrKind = rule.red != null ? 'red' : rule.amber != null ? 'amber' : rule.kind === 'text' ? 'info' : 'info';
      // Direction glyph so a high/low pair (e.g. high vs low calcium) is distinguishable at a glance.
      const _rrDir =
        rule.kind === 'text' ? '' : rule.comparator === 'above' ? '↑' : rule.comparator === 'below' ? '↓' : '';
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
    const thresholdEls = document.querySelectorAll('.rr-fields-threshold');
    const textEls = document.querySelectorAll('.rr-fields-text');
    const isText = kind === 'text';
    thresholdEls.forEach((el) => {
      el.style.display = isText ? 'none' : '';
    });
    textEls.forEach((el) => {
      el.style.display = isText ? '' : 'none';
    });
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
          const tr = tbody.insertRow();
          tr.className = 'tl-rr-inspector-row';
          const tdIdx = tr.insertCell();
          tdIdx.className = 'tl-rr-inspector-idx';
          tdIdx.textContent = String(i + 1);
          const tdName = tr.insertCell();
          tdName.className = 'tl-rr-inspector-name';
          tdName.textContent = f.name != null ? f.name : '(none)';
          const tdSpec = tr.insertCell();
          tdSpec.className = f.specimen ? 'tl-rr-inspector-spec' : 'tl-rr-inspector-spec tl-rr-inspector-null';
          tdSpec.textContent = f.specimen != null ? f.specimen : '(none — rule will fail-open)';
          const tdText = tr.insertCell();
          tdText.className = 'tl-rr-inspector-text';
          const SHORT = 160;
          const display = f.text.length > SHORT ? f.text.slice(0, SHORT) + '…' : f.text;
          tdText.textContent = display || '(empty)';
          if (f.text.length > SHORT) tdText.title = f.text;
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
          'Click any suggestion pill above to fill the corresponding field.';
        resultsEl.appendChild(summary);

        resultsEl.style.display = 'block';
        statusEl.className = 'tl-rr-inspector-status tl-rr-inspector-ok';
        statusEl.textContent = 'Parsed.';
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
    $('#rrLabel').value = rrEditingDraft.label || '';
    $('#rrAnalyteMatch').value = ((rrEditingDraft.analyte && rrEditingDraft.analyte.match) || []).join('\n');
    $('#rrAnalyteExclude').value = ((rrEditingDraft.analyte && rrEditingDraft.analyte.exclude) || []).join('\n');
    $('#rrAnalyteSpecimen').value = ((rrEditingDraft.analyte && rrEditingDraft.analyte.specimen) || []).join('\n');
    const kind = rrEditingDraft.kind === 'text' ? 'text' : 'threshold';
    $('#rrKind').value = kind;
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
    const enabled = $('#rrEnabled').checked;

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
      // Remove text-only fields if switching from text to threshold
      delete rrEditingDraft.kind;
      delete rrEditingDraft.normalText;
      delete rrEditingDraft.normalLabel;
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
          if (c.kind === 'text') {
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
