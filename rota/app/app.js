// App shell: hash router + shared state. Views render into #main and
// persist through ctx.persist; everything re-renders from state.
// When practice sync is connected, local changes push to the shared
// folder (debounced) and remote changes are pulled on a poll.

import { loadAll, save } from '../shared/store.js';
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

const VIEWS = { dashboard, me, rota, staff, templates, leave, demand, sync: syncView, settings };
const SYNC_SCOPES = ['staff', 'entries', 'leave', 'rooms', 'swaps', 'audit', 'demand', 'settings'];

const state = {
  staff: [],
  entries: [],
  leave: [],
  rooms: [],
  swaps: [],
  audit: [],
  demand: { days: {}, pulledAt: '' },
  settings: {},
  weekMonday: mondayOf(todayISO()),
  ui: {}, // per-view scratch (selected staff member, last sync results, …)
};

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

async function persist(...parts) {
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

function currentRoute() {
  const r = (location.hash || '#dashboard').slice(1);
  return VIEWS[r] ? r : 'dashboard';
}

function render() {
  const route = currentRoute();
  document.querySelectorAll('#nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === route);
  });
  const main = document.getElementById('main');
  main.innerHTML = '';
  VIEWS[route].render(main, ctx);
}

async function applyRemote(remote) {
  const pendingBefore =
    state.leave.filter((l) => l.status === 'requested').length +
    state.swaps.filter((s) => s.status === 'requested').length;
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

(async function init() {
  showVersion();
  Object.assign(state, await loadAll());
  await initSync();
  render();
})();
