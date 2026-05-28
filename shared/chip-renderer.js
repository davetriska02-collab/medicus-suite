// Medicus Suite — Shared Drug-Monitoring Chip Renderer
// Used by:
//   side-panel/modules/sentinel/sentinel.js  (live chip rendering)
//   sentinel-options/options.js               (custom rule live preview)
//
// Exports renderDrugChip(chip) -> HTML string.
// Keeps the sentinel side panel and options preview in sync automatically.

(function(global) {
  'use strict';

  const STATUS_COLOUR = {
    overdue: 'red', not_met: 'red',
    stale: 'amber', due_soon: 'amber',
    no_data: 'neutral', recently_initiated: 'neutral',
    achieved: 'green', in_date: 'green'
  };

  const STATUS_LABEL = {
    overdue: 'OVERDUE', not_met: 'NOT MET',
    stale: 'STALE', due_soon: 'DUE SOON',
    no_data: 'NO DATA', recently_initiated: 'NEW',
    achieved: 'MET', in_date: 'IN DATE'
  };

  function escHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function formatDate(s) {
    if (!s) return '';
    try { return new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
    catch { return s; }
  }

  // Render a drug-monitoring chip object to an HTML string.
  // chip shape matches evaluateDrugRule output.
  function renderDrugChip(chip) {
    const col = STATUS_COLOUR[chip.status] || 'neutral';
    const lbl = STATUS_LABEL[chip.status] || String(chip.status || '').toUpperCase();
    const isCustom = chip.isCustom || (chip.ruleId && chip.ruleId.startsWith('custom-'));

    const testLines = (chip.tests || []).map(t => {
      const tCol = STATUS_COLOUR[t.status] || 'neutral';
      const tLbl = STATUS_LABEL[t.status] || '';
      const dateStr = t.latestObs ? formatDate(t.latestObs.date) : '';
      const valStr = t.latestObs && t.latestObs.value != null
        ? ` · ${escHtml(String(t.latestObs.value).trim().slice(0, 30))}`
        : '';
      const dayStr = t.days != null ? ` · ${t.days}d` : '';
      return `<div class="sent-test-row">
        <span class="sent-test-name">${escHtml(t.testName || t.name || '')}</span>
        <span class="sent-test-status sent-test-${tCol}">${tLbl}${valStr}${dateStr ? ` · ${dateStr}${dayStr}` : ''}</span>
      </div>`;
    }).join('');

    // Hover-surface notes/source on custom chips so users can see provenance at a glance
    const tooltipBits = [];
    if (chip.notes) tooltipBits.push(chip.notes);
    if (chip.source) tooltipBits.push('Source: ' + chip.source);
    const titleAttr = isCustom && tooltipBits.length ? ` title="${escHtml(tooltipBits.join(' — '))}"` : '';
    const customTag = isCustom ? `<span class="sent-custom-tag">Custom</span>` : '';

    let hrtCtxHtml = '';
    if (chip.hrtContext) {
      const ctx = chip.hrtContext;
      let ctxClass, ctxText;
      if (ctx.hasHysterectomy) {
        ctxClass = 'hrt-ctx-ok';
        ctxText  = 'Hysterectomy — progestogen not required';
      } else if (ctx.iusMed) {
        ctxClass = 'hrt-ctx-ok';
        // Show "IUS in situ" + brand name trimmed to first two words
        const brand = ctx.iusMed.split(/\s+/).slice(0, 2).join(' ');
        ctxText = `IUS in situ — ${escHtml(brand)}`;
      } else if (ctx.progestogenMed) {
        ctxClass = 'hrt-ctx-ok';
        // Strip trailing dose (e.g. "Utrogestan 100mg capsules" → "Utrogestan")
        const name = ctx.progestogenMed.replace(/\s+\d.*$/i, '').trim();
        ctxText = `Progestogen: ${escHtml(name)}`;
      } else {
        ctxClass = 'hrt-ctx-warn';
        ctxText  = 'No progestogen or hysterectomy recorded';
      }
      hrtCtxHtml = `<div class="sent-chip-hrt-ctx ${ctxClass}">${ctxText}</div>`;
    }

    return `
      <div class="sent-chip sent-chip-${col}"${titleAttr}>
        <div class="sent-chip-head">
          <span class="sent-chip-name">${escHtml(chip.drugName || chip.ruleId)}${customTag}</span>
          <span class="sent-chip-badge sent-badge-${col}">${lbl}</span>
        </div>
        ${chip.drugClass ? `<div class="sent-chip-cat">${escHtml(chip.drugClass)}</div>` : ''}
        ${hrtCtxHtml}
        ${testLines ? `<div class="sent-test-list">${testLines}</div>` : ''}
      </div>`;
  }

  // Render a qof-indicator chip object to an HTML string.
  // For custom indicators (ruleId starts with custom-): show purple Custom tag
  // in place of the QOF year tag, hide points unless explicitly set, surface
  // notes/source on hover.
  function renderQofIndicatorChip(chip) {
    const col = STATUS_COLOUR[chip.status] || 'neutral';
    const lbl = STATUS_LABEL[chip.status] || String(chip.status || '').toUpperCase();
    const isCustom = chip.isCustom || (chip.ruleId && chip.ruleId.startsWith('custom-'));

    const isOverdue = chip.status === 'overdue' || chip.status === 'not_met';
    const datePart = chip.dateText
      ? (isOverdue && chip.qofYearStart && !isCustom && chip.dateText < chip.qofYearStart
          ? ` · ${escHtml(chip.dateText)} ⚠ before ${escHtml(chip.qofYearStart)}`
          : ` · ${escHtml(chip.dateText)}${chip.days != null ? ` (${chip.days}d ago)` : ''}`)
      : '';
    const obs = chip.valueText
      ? `${escHtml(chip.valueText)}${datePart}`
      : (chip.dateText ? datePart.replace(/^ · /, '') : '');

    // Custom chips: replace QOF year tag with Custom tag; hide points if not set
    const yearOrCustomTag = isCustom
      ? `<span class="sent-custom-tag">Custom</span>`
      : (chip.qofYear ? `<span class="sent-qof-year">QOF ${escHtml(chip.qofYear)}</span>` : '');
    const pointsText = chip.points
      ? ` · ${escHtml(String(chip.points))}pt`
      : '';

    // Hover-surface notes/source on custom chips
    const tooltipBits = [];
    if (chip.notes) tooltipBits.push(chip.notes);
    if (chip.source) tooltipBits.push('Source: ' + chip.source);
    const titleAttr = isCustom && tooltipBits.length ? ` title="${escHtml(tooltipBits.join(' — '))}"` : '';

    return `
      <div class="sent-chip sent-chip-${col}"${titleAttr}>
        <div class="sent-chip-head">
          <span class="sent-chip-name">${escHtml(chip.indicatorCode || chip.ruleId)}</span>
          <span class="sent-chip-badge sent-badge-${col}">${lbl}${pointsText}</span>
        </div>
        ${chip.indicatorName ? `<div class="sent-chip-cat">${escHtml(chip.indicatorName)}${yearOrCustomTag}</div>` : yearOrCustomTag}
        ${obs ? `<div class="sent-chip-obs">${obs}</div>` : ''}
      </div>`;
  }

  // Build a synthetic qof-indicator chip for the options-page form preview.
  // statusKind ∈ { achieved, not_met, no_data, overdue }
  function buildQofPreviewChip(rule, statusKind) {
    const now = new Date();
    const within = rule.check?.withinDays || 365;
    let obsDate = null;
    let days = null;
    let valueText = null;

    if (statusKind === 'achieved') {
      days = Math.max(1, Math.floor(within / 4));
    } else if (statusKind === 'not_met') {
      days = Math.max(1, Math.floor(within / 4));
    } else if (statusKind === 'overdue') {
      days = within + 30;
    }

    if (days != null) {
      const ms = now.getTime() - days * 86400000;
      obsDate = new Date(ms).toISOString().slice(0, 10);
      // Synthetic value text based on check kind
      if (rule.check?.kind === 'observation-threshold') {
        if (rule.check.thresholdSystolic && rule.check.thresholdDiastolic) {
          valueText = statusKind === 'achieved' ? '128/78' : '156/96';
        } else if (rule.check.threshold != null) {
          valueText = String(rule.check.threshold + (statusKind === 'achieved' ? -2 : 5));
        }
      }
    }

    return {
      type: 'qof-indicator',
      ruleId: rule.id || 'custom-preview',
      indicatorCode: rule.indicatorCode || 'PREVIEW',
      indicatorName: rule.indicatorName || '',
      status: statusKind,
      points: rule.points || null,
      qofYear: null,
      qofYearStart: null,
      valueText,
      dateText: obsDate,
      days,
      check: rule.check,
      notes: rule.notes || null,
      source: rule.source || null,
      isCustom: true,
    };
  }


  // Build a synthetic chip from a rule definition and a desired status, using
  // computed synthetic observation dates so the preview lands in the right state.
  // Used by the custom rule form live preview.
  function buildPreviewChip(rule, statusKind, drugName) {
    const now = new Date();
    const todayISO = now.toISOString().slice(0, 10);

    const tests = (rule.tests || []).map(test => {
      const intervalDays = test.intervalDays || 84;
      const dueSoonDays = test.dueSoonDays || 28;
      let obsDate = null;
      let days = null;
      let status = statusKind;

      if (statusKind === 'in_date') {
        days = Math.max(1, intervalDays - dueSoonDays - 1);
      } else if (statusKind === 'due_soon') {
        days = intervalDays - Math.floor(dueSoonDays / 2);
      } else if (statusKind === 'overdue') {
        days = intervalDays + 10;
      } else if (statusKind === 'stale') {
        days = intervalDays * 2 + 30;
      } else {
        // no_data / recently_initiated — no observation
        return { ...test, testName: test.name, status: statusKind, latestObs: null, days: null };
      }

      const obsMs = now.getTime() - days * 24 * 60 * 60 * 1000;
      obsDate = new Date(obsMs).toISOString().slice(0, 10);

      return {
        ...test,
        testName: test.name,
        status,
        latestObs: { name: test.name, date: obsDate, value: null },
        days,
      };
    });

    // Worst status across tests (all same in preview)
    const worstStatus = statusKind;

    return {
      type: 'drug-monitoring',
      ruleId: rule.id || 'custom-preview',
      drugName: drugName || (rule.drug?.match?.[0] || 'Drug'),
      drugClass: rule.drugClass || null,
      status: worstStatus,
      tests,
      source: rule.source || null,
      sharedCare: !!rule.sharedCare,
      isCustom: true,
    };
  }

  // Render a drug-combo chip (concurrent drug combination with optional filters).
  function renderDrugComboChip(chip) {
    const col = STATUS_COLOUR[chip.status] || 'neutral';
    const lbl = STATUS_LABEL[chip.status] || String(chip.status || '').toUpperCase();
    const setsText = (chip.matchSummary || [])
      .map(s => `<strong>${escHtml(s.setName)}:</strong> ${escHtml((s.drugs || []).join(', '))}`)
      .join(' + ');
    const tooltipBits = [];
    if (chip.notes)  tooltipBits.push(chip.notes);
    if (chip.source) tooltipBits.push('Source: ' + chip.source);
    const titleAttr = tooltipBits.length ? ` title="${escHtml(tooltipBits.join(' — '))}"` : '';
    return `
      <div class="sent-chip sent-chip-${col}"${titleAttr}>
        <div class="sent-chip-head">
          <span class="sent-chip-name">${escHtml(chip.label || chip.ruleId)}</span>
          <span class="sent-chip-badge sent-badge-${col}">${lbl}</span>
        </div>
        ${setsText ? `<div class="sent-chip-obs">${setsText}</div>` : ''}
        <div class="sent-chip-cat"><span class="sent-custom-tag">Custom</span></div>
      </div>`;
  }

  // Render an event-count chip (recurrent events: ≥N matches in window).
  function renderEventCountChip(chip) {
    const col = STATUS_COLOUR[chip.status] || 'neutral';
    const lbl = STATUS_LABEL[chip.status] || String(chip.status || '').toUpperCase();
    const summary = `${chip.count} ${chip.operator || '≥'} ${chip.countThreshold} in last ${chip.windowMonths || 12} mo`;
    const sample = (chip.matchedItems || []).slice(0, 3).map(escHtml).join(' · ');
    const moreCount = Math.max(0, (chip.matchedItems || []).length - 3);
    const moreSuffix = moreCount > 0 ? ` <span class="sent-chip-more">+${moreCount} more</span>` : '';
    const tooltipBits = [];
    if (chip.notes)  tooltipBits.push(chip.notes);
    if (chip.source) tooltipBits.push('Source: ' + chip.source);
    const titleAttr = tooltipBits.length ? ` title="${escHtml(tooltipBits.join(' — '))}"` : '';
    return `
      <div class="sent-chip sent-chip-${col}"${titleAttr}>
        <div class="sent-chip-head">
          <span class="sent-chip-name">${escHtml(chip.label || chip.ruleId)}</span>
          <span class="sent-chip-badge sent-badge-${col}">${lbl}</span>
        </div>
        <div class="sent-chip-obs">${escHtml(summary)}</div>
        ${sample ? `<div class="sent-chip-cat">${sample}${moreSuffix}</div>` : ''}
      </div>`;
  }

  // Render a composite chip (AND/OR combination of other rules).
  function renderCompositeChip(chip) {
    const col = STATUS_COLOUR[chip.status] || 'neutral';
    const lbl = STATUS_LABEL[chip.status] || String(chip.status || '').toUpperCase();
    const op  = chip.operator || 'AND';
    const fired = (chip.firedRuleIds || []).length;
    const tooltipBits = [];
    if (chip.notes)  tooltipBits.push(chip.notes);
    if (chip.source) tooltipBits.push('Source: ' + chip.source);
    const titleAttr = tooltipBits.length ? ` title="${escHtml(tooltipBits.join(' — '))}"` : '';
    return `
      <div class="sent-chip sent-chip-${col}"${titleAttr}>
        <div class="sent-chip-head">
          <span class="sent-chip-name">${escHtml(chip.label || chip.ruleId)}</span>
          <span class="sent-chip-badge sent-badge-${col}">${lbl}</span>
        </div>
        <div class="sent-chip-obs">${fired} rule${fired === 1 ? '' : 's'} fired (${escHtml(op)})</div>
        <div class="sent-chip-cat"><span class="sent-custom-tag">Composite</span></div>
      </div>`;
  }

  const api = { renderDrugChip, buildPreviewChip, renderQofIndicatorChip, buildQofPreviewChip, renderDrugComboChip, renderEventCountChip, renderCompositeChip, STATUS_COLOUR, STATUS_LABEL, escHtml, formatDate };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.ChipRenderer = api;
  }
})(typeof window !== 'undefined' ? window : global);
