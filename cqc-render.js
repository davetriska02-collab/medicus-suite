// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// CQC Inspection Readiness — renderer (pure HTML + CSV builders).
//
// Consumes the READINESS object assembled by engine/cqc-evidence.js and produces
// the readiness/export HTML and a CSV export. Pure string-building, no I/O — so the
// mode gating (export drops internal "what to fix"), the always-present coverage
// manifest + disclaimer, and the inline-provenance invariant are unit-testable.
//
// House style mirrors side-panel/modules/condor/report/report-render.js:
//   - esc() the same way; pure HTML builders; stat tiles; tables; badge pills.
// Visual classes are prefixed `cqc-` and styled by the page's CSS.
//
// Clinical-safety placement requirements baked in (see
// docs/plans/CQC-EVIDENCE-PACK-BUILD-PLAN.md §2, §9):
//   A1 — per-figure provenance is VISIBLE inline prose (never a title= tooltip).
//   A2 — the coverage manifest shows the raw matched-drug strings.
//   A5 — the coded-data-only + undercount caveat are stated in-output.
//   Disclaimer renders on the surface AND in the footer, in BOTH modes.

'use strict';

export function esc(s) {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

// RAG pill: colour + WORD, never colour alone — we never weaken an alert by
// relying on hue (a red-green colour-blind reader, or a greyscale print, must
// still read "RED"). `na` is a neutral "not applicable / not derivable" state.
export function ragBadge(level) {
  const key = String(level || '').toLowerCase();
  const word = key === 'green' ? 'GREEN' : key === 'amber' ? 'AMBER' : key === 'red' ? 'RED' : 'N/A';
  const cls = key === 'green' || key === 'amber' || key === 'red' ? key : 'na';
  return `<span class="cqc-badge cqc-badge-${cls}">${esc(word)}</span>`;
}

// A1: provenance as VISIBLE inline prose on the same line as the figure — never a
// title= tooltip, never a code/filter string. Reads as human prose, e.g.
//   "Patients on the active list with a coded lithium Rx in the last 6 months,
//    as at 09:14 on 3 Jun 2026 · source: drug-rules v12 · interval: 6-monthly".
export function provenanceLine(provenance) {
  const p = provenance || {};
  const parts = [];
  if (p.denominator) parts.push(esc(p.denominator));
  if (p.asAt) parts.push(`as at ${esc(p.asAt)}`);
  if (p.source) parts.push(`source: ${esc(p.source)}`);
  if (p.intervalApplied) parts.push(`interval: ${esc(p.intervalApplied)}`);
  if (!parts.length) return '';
  return `<span class="cqc-prov">${parts.join(' · ')}</span>`;
}

// ── Small shared builders ──────────────────────────────────────────────────────

function statTile(label, value, sub = '') {
  return (
    `<div class="cqc-stat"><div class="cqc-stat-value">${esc(value)}</div>` +
    `<div class="cqc-stat-label">${esc(label)}</div>` +
    `${sub ? `<div class="cqc-stat-sub">${esc(sub)}</div>` : ''}</div>`
  );
}

function metaRow(label, value) {
  if (value == null || value === '') return '';
  return (
    `<div class="cqc-meta-row"><span class="cqc-meta-label">${esc(label)}</span>` +
    `<span class="cqc-meta-value">${esc(value)}</span></div>`
  );
}

// ── Disclaimer (renders on the surface AND in the footer — both modes) ──────────

function disclaimerStrip(readiness) {
  const text =
    readiness.disclaimer ||
    'Supporting evidence for the Safe and Well-led processes/outcomes only — not proof of compliance.';
  return `<aside class="cqc-disclaimer-strip" role="note"><strong>Supporting evidence, not proof.</strong> ${esc(text)}</aside>`;
}

function disclaimerFooter(readiness) {
  const text =
    readiness.disclaimer ||
    'Supporting evidence for the Safe and Well-led processes/outcomes only — not proof of compliance.';
  return (
    `<footer class="cqc-foot">` +
    `<p class="cqc-note cqc-foot-disclaimer">${esc(text)}</p>` +
    `<p class="cqc-note">Derived read-only from Medicus. Verify against the source record before relying on any figure.</p>` +
    `</footer>`
  );
}

// ── Cover ───────────────────────────────────────────────────────────────────────

function renderCover(readiness, mode) {
  const title = mode === 'export' ? 'CQC Evidence Pack' : 'CQC Inspection Readiness';
  const modeTag =
    mode === 'export'
      ? `<span class="cqc-mode-tag cqc-mode-export">Evidence export</span>`
      : `<span class="cqc-mode-tag cqc-mode-readiness">Readiness check (internal)</span>`;
  return (
    `<header class="cqc-cover">` +
    `<div class="cqc-cover-row"><h1>${esc(title)}</h1>${modeTag}</div>` +
    `<div class="cqc-cover-meta">` +
    metaRow('Practice', readiness.practiceCode || '') +
    metaRow('Generated', readiness.generatedAt || '') +
    `</div></header>`
  );
}

// ── Readiness banner + aggregated "what to fix" (readiness mode only) ───────────

function renderReadinessBanner(readiness) {
  const overall = readiness.currency?.overall || 'na';
  // Lead with the WORD; the verb ("you need to…") is internal-only and dropped in export.
  const verb =
    overall === 'green'
      ? 'You appear inspection-ready on the evidence below — keep the rule sets current.'
      : overall === 'amber'
        ? 'You need to address the items below before CQC arrives.'
        : overall === 'red'
          ? 'You need to act on the items below now — rule currency is out of date.'
          : 'Readiness could not be rated from the available data.';
  return (
    `<section class="cqc-banner cqc-banner-${esc(String(overall).toLowerCase())}">` +
    `<div class="cqc-banner-head"><span class="cqc-banner-label">Overall readiness</span>${ragBadge(overall)}</div>` +
    `<p class="cqc-banner-verb">${esc(verb)}</p>` +
    `</section>`
  );
}

// Aggregate every qualityStatement.toFix into one "what to fix before CQC" list.
// Readiness mode only — dropped entirely in export.
function renderWhatToFix(readiness) {
  const stmts = Array.isArray(readiness.qualityStatements) ? readiness.qualityStatements : [];
  const items = [];
  for (const qs of stmts) {
    for (const fix of qs.toFix || []) {
      if (fix) items.push({ area: qs.title || qs.keyQuestion || '', fix });
    }
  }
  for (const w of readiness.currency?.warnings || []) {
    if (w) items.push({ area: 'Rule currency', fix: w });
  }
  if (!items.length) return '';
  const li = items
    .map((it) => `<li>${it.area ? `<span class="cqc-fix-area">${esc(it.area)}</span> ` : ''}${esc(it.fix)}</li>`)
    .join('');
  return (
    `<section class="cqc-card cqc-card-fix"><h2>What to fix before CQC</h2>` +
    `<p class="cqc-note">Aggregated from the gaps in every quality statement below.</p>` +
    `<ul class="cqc-fix-list">${li}</ul></section>`
  );
}

// ── Coverage manifest (TOP of the surface — both modes; A2 + A5) ────────────────

function renderRulesetTile(label, rs) {
  if (!rs) return '';
  const subParts = [];
  if (rs.specVersion) subParts.push(`spec ${rs.specVersion}`);
  if (rs.schemaVersion) subParts.push(`schema ${rs.schemaVersion}`);
  if (rs.lastUpdated) subParts.push(`updated ${rs.lastUpdated}`);
  const count =
    rs.ruleCount != null
      ? `${rs.ruleCount} rule${rs.ruleCount === 1 ? '' : 's'}`
      : rs.indicatorCount != null
        ? `${rs.indicatorCount} indicator${rs.indicatorCount === 1 ? '' : 's'}`
        : '—';
  return statTile(label, count, subParts.join(' · '));
}

function renderMatchedTerms(terms) {
  const list = Array.isArray(terms) ? terms.filter((t) => t != null && t !== '') : [];
  if (!list.length) {
    return (
      `<div class="cqc-matched"><h3>Matched drug terms</h3>` +
      `<p class="cqc-note">No matched terms reported.</p></div>`
    );
  }
  const chips = list.map((t) => `<li class="cqc-term">${esc(t)}</li>`).join('');
  return (
    `<div class="cqc-matched"><h3>Matched drug terms (${list.length})</h3>` +
    `<p class="cqc-note">The raw coded drug-name strings the tool matched — eyeball this for completeness (e.g. missing slow-release or brand forms).</p>` +
    `<ul class="cqc-term-list">${chips}</ul></div>`
  );
}

function renderCoverageManifest(readiness) {
  const cov = readiness.coverage || {};
  const qof = cov.qof || {};
  const qofSub = [];
  if (qof.lastUpdated) qofSub.push(`updated ${qof.lastUpdated}`);
  if (qof.safetyMonitoringCount != null) qofSub.push(`${qof.safetyMonitoringCount} safety-monitoring`);

  const tiles = [
    renderRulesetTile('Drug monitoring', cov.drug),
    qof.indicatorCount != null ? statTile('QOF', `${qof.indicatorCount} indicators`, qofSub.join(' · ')) : '',
    renderRulesetTile('Vaccines', cov.vaccine),
    renderRulesetTile('Alerts', cov.alert),
  ]
    .filter(Boolean)
    .join('');

  // A5: coded-data-only + undercount caveat — counts are a floor, not a ceiling.
  const codedLine = cov.codedDataOnly
    ? `<p class="cqc-caveat"><strong>Coded data only.</strong> Results filed as scanned letters or free text are not counted.</p>`
    : '';
  const undercount = cov.undercountCaveat ? `<p class="cqc-caveat">${esc(cov.undercountCaveat)}</p>` : '';
  const keeper = cov.keeperProvenance ? `<p class="cqc-note cqc-keeper">${esc(cov.keeperProvenance)}</p>` : '';

  return (
    `<section class="cqc-card cqc-card-manifest"><h2>Coverage manifest</h2>` +
    `<p class="cqc-note">What this readiness check covers — rule sets, versions and dates — so completeness can be judged before any figure is trusted.</p>` +
    `<div class="cqc-grid cqc-grid-4">${tiles}</div>` +
    renderMatchedTerms(cov.matchedTerms) +
    codedLine +
    undercount +
    keeper +
    `</section>`
  );
}

// ── Quality statement cards (both modes; toFix dropped in export) ───────────────

function renderItem(item) {
  const valuePart =
    item.value != null && item.value !== '' ? `<span class="cqc-item-value">${esc(item.value)}</span>` : '';
  const standard = item.standard ? `<span class="cqc-item-standard">Standard: ${esc(item.standard)}</span>` : '';
  const note = item.note ? `<p class="cqc-item-note">${esc(item.note)}</p>` : '';
  // A1: provenance prints as inline prose right under the figure — no interaction.
  const prov = provenanceLine(item.provenance);
  return (
    `<li class="cqc-item">` +
    `<div class="cqc-item-head"><span class="cqc-item-label">${esc(item.label)}</span>${valuePart}</div>` +
    (prov ? `<div class="cqc-item-prov">${prov}</div>` : '') +
    (standard ? `<div class="cqc-item-meta">${standard}</div>` : '') +
    note +
    `</li>`
  );
}

function renderQualityStatement(qs, mode) {
  const items = Array.isArray(qs.items) ? qs.items : [];
  const itemsHtml = items.length
    ? `<ul class="cqc-item-list">${items.map(renderItem).join('')}</ul>`
    : `<p class="cqc-note">No evidence items derivable for this statement.</p>`;

  const wgll = qs.whatGoodLooksLike
    ? `<div class="cqc-wgll"><h3>What good looks like</h3><p>${esc(qs.whatGoodLooksLike)}</p></div>`
    : '';

  // Export mode drops the internal action list ("what to fix").
  const toFix =
    mode !== 'export' && Array.isArray(qs.toFix) && qs.toFix.length
      ? `<div class="cqc-tofix"><h3>To fix</h3><ul>${qs.toFix.map((f) => `<li>${esc(f)}</li>`).join('')}</ul></div>`
      : '';

  const cat = qs.evidenceCategory ? `<span class="cqc-cat-tag">${esc(qs.evidenceCategory)}</span>` : '';
  const subhead = [qs.keyQuestion, qs.title].filter(Boolean).map(esc).join(' · ');

  return (
    `<section class="cqc-card cqc-qs" data-key="${esc(qs.key || '')}">` +
    `<div class="cqc-qs-head">` +
    `<h2>${subhead}</h2>` +
    `<div class="cqc-qs-tags">${cat}${ragBadge(qs.rag)}</div>` +
    `</div>` +
    itemsHtml +
    wgll +
    toFix +
    `</section>`
  );
}

// Group quality statements by CQC key question, preserving first-seen order.
function renderQualityStatements(readiness, mode) {
  const stmts = Array.isArray(readiness.qualityStatements) ? readiness.qualityStatements : [];
  if (!stmts.length) {
    return `<section class="cqc-card"><h2>Quality statements</h2><p class="cqc-note">No quality statements available.</p></section>`;
  }
  const groups = new Map();
  for (const qs of stmts) {
    const kq = qs.keyQuestion || 'Other';
    if (!groups.has(kq)) groups.set(kq, []);
    groups.get(kq).push(qs);
  }
  const blocks = [];
  for (const [kq, list] of groups) {
    const cards = list.map((qs) => renderQualityStatement(qs, mode)).join('');
    blocks.push(
      `<div class="cqc-keyq" data-keyq="${esc(kq)}">` +
        `<h2 class="cqc-keyq-head">Key question: ${esc(kq)}</h2>${cards}</div>`
    );
  }
  return blocks.join('');
}

// ── Delta — what changed since the explicitly-anchored baseline ─────────────────

function renderDelta(readiness) {
  const d = readiness.delta;
  if (!d || !Array.isArray(d.changes) || !d.changes.length) return '';
  const rows = d.changes
    .map(
      (c) =>
        `<tr><td>${esc(c.label)}</td><td class="cqc-num">${esc(c.from)}</td><td class="cqc-num">${esc(c.to)}</td></tr>`
    )
    .join('');
  const anchor = d.sinceAnchorAt ? ` (baseline anchored ${esc(d.sinceAnchorAt)})` : '';
  return (
    `<section class="cqc-card cqc-card-delta"><h2>What changed since baseline${anchor}</h2>` +
    `<table class="cqc-table"><thead><tr><th>Item</th><th class="cqc-num">Before</th><th class="cqc-num">Now</th></tr></thead>` +
    `<tbody>${rows}</tbody></table></section>`
  );
}

// ── Sign-off (export mode only) ─────────────────────────────────────────────────

function renderSignoff() {
  const field = (label) =>
    `<div class="cqc-signoff-field"><span class="cqc-signoff-label">${esc(label)}</span>` +
    `<span class="cqc-signoff-line"></span></div>`;
  return (
    `<section class="cqc-card cqc-signoff"><h2>Sign-off</h2>` +
    `<p class="cqc-note">For the practice to complete before this pack is shared.</p>` +
    `<div class="cqc-signoff-grid">${field('Prepared by')}${field('Reviewed by')}${field('Date')}</div>` +
    `</section>`
  );
}

// ── Top-level HTML builder ──────────────────────────────────────────────────────

export function buildReadinessHtml(readiness, { mode = 'readiness' } = {}) {
  const r = readiness || {};
  const isExport = mode === 'export';

  const parts = [
    renderCover(r, mode),
    disclaimerStrip(r),
    // Coverage manifest is ALWAYS at the top, in both modes.
    renderCoverageManifest(r),
  ];

  if (!isExport) {
    // Readiness mode: RAG-led banner + aggregated "what to fix".
    parts.push(renderReadinessBanner(r));
    parts.push(renderWhatToFix(r));
  }

  parts.push(renderQualityStatements(r, mode));
  parts.push(renderDelta(r));

  if (isExport) parts.push(renderSignoff());

  parts.push(disclaimerFooter(r));

  const cls = isExport ? 'cqc-surface cqc-surface-export' : 'cqc-surface cqc-surface-readiness';
  return `<div class="${cls}">${parts.filter(Boolean).join('')}</div>`;
}

// ── CSV export ──────────────────────────────────────────────────────────────────
// Mirrors report-render.buildReportCsv: { suffix, sections:[{title,header,rows}] }.
// No patient data — currency, coverage and matched terms only.
export function buildReadinessCsv(readiness) {
  const r = readiness || {};
  const suffix = (r.generatedAt ? String(r.generatedAt).slice(0, 10) : '') || 'cqc-readiness';
  const sections = [];

  // ── Section 1: Rule currency ──────────────────────────────────────────────
  const files = Array.isArray(r.currency?.files) ? r.currency.files : [];
  if (files.length) {
    sections.push({
      title: 'Rule currency',
      header: ['file', 'lastUpdated', 'ageDays', 'level'],
      rows: files.map((f) => [f.id ?? '', f.lastUpdated ?? '', f.ageDays ?? '', f.level ?? '']),
    });
  }

  // ── Section 2: Coverage ───────────────────────────────────────────────────
  const cov = r.coverage || {};
  const covRows = [];
  if (cov.drug) {
    covRows.push([
      'drug',
      cov.drug.specVersion ?? cov.drug.schemaVersion ?? '',
      cov.drug.lastUpdated ?? '',
      cov.drug.ruleCount ?? '',
    ]);
  }
  if (cov.qof) {
    covRows.push(['qof', '', cov.qof.lastUpdated ?? '', cov.qof.indicatorCount ?? '']);
  }
  if (cov.vaccine) {
    covRows.push(['vaccine', '', cov.vaccine.lastUpdated ?? '', cov.vaccine.ruleCount ?? '']);
  }
  if (cov.alert) {
    covRows.push(['alert', '', cov.alert.lastUpdated ?? '', cov.alert.ruleCount ?? '']);
  }
  if (covRows.length) {
    sections.push({
      title: 'Coverage',
      header: ['ruleset', 'version', 'lastUpdated', 'ruleCount'],
      rows: covRows,
    });
  }

  // ── Section 3: Matched drug terms ─────────────────────────────────────────
  const terms = Array.isArray(cov.matchedTerms) ? cov.matchedTerms.filter((t) => t != null && t !== '') : [];
  if (terms.length) {
    sections.push({
      title: 'Matched drug terms',
      header: ['term'],
      rows: terms.map((t) => [t]),
    });
  }

  return { suffix, sections };
}
