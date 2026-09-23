// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Lab Result Catalogue: the PRACTICE OVERLAY (pure logic: no DOM, no chrome.*, no fetch, no storage).
//
// PHASE B1 of docs/plans/LAB-RESULT-CATALOGUE-DATA-MODEL-2026-09-19.md.
//
// The shipped catalogue (rules/lab-catalogue.json) is the safety-reviewed BASELINE. A practice adds to it — its own
// results, investigations, lab definitions and practice context — in an OVERLAY that lives in storage and travels in
// backups / the practice profile. This file defines the overlay's shape, sanitises it, and merges it onto the baseline.
//
// Rules baked in here (not left to any editor):
//   * BUILT-INS: an overlay entry that shares an id with a built-in is, by default, APPEND-ONLY — it can only ADD codes,
//     aliases, excludes, request/heading aliases, members and headings (imports and shared profiles arrive this way).
//     An entry marked `override: true` is a COMPLETE practice-authored replacement (the settings page writes these: a
//     practice must be able to correct a shipped definition or adapt it to a different lab). An override is inert until a
//     person approves it on this machine — the shipped definition keeps applying until then, and again if it is removed.
//   * DISABLE is a fail-safe: a disabled result/investigation simply stops being recognised (requests stay outstanding,
//     filing blocks), and everything that referenced it is pruned so the effective catalogue stays valid.
//   * INERT UNTIL REVIEWED. Every non-built-in entry carries provenance.reviewed. Entries that arrive by backup restore or
//     practice-profile sync are forced reviewed:false and are EXCLUDED from the effective catalogue until a person approves
//     them on the machine that will act on them (same doctrine as Lab Filing profiles, H-073). Approvals never travel.
//   * A bad overlay can never break the baseline: the merge always returns a VALID catalogue (falling back to entries that
//     validate, or the baseline alone) plus a list of problems for the UI.
//
// Dual-mode export: browser classic script -> window.LabCatalogueOverlay; Node/test -> require().

'use strict';

