// App shell: hash router + shared state. Views render into #main and
// persist through ctx.persist; everything re-renders from state.
// When practice sync is connected, local changes push to the shared
// folder (debounced) and remote changes are pulled on a poll.

import { loadAll, save } from '../shared/store.js';
import { validateRotaScopes } from '../engine/validate.js';
import { mondayOf, todayISO } from '../shared/time.js';
import * as sync from '../shared/sync.js';
import { notify } from '../shared/notify.js';
import dashboard from './views/dashboard.js';
import me from './views/me.js';
import rota from './views/rota.js';
import staff from './views/staff.js';
import templates from './views/templates.js';
import leave from './views/leave.js';
import demand from './views/demand.js';
import syncView from './views/sync.js';
import settings from './views/settings.js';
import unlock from './views/unlock.js';
import setup from './views/setup.js';

// `unlock` and `setup` are deliberately absent from the nav in app.html: both
// are routes the app sends you to, not places you browse to.
const VIEWS = { dashboard, me, rota, staff, templates, leave, demand, sync: syncView, settings, unlock, setup };
const SYNC_SCOPES = ['staff', 'entries', 'leave', 'rooms', 'swaps', 'audit', 'demand', 'settings', 'access'];

// ── Passcode gate ────────────────────────────────────────────────────────────
// See rota/engine/access.js for the honest framing. Two modes when a passcode
// is set and this tab has not been unlocked:
//
//   staff view (strict=false, the default) — the app is READ-ONLY. Rota and My
//     week stay reachable so staff can look up their week, request leave and
//     propose swaps; everything else redirects to the unlock screen.
//   strict (strict=true) — every route shows the unlock screen.
//
// Unlocking is PER TAB and dies with it: sessionStorage, never persisted.
const UNLOCK_KEY = 'rota.unlockedV1';
// Routes a staff-view (non-strict) locked machine may still reach.
const READONLY_ROUTES = ['rota', 'me', 'unlock'];
// Parts persist() will still write when locked in staff view: the self-service
// writes My week owns, plus the audit trail they generate. Everything else
// (entries, staff, rooms, settings, demand — and access itself) is refused.
const READONLY_PERSIST_PARTS = ['leave', 'swaps', 'audit'];

const state = {
  staff: [],
  entries: [],
  leave: [],
  rooms: [],
  swaps: [],
  audit: [],
  demand: { days: {}, pulledAt: '' },
  settings: {},
  access: null,
  weekMonday: mondayOf(todayISO()),
  ui: {}, // per-view scratch (selected staff member, last sync results, …)
};

function unlockedInThisTab() {
  try {
    return sessionStorage.getItem(UNLOCK_KEY) === '1';
  } catch {
    // Private-mode / storage-partitioned contexts: treat as not unlocked. A
    // gate that fails open is not a gate.
    return false;
  }
}

// Recomputed on every render AND inside persist(), so the two can never
// disagree about whether this tab is allowed to write.
function lockState() {
  const a = state.access;
  const enabled = Boolean(a && a.enabled);
  const strict = enabled && Boolean(a.strict);
  const locked = enabled && !unlockedInThisTab();
  return { enabled, strict, locked, readOnly: locked && !strict };
}

let toastTimer = null;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 3000);
}

// BACKSTOP, not the mechanism. The UI already hides every mutation a locked
// machine must not reach; this is the line that holds if a handler is missed,
// a stale listener fires after the lock re-engages, or someone drives the app
// from the console. It THROWS rather than silently no-oping, so a missed path
// shows up as an obvious failure instead of an edit that quietly disappears.
async function persist(...parts) {
  const lock = lockState();
  if (lock.locked) {
    const allowed = lock.strict ? [] : READONLY_PERSIST_PARTS;
    const refused = parts.filter((p) => !allowed.includes(p));
    if (refused.length) {
      throw new Error(`Rota is locked — refused write to ${refused.join(', ')}`);
    }
  }
  for (const p of parts) await save(p, state[p]);
  if (state.ui.syncReady) {
    sync.schedulePush(async () => {
      try {
        const scopes = Object.fromEntries(SYNC_SCOPES.map((k) => [k, state[k]]));
        await sync.push(scopes, state.settings.userName);
      } catch (err) {
        toast(`Sync push failed: ${err instanceof Error ? err.message : err}`);
      }
    });
  }
}

// Audit trail: who did what. Capped, synced, included in the evidence pack.
async function log(summary) {
  state.audit.push({ at: new Date().toISOString(), by: state.settings.userName || '', summary });
  if (state.audit.length > 500) state.audit = state.audit.slice(-500);
  await persist('audit');
}

