// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Today module: "What needs you now" headline (pure logic)
//
// Why this exists: the Today tab already polls waiting room, triage load,
// demand and sweep state (today.js) but never rolls it up into a single
// plain-English sentence — a clinician has to read six cards to answer
// "what needs me right now?" (G1 blocker, both whole-suite appraisals).
//
// This module is the pure, side-effect-free headline builder: given the SAME
// data today.js already holds in memory (_wrData, _rmData, _demandData,
// _sweepData), it returns one sentence plus a severity for styling. No new
// fetches, no chrome.* calls, no DOM — everything here is Node-testable
// (see test-today-headline.js) and directly importable by today.js.
//
// Ordering contract (red leads, then amber, then quiet):
//   1. Waiting room red (max wait ≥ red threshold, default 20m)
//   2. Waiting room amber (max wait ≥ amber threshold, default 10m)
//   3. Demand red (medical or admin over its red threshold)
//   4. Demand amber (medical or admin over its amber threshold)
//   5. Slots alert-rule breach — red (a type at zero) or amber (at/below threshold)
//   6. Oldest unanswered triage request, if any is tracked
//   7. Sweep not run today
//   8. Quiet — "Nothing needs you right now — last checked HH:MM"
// Within a severity tier, clauses are pushed in the order above (stable sort),
// so e.g. a red waiting-room clause always leads a red slots-breach clause.
// Each clause after the lead clause is appended (", " joined) up to a max of
// three clauses, so the sentence stays scannable rather than becoming a full
// re-statement of every card.

'use strict';

const MAX_CLAUSES = 3;

// Format an epoch-ms wait as "Nm" for the headline (today.js's fmtAge covers
// the age-of-request case elsewhere; this is deliberately simpler — the
// headline only ever needs minutes-waiting for the hero patient).
function pluralPatients(n) {
  return n === 1 ? 'patient' : 'patients';
}

function pluralRequests(n) {
  return n === 1 ? 'request' : 'requests';
}

// Build the waiting-room clause + its severity, or null if the room is clear
// or the data hasn't loaded / errored.
function waitingClause(wrData) {
  if (!wrData || wrData.error || wrData.noCode) return null;
  const patients = Array.isArray(wrData.patients) ? wrData.patients : [];
  if (patients.length === 0) return null;
  const maxWait = Math.max(...patients.map((p) => p.mins ?? 0));
  const severity = maxWait >= 20 ? 'red' : maxWait >= 10 ? 'amber' : null;
  if (!severity) return null;
  const waitPart = maxWait > 0 ? ` (longest ${maxWait} min)` : '';
  return {
    severity,
    text: `${patients.length} ${pluralPatients(patients.length)} waiting${waitPart}`,
  };
}

// Build the demand clause (medical + admin combined into one clause when
// either is over threshold) + its severity, or null if neither stream is
// configured/over threshold.
function demandClause(demandData) {
  if (!demandData || demandData.noCode) return null;
  const { medical, admin, thresholds } = demandData;
  const DEFAULTS = {
    medical: { amber: 30, red: 60, enabled: false },
    admin: { amber: 20, red: 40, enabled: false },
  };

  function level(key, val) {
    if (val == null) return null;
    const t = { ...DEFAULTS[key], ...((thresholds && thresholds[key]) || {}) };
    if (!t.enabled) return null;
    if (val >= (t.red || Infinity)) return 'red';
    if (val >= (t.amber || Infinity)) return 'amber';
    return null;
  }

  const medLevel = level('medical', medical);
  const admLevel = level('admin', admin);
  if (!medLevel && !admLevel) return null;

  const severity = medLevel === 'red' || admLevel === 'red' ? 'red' : 'amber';

  // Internal separator is a comma, never " · " — that token is reserved for
  // joining top-level clauses (see buildHeadline), so a two-stream demand
  // clause must not be mistaken for two separate clauses when split on it.
  const parts = [];
  if (medLevel) parts.push(`${medical} medical`);
  if (admLevel) parts.push(`${admin} admin`);
  return {
    severity,
    text: `${parts.join(', ')} ${parts.length === 1 && admLevel && !medLevel ? 'request' : 'requests'} unread`,
  };
}

