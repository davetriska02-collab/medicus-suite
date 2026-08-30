// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Note companion (side-panel / pop-out).
//
// Configure the TV display: profiles, flap, tiles, busy numbers, and the
// words on the board. Live figures stay on the kiosk page.

'use strict';

import { openBoardTab } from '../../../board/board-open.js';
import {
  STORAGE_KEY,
  WIDGET_META,
  PUBLIC_WIDGETS,
  DEFAULT_COPY,
  BOARD_STYLES,
  BOARD_COLOURS,
  MAX_COPY_CHARS,
  MAX_CUSTOM_PROFILES,
  MAX_PROFILE_NAME,
  SHIPPED_PROFILE_IDS,
  sanitiseConfig,
  sanitiseMessage,
  sanitiseThresholds,
  sanitiseCopy,
  isCustomProfileId,
  newCustomProfile,
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
  return `Open ${profile.name} on a TV tab`;
}

function persist() {
  config = sanitiseConfig(config);
  chrome.storage.local.set({ [STORAGE_KEY]: config });
}

function persistSoon() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(persist, 200);
}

function lineField(key, label) {
  const val = config.copy[key] || DEFAULT_COPY[key] || '';
  return `<label class="note-mod-line">
    <span>${esc(label)}</span>
    <input type="text" data-copy="${esc(key)}" maxlength="${MAX_COPY_CHARS}" value="${esc(val)}" />
  </label>`;
}

function customCount() {
  return config.profiles.filter((p) => isCustomProfileId(p.id)).length;
}