// A practice with nobody in it has nothing for the dashboard to show, so the
// default (and any unknown) route lands on the setup wizard instead — until
// the wizard is dismissed, or somebody exists. A locked machine is by
// definition already set up, so the gate wins: effectiveRoute() sends #setup
// to the unlock screen like any other admin route.
function needsSetup() {
  return state.staff.length === 0 && !state.settings.setupDismissed && !lockState().locked;
}

function currentRoute() {
  const r = (location.hash || '').slice(1);
  if (VIEWS[r]) return r;
  return needsSetup() ? 'setup' : 'dashboard';
}

// The route actually rendered, which is not always the route in the hash. The
// hash is deliberately left alone: unlocking then re-renders whatever the user
// was originally heading for.
function effectiveRoute(route, lock) {
  if (!lock.locked) return route === 'unlock' ? 'dashboard' : route;
  if (lock.strict) return 'unlock';
  return READONLY_ROUTES.includes(route) ? route : 'unlock';
}

// The nav is static markup in app.html, so visibility is toggled here rather
// than by rebuilding it. Hiding a link is an affordance — effectiveRoute() is
// what actually refuses the route.
function paintNav(route, lock) {
  document.querySelectorAll('#nav a[data-route]').forEach((a) => {
    const target = a.dataset.route;
    const visible = !lock.locked || (!lock.strict && READONLY_ROUTES.includes(target));
    a.hidden = !visible;
    a.classList.toggle('active', target === route);
  });
  const unlockBtn = document.getElementById('navUnlock');
  const lockBtn = document.getElementById('navLock');
  if (unlockBtn) unlockBtn.hidden = !lock.locked;
  if (lockBtn) lockBtn.hidden = lock.locked || !lock.enabled;
}

function render() {
  const lock = lockState();
  const route = effectiveRoute(currentRoute(), lock);
  // Views (and the rota grid's module-scope listeners, which read activeCtx at
  // EVENT time) take the gate from ctx, so it is refreshed on every render.
  ctx.locked = lock.locked;
  ctx.readOnly = lock.readOnly;
  ctx.strictLocked = lock.locked && lock.strict;
  paintNav(route, lock);
  const main = document.getElementById('main');
  main.innerHTML = '';
  VIEWS[route].render(main, ctx);
}

async function applyRemote(remote) {
  // The shared folder is writable by anyone with access to the practice share
  // and is re-read every 15s — it is not a trusted input. Validate BEFORE
  // writing anything: a malformed document is refused whole (no partial,
  // half-applied rota) and the reason is surfaced, never swallowed. pollRemote
  // swallows exceptions by design, so this must not throw to report itself.
  const rejects = validateRotaScopes(remote.scopes || {});
  if (rejects.length) {
    // Toast to match how a failed sync push already reports itself, PLUS a
    // sticky banner in Settings: pull() only ever returns a given version once,
    // so a 3-second toast alone could be the only notice this rota is broken.
    state.ui.syncRejected = {
      version: remote.version,
      by: remote.updatedBy || '',
      at: new Date().toISOString(),
      reasons: rejects,
    };
    toast(`Sync rejected: shared rota v${remote.version} is malformed — nothing was saved`);
    render();
    return;
  }
  state.ui.syncRejected = null;

  const pendingBefore =
    state.leave.filter((l) => l.status === 'requested').length +
    state.swaps.filter((s) => s.status === 'requested').length;
  // Only scopes the remote document actually CARRIES are written. This is what
  // stops a machine still running an older build — whose pushed document has no
  // `access` key at all — from clobbering this machine's passcode config back
  // to undefined and unlocking the practice by accident. An explicit
  // `access: null` in the document is a different thing: it means "protection
  // was removed here", and it does propagate.
  for (const key of SYNC_SCOPES) {
    if (key in (remote.scopes || {})) await save(key, remote.scopes[key]);
  }
  Object.assign(state, await loadAll());
  render();
  toast(`Synced from shared folder (v${remote.version}${remote.updatedBy ? `, ${remote.updatedBy}` : ''})`);
  if (state.settings.notifications) {
    notify('Rota updated', `Shared rota v${remote.version}${remote.updatedBy ? ` by ${remote.updatedBy}` : ''}`);
    const pendingAfter =
      state.leave.filter((l) => l.status === 'requested').length +
      state.swaps.filter((s) => s.status === 'requested').length;
    if (state.settings.userRole !== 'staff' && pendingAfter > pendingBefore) {
      notify('Approvals waiting', `${pendingAfter} leave/swap request(s) need a decision`);
    }
  }
}

async function pollRemote() {
  try {
    const remote = await sync.pull();
    if (remote) await applyRemote(remote);
  } catch {
    /* transient share-drive hiccups: try again next poll */
  }
}

