// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Note companion (side-panel / pop-out).
//
// Configure the TV display: pick a profile, edit the flap message, choose
// widgets, open the full-tab board. Live figures stay on the kiosk page;
// this module is the remote.

'use strict';

import { openBoardTab } from '../../../board/board-open.js';
import {
  STORAGE_KEY,
  WIDGET_META,
  PUBLIC_WIDGETS,
  sanitiseConfig,
  sanitiseMessage,
  MAX_MESSAGE_CHARS,
} from '../../../board/board-core.js';

let container = null;
let config = sanitiseConfig(null);
let onClick = null;
let onInput = null;
let onChange = null;
let persistTimer = null;

const esc = (s) =>
  String(s == null ? '' : s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

function activeProfile() {
  return config.profiles.find((p) => p.id === config.activeProfileId) || config.profiles[0];
}

function allowedWidgets(profile) {
  return Object.keys(WIDGET_META).filter((id) => {
    const meta = WIDGET_META[id];
    return profile.audience === 'staff' || meta.audience === 'public';
  });
}

function persist() {
  config = sanitiseConfig(config);
  chrome.storage.local.set({ [STORAGE_KEY]: config });
}

function persistSoon() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(persist, 200);
}

function render() {
  if (!container) return;
  const p = activeProfile();
  const msg = p.message || '';
  const publicLock = p.audience === 'public';

  container.innerHTML = `
    <div class="note-mod">
      <header class="note-mod-head">
        <div>
          <div class="note-mod-title">Note</div>
          <p class="note-mod-sub">A display board for TVs and monitors — waiting-room tempo, a request ticker, or a staff ops overview.</p>
        </div>
      </header>

      <div class="note-mod-actions">
        <button type="button" class="note-mod-btn note-mod-btn-primary" data-open="${esc(p.id)}">Open on this screen</button>
        <button type="button" class="note-mod-btn" data-open="waiting-room">Waiting room</button>
        <button type="button" class="note-mod-btn" data-open="ops">Ops</button>
      </div>
      <p class="note-mod-hint">Opens a full browser tab. Put that tab on the TV, then press F for fullscreen.</p>

      <section class="note-mod-card">
        <h2 class="note-mod-h">Profile</h2>
        <div class="note-mod-profiles" role="radiogroup" aria-label="Display profile">
          ${config.profiles
            .map((prof) => {
              const on = prof.id === p.id;
              return `<button type="button" class="note-mod-profile${on ? ' is-on' : ''}" data-profile="${esc(prof.id)}" role="radio" aria-checked="${on ? 'true' : 'false'}">
                <span class="note-mod-profile-name">${esc(prof.name)}</span>
                <span class="note-mod-profile-aud">${prof.audience === 'public' ? 'Public TV' : 'Staff room'}</span>
              </button>`;
            })
            .join('')}
        </div>
      </section>

      <section class="note-mod-card">
        <h2 class="note-mod-h">Message on the board</h2>
        <textarea id="noteModMessage" class="note-mod-msg" maxlength="${MAX_MESSAGE_CHARS}" rows="3" aria-label="Board message">${esc(msg)}</textarea>
        <div class="note-mod-meta"><span id="noteModCount">${msg.length}</span> / ${MAX_MESSAGE_CHARS}</div>
      </section>

      <section class="note-mod-card">
        <h2 class="note-mod-h">What this profile shows</h2>
        <div class="note-mod-widgets">
          ${allowedWidgets(p)
            .map((id) => {
              const checked = p.widgets.includes(id);
              return `<label class="note-mod-check">
                <input type="checkbox" data-widget="${esc(id)}" ${checked ? 'checked' : ''} />
                <span>${esc(WIDGET_META[id].label)}</span>
              </label>`;
            })
            .join('')}
        </div>
      </section>

      <section class="note-mod-card">
        <h2 class="note-mod-h">Refresh</h2>
        <label class="note-mod-poll">
          Every
          <input type="number" id="noteModPoll" min="10" max="120" step="5" value="${esc(config.pollSeconds)}" />
          seconds
        </label>
      </section>

      <aside class="note-mod-privacy${publicLock ? '' : ' note-mod-privacy-staff'}">
        ${
          publicLock
            ? `<strong>Public display.</strong> Waiting-room and Message profiles never show patient names, initials, or request wording — only counts, wait bands, and the message you type above. ${PUBLIC_WIDGETS.length} widgets are allowed; staff-only tiles are locked off.`
            : `<strong>Staff display.</strong> Ops still paints aggregates only (no patient names). Keep this profile off the waiting-room TV — it shows triage inbox and pressure figures patients should not see.`
        }
      </aside>
    </div>
  `;
}

function wire() {
  onClick = (e) => {
    const open = e.target.closest('[data-open]');
    if (open) {
      persist();
      openBoardTab(open.getAttribute('data-open'));
      return;
    }
    const prof = e.target.closest('[data-profile]');
    if (prof) {
      config.activeProfileId = prof.getAttribute('data-profile');
      persist();
      render();
    }
  };
  onInput = (e) => {
    if (e.target.id === 'noteModMessage') {
      const p = activeProfile();
      p.message = sanitiseMessage(e.target.value);
      const count = container.querySelector('#noteModCount');
      if (count) count.textContent = String(p.message.length);
      persistSoon();
    }
  };
  onChange = (e) => {
    if (e.target.id === 'noteModPoll') {
      config.pollSeconds = Number(e.target.value);
      persist();
      return;
    }
    const w = e.target.getAttribute && e.target.getAttribute('data-widget');
    if (!w) return;
    const p = activeProfile();
    const set = new Set(p.widgets);
    if (e.target.checked) set.add(w);
    else set.delete(w);
    p.widgets = [...set];
    persist();
  };
  container.addEventListener('click', onClick);
  container.addEventListener('input', onInput);
  container.addEventListener('change', onChange);
}

export async function init(el) {
  container = el;
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  config = sanitiseConfig(stored[STORAGE_KEY]);
  render();
  wire();
  return cleanup;
}

export function cleanup() {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (container && onClick) container.removeEventListener('click', onClick);
  if (container && onInput) container.removeEventListener('input', onInput);
  if (container && onChange) container.removeEventListener('change', onChange);
  onClick = onInput = onChange = null;
  container = null;
}