function render() {
  if (!container) return;
  const p = activeProfile();
  const msg = p.message || '';
  const publicLock = p.audience === 'public';
  const custom = isCustomProfileId(p.id);
  const canAdd = customCount() < MAX_CUSTOM_PROFILES;

  container.innerHTML = `
    <div class="note-mod">
      <header class="note-mod-head">
        <div>
          <div class="note-mod-title">Note</div>
          <p class="note-mod-sub">Your boards. Your words. Public TVs still never show patient names.</p>
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
        <h2 class="note-mod-h">Style of the board</h2>
        <p class="note-mod-th-lead">Ten different layouts. Standard is the split-flap board; the others change the type and the room.</p>
        <div class="note-mod-styles" role="radiogroup" aria-label="Board style">
          ${BOARD_STYLES.map((style) => {
            const on = style.id === config.styleId;
            return `<button type="button" class="note-mod-style${on ? ' is-on' : ''}" data-look="${esc(style.id)}" role="radio" aria-checked="${on ? 'true' : 'false'}">
              <span class="note-mod-style-mark" data-kind="${esc(style.id)}" aria-hidden="true"></span>
              <span class="note-mod-style-name">${esc(style.name)}</span>
              <span class="note-mod-style-blurb">${esc(style.blurb)}</span>
            </button>`;
          }).join('')}
        </div>
      </section>
      ${
        config.styleId === 'standard'
          ? `<section class="note-mod-card">
        <h2 class="note-mod-h">Colour of Standard</h2>
        <p class="note-mod-th-lead">These only apply to Standard. The other styles bring their own paint.</p>
        <div class="note-mod-styles" role="radiogroup" aria-label="Standard colour">
          ${BOARD_COLOURS.map((colour) => {
            const on = colour.id === config.colourId;
            return `<button type="button" class="note-mod-style${on ? ' is-on' : ''}" data-colour="${esc(colour.id)}" role="radio" aria-checked="${on ? 'true' : 'false'}">
              <span class="note-mod-style-swatches" aria-hidden="true" style="--s0:${esc(colour.swatches[0])};--s1:${esc(colour.swatches[1])};--s2:${esc(colour.swatches[2])}">
                <i></i><i></i><i></i>
              </span>
              <span class="note-mod-style-name">${esc(colour.name)}</span>
              <span class="note-mod-style-blurb">${esc(colour.blurb)}</span>
            </button>`;
          }).join('')}
        </div>
      </section>`
          : ''
      }

      <section class="note-mod-card">
        <h2 class="note-mod-h">Boards</h2>
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
        <label class="note-mod-line">
          <span>Board name</span>
          <input type="text" id="noteModName" maxlength="${MAX_PROFILE_NAME}" value="${esc(p.name)}" />
        </label>
        <div class="note-mod-add">
          <button type="button" class="note-mod-btn" data-add="public" ${canAdd ? '' : 'disabled'}>Add a public board</button>
          <button type="button" class="note-mod-btn" data-add="staff" ${canAdd ? '' : 'disabled'}>Add a staff board</button>
        </div>
        ${
          custom
            ? `<button type="button" class="note-mod-btn note-mod-btn-remove" data-remove="${esc(p.id)}">Remove this board</button>`
            : `<p class="note-mod-th-lead">The three shipped boards stay. You can rename them.</p>`
        }
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
        <p class="note-mod-th-lead">These numbers are yours. They apply to every board.</p>
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
        <label class="note-mod-check">
          <input type="checkbox" id="noteModPublicDemand" ${config.publicCountsRequests ? 'checked' : ''} />
          <span>Public TVs also count today's requests when judging busy</span>
        </label>
        <p class="note-mod-th-lead">Staff board request pile (always used on staff boards).</p>
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
        <h2 class="note-mod-h">Words on the board</h2>
        <p class="note-mod-th-lead">Use {n} where a number should go. Do not type patient names.</p>
        ${lineField('waitingLabel', 'People-waiting tile')}
        ${lineField('tempoLabelPublic', 'Public busy tile')}
        ${lineField('tempoLabelStaff', 'Staff busy tile')}
        ${lineField('tempoPublicQuiet', 'Public: quiet')}
        ${lineField('tempoPublicSteady', 'Public: normal')}
        ${lineField('tempoPublicBusy', 'Public: busy')}
        ${lineField('tempoPublicVery', 'Public: very busy')}
        ${lineField('tempoStaffQuiet', 'Staff: quiet')}
        ${lineField('tempoStaffSteady', 'Staff: steady')}
        ${lineField('tempoStaffBusy', 'Staff: busy')}
        ${lineField('tempoStaffVery', 'Staff: very busy')}
        ${lineField('tempoSubQuiet', 'Public quiet line')}
        ${lineField('tempoSubSteady', 'Public normal line')}
        ${lineField('tempoSubBusy', 'Public busy line')}
        ${lineField('tempoSubVery', 'Public very-busy line')}
        ${lineField('tempoSubStaff', 'Staff busy line')}
        ${lineField('waitUnder', 'Waits under {n}')}
        ${lineField('waitOver', 'Waits over {n}')}
        ${lineField('waitEmpty', 'Nobody waiting')}
        ${lineField('waitUnknown', 'Waiting, no time yet')}
        ${lineField('demandLabel', 'Requests tile')}
        ${lineField('pressureLabel', 'Pressure tile')}
        ${lineField('pressureSub', 'Pressure line')}
        ${lineField('triageLabel', 'Triage tile')}
        ${lineField('slotsLabel', 'Slots tile')}
        ${lineField('urgentLabel', 'Urgent tile')}
        ${lineField('activityLabel', 'Activity tile')}
        ${lineField('tickerRoomLead', 'Public ticker lead')}
        ${lineField('tickerPracticeLead', 'Staff ticker lead')}
        ${lineField('tickerWaitingOne', 'Ticker: one person')}
        ${lineField('tickerWaitingMany', 'Ticker: {n} people')}
        ${lineField('failTitle', 'Dead board title')}
        ${lineField('failAsk', 'Dead board ask')}
        ${lineField('failBody', 'Dead board body')}
        ${lineField('failBanner', 'Staff fail banner')}
        ${lineField('emptyBoard', 'Empty board')}
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
            ? `<strong>Public display.</strong> You own the boards, the tiles, the numbers and the words. Waiting-room and any public board still never show patient names, initials, or request wording. ${PUBLIC_WIDGETS.length} widgets are allowed; staff-only tiles stay locked off.`
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
          `${prof.name} is a staff display. It shows the triage inbox and pressure figures. Do not put this tab on the waiting-room TV.\n\nOpen it anyway?`
        );
        if (!ok) return;
      }
      openBoardTab(id);
      return;
    }
    const add = e.target.closest('[data-add]');
    if (add) {
      if (customCount() >= MAX_CUSTOM_PROFILES) return;
      const next = newCustomProfile(add.getAttribute('data-add'));
      config.profiles.push(next);
      config.activeProfileId = next.id;
      persist();
      render();
      return;
    }
    const remove = e.target.closest('[data-remove]');
    if (remove) {
      const id = remove.getAttribute('data-remove');
      if (!isCustomProfileId(id)) return;
      if (!window.confirm('Remove this board? The three shipped boards stay.')) return;
      config.profiles = config.profiles.filter((x) => x.id !== id);
      config.activeProfileId = SHIPPED_PROFILE_IDS[0];
      persist();
      render();
      return;
    }
    const look = e.target.closest('[data-look]');
    if (look) {
      config.styleId = look.getAttribute('data-look');
      persist();
      render();
      return;
    }
    const colour = e.target.closest('[data-colour]');
    if (colour) {
      config.colourId = colour.getAttribute('data-colour');
      persist();
      render();
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
      return;
    }
    if (e.target.id === 'noteModName') {
      const p = activeProfile();
      p.name = sanitiseMessage(e.target.value).slice(0, MAX_PROFILE_NAME);
      persistSoon();
      return;
    }
    const copyKey = e.target.getAttribute && e.target.getAttribute('data-copy');
    if (copyKey) {
      config.copy = sanitiseCopy({ ...config.copy, [copyKey]: e.target.value });
      persistSoon();
    }
  };
  onChange = (e) => {
    if (e.target.id === 'noteModPoll') {
      config.pollSeconds = Number(e.target.value);
      persist();
      return;
    }
    if (e.target.id === 'noteModPublicDemand') {
      config.publicCountsRequests = e.target.checked;
      persist();
      return;
    }
    const th = e.target.getAttribute && e.target.getAttribute('data-th');
    if (th) {
      config.thresholds = sanitiseThresholds({ ...config.thresholds, [th]: e.target.value });
      persist();
      render();
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
