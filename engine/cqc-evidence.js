// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Engine — CQC Inspection Readiness data engine (P1: readiness check, internal)
//
// Builds the *Processes / Outcomes* supporting-evidence object for the Safe and
// Well-led key questions from the suite's bundled rule files plus the rule-currency
// assessment. Carries NO patient data and needs NO cohort enumeration — it evidences
// the MONITORING SYSTEM the practice runs and how current it is. Honest framing:
// supporting evidence only, never proof of compliance.
//
// `buildReadiness` and `diffReadiness` are PURE (no I/O, no chrome/window) so they are
// node-testable. `loadRuleFiles` and `assembleReadiness` are the I/O wrappers.
//
// Dual-export pattern: same idiom as shared/rule-currency.js and engine/rules-engine.js.
// In a browser context the IIFE assigns to global.CqcEvidence (a classic <script> the
// readiness page loads); in a Node/test context module.exports is set so the pure
// functions are node-testable.

(function (global) {
  'use strict';

  // ── Pure helpers ─────────────────────────────────────────────────────────────

  // Number of enabled+disabled rules of a given `type` in a rule-file `rules` array.
  function countByType(rules, type) {
    if (!Array.isArray(rules)) return 0;
    return rules.filter((r) => r && r.type === type).length;
  }

  // All `drug.match` strings across drug-monitoring rules, de-duped (case-insensitive)
  // and sorted. This is the coverage manifest's raw matched-term list (A2).
  function collectMatchedTerms(drugFile) {
    if (!drugFile || !Array.isArray(drugFile.rules)) return [];
    const seen = new Map(); // lowercased → first-seen original
    for (const rule of drugFile.rules) {
      // Manifest evidences the monitoring system: only drug-monitoring rules count.
      if (!rule || rule.type !== 'drug-monitoring') continue;
      const match = rule.drug && rule.drug.match;
      if (!Array.isArray(match)) continue;
      for (const term of match) {
        if (typeof term !== 'string') continue;
        const key = term.trim().toLowerCase();
        if (!key) continue;
        if (!seen.has(key)) seen.set(key, term.trim());
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  }

  // One-line provenance string describing how the drug rule-set is maintained (A3).
  // Derived from drug.sourceNotes / specVersion — the documented Keeper passes — never
  // invented. Falls back gracefully if the field is absent.
  function deriveKeeperProvenance(drugFile) {
    if (!drugFile) return 'Rule-set provenance unavailable.';
    const spec = drugFile.specVersion || null;
    const lastUpdated = drugFile.lastUpdated || null;
    const notes = typeof drugFile.sourceNotes === 'string' ? drugFile.sourceNotes : '';
    // Take the leading sentence of sourceNotes (the standing description of how the
    // set is curated) — the dated Keeper-pass log that follows is detail.
    let lead = '';
    if (notes) {
      const firstSentence = notes.split(/(?<=\.)\s+/)[0] || notes;
      lead = firstSentence.trim();
    }
    const parts = [];
    if (lead) parts.push(lead);
    else
      parts.push(
        'Drug-monitoring rules curated from UK primary-care sources (BNF, NICE, BSR shared care, MHRA Drug Safety Update).'
      );
    const tail = [];
    if (spec) tail.push(spec);
    if (lastUpdated) tail.push(`last reviewed ${lastUpdated}`);
    if (tail.length) parts.push(`Maintained via The Keeper currency check — ${tail.join('; ')}.`);
    return parts.join(' ');
  }

  // QOF top-level identity — prefer lastUpdated/specVersion, fall back to version.
  function qofLastUpdated(qofFile) {
    if (!qofFile) return null;
    return qofFile.lastUpdated || qofFile.version || null;
  }

  // Find an assessed currency file entry by id ('drug'|'qof'|'vaccine'|'alert').
  function findCurrencyFile(currency, id) {
    if (!currency || !Array.isArray(currency.files)) return null;
    return currency.files.find((f) => f && f.id === id) || null;
  }

  const STALE_DAYS = 365; // mirrors shared/rule-currency.js STALE_DAYS

  const UNDERCOUNT_CAVEAT =
    'Counts are derived from coded data only. Medicines or results recorded as free ' +
    'text or scanned correspondence are not seen; treat figures as a floor, not a ceiling.';

  const DISCLAIMER =
    'Supporting evidence for the Safe and Well-led key questions (Processes and Outcomes ' +
    'categories) only. Not proof of compliance, and not a complete evidence pack — it does ' +
    'not cover patient experience, staff or partner feedback, or observation.';

  // ── buildReconciliation (PURE) ───────────────────────────────────────────────

  // Human-readable interval label from a number of days (e.g. 84 → "12 weeks").
  // Stays plain English — this prose goes into a printable CQC evidence pack.
  function intervalLabel(days) {
    if (!days || typeof days !== 'number') return null;
    if (days % 365 === 0) {
      const y = days / 365;
      return y === 1 ? '1 year' : `${y} years`;
    }
    if (days % 7 === 0) {
      const w = days / 7;
      return w === 1 ? '1 week' : `${w} weeks`;
    }
    // Best-effort for values like 90, 120, 180.
    if (days % 30 === 0) {
      const m = days / 30;
      return m === 1 ? '1 month' : `${m} months`;
    }
    return `${days} days`;
  }

  // Build the readable cohort-definition string for a single drug-monitoring rule.
  // The definition is reproducible from the rule's own data and carries no patient count.
  // Format: "Active [drug] prescription with no [test1] or [test2] result in the last [interval]."
  // Where a rule has multiple tests with different intervals, the SHORTEST interval is used
  // (the strictest monitoring requirement — erring on the side of safety).
  function ruleToDefinition(rule) {
    const drugTerms = rule.drug && Array.isArray(rule.drug.match) ? rule.drug.match : [];
    if (!drugTerms.length) return null;

    const tests = Array.isArray(rule.tests) ? rule.tests : [];
    if (!tests.length) return null;

    // Lead term: first match entry, capitalised — used as the readable drug name.
    const drugName = drugTerms[0].charAt(0).toUpperCase() + drugTerms[0].slice(1);

    // Collect test names and find the minimum interval (strictest requirement).
    const testNames = [];
    let minInterval = Infinity;
    for (const t of tests) {
      if (t && t.name) testNames.push(t.name);
      if (t && typeof t.intervalDays === 'number' && t.intervalDays < minInterval) {
        minInterval = t.intervalDays;
      }
    }
    if (!testNames.length) return null;

    const testList =
      testNames.length === 1
        ? testNames[0]
        : testNames.slice(0, -1).join(', ') + ' or ' + testNames[testNames.length - 1];

    const intervalStr = minInterval === Infinity ? null : intervalLabel(minInterval);
    const intervalPhrase = intervalStr ? ` in the last ${intervalStr}` : '';

    return (
      `Active ${drugName} prescription AND no ${testList} result${intervalPhrase} ` + `(coded in the clinical record).`
    );
  }

  const RECONCILIATION_CAVEAT =
    "The suite supplies the cohort definition; the practice's own Medicus search supplies " +
    'the count. Coded prescriptions only — patients whose prescription is recorded as free ' +
    'text or scanned correspondence will not appear. Treat any count as a floor, not a ceiling.';

  /**
   * From the drug-monitoring rules, produce a reconciliation structure: for each
   * high-risk monitored drug/rule, a plain, reproducible cohort definition the practice
   * can run in Medicus's own search. NO counts — only definitions + coverage caveat.
   * PURE.
   *
   * @param {object|null} drugFile  parsed drug-rules.json.
   * @returns {{entries:Array<{ruleId,drugClass,drugName,definition,matchTerms}>, caveat:string}}
   */
  function buildReconciliation(drugFile) {
    const entries = [];
    if (!drugFile || !Array.isArray(drugFile.rules)) {
      return { entries, caveat: RECONCILIATION_CAVEAT };
    }

    for (const rule of drugFile.rules) {
      if (!rule || rule.type !== 'drug-monitoring') continue;
      // Skip disabled rules — a disabled rule is not part of the active monitoring system.
      if (rule.enabled === false) continue;

      const definition = ruleToDefinition(rule);
      if (!definition) continue;

      const drugTerms = rule.drug && Array.isArray(rule.drug.match) ? rule.drug.match : [];
      const leadTerm = drugTerms[0] || '';

      entries.push({
        ruleId: rule.id || '',
        drugClass: rule.drugClass || '',
        // Capitalise the lead match term as the display drug name.
        drugName: leadTerm.charAt(0).toUpperCase() + leadTerm.slice(1),
        definition,
        // The full match list so the practice knows which coded terms are covered.
        matchTerms: drugTerms.slice(),
      });
    }

    return { entries, caveat: RECONCILIATION_CAVEAT };
  }

  // ── buildReadiness (PURE) ────────────────────────────────────────────────────

  /**
   * Build the CQC readiness object from already-parsed inputs. PURE — no I/O.
   *
   * @param {{drug:object, qof:object, vaccine:object, alert:object}} ruleFiles  parsed JSON.
   * @param {{todayISO?:string, currency:object, anchor?:object|null}} opts
   *   currency = result of RuleCurrency.assessRuleCurrency (injected so this fn needs no window).
   *   anchor   = a previously-saved readiness object, or null (for the delta).
   * @returns {object} readiness object (see module header / plan §4 P1).
   */
  function buildReadiness(ruleFiles, opts) {
    const files = ruleFiles || {};
    const drug = files.drug || null;
    const qof = files.qof || null;
    const vaccine = files.vaccine || null;
    const alert = files.alert || null;

    const o = opts || {};
    const generatedAt = o.todayISO || new Date().toISOString();
    const currency = o.currency || { overall: 'amber', files: [], warnings: [] };
    const anchor = o.anchor || null;

    // ── Coverage manifest ──
    const matchedTerms = collectMatchedTerms(drug);
    const drugRuleCount = drug && Array.isArray(drug.rules) ? countByType(drug.rules, 'drug-monitoring') : 0;
    const qofRules = qof && Array.isArray(qof.rules) ? qof.rules : [];
    const qofIndicatorCount = countByType(qofRules, 'qof-indicator');
    const safetyMonitoringCount = qofRules.filter((r) => r && r.category === 'safety-monitoring').length;
    const vaccineRuleCount = vaccine && Array.isArray(vaccine.rules) ? countByType(vaccine.rules, 'vaccine') : 0;
    const alertRuleCount = alert && Array.isArray(alert.library) ? alert.library.length : 0;

    const coverage = {
      drug: {
        lastUpdated: drug ? drug.lastUpdated || null : null,
        specVersion: drug ? drug.specVersion || null : null,
        schemaVersion: drug ? (drug.schemaVersion != null ? drug.schemaVersion : null) : null,
        ruleCount: drugRuleCount,
        matchedTerms,
      },
      qof: {
        lastUpdated: qofLastUpdated(qof),
        version: qof ? qof.version || null : null,
        specVersion: qof ? qof.specVersion || null : null,
        indicatorCount: qofIndicatorCount,
        safetyMonitoringCount,
      },
      vaccine: {
        lastUpdated: vaccine ? vaccine.lastUpdated || null : null,
        specVersion: vaccine ? vaccine.specVersion || null : null,
        ruleCount: vaccineRuleCount,
      },
      alert: {
        lastUpdated: alert ? alert.lastUpdated || null : null,
        specVersion: alert ? alert.specVersion || null : null,
        ruleCount: alertRuleCount,
      },
      codedDataOnly: true,
      undercountCaveat: UNDERCOUNT_CAVEAT, // A5
      keeperProvenance: deriveKeeperProvenance(drug), // A3
    };

    // ── Quality statements (organised by CQC quality statement) ──
    const drugCurrency = findCurrencyFile(currency, 'drug');
    const drugRag = drugCurrency ? drugCurrency.level : 'amber';
    const drugAgeDays = drugCurrency ? drugCurrency.ageDays : null;
    const drugStale = typeof drugAgeDays === 'number' && drugAgeDays > STALE_DAYS;

    const qualityStatements = [
      {
        keyQuestion: 'Safe',
        qualityStatement: 'Safe and effective medicines management',
        evidenceCategory: 'Processes',
        rag: drugRag,
        summary:
          `The monitoring rule-set in use: ${drugRuleCount} drug-monitoring rules and ` +
          `${safetyMonitoringCount} QOF safety-monitoring flags.`,
        whatGoodLooksLike:
          'A maintained, version-stamped set of drug-monitoring rules covering the ' +
          'high-risk medicines the practice prescribes, reviewed against current BNF/NICE/MHRA guidance.',
        toFix: drugStale
          ? 'Run The Keeper to refresh drug-monitoring rules (the rule-set is older than the staleness threshold).'
          : drugRag === 'red'
            ? 'Run The Keeper to refresh drug-monitoring rules — currency check reports the set needs urgent review.'
            : null,
        metrics: {
          drugRuleCount,
          safetyMonitoringCount,
        },
        provenance: {
          asAt: generatedAt,
          source: drug
            ? `rules/drug-rules.json (specVersion ${drug.specVersion || 'unknown'})`
            : 'rules/drug-rules.json (unavailable)',
          denominator: 'Coded drug-monitoring rules shipped in the active rule-set (not a patient count).',
        },
      },
      {
        keyQuestion: 'Well-led',
        qualityStatement: 'Governance: safety rules kept current',
        evidenceCategory: 'Processes',
        rag: currency.overall || 'amber',
        summary:
          `Rule-currency overall: ${currency.overall || 'unknown'}. ` +
          `Per-file last-reviewed dates and currency messages are listed below.`,
        whatGoodLooksLike:
          'Clinical safety rules are reviewed on a defined cadence against the authoritative ' +
          'UK sources, with the last review date and trigger recorded — a maintenance process, ' +
          'not an ad-hoc check.',
        toFix:
          currency.overall === 'red' || currency.overall === 'amber'
            ? 'Review and refresh the flagged rule files (run The Keeper); see per-file messages.'
            : null,
        keeperProvenance: coverage.keeperProvenance, // A3 — how/when rules are reviewed
        currencyFiles: Array.isArray(currency.files)
          ? currency.files.map((f) => ({
              id: f.id,
              lastUpdated: f.lastUpdated,
              specVersion: f.specVersion,
              ageDays: f.ageDays,
              level: f.level,
              message: f.message,
            }))
          : [],
        provenance: {
          asAt: generatedAt,
          source: 'shared/rule-currency.js (assessRuleCurrency) over rules/*.json',
          denominator: 'Bundled clinical rule files assessed for currency (system metadata, not patient data).',
        },
      },
      {
        keyQuestion: 'Safe',
        qualityStatement: 'Medicines coverage transparency',
        evidenceCategory: 'Processes',
        rag: matchedTerms.length > 0 ? 'green' : 'amber',
        summary:
          `Coverage manifest: ${matchedTerms.length} distinct coded drug-name strings matched ` +
          `across ${drugRuleCount} monitoring rules. ${UNDERCOUNT_CAVEAT}`,
        whatGoodLooksLike:
          'The drugs and brands the monitoring system covers are explicit and reviewable, ' +
          'so a clinician can eyeball the manifest for gaps (e.g. a missing slow-release brand).',
        toFix:
          matchedTerms.length === 0
            ? 'No matched drug terms found — verify rules/drug-rules.json loaded correctly.'
            : null,
        matchedTermsCount: matchedTerms.length,
        metrics: {
          matchedTermsCount: matchedTerms.length,
          drugRuleCount,
        },
        provenance: {
          asAt: generatedAt,
          source: drug
            ? `rules/drug-rules.json (specVersion ${drug.specVersion || 'unknown'})`
            : 'rules/drug-rules.json (unavailable)',
          denominator: 'Distinct coded drug-name match strings in the active rule-set (coded data only).',
        },
      },
    ];

    // ── Reconciliation hook ──
    // Per-drug cohort definitions the practice runs in Medicus's own search to get the
    // count. The suite supplies the definition + caveat; it does NOT supply a patient count.
    const reconciliation = buildReconciliation(drug);

    const readiness = {
      generatedAt,
      coverage,
      currency: {
        overall: currency.overall || 'amber',
        files: Array.isArray(currency.files) ? currency.files : [],
        warnings: Array.isArray(currency.warnings) ? currency.warnings : [],
      },
      qualityStatements,
      reconciliation,
      delta: null, // filled below
      disclaimer: DISCLAIMER,
    };

    readiness.delta = diffReadiness(readiness, anchor);
    return readiness;
  }

  // ── diffReadiness (PURE) ─────────────────────────────────────────────────────

  /**
   * Compare headline figures of a current readiness object against an anchored prior
   * run. PURE. Returns null if no anchor (A7 — anchored baseline).
   *
   * @param {object} current  the readiness object just built.
   * @param {object|null} anchor  a previously-saved readiness object, or null.
   * @returns {{sinceAnchorAt:string, changes:Array<{label,from,to}>}|null}
   */
  function diffReadiness(current, anchor) {
    if (!anchor || typeof anchor !== 'object') return null;
    const cov = (current && current.coverage) || {};
    const acov = anchor.coverage || {};
    const changes = [];

    function cmp(label, from, to) {
      // Treat undefined/null as comparable; only record genuine differences.
      if (from !== to) changes.push({ label, from: from == null ? null : from, to: to == null ? null : to });
    }

    cmp('Drug-monitoring rule count', acov.drug && acov.drug.ruleCount, cov.drug && cov.drug.ruleCount);
    cmp('Drug rules last reviewed', acov.drug && acov.drug.lastUpdated, cov.drug && cov.drug.lastUpdated);
    cmp(
      'Matched drug terms',
      acov.drug && Array.isArray(acov.drug.matchedTerms) ? acov.drug.matchedTerms.length : undefined,
      cov.drug && Array.isArray(cov.drug.matchedTerms) ? cov.drug.matchedTerms.length : undefined
    );
    cmp('QOF indicator count', acov.qof && acov.qof.indicatorCount, cov.qof && cov.qof.indicatorCount);
    cmp(
      'QOF safety-monitoring count',
      acov.qof && acov.qof.safetyMonitoringCount,
      cov.qof && cov.qof.safetyMonitoringCount
    );
    cmp('QOF last reviewed', acov.qof && acov.qof.lastUpdated, cov.qof && cov.qof.lastUpdated);
    cmp('Vaccine rule count', acov.vaccine && acov.vaccine.ruleCount, cov.vaccine && cov.vaccine.ruleCount);
    cmp(
      'Vaccine rules last reviewed',
      acov.vaccine && acov.vaccine.lastUpdated,
      cov.vaccine && cov.vaccine.lastUpdated
    );
    cmp('Alert library rule count', acov.alert && acov.alert.ruleCount, cov.alert && cov.alert.ruleCount);
    cmp('Alert library last reviewed', acov.alert && acov.alert.lastUpdated, cov.alert && cov.alert.lastUpdated);
    cmp(
      'Rule-currency overall',
      anchor.currency && anchor.currency.overall,
      current && current.currency && current.currency.overall
    );

    return {
      sinceAnchorAt: anchor.generatedAt || null,
      changes,
    };
  }

  // ── loadRuleFiles (I/O) ──────────────────────────────────────────────────────

  /**
   * Fetch the 4 bundled rule files via chrome.runtime.getURL. I/O.
   * Fail-safe: a missing/unparseable file yields a null entry rather than throwing.
   *
   * @returns {Promise<{drug:object|null, qof:object|null, vaccine:object|null, alert:object|null}>}
   */
  async function loadRuleFiles() {
    const result = { drug: null, qof: null, vaccine: null, alert: null };
    /* eslint-disable no-undef */
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.getURL) {
      return result;
    }
    const base = chrome.runtime.getURL('rules/');
    /* eslint-enable no-undef */
    const spec = [
      ['drug', 'drug-rules.json'],
      ['qof', 'qof-rules.json'],
      ['vaccine', 'vaccine-rules.json'],
      ['alert', 'alert-library.json'],
    ];
    await Promise.all(
      spec.map(async ([key, file]) => {
        try {
          const r = await fetch(base + file);
          if (!r.ok) return;
          result[key] = await r.json();
        } catch (_e) {
          // Fail-safe: leave the entry null.
        }
      })
    );
    return result;
  }

  // ── assembleReadiness (I/O convenience) ──────────────────────────────────────

  /**
   * Convenience I/O wrapper: load the rule files, assess their currency with
   * window.RuleCurrency, then build the readiness object. I/O.
   *
   * @param {{todayISO?:string, anchor?:object|null}} [opts]
   * @returns {Promise<object>} the readiness object.
   */
  async function assembleReadiness(opts) {
    const o = opts || {};
    const todayISO = o.todayISO || new Date().toISOString().slice(0, 10);
    const anchor = o.anchor || null;

    const ruleFiles = await loadRuleFiles();

    const currencyInput = [
      {
        id: 'drug',
        lastUpdated: ruleFiles.drug && ruleFiles.drug.lastUpdated,
        specVersion: ruleFiles.drug && ruleFiles.drug.specVersion,
      },
      {
        id: 'qof',
        lastUpdated: ruleFiles.qof && (ruleFiles.qof.lastUpdated || ruleFiles.qof.version),
        specVersion: ruleFiles.qof && ruleFiles.qof.specVersion,
      },
      {
        id: 'vaccine',
        lastUpdated: ruleFiles.vaccine && ruleFiles.vaccine.lastUpdated,
        specVersion: ruleFiles.vaccine && ruleFiles.vaccine.specVersion,
      },
      {
        id: 'alert',
        lastUpdated: ruleFiles.alert && ruleFiles.alert.lastUpdated,
        specVersion: ruleFiles.alert && ruleFiles.alert.specVersion,
      },
    ];

    /* eslint-disable no-undef */
    const RC = typeof window !== 'undefined' ? window.RuleCurrency : null;
    /* eslint-enable no-undef */
    const currency = RC
      ? RC.assessRuleCurrency(currencyInput, todayISO)
      : { overall: 'amber', files: [], warnings: ['Rule currency helper not available.'] };

    return buildReadiness(ruleFiles, { todayISO, currency, anchor });
  }

  // ── Dual export (browser global + Node test harness) ─────────────────────────

  const api = { buildReadiness, buildReconciliation, diffReadiness, loadRuleFiles, assembleReadiness };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.CqcEvidence = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
