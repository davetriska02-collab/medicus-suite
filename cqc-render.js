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
// Map developer-facing source identifiers (file paths, function names, schema/spec
// tags) to plain English. The panel's partner/GP read "source: rules/drug-rules.json"
// and "assessRuleCurrency over rules/*.json" as leaked plumbing on an inspector page.
function humaniseSource(s) {
  let t = String(s || '').trim();
  if (!t) return '';
  // Strip a trailing "(specVersion …)" / "(schema …)" parenthetical.
  t = t.replace(/\s*\((?:spec|schema)[^)]*\)\s*$/i, '').trim();
  const MAP = [
    [/rules\/drug-rules\.json/i, 'Sentinel drug-monitoring rules'],
    [/rules\/qof-rules\.json/i, 'QOF indicator rules'],
    [/rules\/vaccine-rules\.json/i, 'vaccine surveillance rules'],
    [/rules\/alert-library\.json/i, 'prescribing-safety alert library'],
    [/shared\/rule-currency\.js.*$/i, 'rule-currency check'],
    [/engine\/[\w-]+\.js/gi, 'the suite engine'],
  ];
  for (const [re, label] of MAP) t = t.replace(re, label);
  // Drop any residual bare file path / code token.
  t = t.replace(/\b[\w/.-]+\.(?:js|json)\b/gi, '').replace(/\s{2,}/g, ' ').replace(/\(\s*\)/g, '').trim();
  return t.replace(/[·,;\s]+$/, '').trim();
}