// Build the slots-breach clause (item 9), or null if no alert rule is
// currently breached / the data hasn't loaded. Mirrors the Slots tab's own
// amber/red convention: red when a type has hit zero, amber when it's at/
// below threshold but not yet zero. Names ONLY the worst-hit type (the
// headline is a single sentence, not a re-statement of the Slots ribbon —
// the full breach list is already visible on the Slots Today card itself).
function slotsClause(slotsData) {
  if (!slotsData || slotsData.noCode || slotsData.error) return null;
  const breaches = Array.isArray(slotsData.breaches) ? slotsData.breaches : [];
  if (breaches.length === 0) return null;
  const worst = breaches[0]; // buildBreaches() already sorts red-first, most-depleted first
  const severity = worst.level === 'red' ? 'red' : 'amber';
  const extra = breaches.length > 1 ? ` (+${breaches.length - 1} more)` : '';
  const text =
    worst.count === 0
      ? `no ${worst.typeName} slots left${extra}`
      : `${worst.typeName} down to ${worst.count} slot${worst.count === 1 ? '' : 's'}${extra}`;
  return { severity, text };
}

// Build the oldest-unanswered-triage clause, or null if RM isn't configured,
// errored, or nothing is tracked as unanswered. Mirrors today.js's own
// oldestUnanswered() logic but takes the already-computed oldest timestamp
// rather than re-deriving it, so today.js supplies bucket-shape knowledge
// (window.RequestMonitor.BUCKETS) and this module stays free of globals.
function triageClause(rmData, oldestUnansweredMs, now) {
  if (!rmData || !rmData.configured || rmData.error) return null;
  if (oldestUnansweredMs == null) return null;
  const mins = Math.max(0, Math.round((now - oldestUnansweredMs) / 60000));
  const ageText = mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
  // Triage age is informational, not a red/amber alert in its own right here —
  // the RM strip/card already carries its own severity treatment. Keep this
  // clause neutral (no severity) so it never outranks a genuine red/amber.
  return { severity: null, text: `oldest unanswered request waiting ${ageText}` };
}

// Build the sweep clause. "Not run today" is neutral-but-actionable (not a
// clinical alert — never red/amber) so it can only ever be the trailing
// clause, never override a genuine red/amber lead.
function sweepClause(sweepData) {
  if (!sweepData) return null;
  if (sweepData.lastRun) return null; // ran today — nothing to prompt
  return { severity: null, text: 'sweep not run today' };
}

// Format the quiet-state timestamp using the shared provenance canon so the
// wording matches every other "as at HH:MM" surface in the suite.
function quietText(nowMs, formatProvenanceFn) {
  if (typeof formatProvenanceFn === 'function') {
    const stamp = formatProvenanceFn({ asOf: nowMs });
    if (stamp) return `Nothing needs you right now — last checked ${stamp.replace(/^as at\s*/, '')}`;
  }
  // Fallback formatting (no Provenance helper supplied — keep the same shape).
  const d = new Date(nowMs);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `Nothing needs you right now — last checked ${hh}:${mm}`;
}

// ── Public API ───────────────────────────────────────────────────────────────
//
// buildHeadline({ wrData, rmData, demandData, slotsData, sweepData, oldestUnansweredMs, now, formatProvenance })
//   → { text: string, severity: 'red'|'amber'|null }
//
// All inputs optional/nullable — a still-loading card (data === null) simply
// contributes nothing, so the headline degrades gracefully while cards are
// still fetching rather than showing a false "all quiet".
export function buildHeadline({
  wrData = null,
  rmData = null,
  demandData = null,
  slotsData = null,
  sweepData = null,
  oldestUnansweredMs = null,
  now = Date.now(),
  formatProvenance = null,
} = {}) {
  const candidates = [
    waitingClause(wrData),
    demandClause(demandData),
    slotsClause(slotsData),
    triageClause(rmData, oldestUnansweredMs, now),
    sweepClause(sweepData),
  ].filter(Boolean);

  // Red leads, then amber, then neutral — stable within each tier (the order
  // clauses were pushed above: waiting, demand, slots, triage, sweep).
  const rank = { red: 0, amber: 1, null: 2 };
  candidates.sort((a, b) => rank[a.severity] - rank[b.severity]);

  if (candidates.length === 0) {
    return { text: quietText(now, formatProvenance), severity: null };
  }

  const chosen = candidates.slice(0, MAX_CLAUSES);
  const leadSeverity = chosen[0].severity;
  const text = chosen.map((c) => c.text).join(' · ');

  return { text: capitalise(text), severity: leadSeverity };
}

function capitalise(s) {
  return typeof s === 'string' && s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// Exported for tests / reuse — not called internally beyond buildHeadline.
export { waitingClause, demandClause, slotsClause, triageClause, sweepClause, pluralPatients, pluralRequests };
