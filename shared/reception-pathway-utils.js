// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Shared — Reception pathway utilities
//
// Single authoritative implementation of pathway validation, sanitisation and
// effective-set resolution, shared by:
//   - options/options.js          (pathway editor + enable toggles, classic script)
//   - shared/io/reception-io.js   (backup import validation)
//   - side-panel/modules/reception/reception.js (effective pathway set, via global)
//   - node tests                  (test-reception-pathway-utils.js)
//
// Dual-export pattern: same as engine/rules-engine.js / shared/rule-currency.js.

(function(global) {
  'use strict';

  const VALID_TYPES = ['yesno', 'text', 'choice', 'multi'];
  const VALID_ESCALATE = ['999', 'duty'];
  const ID_RE = /^[a-z0-9][a-z0-9-]{0,49}$/i;

  function isStr(v) { return typeof v === 'string'; }
  function nonEmpty(v) { return isStr(v) && v.trim().length > 0; }

  // ---------------------------------------------------------------------------
  // validatePathway(p) → string[]   (empty array = valid)
  // Structural + content rules. Red flags are the safety-critical part: a
  // pathway with no red-flag screen must never reach the reception UI.
  // ---------------------------------------------------------------------------
  function validatePathway(p) {
    const errs = [];
    if (!p || typeof p !== 'object' || Array.isArray(p)) return ['Pathway must be an object.'];
    if (!nonEmpty(p.id) || !ID_RE.test(p.id)) errs.push('id: required, letters/digits/hyphens, max 50 chars.');
    if (!nonEmpty(p.title)) errs.push('title: required.');
    else if (p.title.length > 80) errs.push('title: max 80 characters.');
    if (p.appliesTo != null && !isStr(p.appliesTo)) errs.push('appliesTo: must be text.');
    if (p.sources != null && (!Array.isArray(p.sources) || p.sources.some(s => !isStr(s)))) {
      errs.push('sources: must be a list of text entries.');
    }

    if (!Array.isArray(p.redFlags) || p.redFlags.length < 1) {
      errs.push('redFlags: at least one red-flag question is required.');
    } else {
      const seen = new Set();
      p.redFlags.forEach((rf, i) => {
        const tag = `redFlags[${i}]`;
        if (!rf || typeof rf !== 'object') { errs.push(`${tag}: must be an object.`); return; }
        if (!nonEmpty(rf.id) || !ID_RE.test(rf.id)) errs.push(`${tag}.id: required (letters/digits/hyphens).`);
        else if (seen.has(rf.id)) errs.push(`${tag}.id: duplicate "${rf.id}".`);
        else seen.add(rf.id);
        if (!nonEmpty(rf.ask) || rf.ask.trim().length < 10) errs.push(`${tag}.ask: required, at least 10 characters.`);
        if (VALID_ESCALATE.indexOf(rf.escalate) === -1) errs.push(`${tag}.escalate: must be "999" or "duty".`);
      });
    }

    if (!Array.isArray(p.questions) || p.questions.length < 1) {
      errs.push('questions: at least one history question is required.');
    } else {
      const seen = new Set();
      p.questions.forEach((q, i) => {
        const tag = `questions[${i}]`;
        if (!q || typeof q !== 'object') { errs.push(`${tag}: must be an object.`); return; }
        if (!nonEmpty(q.id) || !ID_RE.test(q.id)) errs.push(`${tag}.id: required (letters/digits/hyphens).`);
        else if (seen.has(q.id)) errs.push(`${tag}.id: duplicate "${q.id}".`);
        else seen.add(q.id);
        if (!nonEmpty(q.ask)) errs.push(`${tag}.ask: required.`);
        if (VALID_TYPES.indexOf(q.type) === -1) errs.push(`${tag}.type: must be one of ${VALID_TYPES.join('/')}.`);
        if ((q.type === 'choice' || q.type === 'multi') &&
            (!Array.isArray(q.options) || q.options.length < 2 || q.options.some(o => !nonEmpty(o)))) {
          errs.push(`${tag}.options: choice/multi need at least 2 non-empty options.`);
        }
        if (q.label != null && !isStr(q.label)) errs.push(`${tag}.label: must be text.`);
      });
    }

    if (p.pharmacyFirst != null) {
      const pf = p.pharmacyFirst;
      if (typeof pf !== 'object' || Array.isArray(pf)) errs.push('pharmacyFirst: must be an object.');
      else {
        if (!nonEmpty(pf.note)) errs.push('pharmacyFirst.note: required when pharmacyFirst is present.');
        if (pf.ageMin != null && typeof pf.ageMin !== 'number') errs.push('pharmacyFirst.ageMin: must be a number.');
        if (pf.ageMax != null && typeof pf.ageMax !== 'number') errs.push('pharmacyFirst.ageMax: must be a number.');
      }
    }
    return errs;
  }

  // ---------------------------------------------------------------------------
  // sanitisePathway(p) → clean copy
  // Whitelist-copies known fields only (trimmed) — imported/edited pathways
  // never carry unknown properties into storage or the renderer.
  // ---------------------------------------------------------------------------
  function sanitisePathway(p) {
    const t = v => isStr(v) ? v.trim() : v;
    const out = {
      id: t(p.id),
      title: t(p.title),
      appliesTo: nonEmpty(p.appliesTo) ? t(p.appliesTo) : undefined,
      sources: Array.isArray(p.sources) ? p.sources.filter(nonEmpty).map(t) : undefined,
      redFlags: (p.redFlags || []).map(rf => ({ id: t(rf.id), ask: t(rf.ask), escalate: rf.escalate })),
      questions: (p.questions || []).map(q => {
        const cq = { id: t(q.id), ask: t(q.ask), type: q.type };
        if (q.type === 'choice' || q.type === 'multi') cq.options = (q.options || []).filter(nonEmpty).map(t);
        if (nonEmpty(q.label)) cq.label = t(q.label);
        return cq;
      }),
    };
    if (p.pharmacyFirst && typeof p.pharmacyFirst === 'object') {
      out.pharmacyFirst = {
        note: t(p.pharmacyFirst.note),
        ageMin: typeof p.pharmacyFirst.ageMin === 'number' ? p.pharmacyFirst.ageMin : undefined,
        ageMax: typeof p.pharmacyFirst.ageMax === 'number' ? p.pharmacyFirst.ageMax : undefined,
      };
    }
    if (out.appliesTo === undefined) delete out.appliesTo;
    if (out.sources === undefined) delete out.sources;
    return out;
  }

  // ---------------------------------------------------------------------------
  // resolveEffectivePathways({ bundled, overrides, customPathways, enabledPathways,
  //                             disclaimerAccepted })
  //
  //   bundled             — pathways array from rules/reception-pathways.json
  //   overrides           — { [bundledId]: pathway } practice edits of bundled pathways
  //   customPathways      — array of practice-authored pathways
  //   enabledPathways     — { [id]: true } (anything else = disabled; DEFAULT IS OFF)
  //   disclaimerAccepted  — boolean; MUST be strictly true for any pathway to be
  //                         enabled. When absent or falsy the returned `enabled`
  //                         array is ALWAYS empty (fail-safe). The `all` listing
  //                         is unaffected so toggle controls still render correctly
  //                         before acceptance.
  //
  // Returns { all, enabled }:
  //   all     — [{ pathway, origin: 'bundled'|'edited'|'custom', enabled,
  //                invalid, overrideInvalid }]
  //             invalid         — the ACTIVE pathway is unusable (invalid or
  //                               id-clashing custom): excluded from `enabled`.
  //             overrideInvalid — a practice edit failed validation and was
  //                               ignored; the bundled original stays active
  //                               and enable-able. Flagged, never silent.
  //   enabled — pathway objects that are enabled AND usable AND disclaimer has
  //             been accepted, in listing order. Empty when disclaimer not accepted.
  // ---------------------------------------------------------------------------
  function resolveEffectivePathways(input) {
    const bundled = (input && input.bundled) || [];
    const overrides = (input && input.overrides) || {};
    const custom = (input && input.customPathways) || [];
    const enabledMap = (input && input.enabledPathways) || {};
    // Disclaimer gate: if not strictly true, no pathway is enabled (fail-safe).
    const disclaimerAccepted = (input && input.disclaimerAccepted) === true;
    const all = [];
    const seenIds = new Set();

    for (const b of bundled) {
      if (!b || !b.id || seenIds.has(b.id)) continue;
      seenIds.add(b.id);
      const ov = overrides[b.id];
      let pathway = b, origin = 'bundled', overrideInvalid = false;
      if (ov) {
        const errs = validatePathway(ov);
        if (errs.length === 0 && ov.id === b.id) { pathway = ov; origin = 'edited'; }
        else { overrideInvalid = true; } // ignore the bad edit; bundled original stays active
      }
      all.push({ pathway, origin, enabled: enabledMap[b.id] === true, invalid: false, overrideInvalid });
    }

    for (const c of custom) {
      if (!c || !c.id) continue;
      const clash = seenIds.has(c.id);
      const errs = validatePathway(c);
      if (clash || errs.length > 0) {
        all.push({ pathway: c, origin: 'custom', enabled: false, invalid: true, overrideInvalid: false });
        continue;
      }
      seenIds.add(c.id);
      all.push({ pathway: c, origin: 'custom', enabled: enabledMap[c.id] === true, invalid: false, overrideInvalid: false });
    }

    // Disclaimer gate: even if a pathway has enabled===true in the config, it
    // must not reach reception until a local admin has explicitly accepted the
    // disclaimer in-browser. When disclaimerAccepted is false, enabled is always
    // empty so the capture UI shows "pathways are switched off".
    const enabled = disclaimerAccepted
      ? all.filter(e => e.enabled && !e.invalid).map(e => e.pathway)
      : [];
    return { all, enabled };
  }

  // ---------------------------------------------------------------------------
  // pathwaySchemaPrompt() → string
  // Returns a self-contained LLM instruction string that asks an external LLM
  // to author a single reception triage-capture pathway in the exact JSON shape
  // that validatePathway() enforces. Embed the returned string in an LLM chat,
  // then paste the JSON response back into the "Import pathway" box in the
  // Reception options page.
  //
  // The embedded EXAMPLE JSON is delimited by the stable markers
  //   --- EXAMPLE JSON ---
  //   --- END EXAMPLE ---
  // so that tests can slice it out and feed it through validatePathway().
  // ---------------------------------------------------------------------------
  function pathwaySchemaPrompt() {
    return `You are generating a single reception triage-capture pathway for a UK GP practice. Output ONLY a JSON object — no prose, no markdown fences, no code blocks. The object must conform exactly to the schema below.

=== SCHEMA ===

Top-level fields:

  id          (string, required)
              Lowercase letters, digits, and hyphens only. Maximum 50 characters.
              Use a short slug that names the clinical topic, e.g. "cellulitis" or "back-pain-adult".

  title       (string, required)
              Human-readable pathway name shown to reception staff. Maximum 80 characters.
              e.g. "Cellulitis / skin infection"

  appliesTo   (string, optional)
              Audience note, e.g. "Adults". Omit if not needed.

  sources     (array of strings, optional)
              List the NICE CKS topic, NICE guideline number, or other guidance you based
              each part of the pathway on. Always include at least one source so the practice
              can verify currency. e.g. ["NICE CKS: Cellulitis", "NICE NG141: Cellulitis (2019)"]

  redFlags    (array, required — minimum 1 item)
              Asked FIRST, before history questions. Every red-flag question must be answered
              before proceeding. Each item:
                id        (string) — unique slug within this pathway, e.g. "rf-spreading"
                ask       (string) — the question as spoken on the phone, in plain lay English.
                           Minimum 10 characters. Must be phrased so a non-clinical receptionist
                           understands it and the patient can answer yes/no.
                escalate  (string) — either "999" or "duty"
                           "999" = immediate life-threatening emergency (call 999 / emergency
                                   ambulance; do not put in a queue)
                           "duty" = same-day clinician review required (alert the duty GP now)

  questions   (array, required — minimum 1 item)
              History questions asked after all red flags are clear. Each item:
                id        (string) — unique slug within this pathway, e.g. "q-duration"
                ask       (string) — the question as spoken on the phone
                type      (string) — one of: "yesno", "text", "choice", "multi"
                           yesno  = yes/no answer
                           text   = free-text answer
                           choice = pick exactly one option (must also provide "options")
                           multi  = pick one or more options (must also provide "options")
                options   (array of strings) — required when type is "choice" or "multi";
                           minimum 2 options, each non-empty
                label     (string, optional) — short label used in the pasted summary,
                           e.g. "Duration". Omit if not needed.

  pharmacyFirst (object, optional)
              Include only if this condition is covered by the NHS Pharmacy First scheme.
                note    (string, required) — brief note for the receptionist, e.g.
                         "Pharmacy First covers impetigo from age 1 — confirm suitability."
                ageMin  (number, optional) — minimum patient age in years for Pharmacy First
                ageMax  (number, optional) — maximum patient age in years for Pharmacy First

=== CLINICAL SAFETY INSTRUCTIONS ===

1.  Red flags must be phrased in plain lay language a non-clinical receptionist can read
    aloud to a patient on the phone. Avoid clinical jargon.

2.  Red flags must be asked FIRST — the pathway design requires this order. Base them on
    the NICE CKS red-flag lists and NICE guideline red-flag criteria for the presenting
    condition.

3.  Escalation level must be conservative:
    - "999" for any presentation that could be immediately life-threatening (e.g. anaphylaxis,
      spreading rapidly with systemic features, airway involvement, sepsis features).
    - "duty" for presentations needing same-day clinical assessment.
    - When in doubt, escalate HIGHER.

4.  Sepsis red flags: for any potentially infected patient include at least one red flag
    covering systemic features (high fever / rigors, very unwell, rapid breathing, confusion,
    mottled or cold skin). Escalate these to "999".

5.  Immunosuppression: include a red flag asking about medicines that weaken the immune
    system (steroids, methotrexate, biologic agents, chemotherapy, etc.) — these patients
    need same-day assessment at minimum.

6.  Include a "sources" list citing the specific NICE CKS page, NICE guideline, or other
    UK guidance you used. This helps the practice verify the pathway is current.

7.  Be conservative throughout: the cost of unnecessary escalation is inconvenience;
    the cost of missed escalation can be a patient's life.

=== EXAMPLE JSON ---

--- EXAMPLE JSON ---
{
  "id": "sore-throat",
  "title": "Sore throat",
  "appliesTo": "Adults and children",
  "sources": ["NICE CKS: Sore throat — acute", "NHS Pharmacy First: acute sore throat pathway"],
  "redFlags": [
    { "id": "rf-breathing", "ask": "Any difficulty breathing, or noisy / high-pitched breathing?", "escalate": "999" },
    { "id": "rf-drooling", "ask": "Are they drooling, or unable to swallow their own saliva?", "escalate": "999" },
    { "id": "rf-trismus", "ask": "Unable to open the mouth properly, or voice sounds muffled like a hot potato voice?", "escalate": "duty" },
    { "id": "rf-onesided", "ask": "Severe pain on ONE side of the throat with swelling of the face or neck?", "escalate": "duty" },
    { "id": "rf-rash", "ask": "Any rash that does NOT fade when pressed with a glass?", "escalate": "999" },
    { "id": "rf-immune", "ask": "Do they take any medicine that weakens the immune system, for example carbimazole, methotrexate, or chemotherapy?", "escalate": "duty" },
    { "id": "rf-unwell-child", "ask": "If a child: are they floppy, unusually drowsy, or not drinking at all?", "escalate": "duty" }
  ],
  "questions": [
    { "id": "q-duration", "ask": "How long has the sore throat been going on?", "type": "text", "label": "Duration" },
    { "id": "q-fever", "ask": "Any fever in the last 24 hours?", "type": "yesno", "label": "Fever last 24h" },
    { "id": "q-eatdrink", "ask": "Are they managing to eat and drink?", "type": "choice", "options": ["Eating and drinking OK", "Drinking but not eating", "Struggling with fluids too"], "label": "Eating/drinking" },
    { "id": "q-cough", "ask": "Do they have a cough as well?", "type": "yesno", "label": "Cough present" },
    { "id": "q-glands", "ask": "Any swollen or tender glands in the neck?", "type": "yesno", "label": "Neck glands" }
  ],
  "pharmacyFirst": {
    "note": "Pharmacy First covers acute sore throat from age 5 — clinician or care navigator to confirm suitability.",
    "ageMin": 5
  }
}
--- END EXAMPLE ---

=== CLOSING REMINDER ===

The practice's clinical safety officer (CSO) or a nominated GP MUST review this pathway
before it is used by reception staff. Importing the pathway does NOT enable it — it must
be reviewed clinically and then toggled on explicitly in the Reception settings.
`;
  }

  // ---------------------------------------------------------------------------
  // Tile organisation — colour, manual order, alpha sort.
  //
  // These are DISPLAY / ORGANISING preferences only, edited from the reception
  // panel itself and stored in `reception.tilePrefs`. They never affect which
  // pathways are enabled, never gate clinical content, and a tile colour is NOT
  // a clinical flag (the panel says so in the UI). Kept here so the panel, the
  // backup importer, and the node test share one validated implementation.
  //
  //   reception.tilePrefs = {
  //     sortMode: 'manual' | 'alpha',          // default 'manual'
  //     order:    string[],                    // pathway ids, manual order
  //     colours:  { [pathwayId]: colourKey }   // colourKey ∈ TILE_COLOUR_KEYS
  //   }
  // ---------------------------------------------------------------------------

  // Palette offered for colour-coding tiles. 'default' = no colour. Each key maps
  // to a CSS class (rcp-tile-c-<key>) in reception.css; keep the two in sync.
  const TILE_COLOUR_KEYS = ['default', 'slate', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'purple', 'pink'];

  function isValidColourKey(k) { return TILE_COLOUR_KEYS.indexOf(k) !== -1; }

  // orderTiles(pathways, prefs) → pathways[] in display order.
  //   'alpha'  → sorted by title, case-insensitive, locale-aware.
  //   'manual' → ids listed in prefs.order first (those still present, in that
  //              order), then any pathway not in prefs.order appended in its
  //              incoming order. Never drops or duplicates a pathway — same
  //              reconcile contract as tab-order.js reconcileTabOrder, so a
  //              newly-added or removed pathway can't vanish from the picker.
  function orderTiles(pathways, prefs) {
    const list = Array.isArray(pathways) ? pathways.slice() : [];
    const mode = (prefs && prefs.sortMode === 'alpha') ? 'alpha' : 'manual';
    if (mode === 'alpha') {
      return list.sort((a, b) =>
        String((a && a.title) || '').localeCompare(String((b && b.title) || ''), undefined, { sensitivity: 'base' }));
    }
    const order = (prefs && Array.isArray(prefs.order)) ? prefs.order : [];
    const byId = new Map();
    for (const p of list) { if (p && p.id != null) byId.set(p.id, p); }
    const result = [];
    const seen = new Set();
    for (const id of order) {
      if (byId.has(id) && !seen.has(id)) { result.push(byId.get(id)); seen.add(id); }
    }
    for (const p of list) {
      if (p && p.id != null && !seen.has(p.id)) { result.push(p); seen.add(p.id); }
    }
    return result;
  }

  // tileColourFor(prefs, id) → a valid colour key ('default' when unset/invalid).
  function tileColourFor(prefs, id) {
    const c = prefs && prefs.colours && prefs.colours[id];
    return isValidColourKey(c) ? c : 'default';
  }

  // sanitiseTilePrefs(raw, validIds) → clean prefs object safe to store/render.
  //   Drops unknown sort modes, non-array order, duplicate ids, invalid colour
  //   keys, and 'default' colours (absence == default). When validIds (Set or
  //   array) is supplied, order entries and colour keys are also filtered to
  //   known pathway ids; otherwise ids are accepted on shape (ID_RE) alone.
  //   Building a fresh object also blocks prototype-pollution keys on import.
  function sanitiseTilePrefs(raw, validIds) {
    const out = { sortMode: 'manual', order: [], colours: {} };
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    if (raw.sortMode === 'alpha') out.sortMode = 'alpha';
    const idOk = validIds
      ? (validIds instanceof Set ? (x => validIds.has(x)) : (x => Array.isArray(validIds) && validIds.indexOf(x) !== -1))
      : (x => typeof x === 'string' && ID_RE.test(x));
    if (Array.isArray(raw.order)) {
      const seen = new Set();
      for (const id of raw.order) {
        if (typeof id === 'string' && idOk(id) && !seen.has(id)) { out.order.push(id); seen.add(id); }
      }
    }
    if (raw.colours && typeof raw.colours === 'object' && !Array.isArray(raw.colours)) {
      for (const [id, key] of Object.entries(raw.colours)) {
        if (idOk(id) && isValidColourKey(key) && key !== 'default') out.colours[id] = key;
      }
    }
    return out;
  }

  const api = {
    validatePathway, sanitisePathway, resolveEffectivePathways, pathwaySchemaPrompt,
    orderTiles, tileColourFor, sanitiseTilePrefs, TILE_COLOUR_KEYS,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.ReceptionPathwayUtils = api;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : global));
