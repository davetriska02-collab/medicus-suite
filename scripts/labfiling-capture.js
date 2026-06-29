// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Lab-filing SCOPING capture (READ-ONLY: clicks nothing, sends nothing).
//
// Dev / onboarding tool. NOT shipped (scripts/ is excluded from the release zip).
// Paste the IIFE below into the PAGE console (DevTools) while on a Medicus
// investigation-report FILING screen, to scope that lab/area's filing controls so
// a Lab-filing profile can be authored against the real DOM. It enumerates the
// visible buttons, option/radio controls (incl. the "Next Steps" radios), any open
// dialog (e.g. the "File results and message patient" dialog — open it first), and
// replays the investigation-report API for the analyte structure (NO values, so
// the output carries no patient numbers). Results are dumped into an on-screen
// textbox with a Copy button so no clipboard permission is needed.
//
// Why a page-console capture: the content script runs in the isolated world, so the
// page console can't read its state — but it CAN read shared DOM, do credentialed
// fetches, and see window.__chPageWorld. See CLAUDE.md "Debugging injected queue
// chips … (capture first)".

/* eslint-disable */
(() => {
  const norm = (s) => (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim();
  const vis = (el) => !!(el && (el.offsetParent !== null || (el.getClientRects && el.getClientRects().length)));
  const textOf = (el) => norm((el.getAttribute && el.getAttribute('aria-label')) || el.textContent).slice(0, 90);
  const dedupe = (a, k) => {
    const s = new Set(),
      o = [];
    for (const x of a) {
      const kk = k(x);
      if (kk && !s.has(kk)) {
        s.add(kk);
        o.push(x);
      }
    }
    return o;
  };
  const ctrls = (root, sel) =>
    dedupe(
      [...root.querySelectorAll(sel)].filter(vis).map((el) => ({
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute && el.getAttribute('type'),
        role: el.getAttribute('role'),
        text: textOf(el),
        ariaChecked: el.getAttribute('aria-checked'),
        checked: el.checked != null ? !!el.checked : undefined,
        placeholder: el.getAttribute && el.getAttribute('placeholder'),
        disabled: !!(el.disabled || el.getAttribute('aria-disabled') === 'true'),
      })),
      (x) => (x.text || x.placeholder || '') + x.tag + (x.type || '')
    ).filter((x) => x.text || x.placeholder || x.type === 'radio' || x.type === 'checkbox');

  const out = { capturedAt: new Date().toISOString(), url: location.href, host: location.host };
  try {
    const parts = location.pathname.split('/').filter(Boolean);
    const m = location.pathname.match(/\/tasks\/data\/([^/]+)\/overview\/([0-9a-fA-F-]{36})/);
    out.context = {
      siteId: parts[0] || null,
      taskTypeSlug: m ? m[1] : null,
      taskUuid: m ? m[2] : null,
      pageWorldBridge: !!window.__chPageWorld,
      labButtonLoaded: !!window.__chLabFile,
    };
  } catch (e) {
    out.context = { error: String(e) };
  }

  out.buttons = ctrls(document, 'button,[role="button"],input[type="submit"]').slice(0, 90);
  // Option/radio controls — now includes native radios/checkboxes AND their labels,
  // so report-level "Next Steps" choices (File results with no further action / …
  // message patient / Reassign task) are captured even when they are <input>+<label>.
  out.optionControls = ctrls(
    document,
    '[role="radio"],[role="option"],[role="menuitem"],input[type="radio"],input[type="checkbox"],.q-radio,.q-checkbox,.q-item,.q-option,label,select,option'
  ).slice(0, 140);
  out.fields = ctrls(document, 'input[type="text"],textarea,[contenteditable="true"]').slice(0, 40);
  out.dialogs = [...document.querySelectorAll('[role="dialog"],[aria-modal="true"],.q-dialog')]
    .filter(vis)
    .map((d) => ({
      title: textOf(d).slice(0, 120),
      buttons: ctrls(d, 'button,[role="button"]').slice(0, 30),
      fields: ctrls(d, 'input[type="text"],textarea,[contenteditable="true"]').slice(0, 20),
      options: ctrls(d, '[role="radio"],input[type="radio"],[role="option"],select,option,label,.q-item').slice(0, 40),
    }));

  const ctx = out.context || {};
  const dump = () => {
    const old = document.getElementById('__chCapBox');
    if (old) old.remove();
    const wrap = document.createElement('div');
    wrap.id = '__chCapBox';
    wrap.style.cssText =
      'position:fixed;inset:24px;z-index:2147483647;background:#fff;border:2px solid #0d6e5e;border-radius:8px;padding:8px;display:flex;flex-direction:column;box-shadow:0 10px 40px rgba(0,0,0,.4)';
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:8px;margin-bottom:6px;align-items:center';
    const ta = document.createElement('textarea');
    ta.value = JSON.stringify(out, null, 2);
    ta.style.cssText = 'flex:1;width:100%;font:12px monospace';
    const cp = document.createElement('button');
    cp.textContent = 'Copy';
    cp.style.cssText = 'padding:6px 12px';
    cp.onclick = () => {
      ta.focus();
      ta.select();
      try {
        document.execCommand('copy');
        cp.textContent = 'Copied ✓';
      } catch (e) {
        /* ignore */
      }
    };
    const cl = document.createElement('button');
    cl.textContent = 'Close';
    cl.style.cssText = 'padding:6px 12px';
    cl.onclick = () => wrap.remove();
    const note = document.createElement('span');
    note.style.cssText = 'font:12px system-ui;color:#555';
    note.textContent = 'Read-only capture — click Copy (or Ctrl+C), then paste back.';
    bar.append(cp, cl, note);
    wrap.append(bar, ta);
    document.body.appendChild(wrap);
    ta.focus();
    ta.select();
    window.__chLabCapture = out;
  };

  if (ctx.siteId && ctx.taskTypeSlug && ctx.taskUuid) {
    fetch(`https://${ctx.siteId}.api.${location.host}/tasks/data/${ctx.taskTypeSlug}/overview/${ctx.taskUuid}`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
      .then((r) => r.json())
      .then((j) => {
        try {
          const rep = j && j.data && j.data.investigationReport;
          const g = (rep && rep.investigationGroups) || [];
          out.report = {
            isMatchedToPatient: rep && rep.isMatchedToPatient,
            // Deliberately omits result VALUES — labels/flags/structure only, so the
            // capture carries no patient numbers.
            groups: g.slice(0, 12).map((x) => ({
              title: x.groupName || x.name || x.title || null,
              results: (x.results || []).slice(0, 40).map((y) => ({
                name: y.description,
                unit: y.resultUnit,
                isAbove: y.isAboveReferenceRange,
                isBelow: y.isBelowReferenceRange,
                urgent: y.requiresUrgentReview,
                hasComment: !!(
                  y.resultText ||
                  (y.resultPerformerComments || []).length ||
                  (y.filingComments || []).length
                ),
              })),
            })),
          };
        } catch (e) {
          out.report = { error: String(e) };
        }
        dump();
      })
      .catch((e) => {
        out.report = { fetchError: String(e) };
        dump();
      });
  } else {
    out.report = { skipped: 'no task context in URL — are you on a result review/overview screen?' };
    dump();
  }
})();
