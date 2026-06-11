// Medicus Suite — Shared module-loader for side-panel and pop-out
// ES module; imported by panel.js and pop-out/pop-out.js.

'use strict';

// ── CSS loader ────────────────────────────────────────────────────────────────
// Each caller passes its own loadedCss Set so state stays per-page.

export function ensureModuleCss(loadedCss, cssPath) {
  if (!cssPath || loadedCss.has(cssPath)) return;
  loadedCss.add(cssPath);
  const link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = cssPath;
  document.head.appendChild(link);
}

// ── Module switcher ───────────────────────────────────────────────────────────
// createModuleLoader returns a switchModule(name) function.
//
// Options:
//   modules      — the MODULES registry object
//   container    — the DOM element whose innerHTML is replaced on each switch
//   loadedCss    — Set<string> for ensureModuleCss dedup
//   getSwitchSeq — () => number  — getter for the caller's switchSeq counter
//   incSwitchSeq — () => number  — increments and returns the new value
//   getCleanup   — () => fn|null
//   setCleanup   — (fn|null) => void
//   setActive    — (name) => void  — called after nav update, before init
//   onSpecial    — optional (name) => boolean; return true if handled, skip rest
//   onPersist    — optional (name) => void; called after activeModule is set
//   escFn        — optional (s) => string; for error HTML; defaults to basic escaping
//   errPrefix    — optional string prefix for load-error banner; default 'Failed to load module'

export function createModuleLoader({
  modules,
  container,
  loadedCss,
  getSwitchSeq,
  incSwitchSeq,
  getCleanup,
  setCleanup,
  setActive,
  onSpecial = null,
  onPersist = null,
  escFn = null,
  errPrefix = 'Failed to load module',
}) {
  function esc(s) {
    return escFn ? escFn(s) : String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  return async function switchModule(name) {
    const mySeq = incSwitchSeq();

    // Cleanup previous module
    const prevCleanup = getCleanup();
    setCleanup(null);
    if (prevCleanup) try { prevCleanup(); } catch (e) { console.error(e); }

    // Update nav
    document.querySelectorAll('.nav-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.module === name)
    );
    setActive(name);
    container.innerHTML = '';

    // Handle special tabs (e.g. 'about', 'visualiser' in panel)
    if (onSpecial && onSpecial(name)) return;

    if (onPersist) onPersist(name);

    const entry = modules[name];
    if (!entry) return;

    ensureModuleCss(loadedCss, entry.css);

    try {
      const mod = await entry.js();
      if (mySeq !== getSwitchSeq()) return;
      if (mod.init) {
        const cleanup = await mod.init(container);
        if (mySeq !== getSwitchSeq()) {
          if (typeof cleanup === 'function') try { cleanup(); } catch (e) { console.error(e); }
          return;
        }
        setCleanup(cleanup);
      }
    } catch (err) {
      if (mySeq !== getSwitchSeq()) return;
      container.innerHTML = `<div class="module-wrap"><div class="banner">${errPrefix}: ${esc(err.message)}</div></div>`;
    }
  };
}
