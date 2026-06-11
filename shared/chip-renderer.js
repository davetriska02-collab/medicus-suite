// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Shared Drug-Monitoring Chip Renderer
// Used by:
//   side-panel/modules/sentinel/sentinel.js  (live chip rendering)
//   sentinel-options/options.js               (custom rule live preview)
//
// Exports renderDrugChip(chip) -> HTML string.
// Keeps the sentinel side panel and options preview in sync automatically.

(function (global) {
  'use strict';

  const STATUS_COLOUR = {
    overdue: 'red',
    not_met: 'red',
    stale: 'amber',
    due_soon: 'amber',
    no_data: 'neutral',
    recently_initiated: 'neutral',
    achieved: 'green',
    in_date: 'green',
    // Non-time-based alert statuses (drug-combo / event-count / composite)
    alert: 'red',
    caution: 'amber',
    noted: 'neutral',
    // Vaccine statuses
    vax_due: 'amber',
    vax_given: 'green',
    vax_declined: 'neutral',
  };

  const STATUS_LABEL = {
    overdue: 'OVERDUE',
    not_met: 'NOT MET',
    stale: 'SEVERELY OVERDUE',
    due_soon: 'DUE SOON',
    no_data: 'NO DATA',
    recently_initiated: 'NEW',
    achieved: 'MET',
    in_date: 'IN DATE',
    // Non-time-based alert statuses (drug-combo / event-count / composite)
    alert: 'ALERT',
    caution: 'CAUTION',
    noted: 'NOTED',
    // Vaccine statuses
    vax_due: 'DUE',
    vax_given: 'GIVEN',
    vax_declined: 'DECLINED',
  };

  function escHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function escAttr(s) {
    return escHtml(s).replace(/"/g, '&quot;');
  }

  // Per-rule dismiss button rendered top-right of a chip. `untilIso` empty/null
  // means a permanent hide; a date snoozes until that date. The button carries
  // the ruleId, until, and the chip's current status via data-* attrs; the
  // side-panel delegates clicks on [data-dismiss-rule] to write sentinel.hiddenRules.
  // data-dismiss-status lets the dismiss handler record statusAtDismissal so a later
  // status-escalation can resurface the chip (HAZARD-LOG H-021 mitigation).
  // stopPropagation in that handler keeps this from also toggling the chip's
  // evidence panel.
  function renderDismissBtn(ruleId, untilIso, statusAtDismissal) {
    if (!ruleId) return '';
    const statusAttr = statusAtDismissal ? ` data-dismiss-status="${escAttr(statusAtDismissal)}"` : '';
    if (untilIso) {
      return `<button class="sent-chip-dismiss" data-dismiss-rule="${escAttr(ruleId)}" data-dismiss-until="${escAttr(untilIso)}"${statusAttr} title="Snooze until season (${escAttr(untilIso)})" aria-label="Snooze this alert until season">×</button>`;
    }
    return `<button class="sent-chip-dismiss" data-dismiss-rule="${escAttr(ruleId)}" data-dismiss-until=""${statusAttr} title="Hide this alert" aria-label="Hide this alert">×</button>`;
  }

  function formatDate(s) {
    if (!s) return '';
    try {
      return new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch {
      return s;
    }
  }

  // Render a drug-monitoring chip object to an HTML string.
  // chip shape matches evaluateDrugRule output.
  function renderDrugChip(chip) {
    const col = STATUS_COLOUR[chip.status] || 'neutral';
    const lbl = STATUS_LABEL[chip.status] || String(chip.status || '').toUpperCase();
    const isCustom = chip.isCustom || (chip.ruleId && chip.ruleId.startsWith('custom-'));

    const testLines = (chip.tests || [])
      .map((t) => {
        const tCol = STATUS_COLOUR[t.status] || 'neutral';
        const tLbl = STATUS_LABEL[t.status] || '';
        const dateStr = t.latestObs ? formatDate(t.latestObs.date) : '';
        const valStr =
          t.latestObs && t.latestObs.value != null
            ? ` · ${escHtml(String(t.latestObs.value).trim().slice(0, 30))}`
            : '';
        const dayStr = t.days != null ? ` · ${t.days}d` : '';
        return `<div class="sent-test-row">
        <span class="sent-test-name">${escHtml(t.testName || t.name || '')}</span>
        <span class="sent-test-status sent-test-${tCol}">${tLbl}${valStr}${dateStr ? ` · ${dateStr}${dayStr}` : ''}</span>
      </div>`;
      })
      .join('');

    // Hover-surface notes/source on custom chips so users can see provenance at a glance
    const tooltipBits = [];
    if (chip.notes) tooltipBits.push(chip.notes);
    if (chip.source) tooltipBits.push('Source: ' + chip.source);
    const titleAttr = isCustom && tooltipBits.length ? ` title="${escAttr(tooltipBits.join(' — '))}"` : '';
    const customTag = isCustom ? `<span class="sent-custom-tag">Custom</span>` : '';

    let hrtCtxHtml = '';
    if (chip.hrtContext) {
      const ctx = chip.hrtContext;
      let ctxClass, ctxText;
      if (ctx.hasHysterectomy) {
        ctxClass = 'hrt-ctx-ok';
        ctxText = 'Hysterectomy — progestogen not required';
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
      } else if (ctx.iusExpired) {
        // A historical coil code older than its licensed life is NOT current
        // cover — surface it so the clinician confirms a replacement/progestogen.
        ctxClass = 'hrt-ctx-warn';
        ctxText = 'IUS expired (>5y) — endometrial cover not confirmed';
      } else {
        ctxClass = 'hrt-ctx-warn';
        ctxText = 'No progestogen or hysterectomy recorded';
      }
      hrtCtxHtml = `<div class="sent-chip-hrt-ctx ${ctxClass}">${ctxText}</div>`;
    }

    const evAttrs = chip.evidence
      ? ` data-rule-id="${escHtml(chip.ruleId || '')}" data-evidence-key="${escHtml((chip.ruleId || '') + '|' + (chip.drugName || ''))}" tabindex="0" role="button" aria-expanded="false"`
      : '';
    const evHint = chip.evidence ? `<span class="sent-chip-info" aria-hidden="true">ⓘ</span>` : '';
    return `
      <div class="sent-chip sent-chip-${col}${chip.evidence ? ' sent-chip-clickable' : ''}"${titleAttr}${evAttrs}>
        ${renderDismissBtn(chip.ruleId, null, chip.status)}
        <div class="sent-chip-head">
          <span class="sent-chip-name">${escHtml(chip.drugName || chip.ruleId)}${customTag}${evHint}</span>
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
      ? isOverdue && chip.qofYearStart && !isCustom && chip.dateText < chip.qofYearStart
        ? ` · ${escHtml(chip.dateText)} ⚠ before ${escHtml(chip.qofYearStart)}`
        : ` · ${escHtml(chip.dateText)}${chip.days != null ? ` (${chip.days}d ago)` : ''}`
      : '';
    const obs = chip.valueText
      ? `${escHtml(chip.valueText)}${datePart}`
      : chip.dateText
        ? datePart.replace(/^ · /, '')
        : '';

    // Custom chips: replace QOF year tag with Custom tag; hide points if not set
    const yearOrCustomTag = isCustom
      ? `<span class="sent-custom-tag">Custom</span>`
      : chip.qofYear
        ? `<span class="sent-qof-year">QOF ${escHtml(chip.qofYear)}</span>`
        : '';
    const pointsText = chip.points ? ` · ${escHtml(String(chip.points))}pt` : '';

    // Hover-surface notes/source on custom chips
    const tooltipBits = [];
    if (chip.notes) tooltipBits.push(chip.notes);
    if (chip.source) tooltipBits.push('Source: ' + chip.source);
    const titleAttr = isCustom && tooltipBits.length ? ` title="${escAttr(tooltipBits.join(' — '))}"` : '';

    const evAttrs = chip.evidence
      ? ` data-rule-id="${escHtml(chip.ruleId || '')}" data-evidence-key="${escHtml(chip.ruleId || '')}" tabindex="0" role="button" aria-expanded="false"`
      : '';
    const evHint = chip.evidence ? `<span class="sent-chip-info" aria-hidden="true">ⓘ</span>` : '';
    return `
      <div class="sent-chip sent-chip-${col}${chip.evidence ? ' sent-chip-clickable' : ''}"${titleAttr}${evAttrs}>
        ${renderDismissBtn(chip.ruleId, null, chip.status)}
        <div class="sent-chip-head">
          <span class="sent-chip-name">${escHtml(chip.indicatorCode || chip.ruleId)}${evHint}</span>
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

    const tests = (rule.tests || []).map((test) => {
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
      drugName: drugName || rule.drug?.match?.[0] || 'Drug',
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
      .map((s) => `<strong>${escHtml(s.setName)}:</strong> ${escHtml((s.drugs || []).join(', '))}`)
      .join(' + ');
    const tooltipBits = [];
    if (chip.notes) tooltipBits.push(chip.notes);
    if (chip.source) tooltipBits.push('Source: ' + chip.source);
    const titleAttr = tooltipBits.length ? ` title="${escAttr(tooltipBits.join(' — '))}"` : '';
    const evAttrs = chip.evidence
      ? ` data-rule-id="${escHtml(chip.ruleId || '')}" data-evidence-key="${escHtml(chip.ruleId || '')}" tabindex="0" role="button" aria-expanded="false"`
      : '';
    const evHint = chip.evidence ? `<span class="sent-chip-info" aria-hidden="true">ⓘ</span>` : '';
    return `
      <div class="sent-chip sent-chip-${col}${chip.evidence ? ' sent-chip-clickable' : ''}"${titleAttr}${evAttrs}>
        <div class="sent-chip-head">
          <span class="sent-chip-name">${escHtml(chip.label || chip.ruleId)}${evHint}</span>
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
    if (chip.notes) tooltipBits.push(chip.notes);
    if (chip.source) tooltipBits.push('Source: ' + chip.source);
    const titleAttr = tooltipBits.length ? ` title="${escAttr(tooltipBits.join(' — '))}"` : '';
    const evAttrs = chip.evidence
      ? ` data-rule-id="${escHtml(chip.ruleId || '')}" data-evidence-key="${escHtml(chip.ruleId || '')}" tabindex="0" role="button" aria-expanded="false"`
      : '';
    const evHint = chip.evidence ? `<span class="sent-chip-info" aria-hidden="true">ⓘ</span>` : '';
    return `
      <div class="sent-chip sent-chip-${col}${chip.evidence ? ' sent-chip-clickable' : ''}"${titleAttr}${evAttrs}>
        <div class="sent-chip-head">
          <span class="sent-chip-name">${escHtml(chip.label || chip.ruleId)}${evHint}</span>
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
    const op = chip.operator || 'AND';
    const fired = (chip.firedRuleIds || []).length;
    const tooltipBits = [];
    if (chip.notes) tooltipBits.push(chip.notes);
    if (chip.source) tooltipBits.push('Source: ' + chip.source);
    const titleAttr = tooltipBits.length ? ` title="${escAttr(tooltipBits.join(' — '))}"` : '';
    const evAttrs = chip.evidence
      ? ` data-rule-id="${escHtml(chip.ruleId || '')}" data-evidence-key="${escHtml(chip.ruleId || '')}" tabindex="0" role="button" aria-expanded="false"`
      : '';
    const evHint = chip.evidence ? `<span class="sent-chip-info" aria-hidden="true">ⓘ</span>` : '';
    return `
      <div class="sent-chip sent-chip-${col}${chip.evidence ? ' sent-chip-clickable' : ''}"${titleAttr}${evAttrs}>
        <div class="sent-chip-head">
          <span class="sent-chip-name">${escHtml(chip.label || chip.ruleId)}${evHint}</span>
          <span class="sent-chip-badge sent-badge-${col}">${lbl}</span>
        </div>
        <div class="sent-chip-obs">${fired} rule${fired === 1 ? '' : 's'} fired (${escHtml(op)})</div>
        <div class="sent-chip-cat"><span class="sent-custom-tag">Composite</span></div>
      </div>`;
  }

  // Render a vaccine eligibility chip (flu / COVID).
  // Vaccine chip: compact summary always visible (name + status badge +
  // eligibility reason + season). A native <details> holds the verbose
  // disclaimer / source / event detail so it stays collapsed by default and
  // needs no extra JS wiring. The ⓘ summary toggles it.
  function renderVaccineChip(chip) {
    const col = STATUS_COLOUR[chip.status] || 'neutral';
    const lbl = STATUS_LABEL[chip.status] || String(chip.status || '').toUpperCase();
    const reason = chip.eligibilityReason || '';
    const isGiven = chip.status === 'vax_given';
    const isDeclined = chip.status === 'vax_declined';

    // Compact sub-line: eligibility reason + inline season.
    const seasonInline = chip.seasonLabel ? `<span class="sent-vax-season">${escHtml(chip.seasonLabel)}</span>` : '';
    const subLine =
      reason || seasonInline
        ? `<div class="sent-chip-obs sent-vax-sub">${reason ? `<span class="sent-vax-reason">${escHtml(reason)}</span>` : ''}${seasonInline}</div>`
        : '';

    // Expanded detail rows.
    const detailRows = [];
    if (reason) {
      detailRows.push(
        `<div class="sent-vax-row"><span class="sent-vax-row-label">Eligibility</span><span class="sent-vax-row-val">${escHtml(reason)}</span></div>`
      );
    }
    if (isGiven || isDeclined) {
      detailRows.push(
        `<div class="sent-vax-row"><span class="sent-vax-row-label">${isGiven ? 'Given' : 'Declined'}</span><span class="sent-vax-row-val">${escHtml(formatDate(chip.eventDate) || 'date unknown')}</span></div>`
      );
    }
    if (chip.seasonLabel) {
      detailRows.push(
        `<div class="sent-vax-row"><span class="sent-vax-row-label">Season</span><span class="sent-vax-row-val">${escHtml(chip.seasonLabel)}</span></div>`
      );
    }
    const notesBit = chip.notes
      ? `<div class="sent-chip-note sent-vax-note">⚠ DOUBLE-CHECK ELIGIBILITY — ${escHtml(chip.notes)}</div>`
      : '';
    const sourceBit = chip.source ? `<div class="sent-chip-source">Source: ${escHtml(chip.source)}</div>` : '';

    return `
      <div class="sent-chip sent-chip-${col} sent-vax-chip">
        ${renderDismissBtn(chip.ruleId, chip.seasonStartIso || null, chip.status)}
        <div class="sent-chip-head">
          <span class="sent-chip-name">${escHtml(chip.displayName || chip.ruleId)}</span>
          <span class="sent-chip-badge sent-badge-${col}">${lbl}</span>
        </div>
        ${subLine}
        <details class="sent-vax-details">
          <summary class="sent-vax-summary"><span class="sent-chip-info" aria-hidden="true">ⓘ</span> Details</summary>
          <div class="sent-vax-detail-body">
            ${detailRows.join('')}
            ${notesBit}
            ${sourceBit}
          </div>
        </details>
      </div>`;
  }

  // === EVIDENCE PANEL ===
  // Renders the click-to-detail panel for a chip's evidence object.
  // Shape: { summary, facts: [{label, value, date?, detail?}], refs?, series? }
  function renderEvidencePanel(evidence) {
    if (!evidence) return '';
    const rows = (evidence.facts || [])
      .map((f) => {
        const v = escHtml(f.value);
        const d = f.date ? `<span class="sent-ev-date">${escHtml(formatDate(f.date))}</span>` : '';
        const det = f.detail ? `<span class="sent-ev-detail">${escHtml(f.detail)}</span>` : '';
        return `<div class="sent-ev-row">
        <span class="sent-ev-label">${escHtml(f.label)}</span>
        <span class="sent-ev-value">${v}${d ? ' · ' + d : ''}${det ? ' · ' + det : ''}</span>
      </div>`;
      })
      .join('');

    const refsHtml =
      evidence.refs && evidence.refs.length
        ? `<div class="sent-ev-refs">
          <div class="sent-ev-refs-head">Sub-rules</div>
          ${evidence.refs
            .map(
              (r) => `
            <button class="sent-ev-ref${r.fired ? ' fired' : ''}" data-ref-rule-id="${escHtml(r.ruleId)}">
              <span class="sent-ev-ref-dot${r.fired ? ' on' : ''}"></span>
              <span class="sent-ev-ref-label">${escHtml(r.label)}</span>
              <span class="sent-ev-ref-state">${r.fired ? 'fired' : 'did not fire'}</span>
            </button>`
            )
            .join('')}
        </div>`
        : '';

    const sparklineHtml = evidence.series ? renderSparkline(evidence.series) : '';

    return `<div class="sent-evidence-panel">
      <div class="sent-ev-summary">${escHtml(evidence.summary || '')}</div>
      ${sparklineHtml}
      <div class="sent-ev-rows">${rows}</div>
      ${refsHtml}
      <div class="sent-ev-foot">
        <button class="sent-ev-close" aria-label="Close evidence">Close</button>
      </div>
    </div>`;
  }

  // SVG sparkline for observation-trend evidence. Points oldest→newest, line
  // coloured by direction (rising=red if "rising" is the trigger direction).
  function renderSparkline(series) {
    const pts = (series.points || []).filter((p) => Number.isFinite(p.value));
    if (pts.length < 2) return '';
    const W = 260,
      H = 60,
      PAD = 6;
    const vals = pts.map((p) => p.value);
    const minV = Math.min(...vals);
    const maxV = Math.max(...vals);
    const rangeV = maxV - minV || 1;
    const stepX = (W - 2 * PAD) / (pts.length - 1);
    const coords = pts.map((p, i) => {
      const x = PAD + i * stepX;
      const y = H - PAD - ((p.value - minV) / rangeV) * (H - 2 * PAD);
      return { x, y, value: p.value, date: p.date };
    });
    const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ');
    const dots = coords
      .map(
        (c) =>
          `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="2.5"><title>${escHtml(formatDate(c.date))}: ${escHtml(String(c.value))}${series.unit ? ' ' + escHtml(series.unit) : ''}</title></circle>`
      )
      .join('');
    const lineCls = series.fires
      ? series.direction === 'rising'
        ? 'sent-spark-line rising'
        : 'sent-spark-line falling'
      : 'sent-spark-line steady';
    const legend = `${pts[0].value} → ${pts[pts.length - 1].value}${series.unit ? ' ' + series.unit : ''} · Δ ${series.delta >= 0 ? '+' : ''}${series.delta.toFixed(1)}`;
    return `<div class="sent-ev-sparkline">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="trend">
        <path d="${linePath}" class="${lineCls}" fill="none"/>
        ${dots}
      </svg>
      <div class="sent-ev-sparkline-legend">${escHtml(legend)}</div>
    </div>`;
  }

  // Skip-reason → readable phrase for buildPlainExplanation.
  const SKIP_PHRASE = {
    disabled: 'rule is disabled',
    'age-filter': "patient age is outside the rule's age range",
    'sex-filter': "patient sex does not match the rule's sex filter",
    'problem-filter': 'required problem condition not met',
    'no-drug-match': 'no matching medication found in the record',
    'not-on-register': 'patient is not on the required register',
    'register-precondition': 'register precondition not met',
    'requires-problem': 'required problem not coded in this record',
    'requires-any-problem': 'none of the required problems found',
    'excluded-by-problem': 'patient has an exclusion-qualifying problem',
    'no-observation': 'no matching observation found',
    'stale-observation': 'observation is too old or has an unparseable date',
    'in-safe-range': 'observation value is within the safe range',
    'not-eligible': 'patient does not meet vaccine eligibility criteria',
    'out-of-campaign': 'outside the vaccine campaign window',
    'count-threshold-not-met': 'event count does not meet threshold',
    'composite-not-met': 'composite rule conditions not satisfied',
    'blocked-by-must-not-present': 'a blocking medication is present',
  };

  // === PLAIN-LANGUAGE EXPLAINER ===
  // buildPlainExplanation(traceEntry) → string
  // Produces a plain-language sentence summarising why a rule fired or did not.
  // Designed for appending to chip evidence panels (via renderWhyBlock).
  function buildPlainExplanation(entry) {
    if (!entry) return 'No trace information available.';

    // Not fired: explain the skip reason
    if (!entry.fired) {
      const phrase = (entry.skipReason && SKIP_PHRASE[entry.skipReason]) || entry.skipReason || 'did not fire';
      return `Rule '${entry.ruleId || ''}' was considered but did not fire: ${phrase}.`;
    }

    const statusPhrase = STATUS_LABEL[entry.status] || String(entry.status || '').toLowerCase();

    // Drug-monitoring type
    if (entry.ruleType === 'drug-monitoring') {
      const match = entry.drugMatch;
      const medName = match ? match.medName : '(unknown medication)';
      const term = match ? match.matchedTerm : null;
      const matchPart = term
        ? `matched rule '${entry.ruleId}' via match term '${term}'`
        : `matched rule '${entry.ruleId}'`;

      if (!entry.arithmetic || entry.arithmetic.length === 0) {
        return `${medName} ${matchPart}. Status: ${statusPhrase}.`;
      }

      const parts = entry.arithmetic.map((ar) => {
        const lastDateStr = ar.lastDate ? formatDate(ar.lastDate) : 'no result on record';
        const dueDateStr = ar.dueDate ? formatDate(ar.dueDate) : null;
        const daysSince = ar.daysSince != null ? `${ar.daysSince}d since last result` : '';
        const arStatus = STATUS_LABEL[ar.status] || ar.status || '';
        if (dueDateStr) {
          return `${ar.test}: last ${lastDateStr}; interval ${ar.intervalDays}d → due ${dueDateStr}${daysSince ? ' (' + daysSince + ')' : ''} → ${arStatus.toLowerCase()}`;
        }
        return `${ar.test}: ${lastDateStr}; interval ${ar.intervalDays}d → ${arStatus.toLowerCase()}`;
      });

      return `${medName} ${matchPart}. ${parts.join('. ')}.`;
    }

    // QOF register type
    if (entry.ruleType === 'qof-register') {
      const prob = entry.matchedProblem;
      const probLabel = prob ? prob.label : '(problem)';
      const term = entry.matchedTerm ? `(matched term: '${entry.matchedTerm}')` : '';
      return `Patient is on the ${entry.label || entry.ruleId} register — coded problem: ${probLabel}${term ? ' ' + term : ''}. Status: ${statusPhrase}.`;
    }

    // QOF indicator type
    if (entry.ruleType === 'qof-indicator') {
      const regPart = entry.matchedRegisterProblem
        ? `Register: ${entry.matchedRegisterProblem.registerName} (${entry.matchedRegisterProblem.label}). `
        : '';
      const obsPart = entry.matchedObs
        ? `Observation: ${entry.matchedObs.name}${entry.matchedObs.value != null ? ' = ' + entry.matchedObs.value : ''}${entry.matchedObs.date ? ' (' + formatDate(entry.matchedObs.date) + ')' : ''}. `
        : '';
      const medPart = entry.matchedMed ? `Medication: ${entry.matchedMed}. ` : '';
      return `${regPart}${obsPart}${medPart}Status: ${statusPhrase}.`;
    }

    // Vaccine type
    if (entry.ruleType === 'vaccine') {
      const seasonPart = entry.isOneOff ? 'one-off vaccine' : `season ${entry.seasonLabel || ''}`;
      const evtPart = entry.eventDate
        ? `${entry.status === 'vax_given' ? 'Given' : 'Declined'} ${formatDate(entry.eventDate)}.`
        : 'No record found.';
      return `Vaccine (${entry.label || entry.ruleId}): ${entry.eligibilityReason || 'eligible'} — ${seasonPart}. ${evtPart} Status: ${statusPhrase}.`;
    }

    // Drug-combo type
    if (entry.ruleType === 'drug-combo') {
      const summary = entry.matchSummary
        ? entry.matchSummary.map((s) => `${s.setName}: ${(s.drugs || []).join(', ')}`).join(' + ')
        : '';
      return `Drug combination '${entry.label || entry.ruleId}' detected${summary ? ': ' + summary : ''}. Status: ${statusPhrase}.`;
    }

    // Event-count type
    if (entry.ruleType === 'event-count') {
      return `Event count rule '${entry.label || entry.ruleId}': ${entry.count} ${entry.operator} ${entry.countThreshold} in last ${entry.windowMonths || 12} months. Status: ${statusPhrase}.`;
    }

    // Composite type
    if (entry.ruleType === 'composite') {
      const firedCount = (entry.firedRuleIds || []).length;
      return `Composite rule '${entry.label || entry.ruleId}' (${entry.operator || 'AND'}): ${firedCount} sub-rule(s) fired. Status: ${statusPhrase}.`;
    }

    // Fallback
    return `Rule '${entry.ruleId}' fired with status: ${statusPhrase}.`;
  }

  // renderWhyBlock(traceEntry) → HTML string
  // Renders a small "Why?" block to append inside a chip's evidence panel.
  // Consistent with existing sent-ev-* CSS classes; adds sent-ev-why class.
  function renderWhyBlock(entry) {
    if (!entry) return '';
    const explanation = buildPlainExplanation(entry);
    const sourceLine = entry.source ? `<div class="sent-ev-why-source">Source: ${escHtml(entry.source)}</div>` : '';
    return `<div class="sent-ev-why">
      <div class="sent-ev-why-label">Why?</div>
      <div class="sent-ev-why-text">${escHtml(explanation)}</div>
      ${sourceLine}
    </div>`;
  }

  const api = {
    renderDrugChip,
    buildPreviewChip,
    renderQofIndicatorChip,
    buildQofPreviewChip,
    renderDrugComboChip,
    renderEventCountChip,
    renderCompositeChip,
    renderVaccineChip,
    renderEvidencePanel,
    renderSparkline,
    renderDismissBtn,
    buildPlainExplanation,
    renderWhyBlock,
    STATUS_COLOUR,
    STATUS_LABEL,
    escHtml,
    formatDate,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.ChipRenderer = api;
  }
})(typeof window !== 'undefined' ? window : global);
