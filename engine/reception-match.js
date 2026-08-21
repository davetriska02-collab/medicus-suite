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

  // normalise(s) — lowercase, strip apostrophes, and treat hyphens/en-dashes as spaces, so
  // "can't breathe" (typed text) and "cant breathe" (a term below) compare equal, and so does
  // "self-harm" against the term "self harm", without listing every spelling everywhere.
  //
  // CSO REVIEW 2026-07-28 (Dr D. Triska, via delegated virtual-Dave agent): the hyphen rule was
  // ADDED at this review. Without it, `\b` anchoring meant the standard written spellings
  // "self-harm", "post-coital bleeding", "shoulder-tip pain" and "one-sided pain" matched NOTHING
  // — the terms lists carry the spaced forms only. That is the silent failure class this file's
  // header warns about (no error, no match, no chip), and it was live on the three DRAFT pathways.
  // Applying it in the normaliser rather than by adding hyphenated duplicates fixes every term at
  // once and keeps the lists reviewable. Pinned by test-reception-match.js.
  function normalise(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .replace(/[’']/g, '')
      .replace(/[-–—]/g, ' ');
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
    // Added for the v3.160.0 "sinusitis" pathway (rules/reception-pathways.json; NICE CKS /
    // Pharmacy First 12+). CSO-reviewable — see the CLINICAL-CONTENT NOTE in this file's header.
    sinusitis: [
      'sinusitis',
      'sinus infection',
      'sinus pain',
      'sinus pressure',
      'blocked sinuses',
      'facial pain',
      'facial pressure',
      'pain around the cheeks',
      'pain around the eyes',
      'pain in the face',
    ],
    // ── CSO-REVIEWED 2026-07-28 — signed off (reception-feedback plan section B) ────────────────
    // Signed off: Dr D. Triska (CSO) — review performed by delegated virtual-Dave agent at Dave's
    // instruction, 2026-07-28 (chat). Reviewed against rules/reception-pathways.json v1.8.
    // Changes made at review: hyphen normalisation added to normalise() above (see the note
    // there); 'balls' + 'testes' added to gu-male and 'thrush' to gyn-female as common lay terms
    // that were missing. Synonyms for the three pathways (gu-male, gyn-female, mental-health) —
    // CSO-reviewable content exactly like the entries above; see this file's CLINICAL-CONTENT
    // NOTE header.
    //
    // gu-male DELIBERATELY repeats the generic UTI terms ('uti', 'waterworks', 'urine infection')
    // that `urinary` also carries. That is the INTENDED behaviour, not a bug: matchPathways
    // returns BOTH candidates so the surface can OFFER both and a human picks — male UTI is
    // excluded from Pharmacy First and must never be silently routed down the women's UTI
    // pathway. test-reception-pathway-coverage.js pins this tie-break; do not "fix" it into
    // first-match-wins.
    'gu-male': [
      'testicle',
      'testicles',
      'testicular',
      'testes',
      // The word most male callers actually use. Added at CSO review 2026-07-28 — it was already
      // in this file's rf-torsion topic terms ("pain in the balls") but missing from the terms
      // that decide whether the pathway is OFFERED at all.
      'balls',
      'scrotum',
      'scrotal',
      'epididymitis',
      'orchitis',
      'prostate',
      'prostatitis',
      'psa',
      'foreskin',
      'penis',
      'male uti',
      'man uti',
      'uti',
      'urine infection',
      'urinary tract infection',
      'waterworks',
      'water infection',
      // Same lay term as `urinary` — so "cystitis" offers BOTH tiles (male UTI
      // is not Pharmacy First). Queue auto-chip must not first-match-win.
      'cystitis',
      'weak stream',
      'cant pass urine',
      'unable to pass urine',
      'urinary retention',
    ],
    // gyn-female: bare 'bleeding' and bare 'discharge' are deliberately NOT listed — they match
    // nosebleeds, ear discharge and hospital discharge far more often than gynae presentations,
    // and a synonym that fires on everything is no signal at all. The qualified forms below
    // carry the same lay wording without the noise.
    'gyn-female': [
      'period',
      'periods',
      'missed period',
      'period pain',
      'heavy periods',
      'irregular bleeding',
      'vaginal bleeding',
      'bleeding after sex',
      // Added at CSO review 2026-07-28: the clinical wording a triage note or a
      // referring colleague actually uses. The rf-pcb topic terms already carried
      // it; the pathway-offer terms did not, so a note written in those words
      // offered no gynae tile at all.
      'post coital bleeding',
      'postcoital bleeding',
      'bleeding after the menopause',
      'postmenopausal bleeding',
      'vaginal discharge',
      'smelly discharge',
      // Added at CSO review 2026-07-28: a very common lay presenting word, and NOT a Pharmacy
      // First condition — it belongs on the clinician-only gynae pathway, not nowhere.
      'thrush',
      'pelvic pain',
      'pregnant',
      'pregnancy',
      'could be pregnant',
      'miscarriage',
      'ectopic',
      'gynae',
      'gynaecology',
      'gynaecological',
      'menopause',
      'menopausal',
      'ovarian',
      'ovary',
    ],
    // mental-health: matched DELIBERATELY BROADLY. For this pathway the fail-safe direction is
    // over-offering, not under-offering — an unnecessary tile costs a receptionist one glance,
    // a missed one costs a distressed caller the right script. Terms cover lay wording for
    // distress, self-harm, and the named diagnoses callers use about themselves.
    'mental-health': [
      'mental health',
      'mental health crisis',
      'mental breakdown',
      'nervous breakdown',
      'anxiety',
      'anxious',
      'depression',
      'depressed',
      'low mood',
      'feeling low',
      'panic',
      'panic attack',
      'panic attacks',
      'self harm',
      'selfharm',
      'self harming',
      'harming themselves',
      'harm myself',
      'suicidal',
      'suicide',
      'ending their life',
      'end my life',
      'take my own life',
      'overdose',
      'crisis',
      'not coping',
      'cant cope',
      'distressed',
      'in distress',
      'psychosis',
      'psychotic',
      'hearing voices',
      'paranoid',
      'bipolar',
      'ptsd',
      'ocd',
      'eating disorder',
      'counselling',
      'talking therapy',
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
    'rf-male-child': [
      'hes male',
      'hes a boy',
      'male patient',
      'under 16',
      'male',
      'boy',
      'man with',
      'he has',
      'he thinks',
    ],
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
    'rf-household-co': [
      'carbon monoxide',
      'others in the house have the same headache',
      'everyone at home has a headache',
      'whole household has headaches',
      'partner has the same headache',
      'same headache at the same time',
    ],
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

    // ── Added for v3.160.0 red flags (cough weight-loss, GCA visual split, sinusitis pathway,
    //    feverish-child fontanelle). Topic terms derived conservatively from each red flag's
    //    `ask` text in rules/reception-pathways.json. CSO-reviewable — see this file's header;
    //    a missing/unmatched term is the SAFE direction here (the topic reads as a GAP and is
    //    re-asked), never a silent suppression. ─────────────────────────────────────────────
    // cough pathway — persistent-cough systemic red flags (lung cancer / TB): weight loss,
    // night sweats, loss of appetite over a cough lasting > 3 weeks.
    'rf-weightloss': [
      'weight loss',
      'unexplained weight loss',
      'losing weight',
      'night sweats',
      'drenching night sweats',
      'loss of appetite',
      'cough for weeks',
      'cough lasting more than 3 weeks',
      'persistent cough',
    ],
    // headache pathway — giant cell arteritis WITH visual threat (the visual variant of rf-new50).
    'rf-new50-visual': [
      'blurred vision',
      'blurring of vision',
      'double vision',
      'loss of vision',
      'sudden loss of vision',
      'vision loss',
      'sight loss',
      'temple tenderness',
      'jaw claudication',
      'pain when chewing',
    ],
    // sinusitis pathway — orbital cellulitis: eye swelling / proptosis / vision or eye-movement change.
    'rf-orbital': [
      'swelling around the eye',
      'swelling behind the eye',
      'eye pushed forward',
      'bulging eye',
      'proptosis',
      'painful eye movement',
      'cant move the eye',
      'change in vision',
      'orbital cellulitis',
      'red swollen eyelid',
    ],
    // sinusitis pathway — frontal osteomyelitis / Pott's puffy tumour: boggy forehead swelling.
    'rf-frontal-swelling': [
      'swelling of the forehead',
      'forehead swelling',
      'swollen forehead',
      'boggy swelling on the forehead',
      'doughy swelling',
      'redness of the forehead',
      'potts puffy tumour',
    ],
    // sinusitis pathway — severe, rapidly worsening facial pain with high fever, systemically unwell.
    'rf-severe-unwell': [
      'severe facial pain',
      'rapidly worsening facial pain',
      'facial pain getting rapidly worse',
      'very high fever',
      'looking very unwell',
      'very unwell',
      'high fever and unwell',
    ],
    // feverish-child pathway — bulging / tense fontanelle in a baby under 18 months.
    'rf-fontanelle': [
      'bulging fontanelle',
      'tense fontanelle',
      'bulging soft spot',
      'soft spot bulging',
      'soft spot is bulging',
      'swollen soft spot',
      'fontanelle',
    ],

    // ── 2026-07-25 Keeper additions (rf-morning-vomit, rf-nasal-unilateral, rf-skin-lesion,
    //    rf-haematuria, rf-hoarseness). Terms derived conservatively from each red flag's `ask`
    //    text in reception-pathways.json. CSO-reviewable content — see file header. ────────────

    // headache pathway — raised intracranial pressure: progressive morning headache, waking from
    // sleep, with vomiting not explained by another cause (NICE CKS Headache red flags).
    'rf-morning-vomit': [
      'headache in the morning',
      'morning headache',
      'headache wakes them',
      'headache waking from sleep',
      'progressively worse headache',
      'headache getting worse',
      'headache with vomiting',
      'vomiting with headache',
      'raised intracranial pressure',
    ],

    // sinusitis pathway — unilateral nasal obstruction/discharge: possible sinonasal cancer
    // (NICE NG12 ENT 2WW). 'One side only' is the key lay term.
    'rf-nasal-unilateral': [
      'one side only',
      'only one side',
      'blocked on one side',
      'runny on one side',
      'unilateral nasal',
      'one nostril',
      'blood in nasal discharge',
      'blood stained nasal',
      'not improving after weeks',
    ],

    // rash pathway — new or changing mole: possible melanoma (NICE NG12 2WW).
    'rf-skin-lesion': [
      'new mole',
      'changing mole',
      'mole changed',
      'mole getting bigger',
      'skin mark',
      'pigmented lesion',
      'dark spot',
      'mole changing shape',
      'mole changing colour',
    ],

    // general pathway — visible haematuria in 45+: possible bladder or kidney cancer
    // (NICE NG12 urology 2WW).
    'rf-haematuria': [
      'blood in urine',
      'blood in the urine',
      'red urine',
      'pink urine',
      'brown urine',
      'bloody urine',
      'haematuria',
      'blood in pee',
      'blood when passing water',
    ],

    // general pathway — persistent hoarseness ≥3 weeks: possible laryngeal or thyroid cancer
    // (NICE NG12 head and neck 2WW).
    'rf-hoarseness': [
      'hoarse voice',
      'voice change',
      'losing their voice',
      'lost their voice',
      'hoarseness',
      'horse voice',
      'voice gone hoarse',
      'voice has changed',
      'croaky voice',
    ],

    // ── CSO-REVIEWED 2026-07-28 — signed off. Red-flag topic terms for the three new
    //    pathways (gu-male, gyn-female, mental-health) added in reception-pathways.json v1.6,
    //    plus the four red flags added at CSO review in v1.8 (rf-priapism, rf-paraphimosis,
    //    rf-early-preg-tissue; gyn-female's rf-sepsis reuses the shared entry above).
    //    Signed off: Dr D. Triska (CSO) — review performed by delegated virtual-Dave agent at
    //    Dave's instruction, 2026-07-28 (chat).
    //    Terms derived conservatively from each red flag's `ask` text. CSO-reviewable content
    //    — see this file's header. Ids already listed above (rf-sepsis, rf-loin,
    //    rf-haematuria, rf-mentalhealth, rf-mentalhealth-attempt) are REUSED with the same
    //    clinical meaning and are not repeated here. A missing/unmatched term is the SAFE
    //    direction (the topic reads as a GAP and is re-asked). ─────────────────────────────

    // gu-male — testicular torsion: sudden severe testicular pain, ± nausea/vomiting.
    'rf-torsion': [
      'testicular pain',
      'testicle pain',
      'painful testicle',
      'sudden testicle pain',
      'severe pain in the testicle',
      'torsion',
      'twisted testicle',
      'pain in the balls',
    ],
    // gu-male — acute urinary retention: unable to pass any urine, painful full bladder.
    'rf-retention': [
      'cant pass urine',
      'unable to pass urine',
      'not passing any urine',
      'cant wee',
      'urinary retention',
      'full bladder',
      'bladder is full',
      'desperate to go but cant',
    ],
    // gu-male — priapism: a painful erection lasting >4 hours (ischaemic priapism is a
    // time-critical urological emergency). Added at CSO review 2026-07-28.
    'rf-priapism': [
      'priapism',
      'erection that wont go',
      'erection that will not go',
      'painful erection',
      'erection for hours',
      'stuck erection',
    ],
    // gu-male — paraphimosis: foreskin retracted and stuck behind the glans, swelling/pain.
    // Added at CSO review 2026-07-28.
    'rf-paraphimosis': [
      'paraphimosis',
      'foreskin stuck',
      'foreskin is stuck',
      'foreskin wont go back',
      'foreskin will not go back',
      'swollen foreskin',
      'trapped foreskin',
    ],
    // gu-male — testicular lump or change in shape/texture (NICE NG12 testicular 2WW).
    'rf-testis-lump': [
      'lump in the testicle',
      'testicular lump',
      'lump on the testicle',
      'swollen testicle',
      'swelling in the scrotum',
      'change in the testicle',
      'hard testicle',
    ],

    // gyn-female — ectopic pregnancy: possible pregnancy with severe/sudden one-sided pain,
    // faintness or dizziness (NICE NG126).
    'rf-ectopic-pain': [
      'pregnant and in pain',
      'possible pregnancy with pain',
      'one sided tummy pain',
      'pain on one side of the tummy',
      'severe tummy pain',
      'feeling faint',
      'dizzy',
      'ectopic',
    ],
    // gyn-female — ectopic pregnancy: shoulder-tip pain in possible pregnancy (NICE NG126).
    'rf-ectopic-shoulder': [
      'shoulder tip pain',
      'pain in the shoulder tip',
      'shoulder pain and pregnant',
      'tip of the shoulder',
    ],
    // gyn-female — early-pregnancy heavy bleeding or passing tissue.
    'rf-early-preg-bleed': [
      'heavy bleeding in pregnancy',
      'bleeding in early pregnancy',
      'soaking a pad',
      'soaking through a pad',
      'passing clots',
      'passing tissue',
      'miscarriage',
    ],
    // gyn-female — early-pregnancy bleeding WITHOUT heavy loss or faintness: passing clots or
    // tissue, i.e. the EPAU-within-24-hours group rather than the straight-to-A&E group
    // (NICE NG126). Split out from rf-early-preg-bleed at CSO review 2026-07-28.
    'rf-early-preg-tissue': [
      'passing clots',
      'passing tissue',
      'miscarriage',
      'bleeding in early pregnancy',
      'losing the pregnancy',
      'think shes miscarrying',
    ],
    // gyn-female — ovarian torsion / cyst accident: sudden severe one-sided pelvic pain with
    // vomiting or faintness.
    'rf-torsion-pelvic': [
      'sudden severe pelvic pain',
      'severe pelvic pain',
      'one sided pelvic pain',
      'pelvic pain and vomiting',
      'ovarian torsion',
      'ovarian cyst',
    ],
    // gyn-female — postmenopausal bleeding not explained by HRT (NICE NG12 gynae 2WW).
    'rf-pmb': [
      'bleeding after the menopause',
      'postmenopausal bleeding',
      'post menopausal bleeding',
      'bleeding since the menopause',
      'periods stopped years ago',
    ],
    // gyn-female — repeated post-coital bleeding (NICE NG12 gynae 2WW).
    'rf-pcb': ['bleeding after sex', 'post coital bleeding', 'postcoital bleeding', 'bleeds after intercourse'],
    // gyn-female — ovarian symptom cluster: persistent bloating / early satiety / appetite loss
    // most days for 3+ weeks (NICE NG12 ovarian).
    'rf-ovarian': [
      'bloating',
      'bloated',
      'feeling full quickly',
      'full after a few mouthfuls',
      'loss of appetite',
      'early satiety',
      'tummy swelling',
    ],

    // mental-health — immediate danger: overdose taken, serious injury, someone else at risk.
    'rf-danger-now': [
      'in danger',
      'taken an overdose',
      'overdose',
      'seriously injured themselves',
      'someone else at risk',
      'at risk right now',
      'threatening someone',
    ],
    // mental-health — self-harm today where the INJURY needs emergency treatment.
    'rf-selfharm-injury-urgent': [
      'self harmed today',
      'cut themselves',
      'deep wound',
      'heavy bleeding',
      'wont stop bleeding',
      'burn',
      'burned themselves',
      'needs stitches',
    ],
    // mental-health — self-harm today where the injury does NOT need emergency treatment.
    'rf-selfharm-not-urgent': [
      'self harmed',
      'self harming',
      'harmed themselves',
      'superficial cuts',
      'scratches',
      'minor injury from self harm',
    ],
    // mental-health — acutely worsening psychosis, unable to cope.
    'rf-psychosis-acute': [
      'hearing voices',
      'seeing things',
      'things that arent real',
      'getting worse quickly',
      'cannot cope',
      'cant cope',
      'psychotic',
      'psychosis',
    ],
    // mental-health — psychosis present but not acutely escalating.
    'rf-psychosis-present': [
      'hearing voices',
      'seeing things',
      'things that arent real',
      'paranoid',
      'delusions',
      'voices in their head',
    ],
    // mental-health — safeguarding: a child or vulnerable adult at risk. safeguarding:true on
    // the flag itself; matching here only decides whether the topic still needs asking.
    'rf-safeguarding': [
      'child at risk',
      'children at risk',
      'vulnerable adult',
      'safeguarding',
      'neglect',
      'abuse',
      'children in the house',
      'child protection',
    ],
    // mental-health — nowhere safe to be / nobody with them while in distress.
    'rf-no-safe-place': [
      'nowhere safe',
      'nowhere to go',
      'no safe place',
      'on their own',
      'nobody with them',
      'alone and distressed',
      'homeless',
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

  // Queue rows have a DOB but no sex. A green "Pharmacy First" chip on the
  // women's UTI pathway is a routing hazard whenever a male/clinician-only
  // pathway also matched, a male/child gate is still unanswered, or the
  // patient already volunteered an escalation red flag.
  const QUEUE_PF_BLOCK_PATHWAY_IDS = ['gu-male', 'gyn-female', 'mental-health', 'general'];
  function queuePharmacyFirstSafe(matchedPathways, gapsData) {
    if (!Array.isArray(matchedPathways) || !matchedPathways.length) return false;
    if (matchedPathways.some((p) => p && QUEUE_PF_BLOCK_PATHWAY_IDS.indexOf(p.id) !== -1)) {
      return false;
    }
    const gaps = (gapsData && gapsData.gaps) || [];
    const flagged = (gapsData && gapsData.flaggedInText) || [];
    const gapIds = gaps.map((g) => (g && g.id) || g);
    const flaggedIds = flagged.map((g) => (g && g.id) || g);
    if (gapIds.indexOf('rf-male-child') !== -1 || flaggedIds.indexOf('rf-male-child') !== -1) {
      return false;
    }
    if (flaggedIds.length > 0) return false;
    return true;
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
    queuePharmacyFirstSafe,
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
