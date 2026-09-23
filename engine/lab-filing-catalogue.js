// Medicus Suite — Lab Filing on the Lab Result Catalogue (Phase E, stage E0: pure adapter, UNWIRED).
//
// PURE: no DOM, no chrome.*, no fetch. Produces catalogue-driven BLOCKERS in the same shape the legacy
// shared/lab-filing-utils.js blocker functions already use (string[] reasons), so a future caller can concat them
// exactly the way content-scripts/triage-lens/lab-file-button.js already concats the legacy ones. This is the
// union-only contract (H-080 control a): nothing here can ever UNBLOCK something legacy blocks — it can only ADD
// blockers — until a separate CSO decision (E3) replaces the legacy gate outright.
//
// Recognition is BY SNOMED CODE (H-074 generalised): every result must resolve to a catalogue result via its own
// code, and belong to a lab report-group heading that has an ENABLED, APPROVED assisted-filing group entry
// (shared/lab-catalogue-overlay.js `filing.groups`). Anything short of that blocks every result under that
// heading, fail-closed — never a partial file of "the ones that did resolve".
//
// Input:
//   `report`    — the shape engine/normalisers.js normaliseInvestigationReport() produces: { lab, results[] },
//                 where each result carries name/value/rawValue/comparator/unit/code/low/high/isAbove/isBelow/
//                 urgent/text/specimen/history. `lab` and `code` are additive fields (added alongside this file);
//                 the legacy engine never reads either.
//   `catalogue` — the ACTING (approved-only) merged catalogue: OV.mergeCatalogue(builtin, overlay, {}).catalogue.
//                 `catalogue.filing` is absent when nothing has been approved yet — every result then falls
//                 through to "no approved assisted-filing setup", which is the correct fail-closed answer.
//   `opts`      — { meds: string[]|{name}[], extraText: string } — same shapes lab-filing-utils.js already takes.
//
// Output: { ok: true, blockers: string[], reasonKinds: string[], meta: {...} } or { ok: false, error: string } —
// NEVER throws; a caller falls back to legacy alone on ok:false, exactly as engine/outstanding-match-catalogue.js's
// fail-safe contract (Phase D). `blockers` are human-readable and MAY embed this patient's value (e.g. "77 u/L is
// above your maximum of 130") — fine for the confirm dialog, NOT fine for a log. `reasonKinds` is the value-free
// twin (engine/lab-filing-gate.js's shadow log uses this one; see its own header for why).
//
// Run tests: node test-lab-filing-catalogue.js

