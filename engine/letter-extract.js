// engine/letter-extract.js — Document Coder: deterministic letter/attachment text assessor
// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
//
// The extraction core of the Document Coder (docs/plans/DOCUMENT-CODER-2026-08-01.md).
// Consumes the plain text of a clinical letter/discharge summary and returns a
// structured assessment: anchored sections, diagnosis candidates with a
// per-candidate status classification, medication-change lines, whole-text
// action flags, and a coverage account. Pure — no DOM, no network, no writes;
// the (future) UI adapter renders what this returns and never re-derives it.
//
// DESIGN CONTRACT (the four-state honesty model — panel P1, 17/20):
//   The caller must be able to render exactly one of:
//     'could-not-read'    — input is absent/garbled/not really text
//     'nothing-anchored'  — text read, but no recognised section structure
//     'assessed'          — sections anchored; candidates/coverage below
//   ('not-run' is the caller's state, not this module's.)
//   Absence of a candidate NEVER means "nothing to code": coverage reports how
//   much of the document the anchors actually covered, and the caller must
//   surface it. No API here can express "letter fully coded" — by design.
//
// CLASSIFICATION (fail-closed — panel P4):
//   Every diagnosis candidate carries status ∈
//     'active' | 'suspected' | 'negated' | 'historical' | 'resolved'
//     | 'family' | 'unclassifiable'
//   and ONLY 'active' has offered === true. Anything ambiguous, negated,
//   historical, family-history or unparseable is returned as
//   "mentioned, not offered" with the trigger evidence — never as a codeable
//   suggestion. Lineage: NegEx/ConText (Chapman et al.) — pre/post negation
//   trigger lists + pseudo-negation guards + temporality + experiencer —
//   implemented sentence-scoped (a list item's sentence is the scope), which
//   is deliberately MORE conservative than NegEx's 6-token window.
//
// ANCHORS:
//   Section headings follow the PRSB eDischarge/outpatient-letter families
//   (Diagnoses / Problems / Impression; Medications and medical devices /
//   … on discharge; Plan and requested actions) plus the informal variants
//   seen in real UK letters. Anchored-pattern extraction ONLY — prose is
//   never mined for diagnoses (the coverage meter names that gap instead).
//   The one whole-text scan is the ACTION-FLAG pass, which is escalate-only:
//   a false positive costs a glance, a missed flag costs a patient — so it
//   runs over every line, anchored or not (the "GP to arrange" sub-paragraph
//   war story, 5 independent panel variants).
//
// SAFETY: this module suggests nothing by itself and must stay that way —
//   it emits candidates for a human-gated flow. Do not add scoring that could
//   read as a clinical verdict, and never add a "fully coded"/"all clear"
//   output field. test-letter-extract.js source-greps for banned language.

