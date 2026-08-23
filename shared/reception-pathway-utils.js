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

  // ── Disposition routing (plan section E) — CLOSED vocabularies ───────────────
  // Every list below is a closed enum. Anything outside it makes the whole
  // pathway INVALID (never "silently ignored"): a routing block that half-parses
  // is how an editable data file quietly sends a patient somewhere a clinician
  // never agreed to.
  const DISPOSITION_DOMAINS = Object.freeze([
    'minor_infection', 'msk', 'gu_male', 'gyn_female', 'mental_health', 'other',
  ]);
  const DISPOSITION_DESTINATIONS = Object.freeze(['pharmacy_first', 'anp', 'paramedic', 'gp_routine']);
  const DISPOSITION_DEFAULTS = Object.freeze(['gp_routine', 'duty']);
  // `when` vocabulary — deliberately TINY and closed. Adding a key here is a
  // clinical-safety change: it widens what editable data can express about
  // routing. Unknown keys invalidate the pathway.
  const DISPOSITION_WHEN_KEYS = Object.freeze(['pharmacyFirstEligible', 'ageUnder', 'ageAtLeast']);
  const DISPOSITION_BLOCK_KEYS = Object.freeze(['domain', 'allowed', 'rules', 'default']);

  // ── Frozen clinician-only sets — SINGLE SOURCE OF TRUTH ─────────────────────
  // These are constants in code, not data, and they are keyed on the BUNDLED
  // pathway id / domain and applied AFTER override resolution. A practice fork
  // of `mental-health` that relabels itself `domain: "other"` therefore cannot
  // reach a non-clinician destination: the id is still `mental-health`.
  // reception-core.js's evaluateDisposition imports these (kept in lock-step by
  // test-reception-disposition.js, which compares the two exports).
  const CLINICIAN_ONLY_IDS = Object.freeze(['mental-health', 'gu-male', 'gyn-female', 'general', 'fever-adult']);
  const CLINICIAN_ONLY_DOMAINS = Object.freeze(['mental_health', 'gu_male', 'gyn_female']);

  function isStr(v) { return typeof v === 'string'; }
  function nonEmpty(v) { return isStr(v) && v.trim().length > 0; }
  function isInt(v) { return typeof v === 'number' && Number.isInteger(v); }

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
    // sensitive (optional, v1.6) — a pathway whose free text is too sensitive to
    // persist. Capture drafts are NEVER auto-saved for it and taker initials are
    // mandatory. Boolean only: an unrecognised value must not read as "true".
    if (p.sensitive != null && typeof p.sensitive !== 'boolean') {
      errs.push('sensitive: must be true or false.');
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
        // safeguarding (optional, v1.6) — marks a safeguarding concern: escalate
        // immediately to the duty clinician AND the practice safeguarding lead,
        // bypassing all routing. Boolean only, for the same reason as `sensitive`.
        if (rf.safeguarding != null && typeof rf.safeguarding !== 'boolean') {
          errs.push(`${tag}.safeguarding: must be true or false.`);
        }
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

    if (p.disposition != null) validateDisposition(p.disposition, errs);
    return errs;
  }

  // ---------------------------------------------------------------------------
  // validateDisposition(d, errs) — pushes errors for a malformed disposition
  // block. A malformed block makes the PATHWAY invalid; it is never partially
  // honoured. Closed vocabularies throughout, unknown keys rejected.
  // ---------------------------------------------------------------------------
  function validateDisposition(d, errs) {
    if (typeof d !== 'object' || Array.isArray(d)) { errs.push('disposition: must be an object.'); return; }
    for (const k of Object.keys(d)) {
      if (DISPOSITION_BLOCK_KEYS.indexOf(k) === -1) errs.push(`disposition: unknown field "${k}".`);
    }
    if (DISPOSITION_DOMAINS.indexOf(d.domain) === -1) {
      errs.push(`disposition.domain: must be one of ${DISPOSITION_DOMAINS.join('/')}.`);
    }
    let allowed = [];
    if (!Array.isArray(d.allowed) || d.allowed.length < 1) {
      errs.push('disposition.allowed: at least one destination is required.');
    } else {
      const seen = new Set();
      for (const a of d.allowed) {
        if (DISPOSITION_DESTINATIONS.indexOf(a) === -1) {
          errs.push(`disposition.allowed: "${a}" is not a known destination (${DISPOSITION_DESTINATIONS.join('/')}).`);
        } else if (seen.has(a)) errs.push(`disposition.allowed: duplicate "${a}".`);
        else { seen.add(a); allowed.push(a); }
      }
    }
    if (d.rules != null) {
      if (!Array.isArray(d.rules)) errs.push('disposition.rules: must be a list.');
      else {
        d.rules.forEach((r, i) => {
          const tag = `disposition.rules[${i}]`;
          if (!r || typeof r !== 'object' || Array.isArray(r)) { errs.push(`${tag}: must be an object.`); return; }
          for (const k of Object.keys(r)) {
            if (k !== 'when' && k !== 'suggest') errs.push(`${tag}: unknown field "${k}".`);
          }
          // suggest ∈ allowed ∪ [gp_routine] — a rule can always fall back to a
          // GP appointment, but it can never name a destination the pathway's
          // own `allowed` list does not carry.
          if (allowed.indexOf(r.suggest) === -1 && r.suggest !== 'gp_routine') {
            errs.push(`${tag}.suggest: must be one of the pathway's allowed destinations, or "gp_routine".`);
          }
          const w = r.when;
          if (!w || typeof w !== 'object' || Array.isArray(w)) { errs.push(`${tag}.when: must be an object.`); return; }
          const keys = Object.keys(w);
          if (keys.length < 1) errs.push(`${tag}.when: at least one condition is required.`);
          for (const k of keys) {
            if (DISPOSITION_WHEN_KEYS.indexOf(k) === -1) {
              errs.push(`${tag}.when: unknown condition "${k}" (allowed: ${DISPOSITION_WHEN_KEYS.join('/')}).`);
              continue;
            }
            if (k === 'pharmacyFirstEligible') {
              if (typeof w[k] !== 'boolean') errs.push(`${tag}.when.${k}: must be true or false.`);
            } else if (!isInt(w[k]) || w[k] < 0 || w[k] > 120) {
              errs.push(`${tag}.when.${k}: must be a whole number of years, 0-120.`);
            }
          }
        });
      }
    }
    if (DISPOSITION_DEFAULTS.indexOf(d.default) === -1) {
      errs.push(`disposition.default: must be one of ${DISPOSITION_DEFAULTS.join('/')}.`);
    }
  }

  // ---------------------------------------------------------------------------
  // sanitiseDisposition(d) → clean block (assumes validation has passed; still
  // whitelist-copies, so an unvalidated block cannot smuggle extra fields).
  // ---------------------------------------------------------------------------
  function sanitiseDisposition(d) {
    const out = {
      domain: d.domain,
      allowed: (Array.isArray(d.allowed) ? d.allowed : []).filter(a => DISPOSITION_DESTINATIONS.indexOf(a) !== -1),
      default: DISPOSITION_DEFAULTS.indexOf(d.default) !== -1 ? d.default : 'gp_routine',
    };
    out.rules = (Array.isArray(d.rules) ? d.rules : []).map(r => {
      const when = {};
      for (const k of DISPOSITION_WHEN_KEYS) {
        if (r && r.when && Object.prototype.hasOwnProperty.call(r.when, k)) when[k] = r.when[k];
      }
      return { when, suggest: r.suggest };
    });
    return out;
  }

  // ---------------------------------------------------------------------------
  // overrideDowngradesDisposition(bundled, override) → boolean
  //
  // The corrected guardrail design (plan E, guardrail 2). `domain` lives in the
  // pathway object and reception.pathwayOverrides accepts any valid whole-object
  // fork — so without this check a fork of `mental-health` declaring
  // `domain: "other", allowed: ["pharmacy_first"]` would be a structurally valid
  // pathway. It still could not route anywhere (evaluateDisposition keys the
  // frozen sets on the BUNDLED id), but the edit would be accepted silently.
  // This rejects it at resolve time instead, where the bundled id is known, and
  // the caller flags it as overrideInvalid so the practice sees it.
  //
  // Clinician-only bundled pathway = frozen id, or sensitive:true, or a bundled
  // domain in CLINICIAN_ONLY_DOMAINS. A downgrade = an override that gives such
  // a pathway a non-clinician-only domain, or any destination/suggestion other
  // than gp_routine. An override with NO disposition block is not a downgrade.
  // ---------------------------------------------------------------------------
  function overrideDowngradesDisposition(bundled, override) {
    if (!bundled || !override || typeof override !== 'object') return false;
    const clinicianOnly =
      CLINICIAN_ONLY_IDS.indexOf(bundled.id) !== -1 ||
      bundled.sensitive === true ||
      !!(bundled.disposition && CLINICIAN_ONLY_DOMAINS.indexOf(bundled.disposition.domain) !== -1);
    if (!clinicianOnly) return false;
    const d = override.disposition;
    if (!d || typeof d !== 'object' || Array.isArray(d)) return false;
    if (CLINICIAN_ONLY_DOMAINS.indexOf(d.domain) === -1) return true;
    if (Array.isArray(d.allowed) && d.allowed.some(a => a !== 'gp_routine')) return true;
    if (Array.isArray(d.rules) && d.rules.some(r => r && r.suggest !== 'gp_routine')) return true;
    return false;
  }

  // ---------------------------------------------------------------------------
  // Routing attestation (plan E, guardrail 6) — reception.routingAttestation.
  //
  //   { attestedBy: string, role: 'cso'|'partner',
  //     attestedAt: ISO datetime string, scope: 'custom-routing' }
  //
  // Custom / practice-edited pathways are clinician-only for routing purposes
  // until this record exists. The attester is the CSO or a partner (Dave,
  // 2026-07-28) — no other role unlocks it.
  //
  // KEEP IN SYNC with isValidRoutingAttestation() in
  // side-panel/modules/reception/reception-core.js (ES module — cannot be
  // required from this classic script). test-reception-disposition.js compares
  // the two implementations across a shared fixture table.
  // ---------------------------------------------------------------------------
  const ROUTING_ATTESTATION_ROLES = Object.freeze(['cso', 'partner']);
  const ROUTING_ATTESTATION_SCOPE = 'custom-routing';
  const _ATTEST_ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

  function isValidRoutingAttestation(a) {
    if (!a || typeof a !== 'object' || Array.isArray(a)) return false;
    if (!nonEmpty(a.attestedBy)) return false;
    if (ROUTING_ATTESTATION_ROLES.indexOf(a.role) === -1) return false;
    if (!isStr(a.attestedAt) || !_ATTEST_ISO_RE.test(a.attestedAt)) return false;
    if (a.scope !== ROUTING_ATTESTATION_SCOPE) return false;
    return true;
  }

  // sanitiseRoutingAttestation(a) → clean record, or null when invalid. Used by
  // the options page and by the backup importer (invalid → dropped, never
  // half-stored: a partial attestation must not read as a sign-off).
  function sanitiseRoutingAttestation(a) {
    if (!isValidRoutingAttestation(a)) return null;
    return {
      attestedBy: String(a.attestedBy).trim().slice(0, 120),
      role: a.role,
      attestedAt: a.attestedAt,
      scope: ROUTING_ATTESTATION_SCOPE,
    };
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
      redFlags: (p.redFlags || []).map(rf => {
        const crf = { id: t(rf.id), ask: t(rf.ask), escalate: rf.escalate };
        // Only the literal boolean true survives — "true", 1, {} etc. are dropped,
        // so a crafted import cannot smuggle a truthy safeguarding marker through.
        if (rf.safeguarding === true) crf.safeguarding = true;
        return crf;
      }),
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
    // Disposition routing block (optional). Whitelist-copied through
    // sanitiseDisposition so an unknown destination, condition key or extra
    // field cannot survive an import or an editor save.
    if (p.disposition && typeof p.disposition === 'object' && !Array.isArray(p.disposition)) {
      out.disposition = sanitiseDisposition(p.disposition);
    }
    // Same strict-true rule as redFlags[].safeguarding above.
    if (p.sensitive === true) out.sensitive = true;
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
        // A structurally valid edit is still rejected when it would DOWNGRADE a
        // clinician-only bundled pathway's routing (plan E guardrail 2). The
        // bundled id is only known here, which is why the check lives at resolve
        // time rather than inside validatePathway.
        if (errs.length === 0 && ov.id === b.id && !overrideDowngradesDisposition(b, ov)) {
          pathway = ov; origin = 'edited';
        } else { overrideInvalid = true; } // ignore the bad edit; bundled original stays active
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

  sensitive   (boolean, optional — set to true, or omit entirely)
              Marks the pathway as carrying especially sensitive free text (e.g. mental
              health / emotional distress). When true:
                - capture drafts are NEVER auto-saved to local storage (nothing the
                  caller says is left sitting on a shared front-desk machine), and
                - the receptionist's initials become MANDATORY before a summary can be
                  generated.
              Use it sparingly and only where the content genuinely warrants it.

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
                           There is NO conditional level. Never write a flag whose answer means
                           "999 in one case, duty in another" — split it into two separate flags
                           with unambiguous lay wording, one per level.
                safeguarding (boolean, optional — set to true, or omit entirely)
                           Marks this flag as a SAFEGUARDING concern (a child or vulnerable
                           adult at risk of harm, neglect, or abuse). A positive answer must be
                           escalated immediately to the duty clinician AND the practice
                           safeguarding lead, and bypasses all other routing. Set "escalate"
                           as well — safeguarding is in addition to, not instead of, a level.

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

  disposition (object, optional)
              An if-this-then-that block that lets the tool SUGGEST where the patient could
              safely be seen once every red flag has been answered "no". It suggests; a human
              decides; the receptionist always also offers a clinician callback. Omit the
              block entirely for anything that should always go to a clinician.
                domain  (string, required) — one of:
                         "minor_infection", "msk", "gu_male", "gyn_female",
                         "mental_health", "other"
                allowed (array, required) — the destinations this pathway may ever suggest.
                         Each entry one of: "pharmacy_first", "anp", "paramedic", "gp_routine"
                rules   (array, optional) — evaluated IN ORDER, first match wins. Each item:
                           when    (object) — one or more conditions, ALL of which must hold.
                                    The condition vocabulary is CLOSED — only these three keys
                                    exist, anything else makes the pathway invalid:
                                      pharmacyFirstEligible (boolean) — the patient's confirmed
                                        age falls inside this pathway's own pharmacyFirst
                                        ageMin/ageMax band (false/unknown if there is no
                                        pharmacyFirst block or no confirmed age)
                                      ageUnder   (whole number 0-120) — confirmed age < this
                                      ageAtLeast (whole number 0-120) — confirmed age >= this
                           suggest (string) — one of this pathway's "allowed" destinations,
                                    or "gp_routine"
                default (string, required) — "gp_routine" or "duty". Used when no rule matches.

              GUARDRAILS ENFORCED IN CODE — you cannot override these from JSON, and
              writing a block that tries to is a wasted instruction:
                1. RED-FLAG GATE. Any red flag answered "yes", and any red flag not yet
                   answered, suppresses the suggestion entirely. A suggestion only ever
                   appears on a completed, all-negative red-flag screen.
                2. CLINICIAN-ONLY DOMAINS. The domains "mental_health", "gu_male" and
                   "gyn_female" NEVER produce a non-clinician destination, whatever
                   "allowed" or "rules" say. Nor do the bundled pathways mental-health,
                   gu-male, gyn-female and general — those are frozen in engine code by id,
                   so relabelling a copy of one with a different domain changes nothing.
                   A pathway marked "sensitive": true produces no suggestion at all.
                3. SAFEGUARDING. A positive safeguarding red flag routes to the duty
                   clinician and the practice safeguarding lead and bypasses all of this.
                4. AGE FLOOR. Confirmed age under 1 is always clinician-only. Under 5 never
                   reaches "anp" or "paramedic". Pharmacy First suggestions re-check the
                   pathway's own pharmacyFirst age band.
                5. CONFIRMED AGE ONLY. The age used is one the receptionist explicitly
                   confirmed on the call — never an age read from an open record. With no
                   confirmed age the suggestion fails closed to a GP appointment.
                6. CUSTOM PACKS ARE CLINICIAN-ONLY BY DEFAULT. A pathway you author will
                   suggest nothing but a clinician until the practice's CSO or a partner
                   records a routing sign-off in the suite's options page.
                7. Every suggestion the receptionist sees, and every suggestion written into
                   the pasted summary, carries: "Or a clinician callback if the patient
                   prefers — always offer it."

              Be conservative. A disposition block is clinical content and the practice's CSO
              must review it before it is used, exactly like the red flags.

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
    // Disposition routing (plan E)
    sanitiseDisposition, overrideDowngradesDisposition,
    isValidRoutingAttestation, sanitiseRoutingAttestation,
    DISPOSITION_DOMAINS, DISPOSITION_DESTINATIONS, DISPOSITION_DEFAULTS, DISPOSITION_WHEN_KEYS,
    CLINICIAN_ONLY_IDS, CLINICIAN_ONLY_DOMAINS, ROUTING_ATTESTATION_ROLES, ROUTING_ATTESTATION_SCOPE,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.ReceptionPathwayUtils = api;
  }
// Works in extension pages (window === self) and service workers (no window).
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : global));
