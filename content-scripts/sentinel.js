// Sentinel v0.2 — Content Script
// Mounts sidebar, fetches data, evaluates rules, renders grouped chip UI.

(function() {
  'use strict';

  if (window.__sentinelMounted) return;
  window.__sentinelMounted = true;

  let host = null;
  let shadowRoot = null;
  let currentMode = 'live';
  let dismissedRules = new Set();
  let lastPatientName = null;
  let refreshDebounceTimer = null;

  // === UI CONFIG ===
  // Default config; user overrides loaded from chrome.storage.local.sentinelConfig
  const DEFAULT_CONFIG = {
    // Colours
    chipStyle: 'subtle',           // subtle | bold | minimal
    // Density
    density: 'normal',             // compact | normal | spacious
    fontSize: 'medium',            // small | medium | large
    sidebarWidth: 380,             // 320 | 380 | 440 | 520
    sidebarSide: 'right',          // left | right
    // Content visibility
    showAchieved: true,
    showNoData: true,
    showDebugPanel: true,
    showDataSourceLine: true,
    showRegisterPills: true,
    showViewLabel: true,
    expandChipsByDefault: false,
    // Sorting & grouping
    chipSort: 'status',            // status | name | points
    chipGrouping: 'by-type',       // by-type | flat
    collapsedSections: [],
    // Behaviour
    autoRefresh: true,
    refreshDebounceMs: 600,
    defaultMode: 'live',           // live | mock
    // Chip style cycle order (used by the sidebar quick-toggle)
    _chipStyleCycle: ['subtle', 'bold', 'minimal']
  };
  let CONFIG = { ...DEFAULT_CONFIG };
  let collapsedSections = new Set();

  const SECTION_LABELS = {
    'drug-monitoring': 'Drug Monitoring',
    'qof-register': 'QOF Registers',
    'qof-indicator': 'QOF Indicators'
  };

  // ============================================================
  // INIT
  // ============================================================

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.action === 'toggleSidebar') {
      // Suite mode: UI now lives in the side panel — toggle is a no-op here.
      return false;
    }
    return false;
  });

  function loadSettings(cb) {
    chrome.storage.local.get(['sentinel.config'], (res) => {
      const stored = res["sentinel.config"] || {};
      CONFIG = { ...DEFAULT_CONFIG, ...stored };
      collapsedSections = new Set(CONFIG.collapsedSections || []);
      currentMode = CONFIG.defaultMode || 'live';
      applyConfigToRoot();
      cb && cb();
    });
  }

  function saveSettings() {
    const toSave = { ...CONFIG, collapsedSections: Array.from(collapsedSections) };
    delete toSave._chipStyleCycle;
    chrome.storage.local.set({ "sentinel.config": toSave });
  }

  // Apply config to root element via data attributes (CSS targets these)
  function applyConfigToRoot() {
    const root = shadowRoot?.querySelector('.sentinel-root');
    if (!root) return;
    root.setAttribute('data-chip-style', CONFIG.chipStyle);
    root.setAttribute('data-density', CONFIG.density);
    root.setAttribute('data-font-size', CONFIG.fontSize);
    root.setAttribute('data-expand-chips', CONFIG.expandChipsByDefault ? 'true' : 'false');
    root.setAttribute('data-show-data-source', CONFIG.showDataSourceLine ? 'true' : 'false');
    root.setAttribute('data-show-register-pills', CONFIG.showRegisterPills ? 'true' : 'false');
    root.setAttribute('data-show-view-label', CONFIG.showViewLabel ? 'true' : 'false');
    root.setAttribute('data-show-debug', CONFIG.showDebugPanel ? 'true' : 'false');
    // Apply host element width and side
    if (host) {
      const w = CONFIG.sidebarWidth || 380;
      host.style.width = w + 'px';
      if (CONFIG.sidebarSide === 'left') {
        host.style.left = '0';
        host.style.right = 'auto';
      } else {
        host.style.right = '0';
        host.style.left = 'auto';
      }
    }
    // Reflect mode selector
    const ms = shadowRoot?.querySelector('#mode-select');
    if (ms) ms.value = currentMode;
    // Reflect toggles
    const sa = shadowRoot?.querySelector('#show-achieved-toggle');
    if (sa) sa.checked = !!CONFIG.showAchieved;
    const snd = shadowRoot?.querySelector('#show-no-data-toggle');
    if (snd) snd.checked = !!CONFIG.showNoData;
  }

  // Listen for config changes from the options page
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes["sentinel.config"]) return;
    const newConfig = changes["sentinel.config"].newValue || {};
    CONFIG = { ...DEFAULT_CONFIG, ...newConfig };
    collapsedSections = new Set(CONFIG.collapsedSections || []);
    applyConfigToRoot();
    refresh();
  });

  // ============================================================
  // SIDEBAR MOUNT
  // ============================================================

  async function mount() {
    if (host) return;
    host = document.createElement('div');
    host.id = 'sentinel-host';
    host.style.cssText = 'position:fixed;top:0;right:0;width:380px;height:100vh;z-index:2147483647;';
    document.documentElement.appendChild(host);

    shadowRoot = host.attachShadow({ mode: 'closed' });
    const cssUrl = chrome.runtime.getURL('sidebar/sidebar.css');
    const htmlUrl = chrome.runtime.getURL('sidebar/sidebar.html');
    const [cssText, htmlText] = await Promise.all([
      fetch(cssUrl).then(r => r.text()),
      fetch(htmlUrl).then(r => r.text())
    ]);
    const styleEl = document.createElement('style');
    styleEl.textContent = cssText;
    shadowRoot.appendChild(styleEl);
    const wrapper = document.createElement('div');
    wrapper.innerHTML = htmlText;
    while (wrapper.firstChild) shadowRoot.appendChild(wrapper.firstChild);
    bindControls();

    loadSettings(() => refresh());
    setupNavWatcher();
  }

  function toggle() {
    if (!host) mount();
    else if (host.style.display === 'none') host.style.display = 'block';
    else host.style.display = 'none';
  }

  function bindControls() {
    shadowRoot.querySelector('#mode-select')?.addEventListener('change', e => {
      currentMode = e.target.value;
      refresh();
    });
    shadowRoot.querySelector('#refresh-btn')?.addEventListener('click', () => refresh());
    shadowRoot.querySelector('#close-btn')?.addEventListener('click', () => toggle());
    shadowRoot.querySelector('#settings-btn')?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'openOptionsPage' });
    });
    shadowRoot.querySelector('#show-achieved-toggle')?.addEventListener('change', e => {
      CONFIG.showAchieved = e.target.checked;
      saveSettings();
      refresh();
    });
    shadowRoot.querySelector('#show-no-data-toggle')?.addEventListener('change', e => {
      CONFIG.showNoData = e.target.checked;
      saveSettings();
      refresh();
    });
    shadowRoot.querySelector('#chip-style-cycle')?.addEventListener('click', () => {
      const cycle = CONFIG._chipStyleCycle || DEFAULT_CONFIG._chipStyleCycle;
      const idx = cycle.indexOf(CONFIG.chipStyle);
      CONFIG.chipStyle = cycle[(idx + 1) % cycle.length];
      saveSettings();
      applyConfigToRoot();
    });
  }

  // ============================================================
  // REFRESH (fetch + evaluate + render)
  // ============================================================

  let pendingBannerRetry = null;
  let lastRetryUrl = null;

  async function refresh() {
    if (!shadowRoot) return;
    setStatus('Loading...');
    try {
      const data = await window.SentinelDataFetcher.fetchPatientData(currentMode);

      // SPA banner-render race: if we're on a Medicus origin in live mode but ended
      // up in DOM-fallback because no patient UUID was found, the banner may not
      // have rendered yet. Schedule a single retry per URL.
      const onMedicus = /medicus\.health$/i.test(location.hostname);
      const isFallback = (data.debug?.dataSource || '').startsWith('dom-fallback');
      const sameUrlAsLastRetry = lastRetryUrl === location.href;
      if (currentMode === 'live' && onMedicus && isFallback && !sameUrlAsLastRetry) {
        lastRetryUrl = location.href;
        if (pendingBannerRetry) clearTimeout(pendingBannerRetry);
        pendingBannerRetry = setTimeout(() => { pendingBannerRetry = null; refresh(); }, 1500);
      } else if (!isFallback) {
        // Reset retry latch on successful resolution so a subsequent navigation can retry
        lastRetryUrl = null;
      }

      // Patient-change detection
      const currentName = data.patientContext?.patientName || null;
      if (lastPatientName && currentName && lastPatientName !== currentName) {
        dismissedRules.clear();
      }
      lastPatientName = currentName;

      if (currentMode === 'discovery') {
        renderDiscovery(data);
        return;
      }

      const rules = await loadRules();

      // Augment observations with encounter-coded journal entries so that indicators
      // like AST007 (asthma annual review) can find their evidence. The investigation
      // dashboard only contains explicit investigation results; consultation-coded entries
      // (annual review codes, smoking status, questionnaire scores) live in the journal.
      // Patient UUID: try common normaliser field names.
      // URL regex fallback is restricted to /patient/patient/ paths so we never
      // accidentally extract an encounter or task UUID on those views (encounter
      // and task resolvers should always populate patientContext correctly anyway).
      const _patientUrlMatch = /\/patient\/patient\/[^/]+\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
        .exec(location.pathname);
      const _resolvedPatientId = data.patientContext?.patientId
        || data.patientContext?.id
        || data.patientContext?.uuid
        || (_patientUrlMatch && _patientUrlMatch[1])
        || null;
      if (currentMode === 'live' && _resolvedPatientId) {
        const journalObs = await fetchJournalObservations(
          _resolvedPatientId,
          data.observations || []
        );
        if (journalObs.length > 0) {
          data.observations = [...(data.observations || []), ...journalObs];
          if (data.debug) {
            data.debug.counts = {
              ...(data.debug.counts || {}),
              observations: (data.observations || []).length
            };
          }
        }
      }

      const allChips = window.SentinelRules.evaluatePatient(
        data.medications || [],
        data.observations || [],
        rules,
        {
          now: new Date().toISOString(),
          problems: data.problems || [],
          patientContext: data.patientContext
        }
      );

      renderPatientBanner(data, allChips);
      renderGroupedChips(allChips, data);
      renderDebugPanel(data);

      // Status line: show data source
      const ds = data.debug?.dataSource || 'unknown';
      const counts = data.debug?.counts;
      const countSummary = counts ? ` (${counts.medications}m / ${counts.observations}o / ${counts.problems}p)` : '';
      setStatus(`Mode: ${data.mode} / ${ds}${countSummary}`);

      // Update show-achieved toggle UI state
      const toggle = shadowRoot.querySelector('#show-achieved-toggle');
      if (toggle) toggle.checked = CONFIG.showAchieved;
    } catch (e) {
      setStatus('Error: ' + e.message);
      console.error('[Sentinel]', e);
    }
  }

  async function loadRules() {
    // Load both drug-rules.json and qof-rules.json and merge.
    // Three-tier overrides: canonical -> organisational -> individual -> custom appended.
    const drugUrl = chrome.runtime.getURL('rules/drug-rules.json');
    const qofUrl = chrome.runtime.getURL('rules/qof-rules.json');
    const [drugDoc, qofDoc] = await Promise.all([
      fetch(drugUrl).then(r => r.json()),
      fetch(qofUrl).then(r => r.json())
    ]);
    const canonical = [...(drugDoc.rules || []), ...(qofDoc.rules || [])];

    // Load org + individual overrides + custom rules
    return new Promise(resolve => {
      chrome.storage.local.get(['sentinel.rules', 'sentinel.orgRules', 'sentinel.customRules'], (res) => {
        const individual  = res['sentinel.rules']       || {};
        const org         = res['sentinel.orgRules']    || null;
        const customRules = res['sentinel.customRules'] || [];
        const RIO = window.SentinelRulesetIo;
        let merged;
        if (RIO) {
          merged = RIO.mergeRules(canonical, org, individual);
        } else {
          // Fallback: apply individual overrides only
          merged = canonical.map(rule => {
            if (individual[rule.id]) return Object.assign({}, rule, individual[rule.id]);
            return rule;
          });
        }
        // Append enabled custom rules as additions (not overlays)
        const enabledCustom = customRules.filter(r => r.enabled !== false);
        merged.push(...enabledCustom);
        resolve(merged);
      });
    });
  }

  // ============================================================
  // JOURNAL OBSERVATIONS (for AST007 and future encounter-coded rules)
  // ============================================================

  // Derive the Medicus API origin from the current page URL.
  // Pattern: https://england.medicus.health/560b6c/... → https://560b6c.api.england.medicus.health
  function getMedicusApiOrigin() {
    const siteCode = location.pathname.split('/').filter(Boolean)[0];
    if (!siteCode || !/^[a-f0-9]{5,8}$/.test(siteCode)) return null;
    return `https://${siteCode}.api.${location.hostname}`;
  }

  // Fetch encounter-coded observations from the patient journal overview endpoint.
  // The investigation dashboard misses entries coded inside consultations (e.g. asthma annual
  // review, smoking status, depression questionnaire scores). This function fills that gap
  // for indicators like AST007 whose evidence lives exclusively in the journal.
  //
  // Returns an array of { name, value, date (ISO YYYY-MM-DD), source: 'journal' } objects,
  // filtered to the last 400 days and de-duplicated against existingObs by name+date.
  async function fetchJournalObservations(patientId, existingObs) {
    const apiOrigin = getMedicusApiOrigin();
    if (!apiOrigin || !patientId) return [];

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 400);

    try {
      const resp = await fetch(
        `${apiOrigin}/clinical/data/patient-journal/overview/${patientId}`,
        { credentials: 'include' }
      );
      if (!resp.ok) return [];
      const d = await resp.json();

      const monthIndex = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };

      // Parse "DD Mon YYYY" (entry.observationDate) or "DayName DD Mon YYYY" (record.title)
      function parseDisplayDate(str) {
        if (!str) return null;
        const parts = str.trim().split(' ').filter(Boolean);
        // "20 Apr 2026" → [20, Apr, 2026]  or  "Mon 11 May 2026" → [Mon, 11, May, 2026]
        const dayStr  = parts.length === 3 ? parts[0] : parts[1];
        const monStr  = parts.length === 3 ? parts[1] : parts[2];
        const yearStr = parts.length === 3 ? parts[2] : parts[3];
        if (!dayStr || !monStr || !yearStr) return null;
        const mon = monthIndex[monStr];
        if (mon === undefined) return null;
        const d = new Date(parseInt(yearStr), mon, parseInt(dayStr));
        return isNaN(d.getTime()) ? null : d;
      }

      // Build a Set of "name|date" keys already present in the investigation dashboard
      const existingKeys = new Set(
        (existingObs || []).map(o => `${(o.name||'').toLowerCase()}|${o.date||''}`)
      );

      const result = [];
      for (const record of (d.patientJournalRecords || [])) {
        const groupDate = parseDisplayDate(record.title);
        for (const item of (record.items || [])) {
          // Only encounter items contain consultation-coded observations
          if (item.type !== 'encounter') continue;
          for (const topic of (item.data?.consultationTopics || [])) {
            for (const heading of (topic.headings || [])) {
              for (const entry of (heading.entries || [])) {
                if (!entry.type || entry.entryType !== 'observation') continue;
                const entryDate = parseDisplayDate(entry.observationDate) || groupDate;
                if (!entryDate || entryDate < cutoff) continue;
                const isoDate = entryDate.toISOString().split('T')[0];
                const nameKey = `${entry.type.toLowerCase()}|${isoDate}`;
                if (existingKeys.has(nameKey)) continue; // already in investigation dashboard
                existingKeys.add(nameKey); // de-dupe within journal results too
                result.push({
                  name:   entry.type,
                  value:  typeof entry.value === 'string' ? entry.value : '',
                  date:   isoDate,
                  source: 'journal'
                });
              }
            }
          }
        }
      }
      return result;
    } catch (e) {
      console.warn('[Sentinel] fetchJournalObservations failed:', e.message);
      return [];
    }
  }



  function renderPatientBanner(data, allChips) {
    const banner = shadowRoot.querySelector('.patient-banner');
    if (!banner) return;
    const pc = data.patientContext;
    if (!pc || !pc.patientName) {
      banner.style.display = 'none';
      return;
    }
    banner.style.display = 'block';

    const registerPills = allChips
      .filter(c => c.type === 'qof-register' && c.status === 'achieved')
      .map(c => `<span class="register-pill" title="${escapeHtml(c.matchedProblem)}">${escapeHtml(c.registerCode)}</span>`)
      .join('');

    const ageSex = [
      pc.ageYears != null ? `Age ${pc.ageYears}` : null,
      pc.sex || null
    ].filter(Boolean).join(' &middot; ');

    banner.innerHTML = `
      <div class="patient-name">${escapeHtml(pc.patientName)}</div>
      <div class="patient-meta">
        ${pc.nhsNumber ? `NHS: ${formatNhs(pc.nhsNumber)} &middot; ` : ''}
        ${pc.dobRaw ? `DOB ${escapeHtml(pc.dobRaw)}` : ''}
      </div>
      ${ageSex ? `<div class="patient-meta">${ageSex}</div>` : ''}
      ${registerPills ? `<div class="register-pills">Registers: ${registerPills}</div>` : ''}
      ${pc.view && pc.view !== 'unknown' ? `<div class="patient-view">View: ${escapeHtml(pc.view)}</div>` : ''}
    `;
  }

  // ============================================================
  // RENDER: grouped chip sections
  // ============================================================

  function renderGroupedChips(allChips, data) {
    const list = shadowRoot.querySelector('.chip-list');
    if (!list) return;

    // Filter out dismissed
    let chips = allChips.filter(c => !dismissedRules.has(c.ruleId));

    // Apply config filters
    if (!CONFIG.showAchieved) {
      chips = chips.filter(c => !(c.status === 'achieved' || c.status === 'in_date'));
    }
    if (!CONFIG.showNoData) {
      chips = chips.filter(c => c.status !== 'no_data');
    }

    // Sort
    if (CONFIG.chipSort === 'name') {
      chips.sort((a, b) => {
        const an = a.drugName || a.indicatorCode || a.registerCode || '';
        const bn = b.drugName || b.indicatorCode || b.registerCode || '';
        return an.localeCompare(bn);
      });
    } else if (CONFIG.chipSort === 'points') {
      chips.sort((a, b) => (b.points || 0) - (a.points || 0));
    }
    // 'status' is the default order already produced by the engine

    // Group by type (default) or flat list
    const groups = { 'drug-monitoring': [], 'qof-indicator': [], 'qof-register': [] };
    chips.forEach(c => {
      const t = c.type || 'drug-monitoring';
      if (!groups[t]) groups[t] = [];
      groups[t].push(c);
    });

    if (chips.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <strong>No active alerts.</strong>
          <p>${data.mode === 'mock' ? 'Switch off Mock Mode to run on the live page.' : 'No matched rules for this patient on this view.'}</p>
        </div>
      `;
      renderViewHint(data, list);
      updateSummary(allChips);
      return;
    }

    list.innerHTML = '';
    renderViewHint(data, list);

    if (CONFIG.chipGrouping === 'flat') {
      // One flat list
      chips.forEach(chip => {
        const el = document.createElement('article');
        el.className = `chip chip-${chip.status}`;
        el.innerHTML = chipHtml(chip);
        list.appendChild(el);
        wireChipEvents(el, chip, allChips, data);
      });
    } else {
      // Grouped sections (default)
      ['drug-monitoring', 'qof-indicator'].forEach(type => {
        const groupChips = groups[type] || [];
        if (groupChips.length === 0) return;
        const sectionEl = document.createElement('section');
        sectionEl.className = 'chip-section';
        const collapsed = collapsedSections.has(type);
        sectionEl.innerHTML = `
          <header class="chip-section-header" data-section="${type}">
            <span class="chip-section-toggle">${collapsed ? '\u25B6' : '\u25BC'}</span>
            <span class="chip-section-title">${SECTION_LABELS[type]}</span>
            <span class="chip-section-count">${groupChips.length}</span>
          </header>
          <div class="chip-section-body" ${collapsed ? 'hidden' : ''}></div>
        `;
        const body = sectionEl.querySelector('.chip-section-body');
        groupChips.forEach(chip => {
          const el = document.createElement('article');
          el.className = `chip chip-${chip.status}`;
          el.innerHTML = chipHtml(chip);
          body.appendChild(el);
          wireChipEvents(el, chip, allChips, data);
        });
        sectionEl.querySelector('.chip-section-header')?.addEventListener('click', () => {
          if (collapsedSections.has(type)) collapsedSections.delete(type);
          else collapsedSections.add(type);
          CONFIG.collapsedSections = Array.from(collapsedSections);
          saveSettings();
          renderGroupedChips(allChips, data);
        });
        list.appendChild(sectionEl);
      });
    }

    updateSummary(chips);
  }

  function wireChipEvents(el, chip, allChips, data) {
    el.querySelector('.chip-dismiss')?.addEventListener('click', () => {
      dismissedRules.add(chip.ruleId);
      el.remove();
      updateSummary(allChips.filter(c => !dismissedRules.has(c.ruleId)));
    });
    el.querySelector('.chip-expand')?.addEventListener('click', () => {
      el.classList.toggle('expanded');
    });
  }

  function renderViewHint(data, list) {
    const obsCount = data.observations?.length || 0;
    const medCount = data.medications?.length || 0;
    const probCount = data.problems?.length || 0;
    if (data.mode !== 'live') return;
    const missing = [];
    if (obsCount === 0) missing.push('observations');
    if (probCount === 0) missing.push('problems');
    if (missing.length > 0 && (medCount > 0 || probCount > 0)) {
      const hint = document.createElement('div');
      hint.className = 'view-hint';
      hint.innerHTML = `
        <strong>Limited view.</strong>
        This page has no ${missing.join(' or ')} extracted.
        Open a patient summary or prescription request task for full data.
      `;
      list.appendChild(hint);
    }
  }

  function updateSummary(chips) {
    const summary = shadowRoot.querySelector('.summary');
    if (!summary) return;
    const counts = chips.reduce((acc, c) => {
      acc[c.status] = (acc[c.status] || 0) + 1;
      return acc;
    }, {});
    const parts = [];
    if (counts.not_met) parts.push(`<span class="sum-bad">${counts.not_met} not met</span>`);
    if (counts.overdue) parts.push(`<span class="sum-bad">${counts.overdue} overdue</span>`);
    if (counts.stale) parts.push(`<span class="sum-warn">${counts.stale} stale</span>`);
    if (counts.due_soon) parts.push(`<span class="sum-warn">${counts.due_soon} due soon</span>`);
    if (counts.no_data) parts.push(`<span class="sum-meh">${counts.no_data} no data</span>`);
    if (counts.achieved) parts.push(`<span class="sum-good">${counts.achieved} achieved</span>`);
    if (counts.in_date) parts.push(`<span class="sum-good">${counts.in_date} in date</span>`);
    if (counts.recently_initiated) parts.push(`<span class="sum-meh">${counts.recently_initiated} new</span>`);
    summary.innerHTML = parts.length ? parts.join(' &middot; ') : 'No chips';
  }

  // ============================================================
  // CHIP HTML
  // ============================================================

  function chipHtml(chip) {
    if (chip.type === 'drug-monitoring') return drugChipHtml(chip);
    if (chip.type === 'qof-indicator') return qofIndicatorChipHtml(chip);
    if (chip.type === 'qof-register') return qofRegisterChipHtml(chip);
    return '<div>Unknown chip type</div>';
  }

  function drugChipHtml(chip) {
    const statusLabel = labelFor(chip.status);
    const testsLine = (chip.tests || []).map(t => {
      const dateStr = t.latestObs?.date ? ` (${formatDate(t.latestObs.date)}, ${t.days}d)` : '';
      return `<li class="test-${t.status}">${escapeHtml(t.name)}: ${labelFor(t.status)}${dateStr}</li>`;
    }).join('');
    return `
      <header class="chip-header chip-expand" role="button">
        <div class="chip-title">
          <strong>${escapeHtml(chip.drugName)}</strong>
          ${chip.drugClass ? `<span class="chip-class">${escapeHtml(chip.drugClass)}</span>` : ''}
        </div>
        <span class="chip-status">${statusLabel}</span>
      </header>
      <div class="chip-body">
        <ul class="test-list">${testsLine}</ul>
        <div class="chip-detail">
          ${chip.source ? `<p><strong>Source:</strong> ${escapeHtml(chip.source)}</p>` : ''}
          ${chip.sharedCare ? `<p class="shared-care">Shared care: hospital may share monitoring responsibility.</p>` : ''}
          ${chip.notes ? `<p>${escapeHtml(chip.notes)}</p>` : ''}
        </div>
        <div class="chip-actions">
          <button class="chip-dismiss" type="button">Dismiss</button>
        </div>
      </div>
    `;
  }

  function qofIndicatorChipHtml(chip) {
    const statusLabel = labelFor(chip.status);
    const valueDate = chip.valueText
      ? `<p class="qof-value">${escapeHtml(chip.valueText)} on ${chip.dateText ? formatDate(chip.dateText) : '?'} (${chip.days}d ago)</p>`
      : (chip.status === 'no_data' ? `<p class="qof-value qof-nodata">No matching observation on this view.</p>` : '');
    const thresholds = chip.thresholds
      ? `<p><strong>Achievement band:</strong> ${chip.thresholds.lower}-${chip.thresholds.upper}% / ${chip.points} pts</p>`
      : '';
    return `
      <header class="chip-header chip-expand" role="button">
        <div class="chip-title">
          <strong>${escapeHtml(chip.indicatorCode)}</strong>
          <span class="chip-class">${escapeHtml(chip.indicatorName)}</span>
        </div>
        <span class="chip-status">${statusLabel}</span>
      </header>
      <div class="chip-body">
        ${valueDate}
        <div class="chip-detail">
          ${chip.requiresRegister ? `<p><strong>Register:</strong> ${escapeHtml(chip.requiresRegister)}</p>` : ''}
          ${thresholds}
          ${chip.source ? `<p><strong>Source:</strong> ${escapeHtml(chip.source)}</p>` : ''}
          ${chip.notes ? `<p>${escapeHtml(chip.notes)}</p>` : ''}
        </div>
        <div class="chip-actions">
          <button class="chip-dismiss" type="button">Dismiss</button>
        </div>
      </div>
    `;
  }

  function qofRegisterChipHtml(chip) {
    return `
      <header class="chip-header chip-expand" role="button">
        <div class="chip-title">
          <strong>${escapeHtml(chip.registerCode)}</strong>
          <span class="chip-class">${escapeHtml(chip.registerName)}</span>
        </div>
        <span class="chip-status">On register</span>
      </header>
      <div class="chip-body">
        <p><strong>Matched problem:</strong> ${escapeHtml(chip.matchedProblem)}</p>
        ${chip.codedDate ? `<p><strong>Coded:</strong> ${formatDate(chip.codedDate)}</p>` : ''}
        <div class="chip-detail">${chip.source ? `<p><strong>Source:</strong> ${escapeHtml(chip.source)}</p>` : ''}</div>
        <div class="chip-actions">
          <button class="chip-dismiss" type="button">Dismiss</button>
        </div>
      </div>
    `;
  }

  // ============================================================
  // RENDER: discovery (unchanged from v0.1)
  // ============================================================

  function renderDiscovery(findings) {
    const list = shadowRoot.querySelector('.chip-list');
    if (!list) return;
    list.innerHTML = `
      <div class="discovery-output">
        <h3>Discovery findings</h3>
        <p>${findings.headings?.length || 0} headings, ${findings.definitionLists?.length || 0} definition lists, ${findings.apiCallsObserved?.length || 0} API calls observed</p>
        <button class="copy-findings">Copy findings JSON</button>
      </div>
    `;
    list.querySelector('.copy-findings')?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(JSON.stringify(findings, null, 2));
        setStatus('Discovery copied to clipboard');
      } catch (e) {
        setStatus('Clipboard failed: ' + e.message);
      }
    });
    setStatus(`Mode: discovery`);
  }

  // ============================================================
  // RENDER: debug panel
  // ============================================================

  function renderDebugPanel(data) {
    const list = shadowRoot.querySelector('.chip-list');
    if (!list) return;
    const existing = list.querySelector('.debug-panel');
    if (existing) existing.remove();
    if (data.mode !== 'live') return;

    const meds = data.medications || [];
    const obs = data.observations || [];
    const probs = data.problems || [];
    const fails = data.debug?.parseFailures || [];

    const renderList = (items, fmt, empty) => items.length === 0
      ? `<p class="debug-empty">${empty}</p>`
      : '<ul class="debug-list">' + items.map(fmt).join('') + '</ul>';

    const debugHtml = `
      <details class="debug-panel">
        <summary>Show extracted data (${meds.length} meds &middot; ${obs.length} obs &middot; ${probs.length} problems${fails.length ? ` &middot; ${fails.length} fails` : ''})</summary>
        <div class="debug-content">
          <h4>Medications</h4>
          ${renderList(meds, m => `<li><strong>${escapeHtml(m.name)}</strong> <small>[${escapeHtml(m.source || '?')}]</small></li>`, 'None extracted.')}
          <h4>Observations</h4>
          ${renderList(obs, o => `<li><strong>${escapeHtml(o.name)}</strong> = ${escapeHtml(o.value || '-')} <span class="debug-date">(${escapeHtml(o.date || '-')})</span> <small>[${escapeHtml(o.source || '?')}]</small></li>`, 'None extracted.')}
          <h4>Problems</h4>
          ${renderList(probs, p => `<li><strong>${escapeHtml(p.label)}</strong>${p.codedDate ? ` <span class="debug-date">(${escapeHtml(p.codedDate)})</span>` : ''} <small>[${escapeHtml(p.source || '?')}]</small></li>`, 'None extracted.')}
          ${fails.length ? `<h4>Parse failures (${fails.length})</h4><ul class="debug-list">${fails.slice(0, 20).map(f => `<li><small>[${escapeHtml(f.section)}]</small> ${escapeHtml(f.text)}</li>`).join('')}</ul>` : ''}
          <button class="debug-copy" type="button">Copy debug JSON</button>
        </div>
      </details>
    `;
    list.insertAdjacentHTML('beforeend', debugHtml);
    list.querySelector('.debug-copy')?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(JSON.stringify({
          mode: data.mode,
          patientContext: data.patientContext,
          medications: meds,
          observations: obs,
          problems: probs,
          parseFailures: fails
        }, null, 2));
        setStatus('Debug data copied');
      } catch (e) {
        setStatus('Clipboard failed: ' + e.message);
      }
    });
  }

  // ============================================================
  // NAV WATCHER
  // ============================================================

  function setupNavWatcher() {
    const titleObserver = new MutationObserver(() => debouncedRefresh());
    const titleEl = document.querySelector('title');
    if (titleEl) titleObserver.observe(titleEl, { childList: true });
    const pushState = history.pushState;
    history.pushState = function() { pushState.apply(this, arguments); window.dispatchEvent(new Event('locationchange')); };
    const replaceState = history.replaceState;
    history.replaceState = function() { replaceState.apply(this, arguments); window.dispatchEvent(new Event('locationchange')); };
    window.addEventListener('popstate', () => debouncedRefresh());
    window.addEventListener('hashchange', () => debouncedRefresh());
    window.addEventListener('locationchange', () => debouncedRefresh());
  }

  function debouncedRefresh() {
    if (!CONFIG.autoRefresh) return;
    if (refreshDebounceTimer) clearTimeout(refreshDebounceTimer);
    refreshDebounceTimer = setTimeout(() => refresh(), CONFIG.refreshDebounceMs || 600);
  }

  // ============================================================
  // HELPERS
  // ============================================================

  function setStatus(text) {
    const s = shadowRoot?.querySelector('.status');
    if (s) s.textContent = text;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function formatNhs(n) {
    if (!n) return '';
    const d = String(n).replace(/\D/g, '');
    if (d.length !== 10) return n;
    return `${d.slice(0,3)} ${d.slice(3,6)} ${d.slice(6)}`;
  }

  function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const day = String(d.getDate()).padStart(2, '0');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${day} ${months[d.getMonth()]} ${d.getFullYear()}`;
  }

  function labelFor(status) {
    const map = {
      overdue: 'OVERDUE', stale: 'STALE', due_soon: 'DUE SOON',
      no_data: 'NO DATA', recently_initiated: 'NEW', in_date: 'IN DATE',
      achieved: 'MET', not_met: 'NOT MET'
    };
    return map[status] || String(status).toUpperCase();
  }

  // Boot
  // SUITE MODE: do NOT mount the floating sidebar — UI is in the Chrome side panel.
  // We still need the data pipeline (fetch + evaluate) to run so the snapshot bridge
  // has chips to expose to the side panel.
  bootDataOnly();

  function bootDataOnly() {
    loadSettings(async () => {
      try {
        const rules = await loadRules();
        evaluateAndPublish(rules);
        // Re-evaluate on URL changes inside the SPA
        let lastUrl = location.href;
        new MutationObserver(() => {
          if (location.href !== lastUrl) {
            lastUrl = location.href;
            setTimeout(async () => {
              try { evaluateAndPublish(await loadRules()); } catch (e) {}
            }, 800);
          }
        }).observe(document.body, { childList: true, subtree: true });
      } catch (e) {}
    });
  }

  function evaluateAndPublish(rules) {
    try {
      const fetcher = window.SentinelDataFetcher;
      if (!fetcher) return;
      const result = fetcher.fetchPatientData ? fetcher.fetchPatientData(currentMode) : null;
      Promise.resolve(result).then(data => {
        if (!data || !window.SentinelRules) return;
        // This call triggers the patched evaluatePatient below, which stores the snapshot.
        window.SentinelRules.evaluatePatient(
          data.medications || [],
          data.observations || [],
          rules,
          {
            now: new Date().toISOString(),
            problems: data.problems || [],
            patientContext: data.patientContext,
          }
        );
      }).catch(() => {});
    } catch (e) {}
  }

  // ── Side panel bridge ──────────────────────────────────────────────────────
  // Stores the last evaluated chip snapshot so the suite side panel can read it
  // without needing a fresh fetch. Updated every time chips are evaluated.
  let _lastSnapshot = null;

  // Patch into the evaluate-and-render flow by intercepting the storage pattern
  // via a flag set after the first successful evaluation.
  const _origEvaluate = window.SentinelRules && window.SentinelRules.evaluatePatient;
  if (_origEvaluate) {
    window.SentinelRules.evaluatePatient = function(meds, obs, rules, opts) {
      const chips = _origEvaluate.call(this, meds, obs, rules, opts);
      _lastSnapshot = {
        chips,
        patientContext: opts && opts.patientContext || null,
        evaluatedAt: new Date().toISOString(),
      };
      return chips;
    };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.action === 'getSentinelSnapshot') {
      sendResponse(_lastSnapshot || { chips: null, patientContext: null, evaluatedAt: null });
      return false;
    }
  });
})();