async function initSync() {
  if (!sync.isSupported()) {
    state.ui.syncStatus = 'unsupported';
    return;
  }
  const restored = await sync.restore();
  state.ui.syncStatus = restored === true ? 'connected' : restored === 'needs-permission' ? 'needs-permission' : 'off';
  if (restored === true) {
    state.ui.syncReady = true;
    await pollRemote();
    sync.startPolling(pollRemote, 15);
  }
}

const ctx = {
  state,
  persist,
  log,
  rerender: render,
  toast,
  sync,
  // Set on every render() — declared here so the shape is visible in one place.
  locked: false,
  readOnly: false,
  strictLocked: false,
  // Unlocking is per tab and dies with the tab. Neither unlocks nor failed
  // attempts are audited: on a shared practice machine that is noise, and a
  // log of failed attempts is a log of people's typing.
  unlock() {
    try {
      sessionStorage.setItem(UNLOCK_KEY, '1');
    } catch {
      /* storage-less context: the render below simply stays locked */
    }
    // Arrived at the unlock screen because a route was REDIRECTED here (#staff,
    // #settings, …)? The hash still holds that destination, so a plain
    // re-render lands the user where they were going. Arrived by pressing
    // Unlock in the nav? The hash says #unlock, which is nowhere to be once
    // unlocked — send them to the dashboard (the hashchange re-renders).
    if (location.hash === '#unlock') location.hash = '#dashboard';
    else render();
  },
  lock() {
    try {
      sessionStorage.removeItem(UNLOCK_KEY);
    } catch {
      /* nothing stored, nothing to clear */
    }
    render();
  },
  // A verified recovery code on the unlock screen (views/unlock.js). Clearing
  // the gate IS the recovery: the passcode is a one-way hash and is never
  // revealed, so the way back in is to take the lock off and let the manager
  // set a new one.
  //
  // state.access is cleared FIRST and only then persisted, so persist()'s
  // backstop sees exactly the same "no gate" state that Settings → Remove
  // protection reaches. This is not a route around the lock, it is the lock
  // being removed — and it propagates to the practice shared folder for the
  // same reason removing it in Settings does.
  //
  // Audited, unlike unlocks and failed attempts: this is a CHANGE to the
  // practice's configuration, and a manager arriving to a rota with no passcode
  // should be able to see why.
  async recoverAccess() {
    state.access = null;
    await persist('access');
    await log('Passcode protection removed using the recovery code');
    // Mark the tab unlocked as well, so setting a fresh passcode from Settings
    // does not immediately bounce the manager back to the unlock screen.
    ctx.unlock();
  },
  // "Who am I on this machine" is a staff self-service write that happens to
  // live inside rota.settings, which persist() refuses when locked. This is the
  // ONE narrow exception: it can only ever write the two identity fields, never
  // practice policy, so a locked staff machine can still identify itself in My
  // week — which the read-only mode exists to keep working.
  async identify(staffId, fallbackName) {
    state.settings.userStaffId = staffId || null;
    if (staffId && !state.settings.userName) state.settings.userName = fallbackName || '';
    // Unlocked machines keep the old behaviour exactly (persist → sync push);
    // only the read-only staff view takes the direct-save path.
    if (lockState().readOnly) await save('settings', state.settings);
    else await persist('settings');
  },
  async syncConnected() {
    state.ui.syncStatus = 'connected';
    state.ui.syncReady = true;
    await pollRemote();
    sync.startPolling(pollRemote, 15);
    render();
  },
  async reload() {
    Object.assign(state, await loadAll());
    render();
  },
};

window.addEventListener('hashchange', render);

// Version in the nav footer comes from the suite manifest, so it can never go
// stale. Guarded: app.html is also openable as a plain tab during development,
// where chrome.runtime does not exist.
function showVersion() {
  const el = document.getElementById('navVersion');
  if (!el) return;
  let v = '';
  try {
    v = chrome.runtime.getManifest().version;
  } catch (_) {
    v = '';
  }
  el.textContent = v ? `v${v}` : '';
}

// The nav's lock/unlock buttons are static markup, so they are wired once.
function wireNavGate() {
  const unlockBtn = document.getElementById('navUnlock');
  const lockBtn = document.getElementById('navLock');
  if (unlockBtn)
    unlockBtn.onclick = () => {
      // Already on a hash the router keeps? Re-render; otherwise the hashchange
      // does it. Either way the gate decides what actually renders.
      if (location.hash === '#unlock') render();
      else location.hash = '#unlock';
    };
  if (lockBtn) lockBtn.onclick = () => ctx.lock();
}

(async function init() {
  showVersion();
  wireNavGate();
  Object.assign(state, await loadAll());
  // Sync starts before the first paint exactly as it always has: a locked
  // machine still RECEIVES the practice's rota (applyRemote writes through
  // save(), not persist()), it simply cannot originate changes. render() is
  // what decides whether any of it is shown.
  await initSync();
  render();
})();