(function (global) {
  'use strict';

  const LC =
    typeof module !== 'undefined' && module.exports ? require('../shared/lab-catalogue-core.js') : global.LabCatalogue;
  const LFU =
    typeof module !== 'undefined' && module.exports ? require('../shared/lab-filing-utils.js') : global.LabFilingUtils;

  const isStr = (v) => typeof v === 'string';
  const asArr = (v) => (Array.isArray(v) ? v : []);

  // The acting catalogue's index, or null when there is nothing usable to match against. Mirrors
  // engine/outstanding-match-catalogue.js's buildActingIndex — same name, same fail-closed contract.
  function buildActingIndex(catalogue) {
    if (!catalogue || typeof catalogue !== 'object') return null;
    try {
      const v = LC.validateCatalogue(catalogue);
      if (v.errors.length) return null;
      return LC.buildIndex(catalogue);
    } catch (_) {
      return null;
    }
  }

  const normHeading = (h) => LC.norm(h || '');

  function findGroup(catalogue, labId, heading) {
    const groups = (catalogue.filing && catalogue.filing.groups) || [];
    const nh = normHeading(heading);
    return groups.find((g) => g.lab === labId && normHeading(g.heading) === nh) || null;
  }
  function findRange(catalogue, resultId, labId, code) {
    const ranges = (catalogue.filing && catalogue.filing.ranges) || [];
    return ranges.find((r) => r.result === resultId && r.lab === labId && r.code === code) || null;
  }
  function findGuard(catalogue, resultId, labId) {
    const guards = (catalogue.filing && catalogue.filing.guards) || [];
    return guards.find((g) => g.result === resultId && g.lab === labId) || null;
  }

  // Recognition + practice-range + trend for ONE result already known to sit under an enabled, approved group.
  // Returns { reasons: {text,kind}[], resultId: string|null, guard: object|null } — resultId/guard are null when
  // the result was never recognised (nothing further to key a guard or medicine check to). `kind` is a short,
  // value-free tag (see KINDS below) — `text` is the human-readable reason and may embed this patient's value.
  function resultBlockers(r, index, catalogue, labId) {
    const name = isStr(r.name) && r.name.trim() ? r.name.trim() : 'a result';
    if (!isStr(r.code) || !r.code) {
      return {
        reasons: [{ text: `${name} is not recognised by SNOMED code in the catalogue`, kind: 'unrecognised-code' }],
        resultId: null,
        guard: null,
      };
    }
    const hit = index.byCode.get(r.code);
    if (!hit) {
      return {
        reasons: [
          { text: `${name} (code ${r.code}) is not one of the catalogue's known results`, kind: 'unrecognised-code' },
        ],
        resultId: null,
        guard: null,
      };
    }
    const resultId = hit.resultId;
    const reasons = [];
    const range = findRange(catalogue, resultId, labId, r.code);
    const guard = findGuard(catalogue, resultId, labId);
    const val = Number(r.value);
    const comp = isStr(r.comparator) ? r.comparator.trim() : '';
    // Comparator-censored values fail closed at the bound, exactly as the legacy gate does (H-081 controls b/c):
    // ">47" against a maximum of 47 means the true value may exceed it.
    const compAbove = comp === '>' || comp === '≥' || comp === '>=';
    const compBelow = comp === '<' || comp === '≤' || comp === '<=';

    if (range && Number.isFinite(val) && LFU.unitsSafeToApply(range.unit, r.unit)) {
      const unitTxt = range.unit ? ' ' + range.unit : '';
      let outOfRange = false;
      if (range.low != null && (val < range.low || (compBelow && val <= range.low))) {
        reasons.push({
          text: `${name} (${r.rawValue != null ? r.rawValue : r.value}${unitTxt}) is below your practice minimum of ${range.low}`,
          kind: 'below-practice-range',
        });
        outOfRange = true;
      } else if (range.high != null && (val > range.high || (compAbove && val >= range.high))) {
        reasons.push({
          text: `${name} (${r.rawValue != null ? r.rawValue : r.value}${unitTxt}) is above your practice maximum of ${range.high}`,
          kind: 'above-practice-range',
        });
        outOfRange = true;
      }
      // Off by default (H-081 control d): a lab-flagged result stays blocked unless the practice has explicitly
      // said its own range overrides the lab's flag for this result at this lab.
      if (!outOfRange && (r.isAbove || r.isBelow) && !(guard && guard.overrideLabFlag === true)) {
        reasons.push({ text: `${name} is flagged by the lab as out of range`, kind: 'lab-flagged-abnormal' });
      }
    } else if (Number.isFinite(val)) {
      // No usable practice range (none set, or its unit doesn't positively agree with the report's) — fall back to
      // the lab's own reference range/flag. A numeric result with NEITHER a practice range NOR a lab reference
      // range is "unknown, cannot judge" and blocks (same doctrine as legacy's requireRangeForAll).
      if (r.low == null && r.high == null) {
        reasons.push({
          text: `${name} has no practice range and no lab reference range to judge by`,
          kind: 'no-range-to-judge',
        });
      } else if (r.isAbove || r.isBelow) {
        reasons.push({ text: `${name} is flagged by the lab as out of range`, kind: 'lab-flagged-abnormal' });
      }
    }

    if (guard && guard.trendMaxDeltaPct != null) {
      const t = LFU.analyteTrend(r);
      if (t && t.deltaPct != null && Math.abs(t.deltaPct) > guard.trendMaxDeltaPct) {
        const dir = guard.trendDirection || 'any';
        if (dir === 'any' || dir === t.dir) {
          reasons.push({
            text: `${name} has changed ${t.delta > 0 ? '+' : ''}${Math.round(t.deltaPct)}% since last (${t.prev} → ${r.value})`,
            kind: 'trend-exceeded',
          });
        }
      }
    }
    return { reasons, resultId, guard };
  }

  function ok(reasonPairs, meta) {
    return {
      ok: true,
      blockers: Array.from(new Set(reasonPairs.map((r) => r.text))),
      reasonKinds: Array.from(new Set(reasonPairs.map((r) => r.kind))),
      meta,
    };
  }

  function evaluateFilingCatalogue(report, catalogue, opts) {
    try {
      const o = opts || {};
      const emptyMeta = { labId: null, recognisedCount: 0, unrecognisedCount: 0, groupsUsed: [] };
      if (!report || !Array.isArray(report.results)) return ok([], emptyMeta);
      if (!catalogue || typeof catalogue !== 'object') return { ok: false, error: 'no catalogue' };
      const index = buildActingIndex(catalogue);
      if (!index) return { ok: false, error: 'catalogue failed validation' };

      const labInfo = report.lab && typeof report.lab === 'object' ? report.lab : {};
      if (!isStr(labInfo.organisation) || !labInfo.organisation) {
        return ok([{ text: 'could not identify which lab this report is from', kind: 'unrecognised-lab' }], emptyMeta);
      }
      const lab = LC.identifyLab(index, labInfo);
      if (!lab) {
        return ok([{ text: 'this lab is not yet set up in the catalogue', kind: 'lab-not-set-up' }], emptyMeta);
      }
      const labId = lab.def.id;

      // Group by report-group heading (normalised) — a report can span several headings under one File button.
      const byHeading = new Map(); // normHeading -> results[]
      const reasonPairs = [];
      for (const r of report.results) {
        if (!r || typeof r !== 'object') {
          reasonPairs.push({
            text: 'A result row could not be read at all — file this report by hand',
            kind: 'unreadable-row',
          });
          continue;
        }
        const nh = normHeading(r.specimen);
        if (!byHeading.has(nh)) byHeading.set(nh, []);
        byHeading.get(nh).push(r);
      }

      // "Never offer to file when the comment says…" — ONE practice-wide list (Nick, 2026-09-23: expected to be the
      // same whichever heading variant or lab sent the report), checked once across every result in the WHOLE
      // report plus any extra page text — not per heading, and not gated on any group being approved: a phrase
      // like "telephone result" blocks the task even if some of its groups are not otherwise set up for filing.
      const suppressList = (catalogue.filing && catalogue.filing.suppress && catalogue.filing.suppress[0]) || null;
      if (suppressList && asArr(suppressList.items).length) {
        LFU.textSuppressBlockers(
          { results: report.results },
          { suppressIfText: suppressList.items },
          o.extraText
        ).forEach((text) => reasonPairs.push({ text, kind: 'suppressed-text' }));
      }

      const groupsUsed = [];
      let recognisedCount = 0;
      let unrecognisedCount = 0;
      for (const results of byHeading.values()) {
        const headingLabel = results[0] && isStr(results[0].specimen) ? results[0].specimen : null;
        const group = headingLabel ? findGroup(catalogue, labId, headingLabel) : null;
        if (!group || group.enabled !== true) {
          unrecognisedCount += results.length;
          reasonPairs.push({
            text: headingLabel
              ? `‘${headingLabel}’ has no approved assisted-filing setup at ${lab.def.name}`
              : 'a result with no report-group heading cannot be matched to an approved assisted-filing group',
            kind: headingLabel ? 'group-not-approved' : 'no-heading',
          });
          continue; // the whole group is blocked — no point evaluating individual results under it
        }
        groupsUsed.push(headingLabel);
        // Whitelisted comments are per lab x heading — the exact wording is the lab's own and genuinely differs.
        const pseudo = { allowComments: group.allowComments };
        LFU.unresolvedCommentedResults({ results }, pseudo).forEach((u) =>
          reasonPairs.push({
            text: `${u.name} carries a comment that isn't on the allowed list (“${u.residue}”)`,
            kind: 'comment-not-whitelisted',
          })
        );
        for (const r of results) {
          const { reasons, resultId, guard } = resultBlockers(r, index, catalogue, labId);
          if (resultId) recognisedCount++;
          else unrecognisedCount++;
          reasonPairs.push(...reasons);
          if (guard && asArr(guard.excludeIfMeds).length && Array.isArray(o.meds)) {
            LFU.medExclusionBlockers(o.meds, { excludeIfMeds: guard.excludeIfMeds }).forEach((text) =>
              reasonPairs.push({ text, kind: 'medicine-exclusion' })
            );
          }
        }
      }
      return ok(reasonPairs, { labId, recognisedCount, unrecognisedCount, groupsUsed });
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  }

  const api = { evaluateFilingCatalogue, buildActingIndex };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.LabFilingCatalogue = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : global);