export function provenanceLine(provenance) {
  const p = provenance || {};
  const parts = [];
  if (p.denominator) parts.push(esc(p.denominator));
  if (p.asAt) parts.push(`as at ${esc(p.asAt)}`);
  const src = humaniseSource(p.source);
  if (src) parts.push(`source: ${esc(src)}`);
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

// Plain-English headline verdict — the FIRST thing on the page in both modes
// (the panel's universal ask: "tell me the answer before the detail"). Leads with
// the RAG WORD, an honest one-line summary with a count, a legend so a reader sees
// what amber/red mean even on an all-green run, and a "how to use this page" line
// that points at the reconciliation worksheet. Framed as MONITORING-SYSTEM
// readiness, never "the practice is compliant".
function renderHeadlineVerdict(readiness, mode) {
  const overall = String(readiness.currency?.overall || 'na').toLowerCase();
  const files = Array.isArray(readiness.currency?.files) ? readiness.currency.files : [];
  const total = files.length;
  const attention = files.filter((f) => {
    const l = String(f.level || '').toLowerCase();
    return l === 'amber' || l === 'red';
  }).length;

  const plain =
    overall === 'green'
      ? `All ${total || ''} safety rule set${total === 1 ? '' : 's'} are current.`.replace('  ', ' ')
      : overall === 'amber'
        ? `${attention} of ${total} rule set${total === 1 ? '' : 's'} need${attention === 1 ? 's' : ''} review soon.`
        : overall === 'red'
          ? `${attention} of ${total} rule set${total === 1 ? '' : 's'} ${attention === 1 ? 'is' : 'are'} out of date.`
          : 'Readiness could not be rated from the available data.';

  // The internal action verb is readiness-mode only — dropped from the inspector export.
  const verb =
    mode === 'export'
      ? ''
      : overall === 'green'
        ? ' Keep the rule sets current.'
        : overall === 'amber'
          ? ' Address the items below before CQC arrives.'
          : overall === 'red'
            ? ' Act on the items below now.'
            : '';

  const asAt = readiness.generatedAt
    ? ` <span class="cqc-verdict-asat">as at ${esc(readiness.generatedAt)}</span>`
    : '';

  const legend =
    `<p class="cqc-rag-legend"><span class="cqc-rag-legend-label">What the ratings mean:</span> ` +
    `${ragBadge('green')} current &middot; ${ragBadge('amber')} review soon &middot; ${ragBadge('red')} out of date</p>`;

  // Separate "rules current" from "patients monitored" — the panel's sharpest
  // clinical-safety point: a green here must never be misread as "every patient
  // has been monitored". State the boundary in the verdict itself.
  const meaning =
    `<p class="cqc-verdict-means">This rates the monitoring <strong>system</strong>: whether the practice's ` +
    `clinical-safety rules are current. It does <strong>not</strong> confirm that any individual patient has ` +
    `been monitored &mdash; use the Reconciliation worksheet below for patient-level checks.</p>`;

  const howTo =
    `<p class="cqc-verdict-howto"><strong>How to use this page.</strong> Read the rating, run the searches in the ` +
    `<em>Reconciliation worksheet</em> below to fill in your own patient numbers, then use <em>Print / PDF</em> for ` +
    `your evidence folder. Supporting evidence for the Safe and Well-led key questions &mdash; <strong>not</strong> ` +
    `proof of compliance.</p>`;

  return (
    `<section class="cqc-card cqc-verdict cqc-verdict-${esc(overall)}">` +
    `<div class="cqc-verdict-head">` +
    `<span class="cqc-verdict-label">Monitoring-system readiness</span>${ragBadge(overall)}${asAt}` +
    `</div>` +
    `<p class="cqc-verdict-plain">${esc(plain)}${esc(verb)}</p>` +
    legend +
    meaning +
    howTo +
    `</section>`
  );
}

// Aggregate every qualityStatement.toFix into one "what to fix before CQC" list.
// Readiness mode only — dropped entirely in export.
function renderWhatToFix(readiness) {
  const stmts = Array.isArray(readiness.qualityStatements) ? readiness.qualityStatements : [];
  const items = [];
  for (const qs of stmts) {
    // toFix is a string (or null) from the engine; tolerate an array too. NEVER
    // iterate a bare string with for..of — that explodes it into one bullet per char.
    const fixes = Array.isArray(qs.toFix) ? qs.toFix : qs.toFix ? [qs.toFix] : [];
    for (const fix of fixes) {
      if (fix) items.push({ area: qs.qualityStatement || qs.title || qs.keyQuestion || '', fix });
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

// Rule-file spec/version fields carry long developer/governance provenance notes
// (e.g. "...applied this run without page-verification due to WebFetch 403"). Those
// are for maintainers, never for an inspector-facing page — show only a clean
// leading label and hard-stop on any residual code/HTTP noise. (The panel flagged
// "WebFetch 403", "schema 2" and "CQC-P0-COHORT-SPIKE" leaking into the document.)
function cleanSpec(s) {
  let t = String(s || '').trim();
  if (!t) return '';
  // Drop parenthetical notes and anything after a dash/em-dash — the dev log tail.
  t = t.replace(/\s*[([].*$/s, '').replace(/\s+[—–-]\s.*$/s, '').trim();
  // Hard stop on any residual HTTP-status / fetch noise.
  if (/\bhttp|webfetch|\b\d{3}\b/i.test(t)) t = t.split(/[,;:]/)[0].trim();
  return t.length > 56 ? `${t.slice(0, 53).trim()}…` : t;
}

function renderRulesetTile(label, rs) {
  if (!rs) return '';
  const subParts = [];
  // schemaVersion ("schema 2") is pure plumbing — dropped from the user-facing tile.
  const spec = cleanSpec(rs.specVersion);
  if (spec) subParts.push(`spec ${spec}`);
  if (rs.lastUpdated) subParts.push(`reviewed ${rs.lastUpdated}`);
  const count =
    rs.ruleCount != null
      ? `${rs.ruleCount} rule${rs.ruleCount === 1 ? '' : 's'}`
      : rs.indicatorCount != null
        ? `${rs.indicatorCount} indicator${rs.indicatorCount === 1 ? '' : 's'}`
        : '—';
  return statTile(label, count, subParts.join(' · '));
}

// The matched-term list is long (every coded drug string the tool recognises). It
// was rendered inline at the TOP and became a multi-screen wall that buried the
// verdict (the panel's #1 friction). Collapse it into a counted <details> so the
// count stays visible but the wall is one click away. Opened by default in export
// mode so the inspector PDF still prints the full list; a print rule also force-
// expands it for any open-state edge case.
function renderMatchedTerms(terms, mode) {
  const list = Array.isArray(terms) ? terms.filter((t) => t != null && t !== '') : [];
  if (!list.length) {
    return (
      `<div class="cqc-matched"><h3>Matched drug terms</h3>` +
      `<p class="cqc-note">No matched terms reported.</p></div>`
    );
  }
  // Collapsed on screen in BOTH modes (an always-open export read as "a wall the
  // length of a bus"); a beforeprint handler force-opens all <details> so the
  // printed inspector pack still carries the full list.
  const chips = list.map((t) => `<li class="cqc-term">${esc(t)}</li>`).join('');
  return (
    `<details class="cqc-matched">` +
    `<summary class="cqc-matched-summary">Matched drug names &mdash; ${list.length} term${list.length === 1 ? '' : 's'} <span class="cqc-matched-hint">(expand to check for missing brands or slow-release forms)</span></summary>` +
    `<p class="cqc-note">The full alphabetical list the tool matches. For the same coverage <strong>grouped per drug</strong> (easier to scan), see the Reconciliation worksheet below.</p>` +
    `<ul class="cqc-term-list">${chips}</ul></details>`
  );
}

function renderCoverageManifest(readiness, mode) {
  const cov = readiness.coverage || {};
  const qof = cov.qof || {};
  const qofSub = [];
  if (qof.lastUpdated) qofSub.push(`reviewed ${qof.lastUpdated}`);
  if (qof.safetyMonitoringCount != null) qofSub.push(`${qof.safetyMonitoringCount} safety-monitoring`);

  const tiles = [
    renderRulesetTile('Drug monitoring', cov.drug),
    qof.indicatorCount != null ? statTile('QOF', `${qof.indicatorCount} indicators`, qofSub.join(' · ')) : '',
    // Labelled "surveillance" so the count is not read as drug-monitoring safety coverage (Raj).
    renderRulesetTile('Vaccines (surveillance)', cov.vaccine),
    renderRulesetTile('Alerts', cov.alert),
  ]
    .filter(Boolean)
    .join('');

  // F1: prominent, honestly-worded "last reviewed against guidance" line — the panel's
  // top ask. The date is the drug-rule lastUpdated (its sourceNotes cite BNF/NICE/MHRA);
  // "reviewed", not "updated" — clinically verified, not merely edited (Eileen).
  const reviewedDate = cov.drug?.lastUpdated || null;
  const reviewedLine = reviewedDate
    ? `<p class="cqc-reviewed"><strong>Safety rules last reviewed against BNF / NICE / MHRA: ${esc(reviewedDate)}</strong>` +
      (cov.keeperProvenance ? ` — via The Keeper` : '') +
      `. See each rule set's version below.</p>`
    : '';

  // F3: these are RULE/indicator counts (the monitoring system in use), not patient counts.
  const systemNote =
    `<p class="cqc-note">These are the rule sets the practice runs — counts are rules and indicators, ` +
    `<strong>not patient numbers</strong>. Patient-level figures are a later phase.</p>`;

  // A5/F4: ONE prominent coded-data/undercount callout — counts are a floor, not a
  // ceiling. Previously this stacked codedLine + undercountCaveat, which restated
  // "coded data only" twice in the same box and read as the page hedging (Margaret).
  // Prefer the fuller undercount caveat; fall back to the short coded-data line.
  const undercount = cov.undercountCaveat
    ? esc(cov.undercountCaveat) // self-contained — already opens "Counts are derived from coded data only…"
    : cov.codedDataOnly
      ? `<strong>Coded data only.</strong> Results filed as scanned letters or free text are not counted; treat figures as a floor, not a ceiling.`
      : '';
  const callout = undercount ? `<p class="cqc-callout" role="note">${undercount}</p>` : '';
  const keeper = cov.keeperProvenance ? `<p class="cqc-note cqc-keeper">${esc(cov.keeperProvenance)}</p>` : '';

  return (
    `<section class="cqc-card cqc-card-manifest"><h2>Coverage manifest</h2>` +
    reviewedLine +
    `<p class="cqc-note">What this readiness check covers — rule sets, versions and dates — so completeness can be judged before any figure is trusted.</p>` +
    systemNote +
    `<div class="cqc-grid cqc-grid-4">${tiles}</div>` +
    renderMatchedTerms(cov.drug && cov.drug.matchedTerms, mode) +
    callout +
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

// Per-file rule-currency table (the Well-led statement's actual evidence — dates,
// age and currency message per rule file). Dropped before; now surfaced.
function renderCurrencyFiles(files) {
  const list = Array.isArray(files) ? files : [];
  if (!list.length) return '';
  const rows = list
    .map(
      (f) =>
        `<tr><td>${esc(f.id || '')}</td><td>${esc(f.lastUpdated || '—')}</td>` +
        `<td>${f.ageDays != null ? esc(f.ageDays) + 'd' : '—'}</td><td>${ragBadge(f.level)}</td>` +
        `<td>${esc(f.message || '')}</td></tr>`
    )
    .join('');
  return (
    `<table class="cqc-table"><thead><tr><th>Rule file</th><th>Last reviewed</th>` +
    `<th>Age</th><th>Currency</th><th>Message</th></tr></thead><tbody>${rows}</tbody></table>`
  );
}

function renderQualityStatement(qs, mode) {
  // Engine emits `qualityStatement` (title), `summary`, statement-level `provenance`,
  // optional `metrics`/`currencyFiles`, and a STRING `toFix`. Earlier this read `qs.title`
  // + `qs.items[]` (neither emitted), so cards showed only the key question + "no items".
  const title = qs.qualityStatement || qs.title || qs.keyQuestion || '';
  const subhead = [qs.keyQuestion, title].filter(Boolean).map(esc).join(' · ');
  const cat = qs.evidenceCategory ? `<span class="cqc-cat-tag">${esc(qs.evidenceCategory)}</span>` : '';

  const summary = qs.summary ? `<p class="cqc-qs-summary">${esc(qs.summary)}</p>` : '';
  // A1: statement-level provenance as inline prose (the figure's source/as-at).
  const prov = provenanceLine(qs.provenance);
  const provHtml = prov ? `<div class="cqc-item-prov">${prov}</div>` : '';
  // Backward-compatible explicit items[], plus the per-file currency table where present.
  const items = Array.isArray(qs.items) ? qs.items : [];
  const itemsHtml = items.length ? `<ul class="cqc-item-list">${items.map(renderItem).join('')}</ul>` : '';
  const currencyHtml = renderCurrencyFiles(qs.currencyFiles);

  const wgll = qs.whatGoodLooksLike
    ? `<div class="cqc-wgll"><h3>What good looks like</h3><p>${esc(qs.whatGoodLooksLike)}</p></div>`
    : '';

  // Export drops the internal action list. toFix is a string (or array) from the engine.
  const fixes = Array.isArray(qs.toFix) ? qs.toFix : qs.toFix ? [qs.toFix] : [];
  const toFix =
    mode !== 'export' && fixes.length
      ? `<div class="cqc-tofix"><h3>To fix</h3><ul>${fixes.map((f) => `<li>${esc(f)}</li>`).join('')}</ul></div>`
      : '';

  return (
    `<section class="cqc-card cqc-qs" data-key="${esc(qs.key || '')}">` +
    `<div class="cqc-qs-head">` +
    `<h2>${subhead}</h2>` +
    // Label the badge "System currency" so a green is read as "the rule is current",
    // never as a pass/fail of the practice (the manager's misread-as-a-scorecard risk).
    `<div class="cqc-qs-tags">${cat}<span class="cqc-qs-ragcontext">System currency:</span>${ragBadge(qs.rag)}</div>` +
    `</div>` +
    summary +
    provHtml +
    itemsHtml +
    currencyHtml +
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
  // Plain-English gloss for CQC's key-question jargon — the technophobe floor could
  // not say what "Safe"/"Well-led"/"Processes" meant. One line per key question.
  const KQ_GLOSS = {
    Safe: 'CQC key question. The evidence below shows the safety systems the practice runs (it is "Processes" evidence, not patient outcomes).',
    'Well-led':
      'CQC key question. The evidence below shows how the practice keeps its clinical-safety rules current and governed.',
    Effective: 'CQC key question. The evidence below shows the clinical rule sets the practice has in use.',
  };
  const blocks = [];
  for (const [kq, list] of groups) {
    const cards = list.map((qs) => renderQualityStatement(qs, mode)).join('');
    const gloss = KQ_GLOSS[kq] ? `<p class="cqc-keyq-note">${esc(KQ_GLOSS[kq])}</p>` : '';
    blocks.push(
      `<div class="cqc-keyq" data-keyq="${esc(kq)}">` +
        `<h2 class="cqc-keyq-head">Key question: ${esc(kq)}</h2>${gloss}${cards}</div>`
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
    `<div class="cqc-signoff-grid">${field('Prepared by (Practice Manager)')}${field('Reviewed by (Responsible GP)')}${field('Date')}</div>` +
    `</section>`
  );
}

// ── Reconciliation hook (both modes) ────────────────────────────────────────────
//
// Renders the "run these in Medicus to get the numbers" section: a table of drug →
// cohort definition → a blank "your count: ____" column for the practice to fill.
//
// Honest framing invariants (clinical-safety requirement):
//   - Section heading makes explicit this is the definition, not a count.
//   - A prominent notice states the suite cannot enumerate patients read-only.
//   - The coded-data caveat is repeated (A5) — counts from Medicus search are also
//     coded-data-only; the suite's caveat applies to any figure the practice records.
//   - There is NO numeric patient count anywhere in this section.

function renderReconciliation(readiness, mode) {
  const recon = readiness.reconciliation;
  if (!recon || !Array.isArray(recon.entries) || !recon.entries.length) return '';

  const entries = recon.entries;

  // Prominent honest-framing callout — the whole point of this section. The blank
  // "your count" cells are DELIBERATE: the suite cannot count patients read-only, so
  // it supplies the reproducible definition and the practice supplies the number.
  // Say so explicitly, so an exported pack with empty cells is never misread as
  // "nothing to report" (the manager/partner recoiled at "unfinished homework").
  const honestFraming =
    `<div class="cqc-recon-notice" role="note">` +
    `<strong>This is a worksheet — the blank "your count" cells are filled in by you, not the suite.</strong> ` +
    `The Medicus Suite cannot count patients read-only (a true population query is not reachable via the API ` +
    `available to this extension; this is a deliberate safety boundary, not a fault). Run each query below in ` +
    `Medicus's own search or QOF reporting tool, enter the count you get, and attach the completed page to your ` +
    `evidence pack.` +
    `</div>`;

  const caveat = recon.caveat
    ? `<p class="cqc-callout" role="note"><strong>Coded data only.</strong> ${esc(recon.caveat)}</p>`
    : '';

  // One row per drug-monitoring rule.
  const rows = entries
    .map(
      (e) =>
        `<tr>` +
        `<td class="cqc-recon-drug"><strong>${esc(e.drugName)}</strong>` +
        (e.drugClass ? `<br><span class="cqc-recon-class">${esc(e.drugClass)}</span>` : '') +
        `</td>` +
        `<td class="cqc-recon-defn">${esc(e.definition)}</td>` +
        `<td class="cqc-recon-terms"><span class="cqc-recon-terms-label">Coded terms:</span> ` +
        `${e.matchTerms.map((t) => `<span class="cqc-term">${esc(t)}</span>`).join(' ')}` +
        // Disclose excludes inline — a pharmacist must see what is silently dropped.
        (Array.isArray(e.excludeTerms) && e.excludeTerms.length
          ? `<div class="cqc-recon-excl"><span class="cqc-recon-excl-label">Excluded (dropped):</span> ` +
            `${e.excludeTerms.map((t) => `<span class="cqc-term cqc-term-excl">${esc(t)}</span>`).join(' ')}</div>`
          : '') +
        `</td>` +
        `<td class="cqc-recon-count"><span class="cqc-recon-blank">your count: ____</span></td>` +
        `</tr>`
    )
    .join('');

  const table =
    `<table class="cqc-table cqc-recon-table">` +
    `<thead><tr>` +
    `<th>Drug / class</th>` +
    `<th>Cohort definition (run this in Medicus)</th>` +
    `<th>Coded terms covered</th>` +
    `<th>Your count</th>` +
    `</tr></thead>` +
    `<tbody>${rows}</tbody>` +
    `</table>`;

  // The full table is long; collapse it so the Safe/Well-led evidence above stays
  // the focus. Opened in export mode (and force-opened in print) so the worksheet
  // still appears in the inspector pack.
  const collapsibleTable =
    `<details class="cqc-recon-details">` +
    `<summary class="cqc-recon-summary">Worksheet &mdash; ${entries.length} cohort definition${entries.length === 1 ? '' : 's'} to run in Medicus <span class="cqc-matched-hint">(expand to complete)</span></summary>` +
    table +
    `</details>`;

  return (
    `<section class="cqc-card cqc-card-recon">` +
    `<h2>Reconciliation worksheet — counts to complete in Medicus</h2>` +
    `<p class="cqc-note">` +
    `For each high-risk monitored drug the suite covers, the worksheet below gives a reproducible ` +
    `cohort definition. Run it in Medicus's own search or QOF tool, note the count in the ` +
    `"Your count" column, and use the completed table as supporting evidence for your CQC pack. ` +
    `The suite provides the rigour (the definition + coverage caveat); your validated clinical ` +
    `system provides the number.` +
    `</p>` +
    honestFraming +
    caveat +
    collapsibleTable +
    `<p class="cqc-note cqc-recon-foot">` +
    `Definitions are derived deterministically from the suite's active drug-monitoring rules. ` +
    `If a rule is disabled in Options it will not appear here. The "coded terms" column lists ` +
    `every drug name the rule matches — check it for gaps (e.g. a missing slow-release brand).` +
    `</p>` +
    // Eileen: an exclude with no reason sends a nurse to the phone. Explain WHY excludes
    // exist and prompt the safety check, since a per-exclude reason is not in the data.
    `<p class="cqc-note cqc-recon-foot">` +
    `<strong class="cqc-recon-excl-label">Excluded (dropped)</strong> terms are deliberate suppressions of known ` +
    `false-positives (typically a different formulation or an unrelated drug sharing a name fragment). They are ` +
    `listed so you can sense-check each one: if an exclude could drop a real patient who <em>needs</em> this ` +
    `monitoring, raise it — an over-broad exclude is a silent gap.` +
    `</p>` +
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
    // Lead with the answer: the plain-English verdict is FIRST in both modes.
    renderHeadlineVerdict(r, mode),
    // Coverage manifest (concise — the long matched-term list is now collapsed).
    renderCoverageManifest(r, mode),
  ];

  if (!isExport) {
    // Readiness mode: aggregated "what to fix" (the verdict already carries the RAG).
    parts.push(renderWhatToFix(r));
  }

  // Safe/Well-led summaries lead the evidence; the reconciliation WORKSHEET follows
  // (collapsed). Promoting the worksheet above the summaries made a table of blank
  // "your count" boxes the centrepiece and read as "unfinished homework" to the
  // manager/partner — so it sits after the actual evidence, clearly framed as a
  // worksheet to complete, not a result.
  parts.push(renderQualityStatements(r, mode));
  parts.push(renderReconciliation(r, mode));
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

  // ── Section 3: Matched drug terms (engine puts these at coverage.drug.matchedTerms)
  const allTerms = cov.drug && Array.isArray(cov.drug.matchedTerms) ? cov.drug.matchedTerms : [];
  const terms = allTerms.filter((t) => t != null && t !== '');
  if (terms.length) {
    sections.push({
      title: 'Matched drug terms',
      header: ['term'],
      rows: terms.map((t) => [t]),
    });
  }

  return { suffix, sections };
}