(function (global) {
  'use strict';

  // ── text hygiene ──────────────────────────────────────────────────────────

  const LEGACY_PREFIX_RE = /^\[(x|d|so|v|m|q)\]\s*/i; // [X]/[D]/[SO]… legacy Read-code markers

  function normSpace(s) {
    return String(s || '')
      .replace(/[\u00a0\u2007\u202f]/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .trim();
  }

  // ── could-not-read heuristics ─────────────────────────────────────────────
  // Conservative on purpose: when in doubt, 'could-not-read' (the loud state)
  // beats pretending garbled OCR debris was assessed.

  function readability(text) {
    const t = String(text || '');
    const chars = t.length;
    if (!chars) return { ok: false, reason: 'empty' };
    const letters = (t.match(/[a-z]/gi) || []).length;
    const replacement = (t.match(/�/g) || []).length;
    if (letters < 40) return { ok: false, reason: 'too-little-text' };
    if (replacement / chars > 0.02) return { ok: false, reason: 'garbled-extraction' };
    if (letters / chars < 0.35) return { ok: false, reason: 'not-prose' };
    return { ok: true, reason: null };
  }

  // ── section anchors (PRSB-family + informal variants) ────────────────────

  const SECTION_DEFS = [
    {
      kind: 'diagnosis',
      re: /^(?:\d+[.)]\s*)?(?:principal |primary |secondary |main |new |discharge |clinical )?(?:diagnosis|diagnoses|impression|problem list|problems?|issues)\s*(?:\(.*\))?\s*:?\s*$/i,
    },
    {
      kind: 'meds',
      re: /^(?:\d+[.)]\s*)?(?:medications?(?: and medical devices)?|medications? (?:on|at) discharge|discharge medications?|drugs (?:on|at) discharge|current medications?|medication changes|drug therapy)\s*:?\s*$/i,
    },
    {
      kind: 'plan',
      re: /^(?:\d+[.)]\s*)?(?:plan(?: and requested actions?)?|actions? (?:for|requested of) (?:the )?gp|gp actions?(?: required)?|requested actions?|recommendations?)\s*:?\s*$/i,
    },
    {
      kind: 'allergies',
      re: /^(?:\d+[.)]\s*)?(?:allergies(?: and adverse reactions?)?|drug allergies)\s*:?\s*$/i,
    },
  ];

  // A heading we don't recognise still TERMINATES the previous section (we
  // must not keep attributing lines to "Diagnoses" once "Social history:"
  // starts) — but its content is NOT assessed.
  const GENERIC_HEADING_RE = /^(?:[A-Z][A-Za-z /&-]{2,40})\s*:\s*$/;

  // Inline single-line form: "Diagnosis: community acquired pneumonia"
  const INLINE_SECTION_RE = /^(?:diagnosis|diagnoses|impression)\s*:\s*(\S.*)$/i;

  // ── candidate status classification (NegEx/ConText lineage) ──────────────

  // Pseudo-negation: looks like negation, is not. Checked FIRST.
  const PSEUDO_NEG = [
    /\bnot certain (?:if|whether)\b/i,
    /\bnot only\b/i,
    /\bno (?:further|increase|change|significant change)\b/i,
    /\bnot exclude/i,
    /\bcannot be (?:excluded|ruled out)\b/i,
    /\bunable to (?:exclude|rule out)\b/i,
  ];

  // Pre-negation triggers (proposition follows the trigger).
  const PRE_NEG = [
    /\bno evidence (?:of|for)\b/i,
    /\bno signs? of\b/i,
    /\bno suggestion of\b/i,
    /\bnegative for\b/i,
    /\bwithout (?:any )?evidence of\b/i,
    /\bnot consistent with\b/i,
    /\bno\b(?! change)/i,
    /\bnot\b/i,
    /\bdenies\b/i,
    /\bfree of\b/i,
  ];

  // Post-negation triggers (proposition precedes the trigger).
  const POST_NEG = [
    /\b(?:was|were|has been|have been|now)? ?(?:excluded|ruled out|out[- ]?ruled)\b/i,
    /\bunlikely\b/i,
    /\bnot (?:seen|demonstrated|identified|detected|confirmed)\b/i,
    /\bnegative\b/i,
  ];

  // Experiencer ≠ patient (ConText): family history must never be coded onto
  // the patient. Nobody on the panel raised this one — ConText did.
  const FAMILY = [
    /\bfamily history\b/i,
    /\bfh\s*:/i,
    /\bfhx\b/i,
    /\b(?:mother|father|mum|dad|brother|sister|sibling|son|daughter|aunt|uncle|grandmother|grandfather|grandparent|maternal|paternal)\b/i,
  ];

  // Historical / pre-existing (not a NEW coding event from this letter).
  const HISTORICAL = [
    /\bprevious(?:ly)?\b/i,
    /\bpast medical history\b/i,
    /\bpmh\s*[:\-]?/i,
    /\bhistory of\b/i,
    /\bh\/o\b/i,
    /\bknown\b/i,
    /\bpre[- ]?existing\b/i,
    /\blong[- ]?standing\b/i,
    /\bsince (?:19|20)\d\d\b/i,
    /\bin (?:19|20)\d\d\b/i,
    /\(\s*(?:19|20)\d\d\s*\)/,
    /\bold\b/i,
  ];

  const RESOLVED = [
    /\bresolved\b/i,
    /\bresolving\b/i,
    /\btreated and (?:resolved|completed)\b/i,
    /\bno longer (?:present|active)\b/i,
    /\bback to baseline\b/i,
    /\bnormalised\b/i,
  ];

  const SUSPECTED = [
    /\?/,
    /\bquery\b/i,
    /\bqueried\b/i,
    // "cannot be excluded" is pseudo-negation (guards the negated branch)
    // AND semantically a suspicion — it must land here, never at 'active'.
    /\bcannot be (?:excluded|ruled out)\b/i,
    /\bunable to (?:exclude|rule out)\b/i,
    /\bnot exclude/i,
    /\bpossible\b/i,
    /\bprobable\b/i,
    /\blikely\b/i,
    /\bsuspected\b/i,
    /\bpresumed\b/i,
    /\bdifferentials?\b/i,
    /\bawaiting (?:histology|biopsy|confirmation|results?|mdt)\b/i,
    /\bto (?:be )?confirm(?:ed)?\b/i,
    /\bworking diagnosis\b/i,
    /\bimpression of\b/i,
    /\bunder investigation\b/i,
  ];

  const LATERALITY_RE = /\b(right|left|bilateral|rt|lt|r|l)\b/i;

  function firstMatch(res, s) {
    for (const re of res) {
      const m = s.match(re);
      if (m) return m[0];
    }
    return null;
  }

  // Classify one candidate SENTENCE (the scope). Fail-closed ordering:
  // family beats everything (wrong experiencer is the worst miss), then
  // negation (with pseudo-negation guard), then resolved/historical, then
  // suspected; only a clean run through every gate is 'active'.
  function classifyCandidate(sentence) {
    const s = normSpace(sentence);
    if (!s) return { status: 'unclassifiable', evidence: 'empty' };

    const fam = firstMatch(FAMILY, s);
    if (fam) return { status: 'family', evidence: fam };

    if (!firstMatch(PSEUDO_NEG, s)) {
      const neg = firstMatch(PRE_NEG, s) || firstMatch(POST_NEG, s);
      if (neg) return { status: 'negated', evidence: neg };
    }

    const res = firstMatch(RESOLVED, s);
    if (res) return { status: 'resolved', evidence: res };

    const hist = firstMatch(HISTORICAL, s);
    if (hist) return { status: 'historical', evidence: hist };

    const sus = firstMatch(SUSPECTED, s);
    if (sus) return { status: 'suspected', evidence: sus };

    return { status: 'active', evidence: null };
  }

  // ── candidate term extraction ─────────────────────────────────────────────

  const LIST_MARKER_RE = /^\s*(?:\d+[.)]\s*|[-–•*]\s+)/;

  function splitSentences(item) {
    // Sentence scope: split on . ; only when followed by whitespace+letter,
    // so "3.5 mg" and "T2DM." survive. Keep it simple and inspectable.
    return String(item)
      .split(/(?<=[.;])\s+(?=[A-Za-z])/)
      .map(normSpace)
      .filter(Boolean);
  }

  function cleanTerm(sentence) {
    let t = normSpace(sentence)
      .replace(LEGACY_PREFIX_RE, '')
      .replace(/^\bnew\b\s+/i, '') // "New atrial fibrillation" → the concept is the term
      .replace(/[?]/g, '')
      .trim();
    // Trim a trailing parenthetical or dash-clause: keep the head concept,
    // the full sentence stays alongside as sourceSentence.
    t = t.replace(/\s*\((?![^)]*(?:19|20)\d\d)[^)]*\)\s*$/, '');
    t = t.split(/\s+[—–-]\s+|:\s+/)[0];
    t = t.replace(/[.,;:]+$/, '').trim();
    return t;
  }

  function extractCandidatesFromItem(item, lineNo, sectionKind) {
    const out = [];
    // Strip the list marker BEFORE sentence-splitting: "1. Foo" must not
    // split into a sentence "1." (which would silently drop the candidate —
    // the exact silent-miss failure mode this engine exists to avoid).
    const body = normSpace(item).replace(LIST_MARKER_RE, '');
    const sentences = splitSentences(body);
    if (!sentences.length) return out;
    // The FIRST sentence of a list item is the diagnosis clause; later
    // sentences are commentary — they still get classified so a negation or
    // action in them never leaks onto the head term, but they don't spawn
    // their own candidates (prose is not mined).
    const head = sentences[0];
    const cls = classifyCandidate(head);
    const term = cleanTerm(head);
    const latM = head.match(LATERALITY_RE);
    if (!term || term.length < 3 || /^(nil|none|nad|n\/a)$/i.test(term)) {
      return out; // an empty/nil line is NOT a candidate and NOT an all-clear
    }
    out.push({
      term,
      sourceSentence: head,
      sourceLine: normSpace(item),
      lineNo,
      section: sectionKind,
      status: cls.status,
      statusEvidence: cls.evidence,
      offered: cls.status === 'active',
      laterality: latM ? latM[0].toLowerCase() : null,
    });
    return out;
  }

  // ── medication lines ─────────────────────────────────────────────────────

  const MED_CHANGE = [
    { change: 'started', re: /\b(?:start(?:ed)?|new|commence[ds]?|initiat(?:ed|e))\b/i },
    { change: 'stopped', re: /\b(?:stop(?:ped)?|discontinu(?:ed|e)|cease[ds]?|withheld|withdrawn|discontinued)\b/i },
    {
      change: 'changed',
      re: /\b(?:increas(?:ed|e)|decreas(?:ed|e)|reduc(?:ed|e)|up[- ]?titrat(?:ed|e)|down[- ]?titrat(?:ed|e)|titrat(?:ed|e)|switch(?:ed)?|chang(?:ed|e)|convert(?:ed)?)\b/i,
    },
  ];
  const DOSE_RE = /\b\d+(?:\.\d+)?\s*(?:mg|mcg|microgram(?:me)?s?|g|ml|units?|iu|puffs?)\b.*$/i;

  function extractMedLine(item, lineNo) {
    const s = normSpace(item).replace(LIST_MARKER_RE, '');
    if (!s) return null;
    let change = 'listed';
    let changeEvidence = null;
    for (const c of MED_CHANGE) {
      const m = s.match(c.re);
      if (m) {
        change = c.change;
        changeEvidence = m[0];
        break;
      }
    }
    const doseM = s.match(DOSE_RE);
    // Name = text before the dose (or before the change word), cleaned.
    let name = s;
    if (doseM) name = s.slice(0, doseM.index);
    name = name
      .replace(MED_CHANGE[0].re, '')
      .replace(MED_CHANGE[1].re, '')
      .replace(MED_CHANGE[2].re, '')
      .replace(/[:\-–—,]+$/g, '')
      .trim();
    if (!name || name.length < 3) {
      // Never guess a drug name — surface as unparsed (loud downstream).
      return {
        name: null,
        doseText: doseM ? normSpace(doseM[0]) : null,
        change: 'unparsed',
        changeEvidence,
        sourceLine: normSpace(item),
        lineNo,
      };
    }
    return {
      name,
      doseText: doseM ? normSpace(doseM[0]) : null,
      change,
      changeEvidence,
      sourceLine: normSpace(item),
      lineNo,
    };
  }

  // ── action flags: the ONE whole-text scan (escalate-only) ────────────────

  const ACTION_DEFS = [
    {
      kind: 'gp-action',
      res: [
        /\bfor (?:the )?gp to\b/i,
        /\bgp to (?:arrange|review|monitor|follow|check|repeat|refer|consider|action|chase)\b/i,
        /\bplease (?:arrange|review|monitor|repeat|check|refer|consider|chase|follow)/i,
        /\bwe would be grateful if (?:you|the gp)\b/i,
        /\bkindly (?:arrange|review|monitor|repeat|refer)\b/i,
        /\baction(?:s)? required\b/i,
        /\bfor (?:your|gp) action\b/i,
      ],
    },
    {
      kind: 'follow-up',
      res: [
        /\bfollow[- ]?up (?:in|within|at)\s+\d+\s*(?:day|week|month|yr|year)s?\b/i,
        /\brepeat\b[^.\n]{0,60}\b(?:in|within)\s+\d+\s*(?:day|week|month)s?\b/i,
        /\bsafety[- ]?net/i,
        /\brefer (?:back|again) if\b/i,
      ],
    },
    {
      kind: '2ww-mention',
      res: [
        /\btwo[- ]week[- ]wait\b/i,
        /\b2\s?ww\b/i,
        /\bfast[- ]?track\b/i,
        /\burgent suspected cancer\b/i,
        /\bcancer pathway\b/i,
        /\bfds\b/i,
      ],
    },
  ];

  function scanActions(lines) {
    const flags = [];
    lines.forEach((raw, i) => {
      const line = normSpace(raw);
      if (!line) return;
      for (const def of ACTION_DEFS) {
        const hit = firstMatch(def.res, line);
        if (hit) {
          flags.push({ kind: def.kind, phrase: hit, sourceLine: line, lineNo: i });
          break; // one flag per line, highest-priority kind first
        }
      }
    });
    return flags;
  }

  // ── main entry ────────────────────────────────────────────────────────────

  function assessLetterText(text) {
    const read = readability(text);
    if (!read.ok) {
      return {
        state: 'could-not-read',
        reason: read.reason,
        sections: [],
        candidates: [],
        meds: [],
        actions: [],
        coverage: null,
      };
    }

    const lines = String(text).split(/\r\n|\r|\n/);
    const sections = [];
    const candidates = [];
    const meds = [];
    let current = null; // { kind, heading, startLine, itemLines: [] }

    function closeSection(endLine) {
      if (!current) return;
      current.endLine = endLine;
      sections.push(current);
      current = null;
    }

    lines.forEach((raw, i) => {
      const line = normSpace(raw);
      if (!line) return; // blank lines don't terminate a section (letters are gappy)

      // Inline "Diagnosis: X" one-liner
      const inline = line.match(INLINE_SECTION_RE);
      if (inline) {
        closeSection(i - 1);
        sections.push({ kind: 'diagnosis', heading: line.split(':')[0], startLine: i, endLine: i, itemCount: 1 });
        candidates.push(...extractCandidatesFromItem(inline[1], i, 'diagnosis'));
        return;
      }

      const def = SECTION_DEFS.find((d) => d.re.test(line));
      if (def) {
        closeSection(i - 1);
        current = { kind: def.kind, heading: line.replace(/:\s*$/, ''), startLine: i, endLine: i, itemCount: 0 };
        return;
      }
      if (GENERIC_HEADING_RE.test(line)) {
        // Unrecognised heading: terminates the current section; its own
        // content is NOT assessed (counted as unanchored in coverage).
        closeSection(i - 1);
        return;
      }

      if (!current) return; // unanchored prose: never mined for candidates

      current.itemCount++;
      if (current.kind === 'diagnosis') {
        candidates.push(...extractCandidatesFromItem(line, i, 'diagnosis'));
      } else if (current.kind === 'meds') {
        const med = extractMedLine(line, i);
        if (med) meds.push(med);
      }
      // 'plan' and 'allergies' content lines are covered by the action scan /
      // deliberately not extracted (allergy reconciliation is not this module).
    });
    closeSection(lines.length - 1);

    // Whole-text action-flag scan — anchored or not, every line.
    const actions = scanActions(lines);

    // Coverage: an honest count, not a reassurance.
    const contentLineIdx = [];
    lines.forEach((raw, i) => {
      if (normSpace(raw)) contentLineIdx.push(i);
    });
    const assessedIdx = new Set();
    sections.forEach((s) => {
      for (let i = s.startLine; i <= s.endLine; i++) assessedIdx.add(i);
    });
    const assessedLines = contentLineIdx.filter((i) => assessedIdx.has(i)).length;
    const coverage = {
      totalContentLines: contentLineIdx.length,
      assessedLines,
      unanchoredLines: contentLineIdx.length - assessedLines,
      sectionsFound: sections.length,
      sectionKinds: sections.map((s) => s.kind),
    };

    if (!sections.length) {
      return { state: 'nothing-anchored', reason: null, sections, candidates: [], meds: [], actions, coverage };
    }

    return {
      state: 'assessed',
      reason: null,
      sections: sections.map((s) => ({
        kind: s.kind,
        heading: s.heading,
        startLine: s.startLine,
        endLine: s.endLine,
        itemCount: s.itemCount,
      })),
      candidates,
      meds,
      actions,
      coverage,
    };
  }

  // ── Module export (dual-mode: Node require OR browser global) ─────────────
  const api = {
    assessLetterText,
    classifyCandidate,
    extractMedLine,
    scanActions,
    readability,
    cleanTerm,
    // exposed for tests only:
    _internals: { splitSentences, SECTION_DEFS, ACTION_DEFS },
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.SuiteLetterExtract = api;
  }
})(typeof window !== 'undefined' ? window : global);
