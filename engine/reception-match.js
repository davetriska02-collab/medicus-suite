// engine/reception-match.js — Reception pathway matching: Pharmacy First divert + missing-info ask-back
// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
//
// Pure matching engine for TRIAGE-LENS-2026-07-02.md items 4.1 (Pharmacy First divert chip) and
// 4.2 (missing-info ask-back). Matches a patient's free-text REQUEST (e.g. an online consultation
// "reason for contact" field, or a submission body) against the CSO-signed
// rules/reception-pathways.json pathway set, and derives:
//
//   matchPathways(requestText)                    → pathway[]   which pathway(s) the request text
//                                                    plausibly belongs to.
//   pharmacyFirstEligibility(pathway, ageYears)    → { eligible, reason, ageNote }
//                                                    whether Pharmacy First eligibility can be
//                                                    CONFIRMED for this patient — FAIL-CLOSED on
//                                                    unknown age (never claims eligibility it
//                                                    cannot confirm).
//   redFlagGaps(pathway, requestText)              → { gaps, flaggedInText }
//                                                    which red-flag topics the request text does
//                                                    NOT already address (what reception/the GP
//                                                    still needs to ask), plus which red-flag
//                                                    topics the patient already volunteered (an
//                                                    escalation signal in its own right).
//   buildAskBackText(pathway, gaps, closingQuestions) → string
//                                                    a plain-text, prepare-only (never auto-sent)
//                                                    ask-back message listing the gap questions in
//                                                    lay language, for a GP/receptionist to review.
//
// This module is DISJOINT from the existing reception phone-capture flow
// (side-panel/modules/reception/reception-core.js, shared/reception-pathway-utils.js). That flow
// captures EXPLICIT yes/no red-flag ANSWERS from a receptionist reading questions aloud on a live
// call, and has its own age-hint helper (pharmacyFirstHint). This module instead does free-text
// KEYWORD MATCHING against an ALREADY-WRITTEN request (e.g. an online consultation submission),
// for the triage/GP-workflow queue screens described in items 4.1/4.2. Both modules read the same
// rules/reception-pathways.json but serve different UI surfaces, have different fail-safe
// semantics (this module fails CLOSED on unknown age; the phone-capture hint fails toward "ask a
// clinician to confirm" with a caveat string), and must stay independent — do not merge them.
//
// SCOPE NOTE (2026-07-02): this is the PURE matching core only, built ahead of a later
// integration wave. No content.js wiring, no defaults.json entries, no options UI here.
//
// rules/reception-pathways.json is READ-ONLY from this module's point of view — it is a
// CSO-signed clinical asset (see its own sourceNotes) and is never modified here.
//
// Dual-mode export: Node `require` AND browser global (`window.SentinelReceptionMatch`), same
// pattern as engine/result-rules.js.
//
// ── CLINICAL-CONTENT NOTE — CSO REVIEW REQUIRED ───────────────────────────────────────────────
// SYNONYM_TERMS and RED_FLAG_TOPIC_TERMS below are NEW clinical-matching content authored for
// this module. They are NOT part of the CSO-signed rules/reception-pathways.json itself — that
// file carries no explicit "match terms" for free-text matching, so this module derives a small,
// conservative internal synonym set per pathway (from each pathway's title/id and obvious lay
// synonyms) and a topic-term set per red-flag id (from each red flag's `ask` text), documented
// inline below. Exactly like a drug-rules.json brand list (see CLAUDE.md "Editing drug-monitoring
// rules"), a missing term fails SILENTLY — no match, no error — so both maps must be reviewed by
// the practice's Clinical Safety Officer before this module is wired into any user-facing surface.
// The failure mode differs by function, by design:
//   - matchPathways: a missing synonym means the pathway is simply never OFFERED for that
//     wording — conservative in the sense that it never mis-routes, but it can under-trigger.
//   - redFlagGaps: a missing/unmatched topic term means the topic is treated as a GAP (i.e. it is
//     re-asked) — the safe failure direction, over-asking rather than silently assuming a red
//     flag was already covered.
// ───────────────────────────────────────────────────────────────────────────────────────────────

