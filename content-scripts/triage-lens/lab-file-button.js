// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Lab Results Auto-Filing one-click "File all normal" button
//
// Adds a floating action button to a lab-result FILING screen that, when the
// suite has confirmed EVERY parameter is within normal limits, files the result
// as normal by DRIVING THE REAL MEDICUS UI — it sets each subheading's action to
// the configured "normal" option, optionally records a filing comment, files,
// and (optionally) completes the task. It can also PREPARE — never send — a
// "your results are normal" message for the clinician.
//
// WHY drive the UI rather than the API: this keeps Medicus as the system of
// record — its validation, access control and audit trail fire exactly as if the
// clinician clicked. Same doctrine as routine-rx-button.js.
//
// SAFETY (every rule here cost someone a bad day somewhere):
//   • The button only appears when SentinelResultSeverity says the report is
//     level:'none' (no urgent, no out-of-range, no culture needing review) AND an
//     ENABLED filing profile fits this report AND the profile's File control is
//     actually present on screen. Severity is RE-VERIFIED at click time.
//   • Controls are matched by VISIBLE TEXT (the profile's labels), never by
//     per-session ids. If ANY required control is missing the macro ABORTS and
//     clicks nothing further — a wrong-label profile does nothing rather than
//     clicking the wrong thing.
//   • commitMode is 'manual' (default) or 'confirm' ONLY — a human always presses
//     the final, irreversible button. There is no full-auto mode.
//   • The patient message is PREPARED ONLY (draft pre-filled / copied); the macro
//     never sends it.
//   • Every filing run is written to a machine-local audit ring buffer.
//
// Runs in the ISOLATED world at document_idle. Reuses the engine globals that the
// triage-lens content scripts load alongside it (SentinelApiClient / Normalisers
// / ResultSeverity) and shared/lab-filing-utils.js helpers.

