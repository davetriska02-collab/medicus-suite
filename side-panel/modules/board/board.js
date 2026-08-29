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
  sanitiseThresholds,
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

function openerLabel(profile) {
  if (profile.audience === 'staff') return 'Open the staff board on a TV tab';
  if (profile.id === 'message') return 'Open the message board on a TV tab';
  return 'Open the waiting-room board on a TV tab';
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
          <p class="note-mod-sub">A display board for TVs and monitors. Waiting room, a message board, or a staff ops overview.</p>
        </div>
      </header>

      <div class="note-mod-actions">
        <button type="button" class="note-mod-btn ${publicLock ? 'note-mod-btn-primary' : 'note-mod-btn-staff'}" data-open="${esc(p.id)}">${esc(
          openerLabel(p)
        )}</button>
      </div>
      <p class="note-mod-hint">${
        publicLock
          ? 'Use the computer that is already plugged into the TV. Open this there, then press Fullscreen (or F). The tab will not jump to the TV by itself.'
          : 'You will be asked to confirm. Do not put this on the waiting-room TV. Use the computer already plugged into that screen, then press Fullscreen (or F).'
      }</p>

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
        <div class="note-mod-meta">
          <span id="noteModCount">${msg.length}</span> / ${MAX_MESSAGE_CHARS}
          <span class="note-mod-warn">${
            publicLock
              ? 'Do not type patient names. This text goes on a public TV.'
              : 'Do not type patient names. This text goes on the staff-room board.'
          }</span>
        </div>
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
        <h2 class="note-mod-h">When this room looks busy</h2>
        <p class="note-mod-th-lead">These numbers are yours. They apply to every profile.</p>
        <label class="note-mod-th">
          Most waits under
          <input type="number" data-th="amberWaitMin" min="1" max="180" step="1" value="${esc(config.thresholds.amberWaitMin)}" />
          minutes
        </label>
        <label class="note-mod-th">
          Some waits over
          <input type="number" data-th="redWaitMin" min="2" max="240" step="1" value="${esc(config.thresholds.redWaitMin)}" />
          minutes
        </label>
        <label class="note-mod-th">
          Busy at
          <input type="number" data-th="busyWaiting" min="1" max="40" step="1" value="${esc(config.thresholds.busyWaiting)}" />
          people waiting
        </label>
        <label class="note-mod-th">
          Very busy at
          <input type="number" data-th="veryBusyWaiting" min="2" max="80" step="1" value="${esc(config.thresholds.veryBusyWaiting)}" />
          people waiting
        </label>
        <p class="note-mod-th-lead">Staff board only. Public TVs ignore today's request pile.</p>
        <label class="note-mod-th">
          Busy at
          <input type="number" data-th="busyDemand" min="1" max="200" step="1" value="${esc(config.thresholds.busyDemand)}" />
          requests today
        </label>
        <label class="note-mod-th">
          Very busy at
          <input type="number" data-th="veryBusyDemand" min="2" max="400" step="1" value="${esc(config.thresholds.veryBusyDemand)}" />
          requests today
        </label>
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
            ? `<strong>Public display.</strong> You pick the tiles, the flap text, and when the room reads busy. Waiting-room and Message profiles still never show patient names, initials, or request wording. ${PUBLIC_WIDGETS.length} widgets are allowed; staff-only tiles are locked off.`
            : `<strong>Staff display.</strong> No patient names. Keep this off the waiting-room TV. It shows the triage inbox and pressure figures patients should not see.`
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
      const id = open.getAttribute('data-open');
      const prof = config.profiles.find((x) => x.id === id);
      if (prof && prof.audience === 'staff') {
        const ok = window.confirm(
          'Ops is a staff display. It shows the triage inbox and pressure figures. Do not put this tab on the waiting-room TV.\n\nOpen Ops anyway?'
        );
        if (!ok) return;
      }
      openBoardTab(id);
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
    const th = e.target.getAttribute && e.target.getAttribute('data-th');
    if (th) {
      config.thresholds = sanitiseThresholds({ ...config.thresholds, [th]: e.target.value });
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