(function (global) {
  'use strict';

  // ── Load the CSO-signed pathway data (rules/reception-pathways.json) — read-only ─────────────
  // Node: require() the JSON directly (relative to this file). Browser (future integration
  // wave): a caller may instead pass an explicit `pathways` array as matchPathways()'s optional
  // second argument, or pre-populate `global.ReceptionPathwaysData` before this module loads —
  // this module never fetches or embeds the JSON itself in a browser context; that wiring is out
  // of scope for this phase (see SCOPE NOTE above).
  function loadDefaultPathwaysData() {
    if (typeof require === 'function') {
      try {
        // eslint-disable-next-line global-require
        return require('../rules/reception-pathways.json');
      } catch (e) {
        /* not resolvable under this module system/path — fall through to browser hook */
      }
    }
    if (typeof global !== 'undefined' && global.ReceptionPathwaysData) {
      return global.ReceptionPathwaysData;
    }
    return { pathways: [] };
  }

  const DEFAULT_PATHWAYS_DATA = loadDefaultPathwaysData();

  // ── Text-matching helpers ─────────────────────────────────────────────────────────────────────

  // normalise(s) — lowercase + strip apostrophes, so "can't breathe" (typed text) and "cant
  // breathe" (a term below) compare equal without listing both spellings everywhere.
  function normalise(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .replace(/[’']/g, '');
  }

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // containsTerm(normalisedText, term) — case-insensitive, whole-word-ish substring match: `\b`
  // anchors on both ends so short terms (e.g. "uti") don't match inside a longer word (e.g.
  // "utility") while multi-word phrases still match as a literal run of words.
  function containsTerm(normalisedText, term) {
    if (!term) return false;
    const re = new RegExp('\\b' + escapeRegExp(normalise(term)) + '\\b', 'i');
    return re.test(normalisedText);
  }

  function containsAnyTerm(normalisedText, terms) {
    return Array.isArray(terms) && terms.some((t) => containsTerm(normalisedText, t));
  }

  // ── SYNONYM_TERMS — per-pathway free-text match terms (CSO-reviewable; see header) ────────────
  // Conservative lay synonyms derived from each pathway's title/id, covering exactly the
  // pathways currently shipped in rules/reception-pathways.json. Add a new pathway's id here
  // when the pathways file gains one, or matchPathways will simply never offer it.
  const SYNONYM_TERMS = {
    'sore-throat': [
      'sore throat',
      'throat pain',
      'painful throat',
      'throat infection',
      'tonsillitis',
      'pharyngitis',
      'strep throat',
      'quinsy',
    ],
    earache: ['earache', 'ear ache', 'ear pain', 'painful ear', 'otitis media', 'otitis', 'ear infection'],
    cough: ['cough', 'coughing', 'chesty cough', 'chest infection', 'bronchitis', 'chest symptoms'],
    urinary: [
      'uti',
      'urine infection',
      'urinary tract infection',
      'urinary symptoms',
      'waterworks',
      'water infection',
      'cystitis',
      'dysuria',
      'burning when weeing',
      'burning when passing urine',
      'stinging when passing urine',
      'stinging when weeing',
    ],
    headache: ['headache', 'head pain', 'migraine'],
    backpain: ['back pain', 'backache', 'lower back pain', 'sciatica'],
    'feverish-child': [
      'feverish child',
      'child fever',
      'child with a fever',
      'child with a temperature',
      'baby fever',
      'baby with a temperature',
      'fever in baby',
      'fever in child',
      'febrile child',
      'high temperature child',
      'temperature in baby',
      'feverish baby',
    ],
    rash: [
      'rash',
      'skin rash',
      'skin problem',
      'spots',
      'skin infection',
      'cellulitis',
      'shingles',
      'impetigo',
      'hives',
      'urticaria',
    ],
    // Deliberately narrow: "general" is a catch-all pathway, so its terms are limited to explicit
    // "something not covered" phrasing rather than a bare "general" (too generic — would false-
    // match phrases like "in general I feel..." via a naive substring, defeated by \b in most
    // cases but still not a meaningful signal on its own).
    general: ['something else', 'general enquiry', 'general concern', 'not sure what', 'other problem'],
  };

  // ── RED_FLAG_TOPIC_TERMS — per-red-flag-id topic terms (CSO-reviewable; see header) ───────────
  // Keyed by redFlag.id, which is reused with the SAME clinical meaning across pathways in
  // rules/reception-pathways.json (e.g. "rf-confusion" always means new confusion, whether on the
  // cough or urinary pathway) — one shared term list per id. Covers every redFlag id currently
  // shipped in the file; add an entry here whenever a pathway gains a new red-flag id, or that
  // flag's topic will always read as "not mentioned" (a gap) — safe, but noisier than necessary.
  const RED_FLAG_TOPIC_TERMS = {
    'rf-breathing': [
      'difficulty breathing',
      'trouble breathing',
      'breathing difficulty',
      'cant breathe',
      'struggling to breathe',
      'noisy breathing',
      'high pitched breathing',
      'severe difficulty breathing',
    ],
    'rf-drooling': ['drooling', 'cant swallow', 'unable to swallow', 'drooling saliva'],
    'rf-trismus': ['cant open mouth', 'trismus', 'muffled voice', 'hot potato voice', 'lockjaw'],
    'rf-onesided': [
      'one side of the throat',
      'one sided throat',
      'swelling of the face',
      'swelling of the neck',
      'facial swelling',
    ],
    'rf-rash': ['rash', 'non blanching rash', 'rash that doesnt fade', 'glass test', 'purpuric rash'],
    'rf-immune': [
      'immunosuppressed',
      'weakened immune system',
      'methotrexate',
      'carbimazole',
      'chemotherapy',
      'immunocompromised',
      'immune suppressing',
    ],
    'rf-unwell-child': ['floppy', 'drowsy child', 'not drinking', 'lethargic child', 'unwell child'],
    'rf-mastoid': ['behind the ear', 'mastoid', 'swelling behind the ear', 'ear sticking out'],
    'rf-meningism': [
      'stiff neck',
      'neck stiffness',
      'photophobia',
      'dislike of light',
      'dislike of bright light',
      'meningitis',
    ],
    'rf-head-injury': ['head injury', 'bang to the head', 'bump to the head', 'fluid leaking from the ear'],
    'rf-sudden-deaf': ['sudden hearing loss', 'sudden deafness', 'cant hear'],
    'rf-facial-droop': ['facial droop', 'face drooping', 'facial weakness', 'drooping face'],
    'rf-breathless': ['breathless', 'shortness of breath', 'cant finish a sentence', 'breathless at rest', 'sob'],
    'rf-bluelips': ['blue lips', 'grey lips', 'blue face', 'cyanosis', 'blue or grey lips'],
    'rf-haemoptysis': ['coughing up blood', 'coughing up a large amount of blood', 'haemoptysis'],
    'rf-haemoptysis-minor': ['blood streaked phlegm', 'blood streaking', 'streaks of blood', 'slight blood in phlegm'],
    'rf-pe': [
      'calf pain',
      'swollen calf',
      'painful calf',
      'recent flight',
      'recent surgery',
      'sharp chest pain when breathing in',
    ],
    'rf-chestpain': ['chest pain', 'chest pressure', 'tight chest', 'pain in the chest'],
    'rf-confusion': ['confusion', 'confused', 'drowsy', 'disorientated', 'new confusion'],
    'rf-asthma': ['asthma', 'copd', 'inhaler not helping', 'reliever inhaler not working'],
    'rf-urosepsis': [
      'confusion and fever',
      'shivering and confused',
      'rigors with confusion',
      'unable to keep fluids down',
    ],
    'rf-sepsis': ['rigors', 'shaking chills', 'uncontrollable shivering', 'shivering and fever'],
    'rf-loin': ['loin pain', 'flank pain', 'kidney pain', 'side pain', 'pain around the kidney'],
    'rf-vomiting': ['vomiting', 'being sick', 'throwing up', 'cant keep fluids down', 'unable to keep fluids down'],
    'rf-pregnant': ['pregnant', 'pregnancy', 'could be pregnant'],
    'rf-male-child': ['hes male', 'hes a boy', 'male patient', 'under 16'],
    'rf-thunderclap': [
      'thunderclap headache',
      'sudden severe headache',
      'worst headache of my life',
      'worst headache ever',
    ],
    'rf-neuro': ['weakness', 'slurred speech', 'vision loss', 'face drooping', 'one sided weakness'],
    'rf-injury': ['head injury', 'fall and headache', 'vomiting after a head injury'],
    'rf-eye': ['red eye', 'painful eye', 'halos around lights', 'eye pain with headache'],
    'rf-new50': ['temple tenderness', 'pain when chewing', 'jaw claudication', 'new headache over 50'],
    'rf-thinners': ['blood thinners', 'warfarin', 'doac', 'anticoagulant', 'blood thinning medication'],
    'rf-saddle': [
      'saddle numbness',
      'numbness around the genitals',
      'numbness around the back passage',
      'saddle anaesthesia',
    ],
    'rf-bladder': [
      'bladder control',
      'bowel control',
      'incontinence',
      'cant feel passing urine',
      'loss of bladder control',
    ],
    'rf-bothlegs': ['both legs weak', 'weakness in both legs', 'numbness in both legs'],
    'rf-trauma': ['fall', 'accident', 'significant fall', 'injury from a fall'],
    'rf-fever': ['fever with back pain', 'feels very unwell', 'intravenous drug use', 'immunosuppressed'],
    'rf-cancer': ['history of cancer', 'previous cancer', 'cancer history'],
    'rf-under3m': ['baby under 3 months', 'under 3 months old with a fever', '3 month old fever'],
    'rf-floppy': ['floppy', 'hard to wake', 'high pitched cry', 'weak cry'],
    'rf-colour': ['blue skin', 'grey skin', 'mottled skin', 'pale skin', 'pale lips', 'mottled'],
    'rf-fluids': ['no wet nappy', 'not passing urine', 'sunken eyes', 'dehydrated', 'dry nappies'],
    'rf-seizure': ['seizure', 'fit', 'convulsion'],
    'rf-neck': ['stiff neck', 'bright light bothering them', 'photophobia'],
    'rf-nonblanching': ['non blanching rash', 'doesnt fade', 'glass test', 'purpura', 'rash that doesnt fade'],
    'rf-anaphylaxis': [
      'swelling of the lips',
      'swelling of the tongue',
      'swelling of the face',
      'difficulty breathing with the rash',
      'anaphylaxis',
    ],
    'rf-spreading': [
      'spreading rash',
      'red hot painful skin',
      'necrotising fasciitis',
      'spreading fast',
      'skin spreading quickly',
    ],
    'rf-blistering': ['blistering', 'skin peeling', 'mouth and eyes affected', 'sjs', 'stevens johnson'],
    'rf-newdrug': ['new medicine', 'started a new medication', 'new drug reaction', 'recently started a new tablet'],
    'rf-stroke': ['face drooping', 'arm weakness', 'slurred speech', 'fast test', 'signs of a stroke'],
    'rf-bleeding': ['heavy bleeding', 'bleeding that wont stop', 'uncontrolled bleeding'],
    'rf-collapse': ['collapsed', 'hard to wake', 'unconscious', 'collapse'],
    'rf-allergy': ['allergic reaction', 'swelling of lips or tongue', 'anaphylaxis', 'severe allergic reaction'],
    'rf-mentalhealth-attempt': [
      'attempting to harm themselves',
      'suicide attempt',
      'actively harming themselves',
      'plan and means to harm',
    ],
    'rf-mentalhealth': [
      'thoughts of harming themselves',
      'suicidal thoughts',
      'self harm thoughts',
      'thoughts of harming someone else',
    ],
  };

  // ── matchPathways(requestText, pathways?) ─────────────────────────────────────────────────────
  //
  // Returns an array of pathway objects (from rules/reception-pathways.json, or the optional
  // override `pathways` array) whose SYNONYM_TERMS set has at least one hit in `requestText`.
  // Returns [] on no match, empty/non-string input, or when no pathway data is available.
  // Multiple pathways may match the same text — order follows the source pathway list.
  function matchPathways(requestText, pathways) {
    const list = Array.isArray(pathways) ? pathways : (DEFAULT_PATHWAYS_DATA && DEFAULT_PATHWAYS_DATA.pathways) || [];
    if (typeof requestText !== 'string' || !requestText.trim()) return [];
    const text = normalise(requestText);
    const matches = [];
    for (const pathway of list) {
      if (!pathway || !pathway.id) continue;
      const terms = SYNONYM_TERMS[pathway.id];
      if (containsAnyTerm(text, terms)) matches.push(pathway);
    }
    return matches;
  }

  // ── pharmacyFirstEligibility(pathway, ageYears) ───────────────────────────────────────────────
  //
  // Returns { eligible: boolean, reason: string, ageNote: string|null }.
  //   - No pharmacyFirst block on the pathway → never eligible.
  //   - Age unknown (ageYears undefined/null/non-finite) AND the pathway declares an age bound
  //     (ageMin and/or ageMax) → FAIL CLOSED: eligible:false. Never claim an eligibility this
  //     function cannot confirm.
  //   - Age known and outside the declared band (below ageMin, or above ageMax when present) →
  //     not eligible.
  //   - Otherwise → eligible, with a reminder that a clinician/care navigator still confirms
  //     suitability (this function establishes AGE eligibility only, not clinical suitability).
  function pharmacyFirstEligibility(pathway, ageYears) {
    const pf = pathway && pathway.pharmacyFirst;
    if (!pf) {
      return { eligible: false, reason: 'no Pharmacy First pathway for this presentation', ageNote: null };
    }

    const ageNote = typeof pf.note === 'string' ? pf.note : null;
    const hasAgeMin = typeof pf.ageMin === 'number' && Number.isFinite(pf.ageMin);
    const hasAgeMax = typeof pf.ageMax === 'number' && Number.isFinite(pf.ageMax);
    const ageKnown = typeof ageYears === 'number' && Number.isFinite(ageYears);

    if ((hasAgeMin || hasAgeMax) && !ageKnown) {
      return { eligible: false, reason: 'age unknown — cannot confirm Pharmacy First age eligibility', ageNote };
    }
    if (hasAgeMin && ageYears < pf.ageMin) {
      return { eligible: false, reason: 'below Pharmacy First minimum age (' + pf.ageMin + ')', ageNote };
    }
    if (hasAgeMax && ageYears > pf.ageMax) {
      return { eligible: false, reason: 'above Pharmacy First maximum age (' + pf.ageMax + ')', ageNote };
    }
    return {
      eligible: true,
      reason: 'age criteria met for Pharmacy First — clinician or care navigator to confirm suitability',
      ageNote,
    };
  }

  // ── redFlagGaps(pathway, requestText) ─────────────────────────────────────────────────────────
  //
  // Returns { gaps, flaggedInText }, each an array of { id, ask, escalate } drawn from
  // pathway.redFlags:
  //   - gaps           — red flags whose topic is NOT found in requestText (or for which no term
  //                       list exists at all) — i.e. still needs asking. Conservative by
  //                       construction: "unsure" always resolves to a gap, never to "covered".
  //   - flaggedInText   — red flags whose topic IS found in requestText and which escalate to
  //                       '999' or 'duty' — the patient has already volunteered an escalation
  //                       signal; surface it rather than quietly filing it as "covered".
  function redFlagGaps(pathway, requestText) {
    const redFlags = pathway && Array.isArray(pathway.redFlags) ? pathway.redFlags : [];
    const text = normalise(requestText);
    const gaps = [];
    const flaggedInText = [];

    for (const rf of redFlags) {
      if (!rf || !rf.id) continue;
      const terms = RED_FLAG_TOPIC_TERMS[rf.id];
      const mentioned = containsAnyTerm(text, terms);
      const entry = { id: rf.id, ask: rf.ask, escalate: rf.escalate };
      if (!mentioned) {
        gaps.push(entry);
        continue;
      }
      if (rf.escalate === '999' || rf.escalate === 'duty') {
        flaggedInText.push(entry);
      }
    }
    return { gaps, flaggedInText };
  }

  // ── buildAskBackText(pathway, gaps, closingQuestions) ─────────────────────────────────────────
  //
  // Returns a short, plain-text, GP-review-ready draft listing the gap questions in lay language.
  // NEVER sent automatically — this is prepared text for a human to review/edit before use.
  // `gaps` — array as returned in redFlagGaps().gaps (or a caller-filtered subset).
  // `closingQuestions` — optional array of the pathway set's shared closing questions
  //   (rules/reception-pathways.json top-level `closingQuestions`), each { id, ask, ... }.
  function buildAskBackText(pathway, gaps, closingQuestions) {
    const title = (pathway && pathway.title) || 'Reception pathway';
    const gapList = Array.isArray(gaps) ? gaps : [];
    const closing = Array.isArray(closingQuestions) ? closingQuestions : [];
    const lines = [];

    lines.push('Ask-back for review — ' + title);
    lines.push(
      '(Prepared draft only — review and edit before sending. Escalate immediately per practice policy if any red-flag answer is positive.)'
    );
    lines.push('');

    if (gapList.length > 0) {
      lines.push("Not mentioned in the patient's request — may need asking:");
      for (const g of gapList) {
        const esc = g && g.escalate ? ' [escalate ' + g.escalate + ' if yes]' : '';
        lines.push('- ' + (g && g.ask ? g.ask : '') + esc);
      }
    } else {
      lines.push('No outstanding red-flag questions identified from the request text.');
    }

    if (closing.length > 0) {
      lines.push('');
      lines.push('Closing questions to consider:');
      for (const q of closing) {
        lines.push('- ' + (q && q.ask ? q.ask : ''));
      }
    }

    return lines.join('\n').trim() + '\n';
  }

  // ── Module export (dual-mode: Node require OR browser global) ────────────────────────────────
  const api = {
    matchPathways,
    pharmacyFirstEligibility,
    redFlagGaps,
    buildAskBackText,
    // Exposed for CSO review / coverage testing, not part of the "public" call surface above.
    SYNONYM_TERMS,
    RED_FLAG_TOPIC_TERMS,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.SentinelReceptionMatch = api;
  }
})(typeof window !== 'undefined' ? window : global);
