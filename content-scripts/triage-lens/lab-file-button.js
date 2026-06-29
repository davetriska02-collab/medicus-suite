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
  function findByText(root, selectors, wanted, visible) {
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
      if (!partial && t.indexOf(w) >= 0 && vis(el)) partial = el;
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
    // don't fit this layout, we abort before touching anything.
    const fileBtn0 = findByText(root, ['button', '[role="button"]', 'input[type="submit"]'], f.fileButtonText, vis);
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
        : findAllByText(
            root,
            ['[role="radio"]', '[role="option"]', '.q-radio', '.q-checkbox', '.q-item', 'label', 'button'],
            f.normalOptionText,
            vis
          );
      for (const el of opts) {
        if (el.getAttribute && el.getAttribute('aria-checked') === 'true') {
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
      if (!(msgStep.getAttribute && msgStep.getAttribute('aria-checked') === 'true')) click(msgStep);

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
      const step = findByText(root, STEP_RADIO_SELECTORS, f.nextStepText, vis);
      if (!step) {
        result.reason = 'no-next-step';
        return result;
      }
      if (!(step.getAttribute && step.getAttribute('aria-checked') === 'true')) click(step);
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

    // STEP 5 — file. Re-find the button and require it enabled.
    const fileBtn = await wait(() => {
      const b = findByText(root, ['button', '[role="button"]', 'input[type="submit"]'], f.fileButtonText, vis);
      return b && isEnabled(b) ? b : null;
    });
    if (!fileBtn) {
      result.reason = 'file-button-disabled';
      return result;
    }
    click(fileBtn);
    result.filed = true;

    // STEP 6 — optional complete.
    if (f.completeButtonText) {
      const completeBtn = await wait(() => {
        const b = findByText(root, ['button', '[role="button"]'], f.completeButtonText, vis);
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
  const sevCache = new Map(); // taskUuid → { report, severity, ts }
  const SEV_TTL = 60000;

  function loadConfig() {
    return new Promise((resolve) => {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return resolve();
      chrome.storage.local.get([STORE_PROFILES, STORE_CONFIG, TRIAGE_CONFIG], (r) => {
        profiles = Array.isArray(r[STORE_PROFILES]) ? r[STORE_PROFILES] : [];
        const c = r[STORE_CONFIG];
        config = c && typeof c === 'object' ? c : { commitMode: 'manual' };
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
    } catch (e) {
      /* ignore */
    }
  }

  // ── floating button UI ───────────────────────────────────────────────────────
  let host = null;
  let btn = null;
  let msgBtn = null;
  let busy = false;
  let currentProfile = null;

  function buildUI() {
    if (host) return;
    host = document.createElement('div');
    host.className = 'chlf-host chlf-hidden';
    btn = document.createElement('button');
    btn.className = 'chlf-btn';
    btn.onclick = () => onAction('fileNoAction');
    // Optional second action — only shown when the profile enables messaging.
    msgBtn = document.createElement('button');
    msgBtn.className = 'chlf-btn chlf-msg chlf-hidden';
    msgBtn.onclick = () => onAction('fileAndMessage');
    host.appendChild(btn);
    host.appendChild(msgBtn);
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    document.body.appendChild(host);
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
    const mode = LF && LF.LF_COMMIT_MODES.includes(profile.commitMode) ? profile.commitMode : 'manual';
    btn.className = 'chlf-btn';
    btn.disabled = false;
    btn.textContent = (mode === 'manual' ? '✎ ' : '✓ ') + 'File all normal — ' + (profile.name || 'profile');
    btn.title =
      'All results are within normal limits. ' +
      (mode === 'manual'
        ? 'Pre-fills the normal options for you to review and File.'
        : 'Asks you to confirm, then files this result as normal. Irreversible.');
    // Second action: file + message patient (prepares Medicus's message, never sends).
    if (messagingEnabled(profile)) {
      msgBtn.disabled = false;
      msgBtn.textContent = '✉ + message patient';
      msgBtn.title =
        'Selects Medicus’s “message patient” option and drops your message ready to send — you review the recipient and message and press send. It never sends for you.';
      msgBtn.classList.remove('chlf-hidden');
    } else {
      msgBtn.classList.add('chlf-hidden');
    }
    host.classList.remove('chlf-hidden');
  }
  // A non-actionable note shown when a profile fits but the result has something
  // the gate cannot judge — so the clinician knows the feature saw the result and
  // deliberately did NOT offer to file it (and why), rather than seeing nothing.
  function showBlockedHint(blockers) {
    currentProfile = null; // not fileable — onAction early-returns
    btn.className = 'chlf-btn chlf-note';
    btn.disabled = true;
    btn.textContent = 'Auto-file not offered — review manually';
    btn.title = 'This result was not offered for one-click filing because: ' + (blockers || []).join('; ') + '.';
    if (msgBtn) msgBtn.classList.add('chlf-hidden');
    host.classList.remove('chlf-hidden');
  }
  function hideButton() {
    currentProfile = null;
    if (host) host.classList.add('chlf-hidden');
    if (msgBtn) msgBtn.classList.add('chlf-hidden');
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
      const blockers = rs
        ? (rs.blockers || []).concat(LF ? LF.profileParamBlockers(rs.report, profile) : [])
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
        severity: rs.severity,
        blockers,
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
        toast('Filed as normal (' + res.marked + ' subheading(s))' + (res.completed ? ' and completed.' : '.'), 'ok');
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
    const profile = LF && LF.matchProfile(profiles, rs.report);
    if (!profile) {
      hideButton();
      return;
    }
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
    const blockers = (rs.blockers || []).concat(LF ? LF.profileParamBlockers(rs.report, profile) : []);
    if (blockers.length) {
      showBlockedHint(blockers);
      return;
    }
    showButton(profile);
  }

  const CSS = [
    '.chlf-host{position:fixed;right:18px;bottom:18px;z-index:2147483000;display:flex;flex-direction:column;gap:8px;align-items:flex-end}',
    '.chlf-host.chlf-hidden{display:none}',
    '.chlf-btn{background:#0d6e5e;color:#fff;border:0;padding:11px 16px;border-radius:10px;cursor:pointer;',
    'font:600 13px/1.2 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.22);max-width:340px;',
    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.chlf-btn:hover{background:#0a5a4d}.chlf-btn:disabled{opacity:.6;cursor:default}',
    '.chlf-btn.chlf-hidden{display:none}',
    '.chlf-btn.chlf-msg{background:#5b3fb0;font-size:12px;padding:9px 14px}.chlf-btn.chlf-msg:hover{background:#4a3393}',
    '.chlf-btn.chlf-note{background:#92400e;cursor:default}.chlf-btn.chlf-note:hover{background:#92400e}',
    '.chlf-toast{position:fixed;right:18px;bottom:74px;z-index:2147483000;max-width:360px;padding:11px 14px;border-radius:8px;',
    'color:#fff;font:500 13px/1.4 system-ui;box-shadow:0 6px 20px rgba(0,0,0,.25);opacity:0;transform:translateY(8px);transition:.28s}',
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
        if (changes[STORE_PROFILES] || changes[STORE_CONFIG] || changes[TRIAGE_CONFIG]) {
          loadConfig().then(scheduleEval);
        }
      });
    }
  });
})();