(function (global) {
  const OVERLAY_SCHEMA = 1;
  const LIMITS = {
    results: 3000,
    investigations: 1500,
    labs: 50,
    codes: 50,
    aliases: 300,
    members: 300,
    headings: 300,
    refs: 300,
    text: 200,
    note: 1000,
    context: 120,
    retired: 5000,
    filingRanges: 3000,
    filingGuards: 3000,
    filingGroups: 1500,
    filingScreen: 1,
    filingSuppress: 1,
  };
  const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
  const PREFIX = 'labcatalogue.practice';

  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const isStr = (v) => typeof v === 'string';
  const asArr = (v) => (Array.isArray(v) ? v : []);

  function core() {
    if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
      try {
        return require('./lab-catalogue-core.js');
      } catch (_) {
        /* fall through to the global */
      }
    }
    return global.LabCatalogue || null;
  }

  function fail(msg) {
    throw new Error(`${PREFIX}: ${msg}`);
  }

  // Own-keys-only deep clone: never triggers a __proto__ setter and never carries constructor/prototype keys.
  function safeClone(v, depth) {
    const d = depth || 0;
    if (d > 8) fail('structure is nested too deeply');
    if (Array.isArray(v)) return v.map((x) => safeClone(x, d + 1));
    if (isObj(v)) {
      const out = {};
      for (const k of Object.keys(v)) {
        if (DANGEROUS_KEYS.has(k)) continue;
        out[k] = safeClone(v[k], d + 1);
      }
      return out;
    }
    return v;
  }

  // ── Shape ──────────────────────────────────────────────────────────────────────
  function emptyOverlay() {
    return {
      schema: OVERLAY_SCHEMA,
      context: {
        icb: '',
        icbCode: '',
        borough: '',
        labs: [],
        orderingSystems: [],
        dismissed: [],
        labNames: {},
        dismissedSimilarPairs: [],
      },
      results: [],
      investigations: [],
      labs: [],
      retired: [],
      disabled: { results: [], investigations: [] },
      // Lab Filing setup (Phase E): practice normal ranges per RESULT x LAB x SNOMED CODE, each with its own filing approval.
      filing: { ranges: [], guards: [], groups: [], screen: [], suppress: [] },
    };
  }

  // ── Sanitiser: whitelist-rebuild; type errors and over-limit values REJECT (never silently truncate) ─────────────
  function str(v, max, what, required) {
    if (v === undefined || v === null) {
      if (required) fail(`${what} is required`);
      return undefined;
    }
    if (!isStr(v)) fail(`${what} must be a string`);
    const t = v.trim();
    if (required && !t) fail(`${what} is required`);
    if (t.length > max) fail(`${what} must be ${max} characters or fewer`);
    return t;
  }
  function strArr(v, max, itemMax, what) {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) fail(`${what} must be an array`);
    if (v.length > max) fail(`${what} may have at most ${max} entries`);
    return v.map((x, i) => str(x, itemMax, `${what}[${i}]`, true));
  }
  function cap(list, max, what) {
    if (list.length > max) fail(`${what} may have at most ${max} entries`);
    return list;
  }
  // undefined/null -> []; anything else that is not an array REJECTS (a mistyped section must never read as "empty")
  function arr(v, max, what) {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) fail(`${what} must be an array`);
    return cap(v, max, what);
  }

  function sanitiseProvenance(p) {
    const o = isObj(p) ? p : {};
    const out = {
      source: str(o.source, 24, 'provenance.source') || 'practice',
      reviewed: o.reviewed === true,
    };
    for (const k of ['packId', 'packVersion', 'createdAt', 'reviewedBy', 'reviewedAt', 'importedFrom']) {
      const v = str(o[k], 80, `provenance.${k}`);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }

  function sanitiseResult(r, i) {
    const w = `results[${i}]`;
    if (!isObj(r)) fail(`${w} must be an object`);
    const out = {
      id: str(r.id, 64, `${w}.id`, true),
      label: str(r.label, LIMITS.text, `${w}.label`, true),
      valueKind: str(r.valueKind, 16, `${w}.valueKind`, true),
      codes: arr(r.codes, LIMITS.codes, `${w}.codes`).map((c, j) => {
        if (!isObj(c)) fail(`${w}.codes[${j}] must be an object`);
        const oc = {
          conceptId: str(c.conceptId, 24, `${w}.codes[${j}].conceptId`, true),
          role: str(c.role, 16, `${w}.codes[${j}].role`, true),
        };
        const unit = str(c.unit, 40, `${w}.codes[${j}].unit`);
        if (unit !== undefined) oc.unit = unit;
        const desc = str(c.description, LIMITS.text, `${w}.codes[${j}].description`);
        if (desc !== undefined && desc !== '') oc.description = desc;
        if (c.refsets !== undefined) oc.refsets = strArr(c.refsets, 30, 40, `${w}.codes[${j}].refsets`);
        return oc;
      }),
      aliases: arr(r.aliases, LIMITS.aliases, `${w}.aliases`).map((a, j) => {
        if (!isObj(a)) fail(`${w}.aliases[${j}] must be an object`);
        const oa = { text: str(a.text, LIMITS.text, `${w}.aliases[${j}].text`, true) };
        const lab = str(a.lab, 64, `${w}.aliases[${j}].lab`);
        if (lab !== undefined) oa.lab = lab;
        return oa;
      }),
    };
    if (r.excludeAliases !== undefined)
      out.excludeAliases = strArr(r.excludeAliases, LIMITS.aliases, LIMITS.text, `${w}.excludeAliases`);
    const note = str(r.note, LIMITS.note, `${w}.note`);
    if (note !== undefined) out.note = note;
    if (r.override !== undefined) {
      if (typeof r.override !== 'boolean') fail(`${w}.override must be a boolean`);
      if (r.override) out.override = true;
    }
    out.provenance = sanitiseProvenance(r.provenance);
    return out;
  }

  function sanitiseInvestigation(v, i) {
    const w = `investigations[${i}]`;
    if (!isObj(v)) fail(`${w} must be an object`);
    const out = {
      id: str(v.id, 64, `${w}.id`, true),
      label: str(v.label, LIMITS.text, `${w}.label`, true),
      kind: str(v.kind, 16, `${w}.kind`, true),
      requestAliases: arr(v.requestAliases, LIMITS.aliases, `${w}.requestAliases`).map((a, j) => {
        if (!isObj(a)) fail(`${w}.requestAliases[${j}] must be an object`);
        return {
          text: str(a.text, LIMITS.text, `${w}.requestAliases[${j}].text`, true),
          system: str(a.system, 16, `${w}.requestAliases[${j}].system`, true),
        };
      }),
      headingAliases: strArr(v.headingAliases, LIMITS.aliases, LIMITS.text, `${w}.headingAliases`),
      // Legacy free-text terms (pre-catalogue matcher) — still matched, kept apart so requestAliases can hold only
      // wording confirmed by a scan of real Medicus requests (Nick, 2026-09-24).
      synonyms: strArr(v.synonyms, LIMITS.aliases, LIMITS.text, `${w}.synonyms`),
      exclude: strArr(v.exclude, LIMITS.aliases, LIMITS.text, `${w}.exclude`),
      members: arr(v.members, LIMITS.members, `${w}.members`).map((m, j) => {
        if (!isObj(m)) fail(`${w}.members[${j}] must be an object`);
        const om = {
          result: str(m.result, 64, `${w}.members[${j}].result`, true),
          role: str(m.role, 16, `${w}.members[${j}].role`, true),
        };
        if (m.anchor !== undefined) {
          if (typeof m.anchor !== 'boolean') fail(`${w}.members[${j}].anchor must be a boolean`);
          om.anchor = m.anchor;
        }
        return om;
      }),
    };
    const legacy = str(v.legacyKey, 64, `${w}.legacyKey`);
    if (legacy !== undefined) out.legacyKey = legacy;
    const note = str(v.note, LIMITS.note, `${w}.note`);
    if (note !== undefined) out.note = note;
    if (v.override !== undefined) {
      if (typeof v.override !== 'boolean') fail(`${w}.override must be a boolean`);
      if (v.override) out.override = true;
    }
    out.provenance = sanitiseProvenance(v.provenance);
    return out;
  }

  function sanitiseLab(l, i) {
    const w = `labs[${i}]`;
    if (!isObj(l)) fail(`${w} must be an object`);
    const ident = isObj(l.identifiers) ? l.identifiers : {};
    const out = {
      id: str(l.id, 64, `${w}.id`, true),
      name: str(l.name, LIMITS.text, `${w}.name`, true),
      identifiers: { performerOrg: str(ident.performerOrg, 80, `${w}.identifiers.performerOrg`, true) },
      groupHeadings: arr(l.groupHeadings, LIMITS.headings, `${w}.groupHeadings`).map((h, j) => {
        if (!isObj(h)) fail(`${w}.groupHeadings[${j}] must be an object`);
        const out2 = {
          text: str(h.text, LIMITS.text, `${w}.groupHeadings[${j}].text`, true),
          identifies: strArr(h.identifies, LIMITS.refs, 64, `${w}.groupHeadings[${j}].identifies`),
          mayContain: strArr(h.mayContain, LIMITS.refs, 70, `${w}.groupHeadings[${j}].mayContain`),
        };
        // Cosmetic only — when this heading is used, e.g. "used when the set includes potassium". Never read for
        // matching/recognition or for filing; editing it does not withdraw any approval (see setHeadingNote).
        const note = str(h.note, LIMITS.text, `${w}.groupHeadings[${j}].note`);
        if (note) out2.note = note;
        return out2;
      }),
    };
    const dept = str(ident.department, 80, `${w}.identifiers.department`);
    if (dept !== undefined) out.identifiers.department = dept;
    const sys = str(l.orderingSystem, 16, `${w}.orderingSystem`);
    if (sys !== undefined) out.orderingSystem = sys;
    if (l.structured !== undefined) {
      if (typeof l.structured !== 'boolean') fail(`${w}.structured must be a boolean`);
      out.structured = l.structured;
    }
    const note = str(l.note, LIMITS.note, `${w}.note`);
    if (note !== undefined) out.note = note;
    if (l.override !== undefined) {
      if (typeof l.override !== 'boolean') fail(`${w}.override must be a boolean`);
      if (l.override) out.override = true;
    }
    out.provenance = sanitiseProvenance(l.provenance);
    return out;
  }

  function sanitiseLabNames(v) {
    const out = {};
    if (!isObj(v)) return out;
    for (const k of Object.keys(v).slice(0, 50)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      const name = str(v[k], LIMITS.text, 'context.labNames', false);
      if (name && k.length <= 64) out[k] = name.trim();
    }
    return out;
  }

  function sanitiseContext(c) {
    const o = isObj(c) ? c : {};
    const sys = strArr(o.orderingSystems, 8, 16, 'context.orderingSystems');
    return {
      icb: str(o.icb, LIMITS.context, 'context.icb') || '',
      icbCode: str(o.icbCode, 16, 'context.icbCode') || '',
      borough: str(o.borough, LIMITS.context, 'context.borough') || '',
      labs: strArr(o.labs, 20, 64, 'context.labs'),
      orderingSystems: sys,
      // ids of IMPORTED tests the person deleted: reading the Outstanding Requests tests again must not bring them back
      dismissed: strArr(o.dismissed, 300, 128, 'context.dismissed'),
      // human-readable names the practice gives labs (display only; never changes how a lab is recognised)
      labNames: sanitiseLabNames(o.labNames),
      // two result ids a person has explicitly said are NOT the same analyte ("it's not X") — the similarity HINT
      // (SC.similarResults) must not suggest this pairing again, on the match board or in a test's own results table.
      // Sorted "idA|idB" (order-independent), same string-list shape/limits as `dismissed` above.
      dismissedSimilarPairs: strArr(o.dismissedSimilarPairs, 500, 160, 'context.dismissedSimilarPairs'),
    };
  }

  // Duplicate ids within a kind REJECT: every id-keyed lookup (markReviewed, the settings page, the merge) reads the
  // FIRST match, so a second entry under the same id is an invisible passenger — approval stamps would cascade onto a
  // copy the reviewer never saw (e.g. a hidden override riding an innocent-looking duplicate).
  // ── Lab Filing setup: a practice normal range for one RESULT, at one LAB, for one SNOMED CODE ──────────────────────────
  // The unit is carried by the code (HbA1c IFCC and NGSP are different codes), and is SNAPSHOTTED here: if the code's unit
  // later changes, the range no longer means what it did and is excluded until it is set again. `reviewed` is the FILING
  // approval — separate from the approval of the result / test that decides matching. Whether assisted filing is ON is not a
  // property of a result: Medicus files a whole report group at once, so the on/off switch lives on the group entry.
  const filingKey = (r) => [r.result, r.lab, r.code].join('|');
  function finiteOrNull(v, what) {
    if (v === undefined || v === null || v === '') return null;
    const n = typeof v === 'number' ? v : Number(String(v).trim());
    if (!Number.isFinite(n) || Math.abs(n) > 1e9) fail(what + ' must be a number');
    return n;
  }
  function sanitiseFilingRange(v, i) {
    const w = 'filing.ranges[' + i + ']';
    if (!isObj(v)) fail(w + ' must be an object');
    const out = {
      result: str(v.result, 64, w + '.result', true),
      lab: str(v.lab, 64, w + '.lab', true),
      code: str(v.code, 24, w + '.code', true),
      unit: str(v.unit, 40, w + '.unit') || '',
      low: finiteOrNull(v.low, w + '.low'),
      high: finiteOrNull(v.high, w + '.high'),
    };
    if (out.low === null && out.high === null) fail(w + ' needs a low and/or a high value');
    if (out.low !== null && out.high !== null && out.low > out.high) fail(w + ': low must not exceed high');
    out.provenance = sanitiseProvenance(v.provenance);
    return out;
  }
  // Guards are per RESULT x LAB (a trend limit or a medicine exclusion is about the analyte, not about one code).
  const TREND_DIRECTIONS = ['any', 'up', 'down'];
  const filingGuardKey = (g) => [g.result, g.lab].join('|');
  function cleanTerms(v, what, minLen, maxItems) {
    return strArr(v, maxItems, 80, what)
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => {
        if (x.length < minLen) fail(what + ' entry "' + x + '" is too short');
        return x;
      });
  }
  function sanitiseFilingGuard(v, i) {
    const w = 'filing.guards[' + i + ']';
    if (!isObj(v)) fail(w + ' must be an object');
    const trend = finiteOrNull(v.trendMaxDeltaPct, w + '.trendMaxDeltaPct');
    if (trend !== null && trend <= 0) fail(w + '.trendMaxDeltaPct must be more than 0');
    const dir =
      v.trendDirection === undefined || v.trendDirection === null || v.trendDirection === '' ? 'any' : v.trendDirection;
    if (!TREND_DIRECTIONS.includes(dir)) fail(w + '.trendDirection must be one of ' + TREND_DIRECTIONS.join(', '));
    const out = {
      result: str(v.result, 64, w + '.result', true),
      lab: str(v.lab, 64, w + '.lab', true),
      trendMaxDeltaPct: trend,
      // which way it moved: 'any' (a change either way), 'up' (an increase) or 'down' (a decrease). An eGFR that rises is good news,
      // a creatinine that falls is; the opposite movements are what must never be filed automatically.
      trendDirection: trend === null ? 'any' : dir,
      excludeIfMeds: cleanTerms(v.excludeIfMeds, w + '.excludeIfMeds', 2, 50),
    };
    if (out.trendMaxDeltaPct === null && !out.excludeIfMeds.length) fail(w + ' sets no guard');
    out.provenance = sanitiseProvenance(v.provenance);
    return out;
  }

  // Lab comments arrive per lab-defined REPORT GROUP (a heading), as one package for the group's results — so the
  // comment WHITELIST (allowComments) is per lab x group heading, never per result: the exact wording is the lab's
  // own and genuinely differs heading to heading. "Never offer to file when the comment says…" (suppressIfText) is
  // NOT here — Nick, 2026-09-23: those phrases (e.g. "telephone result") are expected to be the same whichever
  // heading variant or lab sent the report, so they are ONE practice-wide list (filing.suppress, below), not
  // duplicated per heading.
  const filingGroupKey = (g) => [g.lab, core().norm(g.heading)].join('|');
  function filingUtils() {
    let U = null;
    if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
      try {
        U = require('./lab-filing-utils.js');
      } catch (_) {
        /* fall through to the global */
      }
    }
    U = U || global.LabFilingUtils || null;
    if (!U || typeof U.allowCommentProblem !== 'function') fail('the lab filing helpers are not loaded');
    return U;
  }
  function sanitiseFilingGroup(v, i) {
    const w = 'filing.groups[' + i + ']';
    if (!isObj(v)) fail(w + ' must be an object');
    const U = filingUtils();
    const allow = strArr(v.allowComments, 100, 2000, w + '.allowComments').map((x) => x.trim());
    allow.forEach((x) => {
      const why = U.allowCommentProblem(x);
      if (why) fail('The comment "' + x.slice(0, 40) + '…" ' + why);
    });
    const out = {
      lab: str(v.lab, 64, w + '.lab', true),
      heading: str(v.heading, LIMITS.text, w + '.heading', true),
      allowComments: [...new Set(allow)],
      // assisted filing ON for this report group (Medicus files a group, never a single result)
      enabled: v.enabled === true,
      // the practice's own normal range overrides the LAB's out-of-range flag for every result this group covers — one
      // decision per test at a lab (moved off the per-result guard, 2026-09-25: buried per-analyte was unfindable, and a
      // multi-result test needed it ticked once per result). See engine/lab-filing-catalogue.js's applyCatalogueOverrides.
      overrideLabFlag: v.overrideLabFlag === true,
    };
    if (!out.allowComments.length && !out.enabled && !out.overrideLabFlag) fail(w + ' sets nothing');
    out.provenance = sanitiseProvenance(v.provenance);
    return out;
  }

  // "Never offer to file when the comment says…" — ONE practice-wide list (Nick, 2026-09-23: expected to be the
  // same whichever heading variant or lab sent the report, unlike the comment whitelist above). Same shape/rules as
  // a group's old suppressIfText (min length 3, up to 50 phrases) — see the filingGroupKey comment for why it moved.
  const filingSuppressKey = () => 'suppress';
  function sanitiseFilingSuppress(v, i) {
    const w = 'filing.suppress[' + i + ']';
    if (!isObj(v)) fail(w + ' must be an object');
    const out = { items: [...new Set(cleanTerms(v.items, w + '.items', 3, 50))] };
    if (!out.items.length) fail(w + ' sets nothing');
    out.provenance = sanitiseProvenance(v.provenance);
    return out;
  }

  // The wording of Medicus's own filing screen (the "normal" option under Filing notes, and the File button). It is Medicus's,
  // not a lab's, so there is ONE setting for the practice. It never changes what is written to the record: the macro finds the
  // controls on the live screen by their visible text, so this only has to match what Medicus shows.
  const FILING_DEFAULT_NORMAL_OPTION = 'Normal result, no action required';
  const FILING_DEFAULT_FILE_BUTTON = 'File results';
  const filingScreenKey = () => 'screen';
  function sanitiseFilingScreen(v, i) {
    const w = 'filing.screen[' + i + ']';
    if (!isObj(v)) fail(w + ' must be an object');
    const out = {
      normalOptionText: (str(v.normalOptionText, 120, w + '.normalOptionText') || '').trim(),
      fileButtonText: (str(v.fileButtonText, 120, w + '.fileButtonText') || '').trim(),
    };
    if (!out.normalOptionText && !out.fileButtonText) fail(w + ' sets nothing');
    out.provenance = sanitiseProvenance(v.provenance);
    return out;
  }

  function rejectDuplicateKeys(list, keyFn, what) {
    const seen = new Set();
    for (const e of list) {
      const k = keyFn(e);
      if (seen.has(k)) fail('filing.' + what + ' has more than one entry for ' + k.replace(/\|/g, ' / '));
      seen.add(k);
    }
    return list;
  }
  const rejectDuplicateFilingKeys = (list) => rejectDuplicateKeys(list, filingKey, 'ranges');

  // the collections the Lab Filing setup lives in
  const FILING_KINDS = {
    ranges: { key: filingKey, sanitise: sanitiseFilingRange, limit: 'filingRanges' },
    guards: { key: filingGuardKey, sanitise: sanitiseFilingGuard, limit: 'filingGuards' },
    groups: { key: filingGroupKey, sanitise: sanitiseFilingGroup, limit: 'filingGroups' },
    screen: { key: filingScreenKey, sanitise: sanitiseFilingScreen, limit: 'filingScreen' },
    suppress: { key: filingSuppressKey, sanitise: sanitiseFilingSuppress, limit: 'filingSuppress' },
  };
  function sanitiseFiling(raw) {
    const src = isObj(raw) ? raw : {};
    const out = {};
    for (const [name, k] of Object.entries(FILING_KINDS)) {
      let list = arr(src[name], LIMITS[k.limit], 'filing.' + name);
      // (a range saved by v3.266.0 with no bounds only said "enabled": that switch is now on the group, so it is dropped, not fatal)
      if (name === 'ranges')
        list = list.filter(
          (r) => (isObj(r) && r.low != null && r.low !== '') || (isObj(r) && r.high != null && r.high !== '')
        );
      out[name] = rejectDuplicateKeys(list.map(k.sanitise), k.key, name);
    }
    return out;
  }
  const clearApproval = (e) => {
    const p = { ...e.provenance, reviewed: false };
    delete p.reviewedBy;
    delete p.reviewedAt;
    return { ...e, provenance: p };
  };

  function rejectDuplicateIds(list, what) {
    const seen = new Set();
    for (const e of list) {
      if (seen.has(e.id)) fail(`${what} has more than one entry with id "${e.id}"`);
      seen.add(e.id);
    }
    return list;
  }

  // raw -> clean overlay. Never mutates `raw`. Unknown keys are dropped; type errors / over-limit values throw.
  function sanitiseOverlay(raw) {
    if (raw === undefined || raw === null) return emptyOverlay();
    if (!isObj(raw)) fail('overlay must be an object');
    const src = safeClone(raw);
    if (src.schema !== undefined && src.schema !== OVERLAY_SCHEMA) fail(`schema must be ${OVERLAY_SCHEMA}`);
    const dis = isObj(src.disabled) ? src.disabled : {};
    return {
      schema: OVERLAY_SCHEMA,
      context: sanitiseContext(src.context),
      results: rejectDuplicateIds(arr(src.results, LIMITS.results, 'results').map(sanitiseResult), 'results'),
      investigations: rejectDuplicateIds(
        arr(src.investigations, LIMITS.investigations, 'investigations').map(sanitiseInvestigation),
        'investigations'
      ),
      labs: rejectDuplicateIds(arr(src.labs, LIMITS.labs, 'labs').map(sanitiseLab), 'labs'),
      retired: strArr(src.retired, LIMITS.retired, 64, 'retired'),
      disabled: {
        results: strArr(dis.results, LIMITS.results, 64, 'disabled.results'),
        investigations: strArr(dis.investigations, LIMITS.investigations, 64, 'disabled.investigations'),
      },
      filing: sanitiseFiling(src.filing),
    };
  }

  // ── Review state ───────────────────────────────────────────────────────────────
  const KINDS = ['results', 'investigations', 'labs'];

  // Force every entry inert (used by backup restore and practice-profile sync). The origin is remembered, the approval is
  // not: approvals are per machine and never travel.
  function forceInert(overlay) {
    const o = sanitiseOverlay(overlay);
    for (const k of KINDS) {
      o[k] = o[k].map((e) => ({
        ...e,
        provenance: {
          ...e.provenance,
          importedFrom:
            e.provenance.source && e.provenance.source !== 'imported' ? e.provenance.source : e.provenance.importedFrom,
          source: 'imported',
          reviewed: false,
          reviewedBy: undefined,
          reviewedAt: undefined,
        },
      }));
      o[k].forEach((e) => {
        delete e.provenance.reviewedBy;
        delete e.provenance.reviewedAt;
        if (e.provenance.importedFrom === undefined) delete e.provenance.importedFrom;
      });
    }
    // Lab Filing setup arrives with its FILING approval removed (its intent — enabled, ranges, guards, whitelisted comments —
    // may travel; it acts only once approved on this machine)
    for (const name of Object.keys(FILING_KINDS)) {
      o.filing[name] = o.filing[name].map((r) => {
        const e = clearApproval(r);
        e.provenance = { ...e.provenance, source: 'imported' };
        return e;
      });
    }
    return o;
  }

  // Strip approvals for EXPORT (backup / published profile): approvals are per machine and must never travel, and the
  // reviewer's name is personal data that has no business in a shared file. Every import path force-inerts anyway —
  // this makes the "approvals never travel" invariant true at the source rather than relying on the importing side.
  // Unlike forceInert, the provenance source is left as-is: the importing machine decides what counts as imported.
  function stripApprovals(overlay) {
    const o = sanitiseOverlay(overlay);
    for (const k of KINDS) {
      o[k] = o[k].map((e) => {
        const p = { ...e.provenance, reviewed: false };
        delete p.reviewedBy;
        delete p.reviewedAt;
        return { ...e, provenance: p };
      });
    }
    for (const name of Object.keys(FILING_KINDS)) o.filing[name] = o.filing[name].map(clearApproval);
    return o;
  }

  // Approve one entry (kind: 'results' | 'investigations' | 'labs'). Pure: returns a new overlay.
  function markReviewed(overlay, kind, id, by, when) {
    if (!KINDS.includes(kind)) fail(`unknown kind "${kind}"`);
    const o = safeClone(overlay);
    const e = o[kind].find((x) => x.id === id);
    if (!e) fail(`${kind} "${id}" not found`);
    e.provenance = {
      ...e.provenance,
      reviewed: true,
      reviewedBy: by || 'unknown',
      reviewedAt: when || new Date().toISOString().slice(0, 10),
    };
    return o;
  }

  function summarise(overlay) {
    const o = overlay || emptyOverlay();
    const count = (k) => ({
      total: asArr(o[k]).length,
      unreviewed: asArr(o[k]).filter((e) => !(e && e.provenance && e.provenance.reviewed === true)).length,
    });
    return {
      results: count('results'),
      investigations: count('investigations'),
      labs: count('labs'),
      filing: (() => {
        const all = Object.keys(FILING_KINDS).flatMap((k) => asArr(o.filing && o.filing[k]));
        return {
          total: all.length,
          unreviewed: all.filter((e) => !(e && e.provenance && e.provenance.reviewed === true)).length,
        };
      })(),
      disabled: asArr(o.disabled && o.disabled.results).length + asArr(o.disabled && o.disabled.investigations).length,
    };
  }

  // ── Settings-page operations (pure: each returns a NEW overlay) ─────────────────────────────────────────────────

  // ── Lab Filing setup operations (pure) ─────────────────────────────────────────────────────────────────────────────
  // Set (create or change) a practice normal range: spec = { result, lab, code, low, high, enabled }. The result, lab and code
  // must exist in the effective catalogue and the code must be one of the RESULT's own codes (that is where the unit comes
  // from). ANY change withdraws the filing approval; a new range starts unapproved.
  function setFilingRange(builtin, overlay, spec, today) {
    const day = today || new Date().toISOString().slice(0, 10);
    const o = safeClone(overlay);
    if (!isObj(spec)) fail('a filing range must be an object');
    const cat = mergeCatalogue(builtin, o, { includeUnreviewed: true }).catalogue;
    const res = asArr(cat.results).find((r) => r.id === spec.result);
    if (!res) fail('unknown result "' + spec.result + '"');
    if (!asArr(cat.labs).some((l) => l.id === spec.lab)) fail('unknown lab "' + spec.lab + '"');
    const code = asArr(res.codes).find((c) => c.conceptId === spec.code);
    if (!code) fail('code ' + spec.code + ' is not one of ' + res.label + "'s codes");
    const cleared =
      (spec.low === undefined || spec.low === null || spec.low === '') &&
      (spec.high === undefined || spec.high === null || spec.high === '') &&
      spec.enabled !== true;
    const next = sanitiseFilingRange(
      {
        result: spec.result,
        lab: spec.lab,
        code: spec.code,
        unit: code.unit || '',
        low: spec.low,
        high: spec.high,
        enabled: cleared ? true : spec.enabled === true, // (a placeholder so a cleared entry passes validation, then is dropped below)
        provenance: { source: 'practice', reviewed: false, createdAt: day },
      },
      0
    );
    if (cleared) next.enabled = false;
    const key = filingKey(next);
    const i = o.filing.ranges.findIndex((r) => filingKey(r) === key);
    // nothing set and assisted filing off = clear it
    if (next.low === null && next.high === null && !next.enabled) {
      if (i >= 0) o.filing.ranges.splice(i, 1);
      return o;
    }
    if (i >= 0) {
      const old = o.filing.ranges[i];
      const same =
        old.low === next.low && old.high === next.high && old.enabled === next.enabled && old.unit === next.unit;
      if (same) return o; // nothing changed: the approval stands
      next.provenance = { ...old.provenance, reviewed: false };
      delete next.provenance.reviewedBy;
      delete next.provenance.reviewedAt;
      o.filing.ranges[i] = next;
    } else {
      if (o.filing.ranges.length >= LIMITS.filingRanges) fail('too many filing ranges');
      o.filing.ranges.push(next);
    }
    return sanitiseOverlay(o);
  }

  // A practice normal range for one code of one result at one lab: spec = { result, lab, code, low, high }. Blank = cleared.
  // (Redefined here so the range no longer carries an on/off flag.)
  function setFilingRange(builtin, overlay, spec, today) {
    const day = today || new Date().toISOString().slice(0, 10);
    const o = safeClone(overlay);
    if (!isObj(spec)) fail('a filing range must be an object');
    const cat = mergeCatalogue(builtin, o, { includeUnreviewed: true }).catalogue;
    const res = asArr(cat.results).find((r) => r.id === spec.result);
    if (!res) fail('unknown result "' + spec.result + '"');
    if (!asArr(cat.labs).some((l) => l.id === spec.lab)) fail('unknown lab "' + spec.lab + '"');
    const code = asArr(res.codes).find((c) => c.conceptId === spec.code);
    if (!code) fail('code ' + spec.code + ' is not one of ' + res.label + "'s codes");
    const blank = (v) => v === undefined || v === null || v === '';
    const key = filingKey({ result: spec.result, lab: spec.lab, code: spec.code });
    if (blank(spec.low) && blank(spec.high)) {
      o.filing.ranges = o.filing.ranges.filter((r) => filingKey(r) !== key);
      return o;
    }
    return upsertFiling(o, 'ranges', { result: spec.result, lab: spec.lab, code: spec.code }, () =>
      sanitiseFilingRange(
        {
          result: spec.result,
          lab: spec.lab,
          code: spec.code,
          unit: code.unit || '',
          low: spec.low,
          high: spec.high,
          provenance: { source: 'practice', reviewed: false, createdAt: day },
        },
        0
      )
    );
  }

  // Guards, per RESULT x LAB: spec = { result, lab, trendMaxDeltaPct, trendDirection, excludeIfMeds }.
  function setFilingGuards(builtin, overlay, spec, today) {
    const day = today || new Date().toISOString().slice(0, 10);
    const o = safeClone(overlay);
    if (!isObj(spec)) fail('guards must be an object');
    const cat = mergeCatalogue(builtin, o, { includeUnreviewed: true }).catalogue;
    if (!asArr(cat.results).some((r) => r.id === spec.result)) fail('unknown result "' + spec.result + '"');
    if (!asArr(cat.labs).some((l) => l.id === spec.lab)) fail('unknown lab "' + spec.lab + '"');
    const key = filingGuardKey(spec);
    const empty =
      finiteOrNull(spec.trendMaxDeltaPct, 'trendMaxDeltaPct') === null &&
      !cleanTerms(spec.excludeIfMeds, 'excludeIfMeds', 2, 50).length;
    if (empty) {
      o.filing.guards = o.filing.guards.filter((g) => filingGuardKey(g) !== key);
      return o;
    }
    return upsertFiling(o, 'guards', spec, () =>
      sanitiseFilingGuard({ ...spec, provenance: { source: 'practice', reviewed: false, createdAt: day } }, 0)
    );
  }

  // A lab report GROUP, per LAB x group heading: spec = { lab, heading, enabled, allowComments }. The heading must
  // be one the lab really sends. Every whitelisted comment must pass allowCommentProblem. Medicus files a group at once, so the
  // assisted filing on/off switch is here, alongside the comment whitelist.
  function setFilingGroup(builtin, overlay, spec, today) {
    const day = today || new Date().toISOString().slice(0, 10);
    const o = safeClone(overlay);
    if (!isObj(spec)) fail('a lab group must be an object');
    const cat = mergeCatalogue(builtin, o, { includeUnreviewed: true }).catalogue;
    const lab = asArr(cat.labs).find((l) => l.id === spec.lab);
    if (!lab) fail('unknown lab "' + spec.lab + '"');
    const LC = core();
    const known = asArr(lab.groupHeadings).some((g) => LC.norm(g.text) === LC.norm(spec.heading));
    if (!known) fail('"' + spec.heading + '" is not a report group heading recorded for ' + lab.name);
    const key = filingGroupKey(spec);
    const empty =
      spec.enabled !== true &&
      spec.overrideLabFlag !== true &&
      !asArr(spec.allowComments).some((x) => String(x || '').trim());
    if (empty) {
      o.filing.groups = o.filing.groups.filter((g) => filingGroupKey(g) !== key);
      return o;
    }
    return upsertFiling(o, 'groups', spec, () =>
      sanitiseFilingGroup({ ...spec, provenance: { source: 'practice', reviewed: false, createdAt: day } }, 0)
    );
  }

  // The Medicus filing-screen wording (one setting for the whole practice): spec = { normalOptionText, fileButtonText }. Text equal
  // to the standard wording (or blank) is not stored at all — the default applies and there is nothing to approve.
  function setFilingScreen(overlay, spec, today) {
    const day = today || new Date().toISOString().slice(0, 10);
    const o = safeClone(overlay);
    if (!isObj(spec)) fail('the filing-screen wording must be an object');
    const opt = String(spec.normalOptionText || '').trim();
    const btnText = String(spec.fileButtonText || '').trim();
    const next = {
      normalOptionText: opt === FILING_DEFAULT_NORMAL_OPTION ? '' : opt,
      fileButtonText: btnText === FILING_DEFAULT_FILE_BUTTON ? '' : btnText,
    };
    if (!next.normalOptionText && !next.fileButtonText) {
      o.filing.screen = [];
      return o;
    }
    return upsertFiling(o, 'screen', {}, () =>
      sanitiseFilingScreen({ ...next, provenance: { source: 'practice', reviewed: false, createdAt: day } }, 0)
    );
  }

  // "Never offer to file when the comment says…" (one practice-wide list): spec = { items: string[] }. Empty clears it.
  function setFilingSuppress(overlay, spec, today) {
    const day = today || new Date().toISOString().slice(0, 10);
    const o = safeClone(overlay);
    if (!isObj(spec)) fail('the suppress-phrase list must be an object');
    const items = cleanTerms(spec.items, 'items', 3, 50);
    if (!items.length) {
      o.filing.suppress = [];
      return o;
    }
    return upsertFiling(o, 'suppress', {}, () =>
      sanitiseFilingSuppress({ items, provenance: { source: 'practice', reviewed: false, createdAt: day } }, 0)
    );
  }

  // shared: create / change one entry. ANY change withdraws that entry's approval; nothing changed keeps it.
  function upsertFiling(o, kind, spec, build) {
    const K = FILING_KINDS[kind];
    const key = K.key(spec);
    const i = o.filing[kind].findIndex((e) => K.key(e) === key);
    const next = build();
    if (i >= 0) {
      const old = o.filing[kind][i];
      const same = JSON.stringify({ ...old, provenance: 0 }) === JSON.stringify({ ...next, provenance: 0 });
      if (same) return o;
      next.provenance = clearApproval(old).provenance;
      o.filing[kind][i] = next;
    } else {
      if (o.filing[kind].length >= LIMITS[K.limit]) fail('too many filing entries');
      o.filing[kind].push(next);
    }
    return sanitiseOverlay(o);
  }

  function removeFiling(overlay, kind, key) {
    const K = FILING_KINDS[kind];
    if (!K) fail('unknown filing kind "' + kind + '"');
    const o = safeClone(overlay);
    const before = o.filing[kind].length;
    o.filing[kind] = o.filing[kind].filter((e) => K.key(e) !== key);
    if (o.filing[kind].length === before) fail('filing ' + kind + ' "' + key + '" not found');
    return o;
  }
  const removeFilingRange = (overlay, key) => removeFiling(overlay, 'ranges', key);

  // The FILING approval of one entry (kind: 'ranges' | 'guards' | 'groups' | 'screen'). It never touches the approval of the
  // result, the test or the lab, and theirs never touches this.
  function approveFiling(overlay, kind, key, by, when) {
    const K = FILING_KINDS[kind];
    if (!K) fail('unknown filing kind "' + kind + '"');
    const o = safeClone(overlay);
    const r = o.filing[kind].find((x) => K.key(x) === key);
    if (!r) fail('filing ' + kind + ' "' + key + '" not found');
    r.provenance = {
      ...r.provenance,
      reviewed: true,
      reviewedBy: by || 'unknown',
      reviewedAt: when || new Date().toISOString().slice(0, 10),
    };
    return o;
  }
  const approveFilingRange = (overlay, key, by, when) => approveFiling(overlay, 'ranges', key, by, when);

  // ── Assisted filing for a TEST at a LAB: what it covers, whether it is on, and what still needs approving ──────────────────
  // Medicus files a report group at once, so "assisted filing" is one switch for the report groups (lab headings) that identify the
  // test. It rests on: those group entries, the practice ranges and guards of the test's results at that lab, and the Medicus
  // wording if the practice has changed it. `merged` is the effective catalogue including unreviewed entries.
  function filingStateForTest(merged, overlay, invId, labId) {
    const LC = core();
    const inv = asArr(merged.investigations).find((i) => i.id === invId);
    const lab = asArr(merged.labs).find((l) => l.id === labId);
    const out = { headings: [], groups: [], enabled: false, overrideLabFlag: false, approved: false, pending: [] };
    if (!inv || !lab) return out;
    out.headings = asArr(lab.groupHeadings)
      .filter((g) => asArr(g.identifies).includes(invId))
      .map((g) => g.text);
    const ids = new Set(asArr(inv.members).map((m) => m.result));
    for (const h of out.headings) {
      const e =
        overlay.filing.groups.find((g) => filingGroupKey(g) === filingGroupKey({ lab: labId, heading: h })) || null;
      out.groups.push({ heading: h, entry: e });
    }
    out.enabled = out.headings.length > 0 && out.groups.every((g) => g.entry && g.entry.enabled === true);
    // whether the practice's own ranges override the lab's out-of-range flag for EVERY report group this test arrives in at
    // this lab — one decision for the whole test, kept in sync across group entries by setFilingOverrideForTest below.
    out.overrideLabFlag =
      out.headings.length > 0 && out.groups.every((g) => g.entry && g.entry.overrideLabFlag === true);
    const need = [];
    for (const g of out.groups) if (g.entry) need.push(['groups', filingGroupKey(g.entry), g.entry, g.heading]);
    for (const r of overlay.filing.ranges)
      if (r.lab === labId && ids.has(r.result)) need.push(['ranges', filingKey(r), r, r.code]);
    for (const g of overlay.filing.guards)
      if (g.lab === labId && ids.has(g.result)) need.push(['guards', filingGuardKey(g), g, g.result]);
    for (const sc of overlay.filing.screen) need.push(['screen', filingScreenKey(sc), sc, 'screen']);
    for (const sp of overlay.filing.suppress) need.push(['suppress', filingSuppressKey(sp), sp, 'suppress']);
    out.pending = need
      .filter(([, , e]) => !(e.provenance && e.provenance.reviewed === true))
      .map(([kind, key, , label]) => ({ kind, key, label }));
    out.approved = out.enabled && out.pending.length === 0;
    void LC;
    return out;
  }

  // Switch assisted filing on / off for a test at a lab: every report group that identifies it. Turning it on creates the group entry
  // (unapproved) if there is none; a group left with nothing set is removed.
  function setFilingForTest(builtin, overlay, invId, labId, enabled, today) {
    const merged = mergeCatalogue(builtin, overlay, { includeUnreviewed: true }).catalogue;
    const st = filingStateForTest(merged, overlay, invId, labId);
    if (!st.headings.length) fail('this lab has no report group heading recorded for this test yet');
    let o = safeClone(overlay);
    for (const g of st.groups) {
      const cur = g.entry || {};
      o = setFilingGroup(
        builtin,
        o,
        {
          lab: labId,
          heading: g.heading,
          enabled: enabled === true,
          allowComments: cur.allowComments || [],
          overrideLabFlag: cur.overrideLabFlag === true,
        },
        today
      );
    }
    return o;
  }

  // Whether the practice's own ranges override the lab's out-of-range flag, for the WHOLE test at this lab — every report
  // group it arrives in is kept in sync (H-081 control d, moved here from a per-result guard: Nick, 2026-09-25, "if I
  // didn't find it having written this system, no chance of a mere user doing so" — a per-analyte toggle buried in each
  // result's own Safety guards column was both unfindable and meant re-ticking it once per result of a multi-result test).
  function setFilingOverrideForTest(builtin, overlay, invId, labId, overrideLabFlag, today) {
    const merged = mergeCatalogue(builtin, overlay, { includeUnreviewed: true }).catalogue;
    const st = filingStateForTest(merged, overlay, invId, labId);
    if (!st.headings.length) fail('this lab has no report group heading recorded for this test yet');
    let o = safeClone(overlay);
    for (const g of st.groups) {
      const cur = g.entry || {};
      o = setFilingGroup(
        builtin,
        o,
        {
          lab: labId,
          heading: g.heading,
          enabled: cur.enabled === true,
          allowComments: cur.allowComments || [],
          overrideLabFlag: overrideLabFlag === true,
        },
        today
      );
    }
    return o;
  }

  // Approve everything assisted filing for a test at a lab rests on that is still awaiting approval — the report groups, the ranges and
  // guards of its results at that lab, and the Medicus wording if changed. Called from the test's own review screen only.
  function approveFilingForTest(builtin, overlay, invId, labId, by, when) {
    const merged = mergeCatalogue(builtin, overlay, { includeUnreviewed: true }).catalogue;
    const st = filingStateForTest(merged, overlay, invId, labId);
    let o = safeClone(overlay);
    for (const p of st.pending) o = approveFiling(o, p.kind, p.key, by, when);
    return o;
  }

  function setContext(overlay, ctx) {
    const o = safeClone(overlay);
    // the settings form only edits labs / systems / area: what else the context carries (deleted imports, lab names) stays
    const keep = { dismissed: o.context && o.context.dismissed, labNames: o.context && o.context.labNames };
    o.context = sanitiseContext({ ...keep, ...ctx });
    return sanitiseOverlay(o);
  }

  // Result ids an investigation counts, in the EFFECTIVE catalogue: the built-in's members plus the overlay's additions.
  function memberResultIds(builtin, overlay, invId) {
    const ids = new Set();
    const b = asArr(builtin && builtin.investigations).find((i) => i.id === invId);
    const v = asArr(overlay.investigations).find((i) => i.id === invId);
    for (const i of [b, v]) for (const m of asArr(i && i.members)) ids.add(m.result);
    return ids;
  }

  // Approve an investigation TOGETHER WITH the overlay result entries it depends on (its members, including the alias
  // additions to built-in results). An approved investigation whose results stayed inert would be dropped by the merge.
  function approveInvestigation(builtin, overlay, id, by, when) {
    const o = safeClone(overlay);
    const inv = o.investigations.find((x) => x.id === id);
    if (!inv) fail(`investigations "${id}" not found`);
    const stamp = {
      reviewed: true,
      reviewedBy: by || 'unknown',
      reviewedAt: when || new Date().toISOString().slice(0, 10),
    };
    inv.provenance = { ...inv.provenance, ...stamp };
    const need = memberResultIds(builtin, o, id);
    const approvedResults = [];
    for (const r of o.results) {
      if (need.has(r.id) && r.provenance.reviewed !== true) {
        r.provenance = { ...r.provenance, ...stamp };
        approvedResults.push(r.id);
      }
    }
    // Lab entries carrying headings that point at THIS investigation are part of the same decision: approve them too,
    // but ONLY when every heading the approval would newly activate references exclusively this investigation (and,
    // for "res:" refs, its own member results). A heading is not "newly activated" if it is byte-identical to one the
    // SHIPPED definition of that lab already carries — lab overrides written by saveInvestigation copy the shipped
    // headings verbatim, and those mappings are live regardless of this approval. Anything else that maps some OTHER
    // report wording onto some OTHER test — even a built-in one — was never shown to the reviewer, and activating it as
    // a side effect is exactly the misfiled-analyte hazard this review gate exists to stop. Such labs stay inert until
    // approved from their own review surface, where every heading mapping is listed.
    const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
    const shippedHeading = (labId, g) =>
      asArr(builtin && builtin.labs)
        .filter((l) => l.id === labId)
        .some((l) =>
          asArr(l.groupHeadings).some(
            (b) =>
              b.text === g.text &&
              sameSet(asArr(b.identifies), asArr(g.identifies)) &&
              sameSet(asArr(b.mayContain), asArr(g.mayContain))
          )
        );
    const approvedLabs = [];
    for (const lab of o.labs) {
      if (lab.provenance.reviewed === true) continue;
      const heads = asArr(lab.groupHeadings);
      if (!heads.some((g) => asArr(g.identifies).includes(id))) continue;
      const ok = heads.every(
        (g) =>
          shippedHeading(lab.id, g) ||
          (asArr(g.identifies).every((x) => x === id) &&
            asArr(g.mayContain).every((ref) =>
              ref.startsWith('inv:') ? ref.slice(4) === id : !ref.startsWith('res:') || need.has(ref.slice(4))
            ))
      );
      if (!ok) continue;
      lab.provenance = { ...lab.provenance, ...stamp };
      approvedLabs.push(lab.id);
    }
    return { overlay: o, approvedResults, approvedLabs };
  }

  // ── Hand authoring (C3) ─────────────────────────────────────────────────────────────────────────────────────
  // Every save is a fresh, UNREVIEWED entry: an edit to an approved entry withdraws its approval. Built-ins can only be
  // ADDED to (the overlay entry carries just the additions; the merge already refuses anything else).

  const slugify = (s) =>
    String(s || '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 44)
      .replace(/-+$/, '');

  function freshId(prefix, label, taken) {
    const base = slugify(prefix + '-' + label) || prefix;
    let id = base;
    let n = 2;
    while (taken.has(id)) id = `${base}-${n++}`;
    return id;
  }
  const authoredProvenance = (old, today) => {
    const p = { source: old && old.source ? old.source : 'practice', reviewed: false };
    p.createdAt = (old && old.createdAt) || today;
    if (old && old.importedFrom) p.importedFrom = old.importedFrom;
    return p;
  };
  const dropNorm = (list, have, keyFn) => {
    const seen = new Set(have);
    return asArr(list).filter((x) => {
      const k = keyFn(x);
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };

  // Rejects a save that the merge would refuse (duplicate code, unknown reference, blood test with no core member…), so
  // the page can say why instead of silently storing an entry the catalogue then ignores.
  function assertUsable(builtin, overlay, ids) {
    const LC = core();
    const m = mergeCatalogue(builtin, overlay, { includeUnreviewed: true });
    const bad = m.problems.filter((p) => ids.includes(p.id) && !/\(ignored\)$/.test(p.reason));
    // the validator's path prefix ("results[63] (id).codes[1]: ") means nothing to a person: keep just the reason
    const plain = (t) =>
      String(t)
        .replace(/^excluded — would make the catalogue invalid: /, '')
        .replace(/^[a-z]+\[\d+\][^:]*: /, '');
    if (bad.length) fail(bad.map((p) => plain(p.reason)).join('; '));
    const v = LC.validateCatalogue(m.catalogue);
    if (v.errors.length) fail(plain(v.errors[0]));
  }

  // ── Content comparison (order-insensitive) — used to tell "unchanged from the shipped version" from a real edit ────
  const sortedJson = (list) => JSON.stringify(list.slice().sort());
  function resultContent(r) {
    const LC = core();
    return JSON.stringify({
      label: r.label,
      valueKind: r.valueKind,
      codes: sortedJson(
        asArr(r.codes).map((c) =>
          [c.conceptId, c.role, c.unit || '', asArr(c.refsets).slice().sort().join(',')].join('|')
        )
      ),
      aliases: sortedJson(asArr(r.aliases).map((a) => LC.norm(a.text) + '|' + (a.lab || ''))),
      exclude: sortedJson(asArr(r.excludeAliases).map(LC.norm)),
    });
  }
  function investigationContent(v) {
    const LC = core();
    return JSON.stringify({
      label: v.label,
      kind: v.kind,
      req: sortedJson(asArr(v.requestAliases).map((a) => LC.norm(a.text) + '|' + a.system)),
      syn: sortedJson(asArr(v.synonyms).map(LC.norm)),
      heads: sortedJson(asArr(v.headingAliases).map(LC.norm)),
      exclude: sortedJson(asArr(v.exclude).map(LC.norm)),
      members: sortedJson(asArr(v.members).map((m) => m.result + '|' + m.role + '|' + (m.anchor === true ? 'A' : ''))),
    });
  }
  function headingsContent(list) {
    const LC = core();
    return sortedJson(
      asArr(list).map((g) =>
        [
          LC.norm(g.text),
          asArr(g.identifies).slice().sort().join(','),
          asArr(g.mayContain).slice().sort().join(','),
        ].join('|')
      )
    );
  }

  // spec: { id?, label, valueKind, codes:[{conceptId, role, unit?, refsets?}], aliases:[{text, lab?}], excludeAliases?, note? }
  // The spec is the COMPLETE definition. For a built-in id it becomes an OVERRIDE entry that replaces the shipped
  // definition once a person approves it (the shipped one keeps applying until then, and again if the override is
  // reverted). A spec identical to the shipped definition simply removes any override.
  function saveResult(builtin, overlay, spec, today) {
    const LC = core();
    const day = today || new Date().toISOString().slice(0, 10);
    const o = safeClone(overlay);
    if (!isObj(spec)) fail('result spec must be an object');
    const b = asArr(builtin && builtin.results).find((r) => r.id === spec.id);
    const idx = o.results.findIndex((r) => r.id === spec.id);
    const old = idx >= 0 ? o.results[idx] : null;
    const taken = new Set([
      ...asArr(builtin && builtin.results).map((r) => r.id),
      ...o.results.map((r) => r.id),
      ...o.retired,
    ]);
    const id = spec.id || freshId('practice', spec.label, taken);
    const text = (v) => String(v || '').trim();
    // at most one primary code: the first one stays primary (or becomes it), the rest are alternates
    const codes = asArr(spec.codes).map((c, i) => ({
      ...c,
      conceptId: text(c.conceptId),
      role: i === 0 ? 'primary' : 'alternate',
    }));
    const entry = {
      id,
      label: text(spec.label),
      valueKind: spec.valueKind || (b ? b.valueKind : 'mixed'),
      codes,
      aliases: dropNorm(
        asArr(spec.aliases).map((a) => ({ ...a, text: text(a.text) })),
        [],
        (a) => LC.norm(a.text) + '|' + (a.lab || '')
      ),
      provenance: authoredProvenance(old, day),
    };
    if (spec.excludeAliases && spec.excludeAliases.length) entry.excludeAliases = spec.excludeAliases.map(text);
    if (spec.note) entry.note = text(spec.note);
    if (b) entry.override = true;
    if (b && resultContent(entry) === resultContent(b)) {
      if (idx >= 0) o.results.splice(idx, 1); // back to the shipped definition
      return { overlay: sanitiseOverlay(o), id, reverted: true };
    }
    if (idx >= 0) o.results[idx] = entry;
    else o.results.push(entry);
    // A practice-only result that becomes unreviewed drops out of the acting catalogue, which would silently invalidate
    // every approved investigation that uses it — so those go back to awaiting review with it.
    if (!b) {
      for (const inv of o.investigations) {
        if (inv.provenance.reviewed === true && asArr(inv.members).some((m) => m.result === id)) {
          inv.provenance = { ...inv.provenance, reviewed: false };
        }
      }
    }
    const clean = sanitiseOverlay(o);
    assertUsable(builtin, clean, [id]);
    return { overlay: clean, id };
  }

  // spec: { id?, label, kind, requestAliases:[{text, system}], headingAliases:[str], exclude:[str],
  //         members:[{result, role, anchor?}], note?, labHeadings:[{lab, text}] }
  // The COMPLETE definition (see saveResult): a built-in id becomes an override; identical to shipped = override removed.
  // labHeadings is every lab-specific report heading that should identify this investigation.
  function saveInvestigation(builtin, overlay, spec, today) {
    const LC = core();
    const day = today || new Date().toISOString().slice(0, 10);
    const o = safeClone(overlay);
    if (!isObj(spec)) fail('investigation spec must be an object');
    const b = asArr(builtin && builtin.investigations).find((i) => i.id === spec.id);
    const idx = o.investigations.findIndex((i) => i.id === spec.id);
    const old = idx >= 0 ? o.investigations[idx] : null;
    const taken = new Set([
      ...asArr(builtin && builtin.investigations).map((i) => i.id),
      ...o.investigations.map((i) => i.id),
      ...o.retired,
    ]);
    const id = spec.id || freshId('practice', spec.label, taken);
    const text = (v) => String(v || '').trim();
    const entry = {
      id,
      label: text(spec.label),
      kind: spec.kind || (b ? b.kind : 'blood'),
      requestAliases: dropNorm(
        asArr(spec.requestAliases).map((a) => ({ text: text(a.text), system: a.system || 'any' })),
        [],
        (a) => LC.norm(a.text) + '|' + a.system
      ),
      synonyms: dropNorm(asArr(spec.synonyms).map(text), [], (x) => LC.norm(x)),
      headingAliases: dropNorm(asArr(spec.headingAliases).map(text), [], (x) => LC.norm(x)),
      exclude: dropNorm(asArr(spec.exclude).map(text), [], (x) => LC.norm(x)),
      members: asArr(spec.members).map((m) => {
        const out = { result: m.result, role: m.role };
        if (m.anchor === true && m.role === 'core') out.anchor = true;
        return out;
      }),
      provenance: authoredProvenance(old, day),
    };
    if (b && b.legacyKey) entry.legacyKey = b.legacyKey;
    if (spec.note) entry.note = text(spec.note);
    if (b) entry.override = true;
    const unchanged = b && investigationContent(entry) === investigationContent(b);
    if (unchanged) {
      if (idx >= 0) {
        if (old.override) o.investigations.splice(idx, 1);
        else {
          // An append-only entry (import / learned from reports) whose additions live in results or lab headings: keep an
          // empty carrier so the test can still be reviewed — approving it is what approves those dependencies.
          const carrier = {
            id,
            label: b.label,
            kind: b.kind,
            requestAliases: [],
            headingAliases: [],
            exclude: [],
            members: [],
            provenance: entry.provenance,
          };
          if (b.legacyKey) carrier.legacyKey = b.legacyKey;
          o.investigations[idx] = carrier;
        }
      }
    } else if (idx >= 0) o.investigations[idx] = entry;
    else o.investigations.push(entry);

    // Lab-specific headings. Work from the fully merged lab (built-in + everything in the overlay) so nothing is lost,
    // change only THIS investigation's membership of each heading, and store the lab as a complete definition.
    const wanted = new Map(); // lab id -> [heading text]
    for (const lh of asArr(spec.labHeadings)) {
      if (!lh || !lh.lab || !text(lh.text)) continue;
      if (!wanted.has(lh.lab)) wanted.set(lh.lab, []);
      wanted.get(lh.lab).push(text(lh.text));
    }
    const mergedLabs = mergeCatalogue(builtin, o, { includeUnreviewed: true }).catalogue.labs;
    for (const labId of wanted.keys()) if (!mergedLabs.some((l) => l.id === labId)) fail(`unknown lab "${labId}"`);
    for (const lab of mergedLabs) {
      const texts = wanted.get(lab.id) || [];
      const wn = new Set(texts.map(LC.norm));
      let heads = asArr(lab.groupHeadings).map((g) => ({
        ...g,
        identifies: [...asArr(g.identifies)],
        mayContain: [...asArr(g.mayContain)],
      }));
      heads = heads
        .map((g) =>
          g.identifies.includes(id) && !wn.has(LC.norm(g.text))
            ? { ...g, identifies: g.identifies.filter((x) => x !== id) }
            : g
        )
        .filter((g) => g.identifies.length || g.mayContain.length);
      for (const t of texts) {
        const cur = heads.find((g) => LC.norm(g.text) === LC.norm(t));
        if (!cur) heads.push({ text: t, identifies: [id], mayContain: [] });
        else if (!cur.identifies.includes(id)) cur.identifies.push(id);
      }
      if (headingsContent(heads) === headingsContent(lab.groupHeadings)) continue; // nothing changed for this lab
      const bl = asArr(builtin && builtin.labs).find((l) => l.id === lab.id);
      const li = o.labs.findIndex((l) => l.id === lab.id);
      if (bl && headingsContent(bl.groupHeadings) === headingsContent(heads)) {
        if (li >= 0) o.labs.splice(li, 1); // back to the shipped headings
        continue;
      }
      const prov = li >= 0 ? o.labs[li].provenance : { source: 'practice', createdAt: day };
      const labEntry = {
        id: lab.id,
        name: lab.name,
        identifiers: { ...lab.identifiers },
        groupHeadings: heads,
        provenance: { ...prov, reviewed: false },
      };
      if (lab.orderingSystem) labEntry.orderingSystem = lab.orderingSystem;
      if (lab.structured !== undefined) labEntry.structured = lab.structured;
      if (lab.note) labEntry.note = lab.note;
      if (bl) labEntry.override = true;
      if (li >= 0) o.labs[li] = labEntry;
      else o.labs.push(labEntry);
    }
    const clean = sanitiseOverlay(o);
    assertUsable(builtin, clean, [id]);
    return { overlay: clean, id, reverted: !!unchanged };
  }

  // Add ONE more request wording to an investigation that already exists — Medicus's OWN exact phrasing (e.g. "Urea
  // and Electrolytes WITH potassium"), kept on record in addition to whatever shorter alias already matches it
  // (Nick, 2026-09-24: a request the scan already recognises via a short alias was previously never offered by its
  // full wording — this is the one-click way to add it without opening the whole editor). Reuses saveInvestigation
  // so nothing else about the investigation is touched; a duplicate (by text, case/spacing aside) is a no-op.
  function addRequestAlias(builtin, overlay, invId, text, system, today) {
    const LC = core();
    const merged = mergeCatalogue(builtin, overlay, { includeUnreviewed: true }).catalogue;
    const inv = asArr(merged.investigations).find((i) => i.id === invId);
    if (!inv) fail('unknown investigation "' + invId + '"');
    const clean = String(text == null ? '' : text).trim();
    if (!clean) fail('a request wording is required');
    const nt = LC.norm(clean);
    if (
      asArr(inv.requestAliases).some((a) => LC.norm(a.text) === nt) ||
      asArr(inv.synonyms).some((s) => LC.norm(s) === nt)
    ) {
      return safeClone(overlay); // already known, as an exact wording or as a synonym
    }
    const labHeadings = [];
    for (const lab of asArr(merged.labs))
      for (const g of asArr(lab.groupHeadings))
        if (asArr(g.identifies).includes(invId)) labHeadings.push({ lab: lab.id, text: g.text });
    const spec = {
      id: invId,
      label: inv.label,
      kind: inv.kind,
      note: inv.note,
      requestAliases: [
        ...asArr(inv.requestAliases).map((a) => ({ text: a.text, system: a.system })),
        { text: clean, system: system || 'any' },
      ],
      synonyms: [...asArr(inv.synonyms)],
      headingAliases: [...asArr(inv.headingAliases)],
      exclude: [...asArr(inv.exclude)],
      members: asArr(inv.members).map((m) => ({ result: m.result, role: m.role, anchor: m.anchor === true })),
      labHeadings,
    };
    return saveInvestigation(builtin, overlay, spec, today).overlay;
  }

  // Put a built-in investigation back to its shipped definition (and its shipped report headings).
  function revertInvestigation(builtin, overlay, id, today) {
    const b = asArr(builtin && builtin.investigations).find((i) => i.id === id);
    if (!b) fail(`investigations "${id}" is not a built-in`);
    const labHeadings = [];
    for (const lab of asArr(builtin.labs))
      for (const g of asArr(lab.groupHeadings))
        if (asArr(g.identifies).includes(id)) labHeadings.push({ lab: lab.id, text: g.text });
    const reverted = saveInvestigation(
      builtin,
      overlay,
      {
        id,
        label: b.label,
        kind: b.kind,
        requestAliases: b.requestAliases,
        synonyms: b.synonyms,
        headingAliases: b.headingAliases,
        exclude: b.exclude,
        members: b.members,
        note: b.note,
        labHeadings,
      },
      today
    );
    // discard everything the practice had recorded against this test (a carrier entry, if one was kept)
    reverted.overlay.investigations = reverted.overlay.investigations.filter((i) => i.id !== id);
    return reverted;
  }

  // Plain-language list of what differs from the SHIPPED definition (for the review screen).
  function describeChanges(builtin, overlay, invId) {
    const LC = core();
    const m = mergeCatalogue(builtin, overlay, { includeUnreviewed: true }).catalogue;
    const b = asArr(builtin && builtin.investigations).find((i) => i.id === invId);
    const n = m.investigations.find((i) => i.id === invId);
    if (!b || !n) return [];
    const out = [];
    if (b.label !== n.label) out.push(`Name changed from "${b.label}" to "${n.label}"`);
    if (b.kind !== n.kind) out.push(`Sample changed from ${b.kind} to ${n.kind}`);
    const diff = (what, before, after, fmt) => {
      const bk = new Map(before.map((x) => [fmt(x).toLowerCase(), fmt(x)]));
      const ak = new Map(after.map((x) => [fmt(x).toLowerCase(), fmt(x)]));
      for (const [k, v] of ak) if (!bk.has(k)) out.push(`Added ${what}: ${v}`);
      for (const [k, v] of bk) if (!ak.has(k)) out.push(`Removed ${what}: ${v}`);
    };
    diff(
      'request wording',
      asArr(b.requestAliases),
      asArr(n.requestAliases),
      (a) => a.text + (a.system !== 'any' ? ` (${a.system})` : '')
    );
    diff('synonym', asArr(b.synonyms), asArr(n.synonyms), (x) => x);
    diff('report heading', asArr(b.headingAliases), asArr(n.headingAliases), (x) => x);
    diff('"never matches" word', asArr(b.exclude), asArr(n.exclude), (x) => x);
    const resLabel = (id) => (asArr(m.results).find((r) => r.id === id) || { label: id }).label;
    diff(
      'result',
      asArr(b.members),
      asArr(n.members),
      (x) => `${resLabel(x.result)} (${x.role}${x.anchor ? ', any one' : ''})`
    );
    for (const mem of asArr(n.members)) {
      const br = asArr(builtin.results).find((r) => r.id === mem.result);
      const nr = asArr(m.results).find((r) => r.id === mem.result);
      if (!br || !nr) continue;
      const name = nr.label;
      diff(`code on ${name}`, asArr(br.codes), asArr(nr.codes), (c) => c.conceptId);
      diff(`wording on ${name}`, asArr(br.aliases), asArr(nr.aliases), (a) => (a.lab ? `${a.lab}: ` : '') + a.text);
    }
    const heads = (cat) => {
      const l = [];
      for (const lab of asArr(cat.labs))
        for (const g of asArr(lab.groupHeadings))
          if (asArr(g.identifies).includes(invId)) l.push({ lab: lab.id, text: g.text });
      return l;
    };
    diff('lab heading', heads(builtin), heads(m), (x) => `${x.lab}: ${x.text}`);
    return out;
  }

  // ── Fills learned from real reports (C4) ───────────────────────────────────────────────────────────────────────
  // fills: { labs:[{ref, newLab?:{name, org, dept}, headings:[{text, identifies:[invId]}]}],
  //          results:[{key?, id?, label?, valueKind?, codes:[{conceptId, unit?}], aliases:[{text, lab?}]}],
  //          members:[{investigation, result (id | "new:<key>"), role}] }
  // ADDITIVE: built-ins get an append-only entry (never an override), existing overlay entries are extended in place, and
  // everything touched goes (back) to "awaiting review". A practice-only result that changes withdraws the approval of
  // the tests that use it (same reason as saveResult).
  function applyFills(builtin, overlay, fills, today) {
    const LC = core();
    const day = today || new Date().toISOString().slice(0, 10);
    const o = safeClone(overlay);
    const f = isObj(fills) ? fills : {};
    const prov = (old) => ({
      source: old && old.source ? old.source : 'imported',
      reviewed: false,
      createdAt: (old && old.createdAt) || day,
      importedFrom: (old && old.importedFrom) || 'results-scan',
    });
    const added = { labs: 0, results: 0, codes: 0, aliases: 0, members: 0, headings: 0 };
    const touched = [];

    // labs -> real ids
    const labIdFor = new Map();
    const takenLabs = new Set([...asArr(builtin && builtin.labs).map((l) => l.id), ...o.labs.map((l) => l.id)]);
    for (const lf of asArr(f.labs)) {
      if (lf.newLab) {
        const org = String(lf.newLab.org || '').trim();
        if (!org) fail('a new lab needs the organisation code its reports carry');
        const id = freshId('lab', lf.newLab.name || org, takenLabs);
        takenLabs.add(id);
        const identifiers = { performerOrg: org };
        if (lf.newLab.dept) identifiers.department = String(lf.newLab.dept).trim();
        o.labs.push({
          id,
          name: String(lf.newLab.name || org).trim(),
          identifiers,
          groupHeadings: [],
          provenance: prov(null),
        });
        labIdFor.set(lf.ref, id);
        added.labs++;
        touched.push(id);
      } else labIdFor.set(lf.ref, lf.ref);
    }
    const mapLab = (ref) => (ref ? labIdFor.get(ref) || ref : undefined);

    // brand-new tests (from a request wording and/or an unlinked group) — awaiting review like everything else
    const newInvIds = new Map();
    const takenInv = new Set([
      ...asArr(builtin && builtin.investigations).map((i) => i.id),
      ...o.investigations.map((i) => i.id),
      ...o.retired,
    ]);
    for (const nf of asArr(f.newInvestigations)) {
      const label = String(nf.label || '').trim();
      if (!label) fail('a new test needs a name');
      const id = freshId('practice', label, takenInv);
      takenInv.add(id);
      o.investigations.push({
        id,
        label,
        kind: nf.kind || 'other',
        requestAliases: dropNorm(
          asArr(nf.requests)
            .map((t) => ({ text: String(t || '').trim(), system: 'any' }))
            .filter((a) => a.text),
          [],
          (a) => LC.norm(a.text) + '|' + a.system
        ),
        headingAliases: [],
        exclude: [],
        members: [],
        provenance: prov(null),
      });
      newInvIds.set('new:' + nf.key, id);
      added.tests = (added.tests || 0) + 1;
      touched.push(id);
    }
    const invId = (x) => newInvIds.get(x) || x;

    // results
    const keyToId = new Map();
    const allResultIds = new Set([
      ...asArr(builtin && builtin.results).map((r) => r.id),
      ...o.results.map((r) => r.id),
      ...o.retired,
    ]);
    const codeOwners = new Set();
    for (const r of [...asArr(builtin && builtin.results), ...o.results])
      for (const c of asArr(r.codes)) codeOwners.add(c.conceptId);
    const ensureResult = (id) => {
      let e = o.results.find((r) => r.id === id);
      if (e) return e;
      const b = asArr(builtin && builtin.results).find((r) => r.id === id);
      if (!b) fail(`unknown result "${id}"`);
      e = { id, label: b.label, valueKind: b.valueKind, codes: [], aliases: [], provenance: prov(null) };
      o.results.push(e);
      return e;
    };
    const withdrawDependents = (id, isBuiltin) => {
      if (isBuiltin) return;
      for (const inv of o.investigations)
        if (inv.provenance.reviewed === true && asArr(inv.members).some((m) => m.result === id))
          inv.provenance = { ...inv.provenance, reviewed: false };
    };
    for (const rf of asArr(f.results)) {
      if (rf.key) {
        const id = freshId('practice', rf.label, allResultIds);
        allResultIds.add(id);
        const codes = asArr(rf.codes)
          .filter((c) => c.conceptId && !codeOwners.has(String(c.conceptId).trim()))
          .map((c, i) => ({
            conceptId: String(c.conceptId).trim(),
            role: i === 0 ? 'primary' : 'alternate',
            ...(c.unit ? { unit: c.unit } : {}),
            ...(c.description ? { description: String(c.description).trim() } : {}),
          }));
        codes.forEach((c) => codeOwners.add(c.conceptId));
        o.results.push({
          id,
          label: String(rf.label || '').trim(),
          valueKind: rf.valueKind || 'mixed',
          codes,
          aliases: dropNorm(
            asArr(rf.aliases).map((a) => ({
              text: String(a.text || '').trim(),
              ...(mapLab(a.lab) ? { lab: mapLab(a.lab) } : {}),
            })),
            [],
            (a) => LC.norm(a.text) + '|' + (a.lab || '')
          ),
          provenance: prov(null),
        });
        keyToId.set(rf.key, id);
        added.results++;
        touched.push(id);
        continue;
      }
      const e = ensureResult(rf.id);
      const isBuiltin = asArr(builtin && builtin.results).some((r) => r.id === rf.id);
      const b = asArr(builtin && builtin.results).find((r) => r.id === rf.id);
      const haveCodes = new Set([...asArr(b && b.codes), ...e.codes].map((c) => c.conceptId));
      for (const c of asArr(rf.codes)) {
        const cid = String(c.conceptId || '').trim();
        if (!cid || haveCodes.has(cid) || codeOwners.has(cid)) continue; // a code belongs to one result only
        e.codes.push({
          conceptId: cid,
          role: haveCodes.size === 0 ? 'primary' : 'alternate',
          ...(c.unit ? { unit: c.unit } : {}),
          ...(c.description ? { description: String(c.description).trim() } : {}),
        });
        haveCodes.add(cid);
        codeOwners.add(cid);
        added.codes++;
      }
      const haveAlias = new Set(
        [...asArr(b && b.aliases), ...e.aliases].map((a) => LC.norm(a.text) + '|' + (a.lab || ''))
      );
      for (const a of asArr(rf.aliases)) {
        const lab = mapLab(a.lab);
        const k = LC.norm(a.text) + '|' + (lab || '');
        if (!LC.norm(a.text) || haveAlias.has(k)) continue;
        e.aliases.push({ text: String(a.text).trim(), ...(lab ? { lab } : {}) });
        haveAlias.add(k);
        added.aliases++;
      }
      e.provenance = prov(e.provenance);
      withdrawDependents(rf.id, isBuiltin);
      touched.push(rf.id);
    }

    // members
    const ensureInv = (id) => {
      let e = o.investigations.find((i) => i.id === id);
      if (e) return e;
      const b = asArr(builtin && builtin.investigations).find((i) => i.id === id);
      if (!b) fail(`unknown investigation "${id}"`);
      e = {
        id,
        label: b.label,
        kind: b.kind,
        requestAliases: [],
        headingAliases: [],
        exclude: [],
        members: [],
        provenance: prov(null),
      };
      if (b.legacyKey) e.legacyKey = b.legacyKey;
      o.investigations.push(e);
      return e;
    };
    for (const mf of asArr(f.members)) {
      const rid = keyToId.get(mf.result) || mf.result;
      const e = ensureInv(invId(mf.investigation));
      const b = asArr(builtin && builtin.investigations).find((i) => i.id === invId(mf.investigation));
      if ([...asArr(b && b.members), ...e.members].some((m) => m.result === rid)) continue;
      e.members.push({ result: rid, role: mf.role || 'optional' });
      e.provenance = prov(e.provenance);
      added.members++;
      touched.push(e.id);
    }

    // lab headings
    const ensureLab = (id) => {
      let e = o.labs.find((l) => l.id === id);
      if (e) return e;
      const b = asArr(builtin && builtin.labs).find((l) => l.id === id);
      if (!b) fail(`unknown lab "${id}"`);
      e = { id, name: b.name, identifiers: { ...b.identifiers }, groupHeadings: [], provenance: prov(null) };
      if (b.orderingSystem) e.orderingSystem = b.orderingSystem;
      if (b.structured !== undefined) e.structured = b.structured;
      o.labs.push(e);
      return e;
    };
    for (const lf of asArr(f.labs)) {
      const id = labIdFor.get(lf.ref);
      if (!asArr(lf.headings).length) continue;
      const e = ensureLab(id);
      const b = asArr(builtin && builtin.labs).find((l) => l.id === id);
      for (const h of lf.headings) {
        const text = String(h.text || '').trim();
        if (!text) continue;
        // A heading that already exists may identify OTHER tests (or a wrong one): this test is ADDED to what it identifies,
        // never replacing it. Nothing to do when it already identifies this test.
        const want = asArr(h.identifies).map(invId);
        const has = (g) => want.every((x) => asArr(g.identifies).includes(x));
        const same = (g) => LC.norm(g.text) === LC.norm(text);
        const mine = e.groupHeadings.find(same);
        const shipped = asArr(b && b.groupHeadings).find(same);
        if ((mine && has(mine)) || (!mine && shipped && has(shipped))) continue;
        if (mine) mine.identifies = [...new Set([...asArr(mine.identifies), ...want])];
        else e.groupHeadings.push({ text, identifies: want, mayContain: [] });
        added.headings++;
      }
      e.provenance = prov(e.provenance);
      touched.push(id);
    }

    // Every test a fill touches gets an overlay entry (even when the test itself gains nothing), because the entry is what
    // carries the review: approving the test approves the results and lab headings it depends on.
    const owners = new Set();
    for (const rf of asArr(f.results)) for (const id of asArr(rf.for)) owners.add(invId(id));
    for (const lf of asArr(f.labs))
      for (const h of asArr(lf.headings)) for (const id of asArr(h.identifies)) owners.add(invId(id));
    for (const mf of asArr(f.members)) owners.add(invId(mf.investigation));
    // a practice test that started as "other" (request only) takes its sample from the first report learned for it
    for (const k of asArr(f.kinds)) {
      const e = o.investigations.find((i) => i.id === invId(k.investigation));
      const isBuiltin = asArr(builtin && builtin.investigations).some((i) => i.id === invId(k.investigation));
      if (e && !isBuiltin && e.kind === 'other') e.kind = k.kind;
    }
    for (const id of owners) {
      const e = ensureInv(id);
      e.provenance = prov(e.provenance);
      touched.push(id);
    }
    const clean = sanitiseOverlay(o);
    assertUsable(builtin, clean, touched);
    return { overlay: clean, added };
  }

  // ── Merge one test into another (C5) ────────────────────────────────────────────────────────────────────────────
  // "This is really part of that other test": the practice test FROM is deleted and everything it knew moves onto INTO —
  // its results (as OPTIONAL when INTO already has an identifying result, so how many results INTO needs to be recognised
  // never changes), its request wordings and report headings, and every lab heading that identified it now identifies
  // INTO. INTO goes back to awaiting review. A built-in test cannot be merged away (disable it instead); it CAN be the
  // target (additive entry).
  function mergeInvestigation(builtin, overlay, fromId, intoId, today) {
    const LC = core();
    const day = today || new Date().toISOString().slice(0, 10);
    if (fromId === intoId) fail('a test cannot be merged into itself');
    if (asArr(builtin && builtin.investigations).some((i) => i.id === fromId))
      fail('a built-in test cannot be merged away — disable it instead');
    const o = safeClone(overlay);
    const merged = mergeCatalogue(builtin, o, { includeUnreviewed: true }).catalogue;
    const F = merged.investigations.find((i) => i.id === fromId);
    const T = merged.investigations.find((i) => i.id === intoId);
    if (!F) fail(`investigations "${fromId}" not found`);
    if (!T) fail(`investigations "${intoId}" not found`);
    let e = o.investigations.find((i) => i.id === intoId);
    if (!e) {
      const b = asArr(builtin && builtin.investigations).find((i) => i.id === intoId);
      if (!b) fail(`investigations "${intoId}" not found`);
      e = {
        id: b.id,
        label: b.label,
        kind: b.kind,
        requestAliases: [],
        headingAliases: [],
        exclude: [],
        members: [],
        provenance: authoredProvenance(null, day),
      };
      if (b.legacyKey) e.legacyKey = b.legacyKey;
      o.investigations.push(e);
    }
    const moved = { results: 0, requests: 0, headings: 0 };
    const have = new Set(asArr(T.members).map((m) => m.result));
    const targetHasCore = asArr(T.members).some((m) => m.role === 'core');
    for (const m of asArr(F.members)) {
      if (have.has(m.result)) continue;
      const role = targetHasCore && m.role === 'core' ? 'optional' : m.role;
      const mem = { result: m.result, role };
      if (role === 'core' && m.anchor === true) mem.anchor = true;
      e.members.push(mem);
      have.add(m.result);
      moved.results++;
    }
    const haveReq = new Set(asArr(T.requestAliases).map((a) => LC.norm(a.text) + '|' + a.system));
    for (const a of [{ text: F.label, system: 'any' }, ...asArr(F.requestAliases)]) {
      const k = LC.norm(a.text) + '|' + a.system;
      if (!LC.norm(a.text) || haveReq.has(k)) continue;
      e.requestAliases.push({ text: a.text, system: a.system });
      haveReq.add(k);
      moved.requests++;
    }
    const haveHead = new Set(asArr(T.headingAliases).map(LC.norm));
    for (const h of asArr(F.headingAliases)) {
      if (haveHead.has(LC.norm(h))) continue;
      e.headingAliases.push(h);
      haveHead.add(LC.norm(h));
      moved.headings++;
    }
    e.synonyms = asArr(e.synonyms);
    const haveSyn = new Set([...asArr(T.synonyms).map(LC.norm), ...haveReq]); // a synonym already present as a request wording is not duplicated either
    for (const s of asArr(F.synonyms)) {
      const k = LC.norm(s);
      if (!k || haveSyn.has(k)) continue;
      e.synonyms.push(s);
      haveSyn.add(k);
    }
    for (const lab of o.labs) {
      let changed = false;
      for (const g of asArr(lab.groupHeadings)) {
        if (asArr(g.identifies).includes(fromId)) {
          g.identifies = [...new Set(g.identifies.map((x) => (x === fromId ? intoId : x)))];
          changed = true;
          moved.headings++;
        }
        if (asArr(g.mayContain).includes('inv:' + fromId)) {
          g.mayContain = [...new Set(g.mayContain.map((x) => (x === 'inv:' + fromId ? 'inv:' + intoId : x)))];
          changed = true;
        }
      }
      if (changed) lab.provenance = { ...lab.provenance, reviewed: false };
    }
    o.investigations = o.investigations.filter((i) => i.id !== fromId);
    o.disabled.investigations = o.disabled.investigations.filter((x) => x !== fromId);
    e.provenance = { ...e.provenance, reviewed: false };
    delete e.provenance.reviewedBy;
    delete e.provenance.reviewedAt;
    const clean = sanitiseOverlay(o);
    assertUsable(builtin, clean, [intoId]);
    return { overlay: clean, moved };
  }

  // "This is the same analyte, just a different code/wording": move a result's codes and other names onto another
  // result, repoint every test that used it, and remove the duplicate. Mirrors mergeInvestigation above — same
  // "never merge away a built-in" rule, same "target goes back to awaiting review" outcome. Nick's 2026-09-23 case:
  // a scan creates a new practice result for a report row whose code/wording differs from an existing result that
  // means the same thing (e.g. a re-worded creatinine), and the two need collapsing into one before either is used.
  function mergeResult(builtin, overlay, fromId, intoId, today) {
    const LC = core();
    const day = today || new Date().toISOString().slice(0, 10);
    if (fromId === intoId) fail('a result cannot be merged into itself');
    if (asArr(builtin && builtin.results).some((r) => r.id === fromId))
      fail('a built-in result cannot be merged away — disable it instead');
    const o = safeClone(overlay);
    const merged = mergeCatalogue(builtin, o, { includeUnreviewed: true }).catalogue;
    const F = merged.results.find((r) => r.id === fromId);
    const T = merged.results.find((r) => r.id === intoId);
    if (!F) fail(`result "${fromId}" not found`);
    if (!T) fail(`result "${intoId}" not found`);
    let e = o.results.find((r) => r.id === intoId);
    if (!e) {
      const b = asArr(builtin && builtin.results).find((r) => r.id === intoId);
      if (!b) fail(`result "${intoId}" not found`);
      e = {
        id: b.id,
        label: b.label,
        valueKind: b.valueKind,
        codes: [],
        aliases: [],
        override: true,
        provenance: authoredProvenance(null, day),
      };
      o.results.push(e);
    }
    const moved = { codes: 0, aliases: 0, tests: 0 };
    e.codes = asArr(e.codes);
    const haveCode = new Set(e.codes.map((c) => c.conceptId));
    for (const c of asArr(F.codes)) {
      if (haveCode.has(c.conceptId)) continue;
      e.codes.push({ ...c, role: 'alternate' });
      haveCode.add(c.conceptId);
      moved.codes++;
    }
    e.aliases = asArr(e.aliases);
    const haveAlias = new Set([LC.norm(T.label) + '|', ...e.aliases.map((a) => LC.norm(a.text) + '|' + (a.lab || ''))]);
    for (const a of [{ text: F.label }, ...asArr(F.aliases)]) {
      const k = LC.norm(a.text) + '|' + (a.lab || '');
      if (!LC.norm(a.text) || haveAlias.has(k)) continue;
      e.aliases.push({ text: a.text, ...(a.lab ? { lab: a.lab } : {}) });
      haveAlias.add(k);
      moved.aliases++;
    }
    // every test that had "from" as a member now has "into" instead — never both, and never a second core if "into"
    // already has one (the same role-conflict rule mergeInvestigation uses for the reverse case).
    for (const inv of o.investigations) {
      const from = asArr(inv.members).find((m) => m.result === fromId);
      if (!from) continue;
      const already = inv.members.find((m) => m.result === intoId);
      if (already) {
        if (from.role === 'core' && already.role !== 'core') already.role = 'core';
        if (from.anchor === true && already.role === 'core') already.anchor = true;
        inv.members = inv.members.filter((m) => m.result !== fromId);
      } else {
        from.result = intoId;
      }
      inv.provenance = { ...inv.provenance, reviewed: false };
      moved.tests++;
    }
    // a fresh, unreviewed result almost never has filing setup yet, but if it does, remap rather than drop it — the
    // target's own entry wins on a clash (rejectDuplicateKeys would otherwise throw on the merged overlay below).
    for (const kind of ['ranges', 'guards']) {
      const keyOf = kind === 'ranges' ? filingKey : filingGuardKey;
      const remapped = asArr(o.filing[kind]).map((r) => (r.result === fromId ? { ...r, result: intoId } : r));
      const seen = new Set();
      o.filing[kind] = remapped.filter((r) => {
        if (r.result !== intoId) return true;
        const k = keyOf(r);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }
    o.results = o.results.filter((r) => r.id !== fromId);
    o.disabled.results = o.disabled.results.filter((x) => x !== fromId);
    e.provenance = { ...e.provenance, reviewed: false };
    delete e.provenance.reviewedBy;
    delete e.provenance.reviewedAt;
    const clean = sanitiseOverlay(o);
    assertUsable(builtin, clean, [intoId]);
    return { overlay: clean, moved };
  }

  // "This is the same lab as that one, under a different reported name": move its report headings onto the target
  // lab, repoint every result's lab-tagged alias and every lab-keyed filing entry (ranges/guards/comment groups), then
  // delete the duplicate. Mirrors mergeInvestigation/mergeResult above. Nick, 2026-09-24: several proposals learned
  // from the SAME not-yet-known lab in one scan, applied together, each created their OWN "new" lab entry — this is
  // the cleanup tool for duplicates that already exist; fillsFromProposals itself was fixed so it stops happening.
  function mergeLab(builtin, overlay, fromId, intoId, today) {
    const LC = core();
    const day = today || new Date().toISOString().slice(0, 10);
    if (fromId === intoId) fail('a lab cannot be merged into itself');
    if (asArr(builtin && builtin.labs).some((l) => l.id === fromId))
      fail('a built-in lab cannot be merged away — disable it instead');
    const o = safeClone(overlay);
    const merged = mergeCatalogue(builtin, o, { includeUnreviewed: true }).catalogue;
    const F = merged.labs.find((l) => l.id === fromId);
    const T = merged.labs.find((l) => l.id === intoId);
    if (!F) fail(`lab "${fromId}" not found`);
    if (!T) fail(`lab "${intoId}" not found`);
    let e = o.labs.find((l) => l.id === intoId);
    if (!e) {
      const b = asArr(builtin && builtin.labs).find((l) => l.id === intoId);
      if (!b) fail(`lab "${intoId}" not found`);
      e = {
        id: b.id,
        name: b.name,
        identifiers: { ...b.identifiers },
        groupHeadings: [],
        provenance: authoredProvenance(null, day),
      };
      o.labs.push(e);
    }
    const moved = { headings: 0, aliases: 0, filing: 0 };
    e.groupHeadings = asArr(e.groupHeadings);
    const haveHead = new Set(e.groupHeadings.map((g) => LC.norm(g.text)));
    for (const g of asArr(F.groupHeadings)) {
      const k = LC.norm(g.text);
      if (haveHead.has(k)) continue; // the target already has this heading — the duplicate's copy adds nothing
      const copy = { text: g.text, identifies: [...asArr(g.identifies)], mayContain: [...asArr(g.mayContain)] };
      if (g.note) copy.note = g.note;
      e.groupHeadings.push(copy);
      haveHead.add(k);
      moved.headings++;
    }
    // every result's alias tagged for the from-lab moves to the into-lab (deduped against what's already there)
    for (const r of o.results) {
      if (!asArr(r.aliases).some((a) => a.lab === fromId)) continue;
      const seen = new Set();
      r.aliases = asArr(r.aliases)
        .map((a) => (a.lab === fromId ? { ...a, lab: intoId } : a))
        .filter((a) => {
          const k = LC.norm(a.text) + '|' + (a.lab || '');
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
      r.provenance = { ...r.provenance, reviewed: false };
      moved.aliases++;
    }
    // filing entries keyed by lab (ranges, guards, comment groups) remap the same way results' ranges/guards do —
    // target's own entry wins on a clash.
    for (const kind of ['ranges', 'guards', 'groups']) {
      const keyOf = FILING_KINDS[kind].key;
      moved.filing += asArr(o.filing[kind]).filter((f) => f.lab === fromId).length;
      const remapped = asArr(o.filing[kind]).map((f) => (f.lab === fromId ? { ...f, lab: intoId } : f));
      const seen = new Set();
      o.filing[kind] = remapped.filter((f) => {
        if (f.lab !== intoId) return true;
        const k = keyOf(f);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }
    o.labs = o.labs.filter((l) => l.id !== fromId);
    e.provenance = { ...e.provenance, reviewed: false };
    delete e.provenance.reviewedBy;
    delete e.provenance.reviewedAt;
    const clean = sanitiseOverlay(o);
    assertUsable(builtin, clean, [intoId]);
    return { overlay: clean, moved };
  }

  // The lab-specific headings this investigation currently owns (for the edit form).
  function ownLabHeadings(overlay, id) {
    const out = [];
    for (const lab of asArr(overlay && overlay.labs))
      for (const g of asArr(lab.groupHeadings))
        if (asArr(g.identifies).length === 1 && g.identifies[0] === id && !asArr(g.mayContain).length)
          out.push({ lab: lab.id, text: g.text });
    return out;
  }

  // Remove an overlay investigation. Overlay results that were still unreviewed and are no longer used by anything are
  // removed with it; anything approved, or still used elsewhere, is left alone. Never touches the built-in.
  // A lab heading that points at a test (or result) that no longer exists would make the WHOLE lab entry invalid. Remove the
  // pointers; a heading left pointing at nothing is dropped; a lab that changed goes back to awaiting review.
  function stripFromLabs(o, ref, invId) {
    for (const lab of o.labs) {
      let changed = false;
      lab.groupHeadings = asArr(lab.groupHeadings)
        .map((g) => {
          const identifies = invId ? asArr(g.identifies).filter((x) => x !== invId) : asArr(g.identifies);
          const mayContain = asArr(g.mayContain).filter((x) => x !== ref);
          if (identifies.length !== asArr(g.identifies).length || mayContain.length !== asArr(g.mayContain).length)
            changed = true;
          return { ...g, identifies, mayContain };
        })
        .filter((g) => g.identifies.length || g.mayContain.length || !changed);
      if (changed) lab.provenance = { ...lab.provenance, reviewed: false };
    }
  }

  // Remove ANY overlay entry by kind — used for entries the merge had to exclude (they are not listed anywhere else).
  function removeEntry(overlay, kind, id) {
    if (!['results', 'investigations', 'labs'].includes(kind)) fail(`unknown kind "${kind}"`);
    const o = safeClone(overlay);
    const before = o[kind].length;
    o[kind] = o[kind].filter((x) => x.id !== id);
    if (o[kind].length === before) fail(`${kind} "${id}" not found`);
    if (kind === 'investigations') {
      o.disabled.investigations = o.disabled.investigations.filter((x) => x !== id);
      stripFromLabs(o, 'inv:' + id, id);
    } else if (kind === 'results') {
      o.disabled.results = o.disabled.results.filter((x) => x !== id);
      for (const inv of o.investigations) {
        const n = asArr(inv.members).length;
        inv.members = asArr(inv.members).filter((m) => m.result !== id);
        if (inv.members.length !== n) inv.provenance = { ...inv.provenance, reviewed: false };
      }
      stripFromLabs(o, 'res:' + id, null);
      o.filing.ranges = o.filing.ranges.filter((r) => r.result !== id);
      o.filing.guards = o.filing.guards.filter((r) => r.result !== id);
    } else if (kind === 'labs') {
      for (const name of Object.keys(FILING_KINDS)) o.filing[name] = o.filing[name].filter((r) => r.lab !== id);
    }
    return sanitiseOverlay(o);
  }

  function removeInvestigation(builtin, overlay, id) {
    const o = safeClone(overlay);
    const before = o.investigations.length;
    const gone = o.investigations.find((x) => x.id === id);
    o.investigations = o.investigations.filter((x) => x.id !== id);
    if (o.investigations.length === before) fail(`investigations "${id}" not found`);
    // a deleted IMPORTED test is remembered, or the next "read my tests" would quietly recreate it
    if (gone && gone.provenance && gone.provenance.source === 'imported') {
      const list = asArr(o.context && o.context.dismissed).filter((x) => x !== id);
      list.push(id);
      o.context = { ...(o.context || {}), dismissed: list.slice(-300) };
    }
    const used = new Set();
    for (const i of [...asArr(builtin && builtin.investigations), ...o.investigations])
      for (const m of asArr(i.members)) used.add(m.result);
    const removedResults = [];
    o.results = o.results.filter((r) => {
      const orphan = r.provenance.reviewed !== true && !used.has(r.id);
      if (orphan) removedResults.push(r.id);
      return !orphan;
    });
    o.disabled.investigations = o.disabled.investigations.filter((x) => x !== id);
    stripFromLabs(o, 'inv:' + id, id);
    o.filing.ranges = o.filing.ranges.filter((r) => !removedResults.includes(r.result));
    o.filing.guards = o.filing.guards.filter((r) => !removedResults.includes(r.result));
    return { overlay: o, removedResults };
  }

  // Give a lab a human-readable name (display only). An empty name removes it, so the lab shows its own name again.
  function renameLab(overlay, labId, name) {
    const o = safeClone(overlay);
    const names = { ...((o.context && o.context.labNames) || {}) };
    const clean = String(name == null ? '' : name).trim();
    if (clean) names[labId] = clean;
    else delete names[labId];
    o.context = { ...(o.context || {}), labNames: names };
    return sanitiseOverlay(o);
  }

  // A plain-English note on ONE of a lab's report-group headings — "used when the set includes potassium" — so two
  // heading variants of the same test (e.g. "Renal function tests" vs "U&Es" at one lab) can say what tells them
  // apart. Cosmetic only, like renameLab: it never changes matching/recognition or filing, so it does NOT withdraw
  // any approval. An override lab entry is created if this lab is still shipped/built-in.
  function setHeadingNote(builtin, overlay, labId, headingText, note) {
    const o = safeClone(overlay);
    const LC = core();
    const merged = mergeCatalogue(builtin, o, { includeUnreviewed: true }).catalogue;
    const lab = asArr(merged.labs).find((l) => l.id === labId);
    if (!lab) fail('unknown lab "' + labId + '"');
    const nh = LC.norm(headingText);
    if (!asArr(lab.groupHeadings).some((g) => LC.norm(g.text) === nh)) {
      fail('"' + headingText + '" is not a report group heading recorded for ' + lab.name);
    }
    const cleanNote = String(note == null ? '' : note).trim();
    const heads = asArr(lab.groupHeadings).map((g) => {
      const next = { text: g.text, identifies: [...asArr(g.identifies)], mayContain: [...asArr(g.mayContain)] };
      const n = LC.norm(g.text) === nh ? cleanNote : g.note;
      if (n) next.note = n;
      return next;
    });
    const bl = asArr(builtin && builtin.labs).find((l) => l.id === labId);
    const li = o.labs.findIndex((l) => l.id === labId);
    const labEntry = {
      id: lab.id,
      name: lab.name,
      identifiers: { ...lab.identifiers },
      groupHeadings: heads,
      provenance: li >= 0 ? o.labs[li].provenance : { source: 'practice', createdAt: new Date().toISOString().slice(0, 10) },
    };
    if (lab.orderingSystem) labEntry.orderingSystem = lab.orderingSystem;
    if (lab.structured !== undefined) labEntry.structured = lab.structured;
    if (lab.note) labEntry.note = lab.note;
    if (bl) labEntry.override = true;
    if (li >= 0) o.labs[li] = labEntry;
    else o.labs.push(labEntry);
    return sanitiseOverlay(o);
  }

  // "Bring my deleted imported tests back": forget the deletions (the next import re-adds them).
  function restoreDismissed(overlay) {
    const o = safeClone(overlay);
    o.context = { ...(o.context || {}), dismissed: [] };
    return o;
  }

  // "It's not X": a person's explicit, remembered "these two results are NOT the same analyte" — the similarity HINT
  // (SC.similarResults, called from the match board and a test's own results table) must stop suggesting this pairing.
  // Sorted so order never matters ("a|b" and "b|a" are the same dismissal). Nick, 2026-09-24: "an option 'it's not X'
  // which then stops offering the match".
  const similarPairKey = (idA, idB) => [idA, idB].sort().join('|');
  function isSimilarPairDismissed(overlay, idA, idB) {
    const list = asArr(overlay && overlay.context && overlay.context.dismissedSimilarPairs);
    return list.includes(similarPairKey(idA, idB));
  }
  function dismissSimilarPair(overlay, idA, idB) {
    const o = safeClone(overlay);
    const key = similarPairKey(idA, idB);
    const list = asArr(o.context && o.context.dismissedSimilarPairs).filter((x) => x !== key);
    list.push(key);
    o.context = { ...(o.context || {}), dismissedSimilarPairs: list.slice(-500) };
    return sanitiseOverlay(o);
  }
  function restoreDismissedSimilarPairs(overlay) {
    const o = safeClone(overlay);
    o.context = { ...(o.context || {}), dismissedSimilarPairs: [] };
    return o;
  }

  function setInvestigationDisabled(overlay, id, disabled) {
    const o = safeClone(overlay);
    const has = o.disabled.investigations.includes(id);
    if (disabled && !has) o.disabled.investigations.push(id);
    if (!disabled && has) o.disabled.investigations = o.disabled.investigations.filter((x) => x !== id);
    return o;
  }

  // ── Merge ──────────────────────────────────────────────────────────────────────
  function mergeCatalogue(builtin, overlayIn, opts) {
    const LC = core();
    if (!LC) throw new Error('LabCatalogue core is not available in this context.');
    const norm = LC.norm;
    const includeUnreviewed = !!(opts && opts.includeUnreviewed);
    const problems = [];
    const excluded = [];
    const overlay = overlayIn ? sanitiseOverlay(overlayIn) : emptyOverlay();
    const base = JSON.parse(JSON.stringify(builtin));
    const baseResultIds = new Set(asArr(base.results).map((r) => r.id));
    const baseInvIds = new Set(asArr(base.investigations).map((i) => i.id));
    const baseLabIds = new Set(asArr(base.labs).map((l) => l.id));
    const baseValid = LC.validateCatalogue(base);
    if (baseValid.errors.length)
      throw new Error('The built-in lab catalogue is invalid: ' + baseValid.errors.slice(0, 3).join('; '));

    const usable = (e, kind) => {
      if (!includeUnreviewed && !(e.provenance && e.provenance.reviewed === true)) {
        excluded.push({ kind, id: e.id, reason: 'unreviewed' });
        return false;
      }
      if (
        overlay.retired.includes(e.id) &&
        !(kind === 'results' ? baseResultIds : kind === 'investigations' ? baseInvIds : baseLabIds).has(e.id)
      ) {
        problems.push({ kind, id: e.id, reason: 'id was retired and cannot be reused', fatal: false });
        return false;
      }
      return true;
    };
    const dedupe = (list, keyFn) => {
      const seen = new Set();
      return list.filter((x) => {
        const k = keyFn(x);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    };

    // --- additive application of one overlay entry onto a working catalogue -----------------------------------
    function applyResult(cat, o) {
      const existing = cat.results.find((r) => r.id === o.id);
      if (!existing) {
        cat.results.push(JSON.parse(JSON.stringify(o)));
        return;
      }
      if (o.override) {
        // the practice has edited this built-in and approved its own version: it REPLACES the shipped definition
        cat.results[cat.results.indexOf(existing)] = JSON.parse(JSON.stringify(o));
        return;
      }
      if (o.label !== existing.label)
        problems.push({ kind: 'results', id: o.id, reason: 'label of a built-in result cannot be changed (ignored)' });
      if (o.valueKind !== existing.valueKind)
        problems.push({
          kind: 'results',
          id: o.id,
          reason: 'valueKind of a built-in result cannot be changed (ignored)',
        });
      const have = new Set(existing.codes.map((c) => c.conceptId));
      let hasPrimary = existing.codes.some((c) => c.role === 'primary');
      for (const c of o.codes) {
        if (have.has(c.conceptId)) {
          // a description is only a label: it may be filled in on a code the built-in already lists
          const cur = existing.codes.find((x) => x.conceptId === c.conceptId);
          if (cur && !cur.description && c.description) cur.description = c.description;
          continue;
        }
        const role = hasPrimary ? 'alternate' : c.role;
        if (role === 'primary') hasPrimary = true;
        existing.codes.push({ ...c, role });
      }
      existing.aliases = dedupe([...asArr(existing.aliases), ...o.aliases], (a) => norm(a.text) + '|' + (a.lab || ''));
      if (o.excludeAliases && o.excludeAliases.length) {
        existing.excludeAliases = dedupe([...asArr(existing.excludeAliases), ...o.excludeAliases], (x) => norm(x));
      }
    }
    function applyInvestigation(cat, o) {
      const existing = cat.investigations.find((i) => i.id === o.id);
      if (!existing) {
        cat.investigations.push(JSON.parse(JSON.stringify(o)));
        return;
      }
      if (o.override) {
        cat.investigations[cat.investigations.indexOf(existing)] = JSON.parse(JSON.stringify(o));
        return;
      }
      if (o.label !== existing.label)
        problems.push({
          kind: 'investigations',
          id: o.id,
          reason: 'label of a built-in investigation cannot be changed (ignored)',
        });
      existing.requestAliases = dedupe(
        [...asArr(existing.requestAliases), ...o.requestAliases],
        (a) => norm(a.text) + '|' + a.system
      );
      existing.synonyms = dedupe([...asArr(existing.synonyms), ...asArr(o.synonyms)], (x) => norm(x));
      existing.headingAliases = dedupe([...asArr(existing.headingAliases), ...o.headingAliases], (x) => norm(x));
      if (o.exclude.length) existing.exclude = dedupe([...asArr(existing.exclude), ...o.exclude], (x) => norm(x));
      const haveMembers = new Map(asArr(existing.members).map((m) => [m.result, m]));
      existing.members = asArr(existing.members);
      for (const m of o.members) {
        const cur = haveMembers.get(m.result);
        if (!cur) existing.members.push({ ...m });
        else if (cur.role !== m.role)
          problems.push({
            kind: 'investigations',
            id: o.id,
            reason: `role of existing member "${m.result}" cannot be changed (ignored)`,
          });
      }
    }
    // heading links must point at tests / results that exist in the catalogue being built; others are dropped, not fatal
    function pruneLab(cat, lab) {
      const inv = new Set(asArr(cat.investigations).map((i) => i.id));
      const res = new Set(asArr(cat.results).map((r) => r.id));
      let dropped = 0;
      const out = JSON.parse(JSON.stringify(lab));
      out.groupHeadings = asArr(out.groupHeadings)
        .map((g) => {
          const identifies = asArr(g.identifies).filter((x) => inv.has(x));
          const mayContain = asArr(g.mayContain).filter((ref) =>
            ref.startsWith('inv:') ? inv.has(ref.slice(4)) : res.has(ref.slice(4))
          );
          dropped += asArr(g.identifies).length - identifies.length + asArr(g.mayContain).length - mayContain.length;
          return { ...g, identifies, mayContain };
        })
        .filter((g) => g.identifies.length || g.mayContain.length);
      if (dropped)
        problems.push({
          kind: 'labs',
          id: lab.id,
          reason: `${dropped} heading link(s) pointed at a test or result that no longer exists (ignored)`,
          fatal: false,
        });
      return out;
    }
    function applyLab(cat, oRaw) {
      const o = pruneLab(cat, oRaw);
      const existing = cat.labs.find((l) => l.id === o.id);
      if (!existing) {
        cat.labs.push(JSON.parse(JSON.stringify(o)));
        return;
      }
      if (o.override) {
        cat.labs[cat.labs.indexOf(existing)] = JSON.parse(JSON.stringify(o));
        return;
      }
      existing.groupHeadings = asArr(existing.groupHeadings);
      for (const h of o.groupHeadings) {
        const cur = existing.groupHeadings.find((x) => norm(x.text) === norm(h.text));
        if (!cur) existing.groupHeadings.push({ ...h });
        else {
          cur.identifies = dedupe([...asArr(cur.identifies), ...h.identifies], (x) => x);
          cur.mayContain = dedupe([...asArr(cur.mayContain), ...h.mayContain], (x) => x);
        }
      }
    }
    // --- display names the practice gave its labs (cosmetic: identification uses org / department, never the name) ---
    function applyLabNames(cat) {
      const names = (overlay.context && overlay.context.labNames) || {};
      for (const lab of cat.labs) if (names[lab.id]) lab.name = names[lab.id];
    }
    // --- Lab Filing setup: which entries act (APPROVED, and still valid against this catalogue) ---
    function attachFiling(cat) {
      const filing = {};
      const LCn = core();
      const usable = (name, list, check) => {
        const good = [];
        for (const e of list) {
          const key = FILING_KINDS[name].key(e);
          const why = check(e);
          if (why) {
            problems.push({ kind: 'filing', id: name + ':' + key, reason: 'excluded — ' + why });
            continue;
          }
          const reviewed = e.provenance.reviewed === true;
          if (!includeUnreviewed && !reviewed) {
            excluded.push({ kind: 'filing', id: name + ':' + key, reason: 'unreviewed' });
            continue;
          }
          const { provenance, ...rest } = e;
          void provenance;
          good.push({ ...rest, reviewed });
        }
        if (good.length) filing[name] = good;
      };
      usable('ranges', overlay.filing.ranges, (r) => {
        const res = cat.results.find((x) => x.id === r.result);
        const lab = cat.labs.find((x) => x.id === r.lab);
        const code = res ? asArr(res.codes).find((c) => c.conceptId === r.code) : null;
        if (!res) return 'its result is gone';
        if (!lab) return 'its lab is gone';
        if (!code) return "that code is no longer one of the result's codes";
        if ((code.unit || '') !== r.unit)
          return (
            "the code's unit changed since the range was set (" +
            (r.unit || 'none') +
            ' -> ' +
            (code.unit || 'none') +
            ')'
          );
        return '';
      });
      usable('guards', overlay.filing.guards, (g) =>
        !cat.results.some((x) => x.id === g.result)
          ? 'its result is gone'
          : !cat.labs.some((x) => x.id === g.lab)
            ? 'its lab is gone'
            : ''
      );
      usable('groups', overlay.filing.groups, (g) => {
        const lab = cat.labs.find((x) => x.id === g.lab);
        if (!lab) return 'its lab is gone';
        return asArr(lab.groupHeadings).some((h) => LCn.norm(h.text) === LCn.norm(g.heading))
          ? ''
          : 'the lab no longer has that report group heading';
      });
      usable('screen', overlay.filing.screen, () => '');
      usable('suppress', overlay.filing.suppress, () => '');
      // absent (not empty) when nothing acts, so a catalogue with no filing setup is byte-for-byte the built-in one
      if (Object.keys(filing).length) cat.filing = filing;
      return cat;
    }
    // --- disables + pruning -------------------------------------------------------------------------------------
    function applyDisables(cat) {
      const rmRes = new Set(overlay.disabled.results);
      const rmInv = new Set(overlay.disabled.investigations);
      if (!rmRes.size && !rmInv.size) return;
      cat.results = cat.results.filter((r) => !rmRes.has(r.id));
      cat.investigations = cat.investigations.filter((i) => !rmInv.has(i.id));
      const liveRes = new Set(cat.results.map((r) => r.id));
      cat.investigations = cat.investigations.filter((inv) => {
        inv.members = asArr(inv.members).filter((m) => liveRes.has(m.result));
        if (LC.KINDS_NEEDING_RESULTS.includes(inv.kind) && !inv.members.some((m) => m.role === 'core')) {
          problems.push({ kind: 'investigations', id: inv.id, reason: 'dropped: no core member left after a disable' });
          return false;
        }
        return true;
      });
      const liveInv = new Set(cat.investigations.map((i) => i.id));
      for (const lab of cat.labs) {
        lab.groupHeadings = asArr(lab.groupHeadings)
          .map((h) => ({
            ...h,
            identifies: asArr(h.identifies).filter((id) => liveInv.has(id)),
            mayContain: asArr(h.mayContain).filter((ref) =>
              ref.startsWith('inv:') ? liveInv.has(ref.slice(4)) : liveRes.has(ref.slice(4))
            ),
          }))
          .filter((h) => h.identifies.length || h.mayContain.length);
      }
    }

    const entries = [
      ...overlay.results.filter((e) => usable(e, 'results')).map((e) => ({ kind: 'results', e })),
      ...overlay.investigations.filter((e) => usable(e, 'investigations')).map((e) => ({ kind: 'investigations', e })),
      ...overlay.labs.filter((e) => usable(e, 'labs')).map((e) => ({ kind: 'labs', e })),
    ];
    const applyOne = (cat, { kind, e }) =>
      kind === 'results'
        ? applyResult(cat, e)
        : kind === 'investigations'
          ? applyInvestigation(cat, e)
          : applyLab(cat, e);

    // FAST PATH: apply everything, validate once.
    let cat = JSON.parse(JSON.stringify(base));
    const problemMark = problems.length;
    for (const it of entries) applyOne(cat, it);
    applyDisables(cat);
    applyLabNames(cat);
    let v = LC.validateCatalogue(cat);
    if (v.errors.length === 0) return { catalogue: attachFiling(cat), problems, excluded, warnings: v.warnings };

    // SLOW PATH (rare): one bad entry must not discard the rest. Add entries one at a time, keeping only those that validate.
    problems.length = problemMark;
    cat = JSON.parse(JSON.stringify(base));
    for (const it of entries) {
      const trial = JSON.parse(JSON.stringify(cat));
      applyOne(trial, it);
      const tv = LC.validateCatalogue(trial);
      if (tv.errors.length === 0) cat = trial;
      else
        problems.push({
          kind: it.kind,
          id: it.e.id,
          reason: 'excluded — would make the catalogue invalid: ' + tv.errors[0],
          fatal: false,
        });
    }
    const beforeDisable = JSON.parse(JSON.stringify(cat));
    applyDisables(cat);
    v = LC.validateCatalogue(cat);
    if (v.errors.length) {
      problems.push({
        kind: 'overlay',
        id: null,
        reason: 'disables would make the catalogue invalid — ignored: ' + v.errors[0],
        fatal: false,
      });
      cat = beforeDisable;
      v = LC.validateCatalogue(cat);
    }
    applyLabNames(cat);
    return { catalogue: attachFiling(cat), problems, excluded, warnings: v.warnings };
  }

  const api = {
    OVERLAY_SCHEMA,
    LIMITS,
    emptyOverlay,
    sanitiseOverlay,
    forceInert,
    stripApprovals,
    markReviewed,
    summarise,
    setContext,
    approveInvestigation,
    saveResult,
    applyFills,
    saveInvestigation,
    revertInvestigation,
    mergeInvestigation,
    mergeResult,
    mergeLab,
    describeChanges,
    ownLabHeadings,
    removeInvestigation,
    restoreDismissed,
    isSimilarPairDismissed,
    dismissSimilarPair,
    restoreDismissedSimilarPairs,
    renameLab,
    setHeadingNote,
    addRequestAlias,
    filingKey,
    setFilingRange,
    removeFilingRange,
    approveFilingRange,
    setFilingGuards,
    setFilingGroup,
    setFilingScreen,
    setFilingSuppress,
    filingStateForTest,
    setFilingForTest,
    setFilingOverrideForTest,
    approveFilingForTest,
    TREND_DIRECTIONS,
    approveFiling,
    removeFiling,
    FILING_DEFAULT_NORMAL_OPTION,
    FILING_DEFAULT_FILE_BUTTON,
    filingGuardKey,
    filingGroupKey,
    filingScreenKey,
    filingSuppressKey,
    removeEntry,
    setInvestigationDisabled,
    mergeCatalogue,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.LabCatalogueOverlay = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : global);