(function () {
  'use strict';

  // Debug logging is off by default; flip it on at runtime from the page console
  // with: localStorage.setItem('ch-debug','1') then reload. (Same flag content.js
  // uses.) Lets a clinician see exactly what comment TEXT a result is being
  // compared against — the fastest way to diagnose "my allowComments phrase
  // isn't excusing this" without guessing at normalisation — and exactly
  // what a filing attempt is doing (added while diagnosing H-075: a click
  // that appeared to work but never actually selected anything).
  const DEBUG = (() => {
    try {
      return typeof localStorage !== 'undefined' && localStorage.getItem('ch-debug') === '1';
    } catch (e) {
      return false;
    }
  })();
  const log = (...a) => DEBUG && console.log('[LabFiling]', ...a);

  // DOM-contract registry (Horizon-1) — dual-mode require so fileAllNormal's
  // generic selector families work identically under `node test-lab-file-macro.js`
  // (require) and in the browser (manifest loads shared/dom-contracts.js
  // earlier in the same content-script block). See lab-file.file-button /
  // lab-file.normal-option-controls in that registry — both are runtime:false
  // (documented false-positive risk) but still the single source of truth for
  // these selector arrays.
  const DomContracts =
    typeof module !== 'undefined' && module.exports
      ? require('../../shared/dom-contracts.js')
      : typeof window !== 'undefined'
        ? window.DomContracts
        : null;
  const FILE_BUTTON_SEL = ((DomContracts && DomContracts.get('lab-file.file-button')) || {}).target || [
    'button',
    '[role="button"]',
    'input[type="submit"]',
  ];
  const NORMAL_OPTION_SEL = ((DomContracts && DomContracts.get('lab-file.normal-option-controls')) || {}).target || [
    '[role="radio"]',
    '[role="option"]',
    '.q-radio',
    '.q-checkbox',
    '.q-item',
    'label',
    'button',
  ];

  // ── DOM helpers (DOM-library-agnostic so the core is unit-testable) ──────────

  function norm(s) {
    return (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim().toLowerCase();
  }
  function defaultVisible(el) {
    return !!(el && (el.offsetParent !== null || (el.getClientRects && el.getClientRects().length)));
  }
  function textOf(el) {
    return norm((el && el.getAttribute && el.getAttribute('aria-label')) || (el && el.textContent));
  }
  function isEnabled(el) {
    if (!el) return false;
    if (el.disabled) return false;
    if (el.getAttribute && el.getAttribute('aria-disabled') === 'true') return false;
    if (el.classList && el.classList.contains && el.classList.contains('disabled')) return false;
    return true;
  }
  // A <label for="id"> can be a separate SIBLING of its actual control, not a
  // wrapper (confirmed live, 2026-09-17 — Medicus's own Next-Step radios:
  // `<input id="radio_group_...">` elsewhere in the DOM, referenced only by
  // the label's `for`). Resolves to the real control either way — used both
  // to click the real thing (realClick) and to read its real .checked state,
  // which `aria-checked` cannot: also confirmed live, Medicus does not set
  // aria-checked on this radio group at all, so a check against it always
  // reads false/unselected regardless of the true state.
  function resolveRadioControl(el) {
    if (!el || el.tagName !== 'LABEL') return el;
    return (
      (el.htmlFor && document.getElementById(el.htmlFor)) ||
      el.querySelector('input,[role="radio"],[role="checkbox"]') ||
      el
    );
  }
  function isRadioSelected(el) {
    const c = resolveRadioControl(el);
    if (c && typeof c.checked === 'boolean') return c.checked;
    return !!(el && el.getAttribute && el.getAttribute('aria-checked') === 'true');
  }
  // Collect elements matching ANY of `selectors`, DE-DUPLICATED — an element that
  // matches two selectors (e.g. a <div role="radio">) must be returned once, or it
  // would be clicked/counted twice.
  function queryAll(root, selectors) {
    const out = [];
    const seen = new Set();
    selectors.forEach((sel) => {
      let nodes;
      try {
        nodes = root.querySelectorAll(sel);
      } catch (e) {
        return; // ignore bad selector
      }
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (seen.has(n)) continue;
        seen.add(n);
        out.push(n);
      }
    });
    return out;
  }
  // First visible element matching one of `selectors` whose text equals (or, as a
  // fallback, contains) `wanted`. `visible` overridable for tests.
  //
  // `exactOnly` (2026-08-22 clinical-safety audit R8): COMMIT-CLICK CALLERS MUST
  // PASS TRUE. The partial fallback exists for finding/marking steps, but a
  // committing click through it is dangerous — with fileButtonText "File
  // results", a screen where only "File results and message patient" is visible
  // would be clicked via the substring arm, committing a different Medicus
  // action from the one the profile named. Exact (whitespace-normalised,
  // case-insensitive) or abort.
  function findByText(root, selectors, wanted, visible, exactOnly) {
    const vis = visible || defaultVisible;
    const w = norm(wanted);
    if (!w) return null;
    const nodes = queryAll(root, selectors);
    let partial = null;
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      const t = textOf(el);
      if (t === w) {
        if (vis(el)) return el;
        continue;
      }
      if (!exactOnly && !partial && t.indexOf(w) >= 0 && vis(el)) partial = el;
    }
    return partial;
  }
  function findAllByText(root, selectors, wanted, visible) {
    const vis = visible || defaultVisible;
    const w = norm(wanted);
    if (!w) return [];
    const out = [];
    const nodes = queryAll(root, selectors);
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      if (textOf(el).indexOf(w) >= 0 && vis(el)) out.push(el);
    }
    return out;
  }

  function realClick(el) {
    if (!el) return;
    // A <label for="id"> here is a separate SIBLING of its actual control,
    // not a wrapper around it (confirmed live, 2026-09-17: Medicus's
    // Next-Step radio is `<input id="radio_group_...">` elsewhere in the
    // DOM, `<label for="radio_group_...">` referencing it by id only).
    // Firing the full pointerdown/mousedown/pointerup/mouseup/click
    // sequence and THEN a separate .click() call — the previous behaviour,
    // used unconditionally for every element — hits that kind of
    // Angular/Material-style radio-group component's own interaction
    // handling TWICE in the same synchronous tick, with no time for its
    // change detection to settle between them. Found live: the whole Next
    // Steps group ended up with NOTHING selected afterwards — not even the
    // option that was clicked, and not the one that had been selected
    // beforehand either. For a label, resolve the real control it's
    // labelling (its for/id target, or — for the label-wraps-input pattern
    // used elsewhere — a descendant) and click THAT directly, exactly once.
    // A single native .click() is also the spec-correct way to trigger a
    // label's own forward-to-control activation behaviour in the first
    // place; a bare dispatchEvent('click') does not reliably do that for a
    // non-trusted synthetic event, which is a second, independent reason
    // the old sequence could fail here even before the double-fire above.
    if (el.tagName === 'LABEL') {
      const control = resolveRadioControl(el);
      log('realClick — label found, clicking its real control once:', {
        labelText: el.textContent && el.textContent.trim(),
        htmlFor: el.htmlFor || null,
        resolvedTag: control.tagName,
        resolvedId: control.id || null,
      });
      try {
        if (typeof control.click === 'function') control.click();
      } catch (e) {
        /* ignore */
      }
      return;
    }
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type) => {
      try {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      } catch (e) {
        /* ignore */
      }
    });
    try {
      if (typeof el.click === 'function') el.click();
    } catch (e) {
      /* ignore */
    }
  }
  function setNativeValue(el, val) {
    try {
      const proto = Object.getPrototypeOf(el);
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(el, val);
      else el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (e) {
      /* ignore */
    }
  }
  function waitFor(fn, timeout, interval) {
    timeout = timeout || 4000;
    interval = interval || 120;
    return new Promise((resolve) => {
      const t0 = Date.now();
      (function poll() {
        let v;
        try {
          v = fn();
        } catch (e) {
          v = null;
        }
        if (v) return resolve(v);
        if (Date.now() - t0 >= timeout) return resolve(null);
        setTimeout(poll, interval);
      })();
    });
  }

  // ── The macro core ───────────────────────────────────────────────────────────
  // Pure-ish: operates only on the passed `root` and injected fns, so it can be
  // driven by a fake DOM in tests. Returns a structured result; NEVER throws.
  //
  // opts:
  //   root        — DOM root to query (document.body in the browser)
  //   profile     — sanitised filing profile
  //   severity    — { level } from evaluateReportSeverity (re-checked here)
  //   report      — normalised investigation report (for the confirm enumeration)
  //   patient     — patient banner string/object (for {firstName}); optional
  //   mode        — 'manual' | 'confirm'
  //   confirmFn   — (msg) => boolean      (window.confirm in the browser)
  //   clickFn     — (el) => void          (realClick in the browser)
  //   setValueFn  — (el, val) => void     (setNativeValue in the browser)
  //   visible     — (el) => boolean       (overridable for tests)
  //   waitForFn   — (fn) => Promise       (waitFor in the browser; immediate in tests)
  //   buildMessage / buildConfirm — from LabFilingUtils (injected so node tests need no globals)
  async function fileAllNormal(opts) {
    const o = opts || {};
    const root = o.root;
    const profile = o.profile;
    const result = { ok: false, reason: null, filed: false, completed: false, marked: 0, preparedMessage: null };
    if (!root || !profile || !profile.filing) {
      result.reason = 'bad-args';
      return result;
    }

    // GATE 1 — must be genuinely all-normal. This is the whole safety case.
    if (!o.severity || o.severity.level !== 'none') {
      result.reason = 'not-normal';
      return result;
    }
    // GATE 1b — fail closed on anything the numeric gate cannot judge (free text,
    // cultures, unmatched report, missing rules). The caller computes these, but
    // the core re-checks so it is safe to call directly (and in tests).
    if (Array.isArray(o.blockers) && o.blockers.length) {
      result.reason = 'blocked';
      return result;
    }

    const f = profile.filing;
    const click = o.clickFn || realClick;
    const setValue = o.setValueFn || setNativeValue;
    const vis = o.visible || defaultVisible;
    const wait = o.waitForFn || waitFor;

    // GATE 2 — the File control must exist on this screen. If the profile's labels
    // don't fit this layout, we abort before touching anything. Exact-only:
    // this is the control STEP 5 will commit-click, so a partial match must
    // abort here, not be discovered at commit time (audit R8).
    const fileBtn0 = findByText(root, FILE_BUTTON_SEL, f.fileButtonText, vis, true);
    if (!fileBtn0) {
      result.reason = 'no-file-button';
      return result;
    }

    // STEP 1 — mark each subheading as the configured normal option.
    let marked = 0;
    // Selector sets are restricted to INTERACTIVE control roles (no bare div/span):
    // on a compromised Medicus page a hostile <div> whose text merely contains the
    // normal-option label could otherwise be clicked during marking. Real Quasar
    // controls carry a role/q-* class or are a label/button, so this keeps the live
    // app working while shrinking the hostile-match surface.
    if (f.openControlText) {
      // Per-row menu: open each, then click the normal option it reveals.
      const openers = findAllByText(root, ['button', '[role="button"]', '.q-field'], f.openControlText, vis);
      for (const opener of openers) {
        click(opener);
        const opt = await wait(() =>
          findByText(root, ['[role="option"]', 'li[role="option"]', '.q-item', 'label'], f.normalOptionText, vis)
        );
        if (opt) {
          click(opt);
          marked++;
        }
      }
    } else {
      // Options already visible (e.g. a "No action" radio per row): click each.
      const opts = f.rowSelector
        ? findAllByText(root, [f.rowSelector], f.normalOptionText, vis)
        : findAllByText(root, NORMAL_OPTION_SEL, f.normalOptionText, vis);
      for (const el of opts) {
        if (isRadioSelected(el)) {
          marked++; // already normal
          continue;
        }
        click(el);
        marked++;
      }
    }

    // GATE 3 — if we couldn't mark a single subheading, the profile doesn't fit
    // this screen. Abort: do NOT file a result we didn't actually mark normal.
    if (marked === 0) {
      result.reason = 'no-normal-controls';
      return result;
    }
    result.marked = marked;

    const STEP_RADIO_SELECTORS = ['[role="radio"]', '.q-radio', '.q-item', 'label', 'div', 'span'];

    // STEP 2 — optional filing comment (best-effort; never aborts).
    if (f.filingComment) {
      const field = queryAll(root, ['textarea', 'input[type="text"]']).find((el) => {
        if (!vis(el)) return false;
        const hint = norm((el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('placeholder'))) || '');
        return hint.indexOf('comment') >= 0 || hint.indexOf('note') >= 0;
      });
      if (field) setValue(field, f.filingComment);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ACTION: 'fileAndMessage' — PREPARE-ONLY HANDOFF. Select the "message patient"
    // Next Step (which opens Medicus's inline message compose), drop the custom
    // message on the clipboard / into the body field if we can find it, then STOP.
    // The macro NEVER presses the send/commit button and NEVER picks a recipient —
    // the clinician reviews the recipient and message in Medicus and sends. This is
    // the safe handoff for an outbound patient communication.
    // ─────────────────────────────────────────────────────────────────────────
    if (o.action === 'fileAndMessage') {
      if (!f.nextStepMessageText) {
        result.reason = 'message-not-configured';
        return result;
      }
      const msgStep = findByText(root, STEP_RADIO_SELECTORS, f.nextStepMessageText, vis);
      if (!msgStep) {
        result.reason = 'no-message-step';
        return result;
      }
      if (!isRadioSelected(msgStep)) click(msgStep);

      const m = profile.patientMessage || {};
      if (m.template) {
        const text = o.buildMessage ? o.buildMessage(m.template, o.patient) : m.template;
        result.preparedMessage = text;
        if (m.fieldText) {
          const body = findByText(
            root,
            ['textarea', 'input[type="text"]', '[contenteditable="true"]'],
            m.fieldText,
            vis
          );
          if (body) setValue(body, text);
        }
      }
      result.ok = true;
      result.reason = 'message-ready'; // caller copies the message + highlights Medicus's send button
      return result;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ACTION: 'fileNoAction' (default) — file with no further action.
    // ─────────────────────────────────────────────────────────────────────────

    // STEP 1c — EXPLICITLY select the no-further-action Next Step. Hard safety
    // step: it guarantees we never file while "message patient" or "reassign" is
    // the selected next step. If the profile names one and it isn't on screen, abort.
    if (f.nextStepText) {
      if (DEBUG) {
        // findByText is NOT exact-only here (no 5th arg) — it can fall back to
        // a PARTIAL/substring match if no exact one is found, and the
        // selector list includes broad div/span tags. If Medicus wraps a
        // radio's label in more than one element carrying the same visible
        // text (e.g. the clickable <label> AND an inner text-only <span>),
        // or if the stored nextStepText doesn't quite match what's on screen,
        // this could click something other than the intended radio. Logged
        // before AND after so a wrong click shows up as a changed selection.
        // Restricted to elements whose resolved control actually exposes a
        // real .checked (i.e. genuine radio/checkbox controls, not every
        // div/span/label on the page) — the earlier unfiltered dump was
        // hundreds of lines of unrelated nav/menu text and hard to read.
        const radios = queryAll(root, STEP_RADIO_SELECTORS).filter((el) => {
          if (!vis(el)) return false;
          const t = norm(textOf(el));
          if (!t || t.length >= 60) return false;
          const c = resolveRadioControl(el);
          return c && typeof c.checked === 'boolean';
        });
        log(
          'STEP 1c — nextStepText:',
          JSON.stringify(f.nextStepText),
          '| on-screen options (checked=selected, now read from the REAL control, not aria-checked):',
          JSON.stringify(radios.map((el) => ({ text: textOf(el), checked: isRadioSelected(el) })))
        );
      }
      const step = findByText(root, STEP_RADIO_SELECTORS, f.nextStepText, vis);
      if (!step) {
        result.reason = 'no-next-step';
        return result;
      }
      const stepAlreadySelected = isRadioSelected(step);
      log('STEP 1c — matched element:', {
        tag: step.tagName,
        className: step.className,
        text: textOf(step),
        exactMatch: textOf(step) === norm(f.nextStepText),
        alreadySelected: stepAlreadySelected,
      });
      // Only click if the REAL control isn't already selected — removes the
      // risk entirely for the common case (Medicus's own default already
      // matches), rather than just changing how the click is performed.
      if (!stepAlreadySelected) click(step);
      if (DEBUG) {
        const after = queryAll(root, STEP_RADIO_SELECTORS).filter((el) => {
          if (!vis(el)) return false;
          const t = norm(textOf(el));
          if (!t || t.length >= 60) return false;
          const c = resolveRadioControl(el);
          return c && typeof c.checked === 'boolean';
        });
        log(
          'STEP 1c — options AFTER (skipped click?',
          stepAlreadySelected,
          '):',
          JSON.stringify(after.map((el) => ({ text: textOf(el), checked: isRadioSelected(el) })))
        );
      }
    }

    // STEP 4 — commit gate. A human always presses the final button.
    if (o.mode === 'manual') {
      result.ok = true;
      result.reason = 'manual-ready';
      return result; // button highlighted by the caller; clinician clicks File
    }
    // 'confirm' (and any unexpected value, defensively): require explicit OK.
    const msg = o.buildConfirm
      ? o.buildConfirm(report(o), profile, o.mode)
      : 'File this result as normal? This cannot be undone.';
    const ok = typeof o.confirmFn === 'function' ? o.confirmFn(msg) : false;
    if (!ok) {
      result.ok = false;
      result.reason = 'cancelled';
      return result;
    }

    // STEP 5 — file. Re-find the button (EXACT label only — a commit click must
    // never go through the substring fallback, audit R8) and require it enabled.
    if (DEBUG) {
      // findByText returns the FIRST exact-text visible match in DOM order —
      // it never checks for a second one. A combined multi-heading report
      // (Renal function tests + LFTs + Lipids + ...) may repeat the same
      // button label once per section rather than sharing one File control;
      // if so the macro could be clicking a DIFFERENT section's button than
      // the one that actually completes the whole task. This makes that
      // visible instead of silent.
      const all = findAllByText(root, FILE_BUTTON_SEL, f.fileButtonText, vis).filter(
        (el) => textOf(el) === norm(f.fileButtonText)
      );
      log(
        'STEP 5 — candidates for File button text',
        JSON.stringify(f.fileButtonText),
        ':',
        all.length,
        all.map((el, i) => ({
          index: i,
          tag: el.tagName,
          className: el.className,
          id: el.id || null,
          enabled: isEnabled(el),
          top: el.getBoundingClientRect ? Math.round(el.getBoundingClientRect().top) : null,
          nearbyText: (el.closest('section,div[class*="card"],div[class*="panel"]') || el.parentElement || el)
            .textContent.trim()
            .slice(0, 80),
        }))
      );
    }
    const fileBtn = await wait(() => {
      const b = findByText(root, FILE_BUTTON_SEL, f.fileButtonText, vis, true);
      return b && isEnabled(b) ? b : null;
    });
    if (!fileBtn) {
      result.reason = 'file-button-disabled';
      return result;
    }
    log('STEP 5 — clicking:', {
      tag: fileBtn.tagName,
      className: fileBtn.className,
      id: fileBtn.id || null,
      top: fileBtn.getBoundingClientRect ? Math.round(fileBtn.getBoundingClientRect().top) : null,
    });
    click(fileBtn);
    // `filed` records that the File control WAS CLICKED — it is not a Medicus
    // confirmation that the report left the review list (audit R10: no
    // post-condition is observed here; the toast copy must not claim one).
    result.filed = true;

    // STEP 6 — optional complete (exact-only for the same reason as STEP 5).
    if (f.completeButtonText) {
      const completeBtn = await wait(() => {
        const b = findByText(root, ['button', '[role="button"]'], f.completeButtonText, vis, true);
        return b && isEnabled(b) ? b : null;
      });
      if (completeBtn) {
        click(completeBtn);
        result.completed = true;
      }
    }

    result.ok = true;
    result.reason = 'filed';
    return result;
  }
  function report(o) {
    return o && o.report;
  }

  // ── Node test hook ───────────────────────────────────────────────────────────
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { fileAllNormal, findByText, findAllByText, textOf, norm, isEnabled };
    return;
  }

  // ── Browser boot ───────────────────────────────────────────────────────────
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__chLabFile) return;
  window.__chLabFile = true;

  const STORE_PROFILES = 'labfiling.profiles';
  const STORE_CONFIG = 'labfiling.config';
  const STORE_SUPPRESS = 'labfiling.suppress';
  const AUDIT_KEY = 'labfiling.auditLog';
  const TRIAGE_CONFIG = 'triagelens.config';

  const LF = window.LabFilingUtils;
  const API = window.SentinelApiClient;
  const NORM = window.SentinelNormalisers;
  const SEV = window.SentinelResultSeverity;

  // Filing-screen URL gate. A result-review task overview. Kept deliberately
  // narrow; the in-DOM File-control gate (GATE 2 above) is the real guard.
  const FILING_URL_RE = /\/tasks\/data\/[^/]*(investigation|result|report)[^/]*\/overview\//i;

  let profiles = [];
  let config = { commitMode: 'manual' };
  let resultRules = [];
  let suppress = []; // machine-local "never auto-file" patient list (uuids or {uuid})
  const sevCache = new Map(); // taskUuid → { report, severity, ts }
  const medsCache = new Map(); // patientUuid → { meds, ts }
  const SEV_TTL = 60000;

  function loadConfig() {
    return new Promise((resolve) => {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return resolve();
      chrome.storage.local.get([STORE_PROFILES, STORE_CONFIG, STORE_SUPPRESS, TRIAGE_CONFIG], (r) => {
        // 2026-08-23 review fix: stored profiles are NOT re-sanitised on load, so
        // the audit's fail-closed requireRangeForAll default never reached any
        // profile already saved in the field. Migrate on read.
        profiles =
          LF && typeof LF.migrateStoredProfiles === 'function'
            ? LF.migrateStoredProfiles(r[STORE_PROFILES])
            : Array.isArray(r[STORE_PROFILES])
              ? r[STORE_PROFILES]
              : [];
        const c = r[STORE_CONFIG];
        config = c && typeof c === 'object' ? c : { commitMode: 'manual' };
        suppress = Array.isArray(r[STORE_SUPPRESS]) ? r[STORE_SUPPRESS] : [];
        const tc = r[TRIAGE_CONFIG];
        resultRules = tc && Array.isArray(tc.resultRules) ? tc.resultRules.filter((x) => x && x.enabled !== false) : [];
        resolve();
      });
    });
  }

  // Fetch + normalise + score the open task's report. Cached per taskUuid (TTL)
  // for the cheap gate poll; pass force=true to BYPASS the cache and re-fetch live
  // — used at click time so an irreversible file always acts on fresh data, never a
  // result that was amended in the up-to-60s since the button appeared.
  async function loadReportSeverity(force) {
    if (!API || !NORM || !SEV) return null;
    const ctx = API.detectMedicusContext(location.href);
    if (!ctx || !ctx.apiBase || !ctx.taskUuid || !ctx.taskTypeSlug) return null;
    const now = Date.now();
    const cached = sevCache.get(ctx.taskUuid);
    if (!force && cached && now - cached.ts < SEV_TTL) return cached;
    const overviewURL = `/tasks/data/${ctx.taskTypeSlug}/overview/${ctx.taskUuid}`;
    let report = null;
    try {
      const raw = await API.fetchInvestigationReport(ctx.apiBase, overviewURL);
      report = NORM.normaliseInvestigationReport(raw);
    } catch (e) {
      return null;
    }
    if (!report || !Array.isArray(report.results) || report.results.length === 0) return null;
    // resultRules escalate-only — passing the user's rules makes this gate match
    // the queue chips exactly (a culture needing review will NOT be level:'none').
    const severity = SEV.evaluateReportSeverity(report, { priorityDisplay: '', resultRules, problems: [] });
    // Beyond numeric severity, fail CLOSED on anything the gate cannot judge
    // (free-text/cultures, unmatched reports, missing result rules).
    const blockers = LF ? LF.fileabilityBlockers(report, severity, resultRules) : ['utilities not loaded'];
    const entry = { report, severity, blockers, ts: now, taskUuid: ctx.taskUuid };
    sevCache.set(ctx.taskUuid, entry);
    return entry;
  }

  // Fetch + normalise the patient's current medications for the drug-exclusion gate.
  // Cached per patientUuid (TTL). Returns an array of {name} or null on failure —
  // callers treat null as "could not check meds" and fail CLOSED.
  async function loadMeds(patientUuid) {
    if (!API || !NORM || !patientUuid) return null;
    const ctx = API.detectMedicusContext(location.href);
    if (!ctx || !ctx.apiBase) return null;
    const now = Date.now();
    const cached = medsCache.get(patientUuid);
    if (cached && now - cached.ts < SEV_TTL) return cached.meds;
    try {
      const raw = await API.fetchMedicationRegimen(ctx.apiBase, patientUuid);
      const meds = NORM.normaliseMedications(raw);
      medsCache.set(patientUuid, { meds: Array.isArray(meds) ? meds : [], ts: now });
      return Array.isArray(meds) ? meds : [];
    } catch (e) {
      return null; // fail closed at the caller
    }
  }

  // Apply the matched profile's "my range wins" lab-flag override (if opted in) and
  // RE-SCORE: returns the effective severity + fileability blockers the all-normal gate
  // should use. Without an override-enabled profile this is exactly rs's raw values, so
  // the default path is unchanged. The engine stays oblivious to lab-filing profiles —
  // the override is applied to a cloned report here, then re-scored by the same scorer.
  // Debug only — prints exactly the text each result's comment residue was
  // computed from and matched against, and whether allowComments excused it,
  // so "why didn't my allow-list phrase match" is answerable from the console
  // instead of guessed at. No-op unless DEBUG is on.
  //
  // De-duped: evaluateGate() re-runs on every DOM mutation the page observes
  // (often more than once a second on a busy Medicus SPA), so this used to
  // print the same snapshot over and over, making the console unreadable.
  // Only actually logs when the printed content would differ from last time.
  let lastCommentDebugSignature = null;
  function logCommentDebug(report, profile, fileBlockers) {
    if (!DEBUG || !LF || !report || !Array.isArray(report.results)) return;
    const rowsForSignature = report.results
      .filter((r) => r && typeof r === 'object' && r.text)
      .map((r) => [r.name, LF.numericCommentResidue(r), LF.profilesOwningResult(currentMatchedProfiles, r).map((p) => p.id)]);
    const signature = JSON.stringify([
      profile && profile.name,
      (profile && profile.allowComments) || [],
      currentMatchedProfiles.map((p) => p.id),
      rowsForSignature,
    ]);
    if (signature === lastCommentDebugSignature) return;
    lastCommentDebugSignature = signature;
    const commentBlocked = (fileBlockers || []).some((b) => /carries a comment/.test(b));
    log(
      'comment check — profile:',
      profile && profile.name,
      'allowComments:',
      (profile && profile.allowComments) || [],
      'still blocked on a comment:',
      commentBlocked
    );
    // Stringified (not raw objects) — a plain console copy/paste renders raw
    // objects as collapsed "{…}" placeholders unless each is manually
    // expanded first; this line is readable as pasted, with no extra step.
    log(
      'matched profiles (candidates for whitelist ownership):',
      JSON.stringify(currentMatchedProfiles.map((p) => ({ id: p.id, name: p.name, match: p.match, enabled: p.enabled })))
    );
    report.results.forEach((r) => {
      if (!r || typeof r !== 'object' || !r.text) return;
      const residue = LF.numericCommentResidue(r);
      if (!residue) return;
      const owners = LF.profilesOwningResult(currentMatchedProfiles, r);
      log(
        '  result:',
        r.name,
        '| specimen (heading):',
        r.specimen,
        '| raw text:',
        JSON.stringify(r.text),
        '| residue after strip:',
        JSON.stringify(residue),
        '| owning profile(s):',
        owners.map((p) => p.name)
      );
    });
  }

  function effectiveScore(rs, profile) {
    if (!rs) return { severity: null, report: null, fileBlockers: ['could not read the result'] };
    if (!LF || !SEV) return { severity: rs.severity, report: rs.report, fileBlockers: rs.blockers || [] };
    if (!profile || profile.paramsOverrideLabFlags !== true) {
      // No lab-flag override — but still re-run fileabilityBlockers WITH the
      // matched profile, so its allowComments can excuse a comment that
      // rs.blockers (computed profile-agnostically in loadReportSeverity)
      // still lists. No fetch involved — cheap to recompute.
      const fileBlockers = LF.fileabilityBlockers(
        rs.report,
        rs.severity,
        resultRules,
        profile,
        currentMatchedProfiles
      );
      logCommentDebug(rs.report, profile, fileBlockers);
      return { severity: rs.severity, report: rs.report, fileBlockers };
    }
    const adj = LF.applyParamOverrides(rs.report, profile);
    const severity = SEV.evaluateReportSeverity(adj, { priorityDisplay: '', resultRules, problems: [] });
    const fileBlockers = LF.fileabilityBlockers(adj, severity, resultRules, profile, currentMatchedProfiles);
    logCommentDebug(adj, profile, fileBlockers);
    return { severity, report: adj, fileBlockers };
  }

  // Combine every per-profile blocker — the clinician-set parameters, the trend
  // guard, the per-patient suppress list, the text-suppress phrases, and (when the
  // profile names monitored drugs) the medication-exclusion check. Async because
  // the meds check needs a fetch. Fails CLOSED: a meds fetch that errors blocks
  // rather than silently letting a monitored-drug patient through.
  async function computeProfileBlockers(rs, profile) {
    if (!LF || !rs) return ['utilities not loaded'];
    const report = rs.report;
    const blockers = []
      .concat(LF.profileParamBlockers(report, profile))
      .concat(LF.unrecognisedAnalyteBlockers(report, profile))
      .concat(LF.trendBlockers(report, profile))
      .concat(LF.suppressedBlockers(report, suppress))
      .concat(LF.textSuppressBlockers(report, profile, document.body ? document.body.textContent : ''));
    if (Array.isArray(profile.excludeIfMeds) && profile.excludeIfMeds.length) {
      const meds = await loadMeds(report && report.patientUuid);
      if (meds === null) {
        blockers.push('could not check this patient’s medications — file manually');
      } else {
        blockers.push(...LF.medExclusionBlockers(meds, profile));
      }
    }
    return Array.from(new Set(blockers));
  }

  function readPatientBanner() {
    // Best-effort: a name in the page banner for {firstName}. Never required.
    const el = document.querySelector(
      '[class*="patient-banner"], [class*="patientBanner"], [data-test*="patient-name"]'
    );
    return el ? el.textContent : '';
  }

  function recordAudit(profile, res, rs) {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
      const report = rs && rs.report;
      const entry = {
        ts: new Date().toISOString(),
        profile: profile && profile.name,
        // Identity + severity so a filing is attributable for governance/diagnosis
        // (machine-local only — this log is never exported or backed up).
        taskUuid: (rs && rs.taskUuid) || null,
        patientUuid: (report && report.patientUuid) || null,
        severity: rs && rs.severity ? rs.severity.level : null,
        analytes: report && Array.isArray(report.results) ? report.results.length : 0,
        marked: res.marked,
        filed: res.filed,
        completed: res.completed,
        messagePrepared: !!res.preparedMessage,
      };
      chrome.storage.local.get(AUDIT_KEY, (r) => {
        const arr = Array.isArray(r[AUDIT_KEY]) ? r[AUDIT_KEY] : [];
        arr.unshift(entry);
        chrome.storage.local.set({ [AUDIT_KEY]: arr.slice(0, 200) });
      });
      // F2 Clinical Event Ledger — MIRROR this filing into the suite-wide
      // machine-local ledger (shared/event-ledger.js, loaded alongside this
      // script via the manifest). The lab-filing audit log above is untouched
      // and remains this module's own governance record. Fire-and-forget: the
      // ledger swallows its own failures and can never break the filing flow.
      if (typeof window !== 'undefined' && window.EventLedger) {
        window.EventLedger.record({
          source: 'labfiling',
          patientRef: entry.patientUuid,
          severity: entry.severity,
          ruleId: null,
          label: entry.profile || null,
          action: 'filed',
        });
      }
    } catch (e) {
      /* ignore */
    }
  }

  // ── floating card UI ─────────────────────────────────────────────────────────
  // One cohesive card (not a pile of pills): an eyebrow + a status dot, the matched
  // profile name as the title (so the clinician SEES which rule fired), a reassurance/
  // reason line, then the actions and a quiet footer. Calm white surface, a single
  // left-accent stripe carrying the state colour — mirrors the suite's card doctrine.
  let host = null;
  let titleEl = null;
  let subEl = null;
  let whitelistBox = null;
  let btn = null;
  let msgBtn = null;
  let suppressLink = null;
  let busy = false;
  let currentProfile = null;
  let currentReport = null;
  // The REAL stored profiles that matched (never the synthetic merged
  // effective object, which always carries id '__merged__') — every one of
  // them, since a combined report can match several profiles at once and
  // each comment needs attributing to whichever of them actually owns it
  // (see profilesOwningResult / renderWhitelistBox).
  let currentMatchedProfiles = [];
  let whitelistBusy = false;
  // Last-rendered whitelist-box content signature — see renderWhitelistBox's
  // idempotent-rebuild comment. null whenever the box is hidden/empty.
  let whitelistSignature = null;

  function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }

  function buildUI() {
    if (host) return;
    host = el('div', 'chlf-card chlf-hidden');

    const head = el('div', 'chlf-head');
    head.appendChild(el('span', 'chlf-dot'));
    head.appendChild(el('span', 'chlf-eyebrow', 'Lab filing'));

    titleEl = el('div', 'chlf-title');
    subEl = el('div', 'chlf-sub');
    whitelistBox = el('div', 'chlf-whitelist chlf-hidden');

    const actions = el('div', 'chlf-actions');
    btn = el('button', 'chlf-primary');
    btn.onclick = () => onAction('fileNoAction');
    // Optional second action — only shown when the profile enables messaging.
    msgBtn = el('button', 'chlf-secondary chlf-hidden');
    msgBtn.onclick = () => onAction('fileAndMessage');
    actions.appendChild(btn);
    actions.appendChild(msgBtn);

    const foot = el('div', 'chlf-foot');
    // Per-patient opt-out: add this patient to the machine-local "never auto-file"
    // list (P5). Shown whenever a profile fits this screen.
    suppressLink = el('button', 'chlf-link', 'Never auto-file this patient');
    suppressLink.onclick = () => suppressCurrentPatient();
    foot.appendChild(suppressLink);

    host.appendChild(head);
    host.appendChild(titleEl);
    host.appendChild(subEl);
    host.appendChild(whitelistBox);
    host.appendChild(actions);
    host.appendChild(foot);

    const style = el('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    document.body.appendChild(host);
  }

  // Add the open report's patient to the machine-local suppress list. Stores the
  // uuid + a timestamp; never stores name/PHI. Re-evaluates the gate after.
  function suppressCurrentPatient() {
    const uuid = currentReport && currentReport.patientUuid;
    if (!uuid) {
      toast('Couldn’t identify the patient on this screen.', 'err');
      return;
    }
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    chrome.storage.local.get(STORE_SUPPRESS, (r) => {
      const arr = Array.isArray(r[STORE_SUPPRESS]) ? r[STORE_SUPPRESS] : [];
      if (arr.some((s) => (s && s.uuid ? s.uuid : s) === uuid)) {
        toast('This patient is already on your “never auto-file” list.', 'warn');
        return;
      }
      arr.push({ uuid, ts: new Date().toISOString() });
      chrome.storage.local.set({ [STORE_SUPPRESS]: arr }, () => {
        toast('Added — auto-filing is now blocked for this patient on every profile.', 'ok');
      });
    });
  }

  function messagingEnabled(profile) {
    return !!(
      profile &&
      profile.patientMessage &&
      profile.patientMessage.enabled &&
      profile.filing &&
      profile.filing.nextStepMessageText
    );
  }

  function showButton(profile) {
    currentProfile = profile;
    if (whitelistBox) {
      whitelistBox.classList.add('chlf-hidden');
      whitelistBox.innerHTML = '';
      whitelistSignature = null;
    }
    const mode = LF && LF.LF_COMMIT_MODES.includes(profile.commitMode) ? profile.commitMode : 'manual';
    host.className = 'chlf-card chlf-ready';
    // Title = the matched profile, so the clinician can SEE which rule fired. For a
    // combined task, name every profile that contributed so coverage is visible.
    const multi = profile._matchedCount > 1;
    titleEl.textContent = profile.name || 'Filing profile';
    const coverage = multi && profile._matchedNames ? 'Covers: ' + profile._matchedNames.join(', ') + '. ' : '';
    subEl.textContent =
      coverage +
      (mode === 'manual'
        ? 'Every value is within your normal limits. Pre-fills the normal options for you to review and file.'
        : 'Every value is within your normal limits. Asks you to confirm, then files. Irreversible.');
    btn.classList.remove('chlf-hidden');
    btn.disabled = false;
    btn.textContent = mode === 'manual' ? 'Review & file all normal' : 'File all normal…';
    // Second action: file + message patient (prepares Medicus's message, never sends).
    if (messagingEnabled(profile)) {
      msgBtn.disabled = false;
      msgBtn.textContent = '+ message patient';
      msgBtn.title =
        'Selects Medicus’s “message patient” option and drops your message ready to send — you review the recipient and message and press send. It never sends for you.';
      msgBtn.classList.remove('chlf-hidden');
    } else {
      msgBtn.classList.add('chlf-hidden');
    }
    if (suppressLink) suppressLink.classList.remove('chlf-hidden');
    host.classList.remove('chlf-hidden');
  }
  // The not-offered state: a profile fits but the result has something the gate
  // cannot pass (out-of-range, free text, a guard tripped). The card NAMES the rule
  // and shows WHY inline — so the clinician sees the feature ran and deliberately
  // declined, rather than seeing nothing or a silent no-op.
  function showBlockedHint(blockers, profile, commentedResults, matchedProfiles) {
    currentProfile = null; // not fileable — onAction early-returns
    const reasons = (blockers || []).filter(Boolean);
    host.className = 'chlf-card chlf-blocked';
    titleEl.textContent = (profile && profile.name ? profile.name : 'Filing profile') + ' — not auto-filed';
    const shown = reasons.slice(0, 2).join(' · ');
    const extra = reasons.length > 2 ? ' (+' + (reasons.length - 2) + ' more)' : '';
    subEl.textContent = reasons.length ? 'Review manually: ' + shown + extra : 'Review manually.';
    subEl.title = reasons.join('\n');
    if (btn) btn.classList.add('chlf-hidden');
    if (msgBtn) msgBtn.classList.add('chlf-hidden');
    // Still allow opting this patient out, even on the not-offered state.
    if (suppressLink) suppressLink.classList.remove('chlf-hidden');
    renderWhitelistBox(commentedResults, matchedProfiles);
    host.classList.remove('chlf-hidden');
  }

  // Builds the "whitelist this comment" checkbox row(s) inside the blocked card.
  // Uses the EXACT residue text unresolvedCommentedResults computed (the same
  // text the gate itself judged against), never a retyped or copy-pasted
  // approximation — so a saved entry is guaranteed to match on the next
  // report carrying the same comment.
  //
  // Every blocked-by-comment result gets an offer WHEN it can be attributed
  // to a real owning profile — never silently dropped just because several
  // profiles matched the report overall (e.g. one task combining Renal
  // function tests, LFTs and Lipids, each with its own comments). Attributed
  // via LF.profilesOwningResult, which matches by the result's HEADING first
  // (Medicus associates a performer comment with the heading, not the
  // individual analyte, in most cases) and falls back to the analyte name
  // only when nothing names the heading itself.
  //
  // NEVER falls back to "every matched profile" when nobody owns a comment.
  // That was tried and is actively harmful — found live 2026-09-17: a Lipids
  // comment (Triglycerides) got saved onto the U&E and LFT profiles because
  // no profile in the practice's set actually covered Lipids, and the
  // fallback filled that gap with every profile that happened to match the
  // combined report. A comment with no owning profile gets no checkbox —
  // the clinician still sees it's blocking (in the reasons text above), just
  // without an offer to save it somewhere that has nothing to do with it.
  // If it comes back with more than one owner, the phrase is saved to ALL of
  // them — never an arbitrary pick among genuinely tied candidates.
  function renderWhitelistBox(commentedResults, matchedProfiles) {
    if (!whitelistBox) return;
    const list = Array.isArray(commentedResults) ? commentedResults : [];
    const profiles = (Array.isArray(matchedProfiles) ? matchedProfiles : []).filter((p) => p && p.id);
    const rows = list
      .map((c) => ({ c, targets: LF ? LF.profilesOwningResult(profiles, c.result) : [] }))
      .filter((x) => x.targets.length > 0);
    if (!rows.length) {
      whitelistBox.classList.add('chlf-hidden');
      whitelistBox.innerHTML = '';
      whitelistSignature = null;
      return;
    }
    // IDEMPOTENT REBUILD — same inject/wipe race class as the queue chips
    // (see CLAUDE.md). Medicus's SPA mutates constantly; evaluateGate() fires
    // on every observed change (often more than once a second), and each
    // pass used to call this function, which unconditionally cleared and
    // rebuilt the box — wiping a checkbox the clinician had just ticked, and
    // the Save button with it, before a click could ever land. Skip the
    // rebuild entirely (leaving checked state and the Save button's visible/
    // hidden state exactly as the clinician left them) when the underlying
    // comment/profile content hasn't actually changed.
    const signature = JSON.stringify(rows.map((x) => [x.c.name, x.c.residue, x.targets.map((p) => p.id).sort()]));
    if (signature === whitelistSignature) return;
    whitelistSignature = signature;
    whitelistBox.innerHTML = '';
    const multiProfile = profiles.length > 1;
    whitelistBox.classList.remove('chlf-hidden');
    whitelistBox.appendChild(
      el(
        'div',
        'chlf-wl-intro',
        'Recognise a comment below? Whitelist it for every future report on the profile(s) it belongs to — this machine only, until you publish a practice profile.'
      )
    );
    const checks = [];
    rows.forEach(({ c, targets }) => {
      const row = el('label', 'chlf-wl-row');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      row.appendChild(cb);
      const text = el('span', 'chlf-wl-text');
      text.appendChild(el('strong', null, c.name + ': '));
      text.appendChild(document.createTextNode('“' + c.residue + '”'));
      if (multiProfile) {
        const names = targets.map((p) => p.name || 'profile').join(', ');
        text.appendChild(el('span', 'chlf-wl-target', ' → ' + names));
      }
      row.appendChild(text);
      whitelistBox.appendChild(row);
      checks.push({ checkbox: cb, residue: c.residue, targetProfiles: targets });
    });
    const saveBtn = el('button', 'chlf-wl-save chlf-hidden', 'Save & switch OFF for review');
    saveBtn.type = 'button';
    saveBtn.onclick = () => whitelistSelectedComments(checks, saveBtn);
    whitelistBox.appendChild(saveBtn);
    const note = el(
      'div',
      'chlf-wl-note',
      'Saves to the profile(s) it belongs to and switches each one OFF — review and re-enable in Options → Lab Filing before it can file anything again.'
    );
    whitelistBox.appendChild(note);
    const syncButtonVisibility = () => {
      saveBtn.classList.toggle('chlf-hidden', !checks.some((c) => c.checkbox.checked));
    };
    checks.forEach((c) => (c.checkbox.onchange = syncButtonVisibility));
  }

  // Writes each checked residue text into every one of its target profiles'
  // allowComments (never the synthetic merged object) and forces each of
  // those profiles back to enabled:false, reviewed:false — same "any content
  // change re-opens review" discipline as every other profile edit
  // (Options → Lab Filing's own save handler). Grouped by profile id so a
  // profile targeted by several checked comments (or the same profile
  // appearing as a fallback/tied target for more than one) is only written
  // once. Re-reads storage fresh immediately before writing so this never
  // clobbers a concurrent edit made elsewhere (Options page, another
  // machine's practice-profile sync) with a stale local copy.
  async function whitelistSelectedComments(checks, saveBtn) {
    if (whitelistBusy) return;
    const ticked = (checks || []).filter((c) => c.checkbox.checked && Array.isArray(c.targetProfiles) && c.targetProfiles.length);
    if (!ticked.length) return;
    if (!LF || typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      toast('Could not save — extension utilities not loaded.', 'err');
      return;
    }
    const byProfileId = new Map();
    ticked.forEach((c) => {
      c.targetProfiles.forEach((p) => {
        if (!p || !p.id) return;
        if (!byProfileId.has(p.id)) byProfileId.set(p.id, []);
        byProfileId.get(p.id).push(c.residue);
      });
    });
    whitelistBusy = true;
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
    }
    try {
      const r = await new Promise((resolve) => chrome.storage.local.get([STORE_PROFILES, 'suite.feedbackEmail'], resolve));
      const stored = Array.isArray(r[STORE_PROFILES]) ? r[STORE_PROFILES] : [];
      const updatedNames = [];
      const missing = [];
      for (const [profileId, texts] of byProfileId) {
        const idx = stored.findIndex((p) => p && p.id === profileId);
        if (idx < 0) {
          missing.push(profileId);
          continue;
        }
        const existingAllow = Array.isArray(stored[idx].allowComments) ? stored[idx].allowComments : [];
        const existingNorm = new Set(existingAllow.map((s) => String(s || '').toLowerCase().trim()));
        const toAdd = texts.filter((t) => !existingNorm.has(String(t || '').toLowerCase().trim()));
        const draft = Object.assign({}, stored[idx], {
          allowComments: existingAllow.concat(toAdd),
          enabled: false,
          reviewed: false,
          updatedAt: new Date().toISOString(),
          updatedBy: r['suite.feedbackEmail'] || '',
        });
        const clean = LF.sanitiseProfile(draft);
        clean.id = stored[idx].id; // sanitiseProfile only keeps a syntactically valid id — pin it explicitly
        stored[idx] = clean;
        updatedNames.push(clean.name || 'Profile');
      }
      if (!updatedNames.length) {
        console.error('[LabFiling] whitelist save found no matching stored profile(s) for ids:', [...byProfileId.keys()]);
        toast('Could not save — the matching profile(s) no longer exist (may have been deleted or renamed).', 'err');
        return;
      }
      await new Promise((resolve) => chrome.storage.local.set({ [STORE_PROFILES]: stored }, resolve));
      const namesStr = updatedNames.map((n) => '“' + n + '”').join(', ');
      toast(namesStr + ' updated and switched OFF — review in Options → Lab Filing to re-enable.', 'ok');
      // chrome.storage.onChanged already re-runs loadConfig()+scheduleEval() —
      // no manual re-evaluate needed. The card will re-render on that pass.
      return;
    } catch (e) {
      // Unconditional (not ch-debug gated) — a failed write here is silent
      // otherwise, and the toast itself is only visible for ~5s.
      console.error('[LabFiling] whitelist save threw:', e);
      toast('Could not save the whitelist entry: ' + (e && e.message ? e.message : 'unknown error'), 'err');
    } finally {
      whitelistBusy = false;
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save & switch OFF for review';
      }
    }
  }
  function hideButton() {
    currentProfile = null;
    currentMatchedProfiles = [];
    if (host) host.classList.add('chlf-hidden');
    if (subEl) subEl.title = '';
    if (whitelistBox) {
      whitelistBox.classList.add('chlf-hidden');
      whitelistBox.innerHTML = '';
      whitelistSignature = null;
    }
    if (msgBtn) msgBtn.classList.add('chlf-hidden');
    if (suppressLink) suppressLink.classList.add('chlf-hidden');
  }

  function toast(msg, kind) {
    const t = document.createElement('div');
    t.className = 'chlf-toast chlf-' + (kind || 'ok');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('chlf-show'), 10);
    setTimeout(() => {
      t.classList.remove('chlf-show');
      setTimeout(() => t.remove(), 300);
    }, 5200);
  }
  function highlight(el) {
    try {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const prev = el.style.boxShadow;
      el.style.boxShadow = '0 0 0 3px #0d6e5e';
      setTimeout(() => {
        el.style.boxShadow = prev;
      }, 2600);
    } catch (e) {
      /* ignore */
    }
  }

  async function onAction(action) {
    if (busy || !currentProfile) return;
    busy = true;
    btn.disabled = true;
    if (msgBtn) msgBtn.disabled = true;
    try {
      // Re-verify at click time with a FRESH fetch (force=true bypasses the cache)
      // — an irreversible file must act on live data, and must clear every
      // fail-closed blocker, not just numeric severity.
      const rs = await loadReportSeverity(true);
      const profile = currentProfile;
      const eff = effectiveScore(rs, profile);
      const blockers = rs
        ? (eff.fileBlockers || []).concat(await computeProfileBlockers(rs, profile))
        : ['could not read the result'];
      if (!rs || blockers.length) {
        toast('Not filing — ' + (blockers[0] || 'review manually') + '. Review manually.', 'err');
        hideButton();
        return;
      }
      const mode = LF && LF.LF_COMMIT_MODES.includes(profile.commitMode) ? profile.commitMode : 'manual';
      const res = await fileAllNormal({
        root: document.body,
        profile,
        action,
        severity: eff.severity,
        blockers,
        // Confirm dialog gets the ORIGINAL report so it shows the real lab flags AND the
        // "accepted by your set range" note — the clinician sees what they're overriding.
        report: rs.report,
        patient: readPatientBanner(),
        mode,
        confirmFn: (m) => window.confirm(m),
        clickFn: realClick,
        setValueFn: setNativeValue,
        waitForFn: waitFor,
        buildMessage: LF && LF.fillTemplate,
        buildConfirm: LF && LF.buildFilingConfirmMessage,
      });

      if (res.reason === 'no-normal-controls' || res.reason === 'no-file-button' || res.reason === 'no-next-step') {
        toast(
          'Couldn’t find the filing controls this profile describes — nothing was changed. Check the profile’s labels.',
          'err'
        );
        return;
      }
      if (res.reason === 'no-message-step' || res.reason === 'message-not-configured') {
        toast('Couldn’t find the “message patient” option for this profile — nothing was changed.', 'err');
        return;
      }
      if (res.reason === 'cancelled') {
        toast('Cancelled — nothing was filed. The normal options are pre-filled.', 'warn');
        return;
      }
      if (res.reason === 'message-ready') {
        // PREPARE-ONLY handoff: copy the custom message and highlight Medicus's own
        // send button. We never press it and never choose the recipient.
        if (res.preparedMessage) {
          try {
            if (navigator.clipboard && navigator.clipboard.writeText)
              navigator.clipboard.writeText(res.preparedMessage);
          } catch (e) {
            /* ignore */
          }
        }
        const sendBtn = findByText(
          document.body,
          ['button', '[role="button"]', 'input[type="submit"]'],
          profile.filing.nextStepMessageText
        );
        if (sendBtn) highlight(sendBtn);
        toast(
          'Marked normal and selected “message patient”.' +
            (res.preparedMessage ? ' Your message is on the clipboard.' : '') +
            ' Check the recipient and message in Medicus, then send — the macro never sends for you.',
          'ok'
        );
        // hand off; leave the button visible in case the clinician changes their mind
        return;
      }
      if (res.reason === 'manual-ready') {
        const fileBtn = findByText(document.body, ['button', '[role="button"]'], profile.filing.fileButtonText);
        if (fileBtn) highlight(fileBtn);
        toast('Marked ' + res.marked + ' subheading(s) normal. Review, then click File.', 'ok');
      } else if (res.filed) {
        recordAudit(profile, res, rs);
        // Audit R10: the macro observed its own clicks, not a Medicus
        // confirmation — the copy must not claim the filing completed.
        toast(
          'Clicked "' +
            profile.filing.fileButtonText +
            '" (' +
            res.marked +
            ' subheading(s) marked normal). Check the report has left your list — the suite has not confirmed the filing.',
          'ok'
        );
        hideButton();
      } else {
        toast('Could not complete filing (' + (res.reason || 'unknown') + '). Nothing was completed.', 'err');
      }
    } finally {
      busy = false;
      btn.disabled = false;
      if (msgBtn) msgBtn.disabled = false;
    }
  }

  // ── gate evaluation (when to show the button) ────────────────────────────────
  let evalTimer = null;
  function scheduleEval() {
    if (document.hidden) return;
    if (evalTimer) return;
    evalTimer = setTimeout(() => {
      evalTimer = null;
      evaluateGate();
    }, 400);
  }

  async function evaluateGate() {
    if (!host) return;
    // Practice kill switch — one config flag disables every offer instantly,
    // without touching individual profiles. The escape hatch a practice can pull.
    if (config && config.killSwitch === true) {
      hideButton();
      return;
    }
    if (!FILING_URL_RE.test(location.pathname)) {
      hideButton();
      return;
    }
    if (!profiles.some((p) => p && p.enabled === true)) {
      hideButton();
      return;
    }
    const rs = await loadReportSeverity();
    if (!rs) {
      hideButton();
      return;
    }
    currentReport = rs.report;
    // A combined task can carry several panels (Bone + U&E + LFT) under one report
    // and ONE shared File button — so merge EVERY matching profile into one effective
    // profile (union of parameters/guards) and act on the whole task as a unit.
    const merge = LF && LF.mergeProfilesForReport(profiles, rs.report);
    const profile = merge && merge.effective;
    if (!profile) {
      hideButton();
      return;
    }
    // The REAL stored profiles (real id, own storage row), every one that
    // matched — renderWhitelistBox attributes each comment to whichever of
    // them actually owns it (see profilesOwningResult).
    currentMatchedProfiles = Array.isArray(merge.matched) ? merge.matched : [];
    // The File control must actually be on this screen, else the profile doesn't fit.
    const fileBtn = findByText(
      document.body,
      ['button', '[role="button"]', 'input[type="submit"]'],
      profile.filing.fileButtonText
    );
    if (!fileBtn) {
      hideButton();
      return;
    }
    // A profile fits and the screen is a filing screen — but if anything the gate
    // cannot judge is present (free text, unmatched, no rules, an abnormal value),
    // explain WHY auto-file is not offered rather than silently hiding (the nurse
    // and locum personas asked to see the not-offered state, not just the success
    // one). Otherwise show the action button. The profile's OWN per-analyte
    // parameters (clinician-set ranges, incl. un-ranged analytes like HbA1c) are
    // checked here on top of the generic blockers.
    const eff = effectiveScore(rs, profile);
    const blockers = (eff.fileBlockers || []).concat(await computeProfileBlockers(rs, profile));
    if (blockers.length) {
      const commentedResults = LF
        ? LF.unresolvedCommentedResults(eff.report, profile, currentMatchedProfiles)
        : [];
      showBlockedHint(blockers, profile, commentedResults, currentMatchedProfiles);
      return;
    }
    showButton(profile);
  }

  // Injected into the Medicus page (no access to the suite's CSS tokens), so values
  // are hardcoded but mirror the suite doctrine: calm white --bg-elev card, hairline
  // border + soft shadow (elevation = both), one left-accent stripe carrying the
  // state colour, sentence-case sans headers, no emoji in chrome, a single spent accent.
  const FONT = 'system-ui,-apple-system,Segoe UI,Roboto,sans-serif';
  const CSS = [
    // Bottom-LEFT: the filing controls (the "Normal result, no action required" notes
    // and the File button) live down the left content pane, so the card sits beside
    // the action — not stranded in the far corner where the eye has to cross the screen.
    '.chlf-card{position:fixed;left:18px;bottom:18px;z-index:2147483000;width:312px;box-sizing:border-box;',
    'background:#fff;border:1px solid #e3e8ee;border-left:4px solid #94a3b8;border-radius:10px;',
    'box-shadow:0 8px 28px rgba(15,23,42,.16);padding:13px 15px;color:#0f172a;font-family:' + FONT + '}',
    '.chlf-card.chlf-hidden{display:none}',
    '.chlf-card.chlf-ready{border-left-color:#0d6e5e}',
    '.chlf-card.chlf-blocked{border-left-color:#b45309}',
    '.chlf-head{display:flex;align-items:center;gap:7px;margin-bottom:7px}',
    '.chlf-dot{width:8px;height:8px;border-radius:50%;background:#94a3b8;flex:0 0 auto}',
    '.chlf-ready .chlf-dot{background:#16a34a}.chlf-blocked .chlf-dot{background:#b45309}',
    '.chlf-eyebrow{font:700 10px/1 ' + FONT + ';letter-spacing:.07em;text-transform:uppercase;color:#475569}',
    '.chlf-title{font:600 13px/1.35 ' + FONT + ';color:#0f172a;margin:0 0 3px;word-break:break-word}',
    '.chlf-sub{font:400 11.5px/1.45 ' + FONT + ';color:#475569;margin:0}',
    '.chlf-actions{display:flex;flex-direction:column;gap:7px;margin-top:11px}',
    '.chlf-primary{appearance:none;border:0;border-radius:8px;background:#0d6e5e;color:#fff;',
    'font:600 13px/1.2 ' + FONT + ';padding:10px 12px;cursor:pointer;text-align:center}',
    '.chlf-primary:hover{background:#0a5a4d}.chlf-primary:disabled{opacity:.55;cursor:default}',
    '.chlf-primary:focus-visible{outline:2px solid #2563eb;outline-offset:1px}',
    '.chlf-primary.chlf-hidden{display:none}',
    '.chlf-secondary{appearance:none;background:#fff;border:1px solid #cbd5e1;border-radius:8px;color:#0d6e5e;',
    'font:600 12px/1.2 ' + FONT + ';padding:8px 12px;cursor:pointer}',
    '.chlf-secondary:hover{border-color:#0d6e5e;background:#f0fdfa}',
    '.chlf-secondary:focus-visible{outline:2px solid #2563eb;outline-offset:1px}',
    '.chlf-secondary.chlf-hidden{display:none}',
    '.chlf-whitelist{margin-top:10px;padding-top:10px;border-top:1px solid #e3e8ee}',
    '.chlf-whitelist.chlf-hidden{display:none}',
    '.chlf-wl-intro{font:600 11px/1.4 ' + FONT + ';color:#334155;margin-bottom:7px}',
    '.chlf-wl-row{display:flex;align-items:flex-start;gap:7px;margin-bottom:7px;cursor:pointer}',
    '.chlf-wl-row input{margin-top:2px;flex:0 0 auto}',
    '.chlf-wl-text{font:400 11px/1.4 ' + FONT + ';color:#475569;word-break:break-word}',
    '.chlf-wl-text strong{color:#0f172a}',
    '.chlf-wl-save{appearance:none;border:0;border-radius:8px;background:#b45309;color:#fff;',
    'font:600 12px/1.2 ' + FONT + ';padding:9px 12px;cursor:pointer;text-align:center;width:100%;margin-top:2px}',
    '.chlf-wl-save:hover{background:#92400e}.chlf-wl-save:disabled{opacity:.55;cursor:default}',
    '.chlf-wl-save:focus-visible{outline:2px solid #2563eb;outline-offset:1px}',
    '.chlf-wl-save.chlf-hidden{display:none}',
    '.chlf-wl-note{font:400 10.5px/1.4 ' + FONT + ';color:#94a3b8;margin-top:6px}',
    '.chlf-foot{display:flex;justify-content:flex-end;margin-top:9px}',
    '.chlf-link{background:none;border:0;color:#64748b;font:500 11px/1.2 ' + FONT + ';cursor:pointer;',
    'padding:2px;text-decoration:underline;text-underline-offset:2px}',
    '.chlf-link:hover{color:#334155}.chlf-link:focus-visible{outline:2px solid #2563eb;outline-offset:1px}',
    '.chlf-link.chlf-hidden{display:none}',
    // Opposite corner from the card (bottom-right) so the transient confirmation
    // never sits on top of the action card when both are visible.
    // z-index one above the card (2147483000). NB: deliberately NOT card+1 — that
    // particular 10-digit value coincidentally passes NHS Modulus-11 and trips the
    // patient-data CI guard; card+2 (2147483002) does not.
    '.chlf-toast{position:fixed;right:18px;bottom:18px;z-index:2147483002;max-width:340px;padding:11px 14px;border-radius:8px;',
    'color:#fff;font:500 13px/1.4 ' +
      FONT +
      ';box-shadow:0 8px 28px rgba(15,23,42,.22);opacity:0;transform:translateY(8px);transition:.28s}',
    '.chlf-toast.chlf-show{opacity:1;transform:none}',
    '.chlf-toast.chlf-ok{background:#0d6e5e}.chlf-toast.chlf-warn{background:#b45309}.chlf-toast.chlf-err{background:#b42318}',
  ].join('');

  loadConfig().then(() => {
    buildUI();
    scheduleEval();
    const hub = window.__chObserverHub;
    const onMut = () => scheduleEval();
    if (hub && hub.subscribe) hub.subscribe(onMut);
    else {
      const mo = new MutationObserver(onMut);
      mo.observe(document.body, { childList: true, subtree: true });
    }
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) scheduleEval();
    });
    if (chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes[STORE_PROFILES] || changes[STORE_CONFIG] || changes[STORE_SUPPRESS] || changes[TRIAGE_CONFIG]) {
          loadConfig().then(scheduleEval);
        }
      });
    }
  });
})();
