// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — dest-set strip HTML for allocation canvases.
// Pure string builder. Canvases bind clicks on the ms-ags-* ids.

'use strict';

(function (global) {
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function destSetStripHtml(state) {
    state = state || {};
    var kind = state.destKind || 'in-today';
    var groupId = state.destGroupId || '';
    var groups = Array.isArray(state.visibleGroups) ? state.visibleGroups : [];
    var chips = [];
    chips.push(
      '<button type="button" class="ms-ags-chip' +
        (kind === 'in-today' ? ' ms-ags-chip-on' : '') +
        '" id="ms-ags-in-today" title="People with a session on the appointment book for the working day.">In today' +
        (state.inTodayCount ? ' (' + state.inTodayCount + ')' : '') +
        '</button>'
    );
    groups.forEach(function (g) {
      if (!g || !g.id) return;
      chips.push(
        '<button type="button" class="ms-ags-chip' +
          (kind === 'group' && g.id === groupId ? ' ms-ags-chip-on' : '') +
          '" data-ags-group="' +
          esc(g.id) +
          '" title="Split onto the people in this group.">' +
          esc(g.name) +
          (Array.isArray(g.memberIds) && g.memberIds.length ? ' (' + g.memberIds.length + ')' : '') +
          '</button>'
      );
    });
    chips.push(
      '<span class="ms-ags-well' +
        (kind === 'custom' ? ' ms-ags-well-on' : '') +
        '" id="ms-ags-new-group" title="Encircle or drag people here to make a group.">New group</span>'
    );
    chips.push(
      '<button type="button" class="ms-ags-chip" id="ms-ags-all" title="Every saved group, including those outside their days and times.">All groups…</button>'
    );
    var destLine = state.destPhrase
      ? '<div class="ms-ags-to">To: ' + esc(state.destPhrase) + '</div>'
      : '';
    var skip = state.skippedPhrase
      ? '<div class="ms-ags-skip" role="status">' + esc(state.skippedPhrase) + '</div>'
      : '';
    var save = state.canSave
      ? '<button type="button" class="ms-lac-ghost" id="ms-ags-save">Save as group…</button>'
      : '';
    return (
      '<div class="ms-ags-strip" id="ms-ags-strip">' +
      '<div class="ms-ags-label">Share out to</div>' +
      '<div class="ms-ags-chips">' +
      chips.join('') +
      save +
      '</div>' +
      destLine +
      skip +
      '</div>'
    );
  }

  function splitActionsHtml(state) {
    state = state || {};
    var destPhrase = state.destPhrase || '';
    var phrase = state.dayPhrase || 'today';
    var poolN = state.poolN || 0;
    var haveWork = !!state.haveWork;
    var dests = state.destCount || 0;
    var stagedN = state.stagedN || 0;
    var noun = state.surfaceNoun || 'items';
    var actions = '';
    if (state.collisionPhrase) {
      actions = '<span class="ms-lac-split-note">' + esc(state.collisionPhrase) + '</span>';
    } else if (!dests) {
      actions =
        '<span class="ms-lac-split-note">Pick In today, a group, or encircle people.</span>';
    } else if (poolN && !haveWork) {
      actions =
        '<button type="button" class="ms-lac-confirm-btn ms-lac-primary ms-ags-split" id="ms-ags-split" title="Split the unallocated pile evenly. Proposal only — nothing is written until you confirm.">Split equally</button>';
    } else if (poolN && haveWork) {
      actions =
        '<button type="button" class="ms-lac-confirm-btn ms-lac-primary ms-ags-split" id="ms-ags-topup" title="Give leftover unallocated work to whoever currently has least. Does not move sitting work. Proposal only.">Top up empty boxes</button>' +
        '<button type="button" class="ms-lac-confirm-btn ms-ags-split" id="ms-ags-level" title="Rebalance so each has the same number, or as near as it can be. Moves sitting work on this canvas. Proposal only.">Distribute equally</button>';
    } else if (haveWork) {
      actions =
        '<button type="button" class="ms-lac-confirm-btn ms-ags-split" id="ms-ags-level" title="Rebalance sitting work. Proposal only.">Distribute equally</button>';
    } else {
      actions =
        '<span class="ms-lac-split-note">Inbox is clear. Share this box on a person splits only that folder among the current destinations.</span>';
    }
    var proposal = stagedN
      ? '<div class="ms-rxac-proposal" role="status"><strong>Proposal — not written yet.</strong> ' +
        stagedN +
        ' ' +
        noun +
        ' would move among ' +
        esc(destPhrase) +
        '. <span class="ms-rxac-drag-hint">Drag a patient from one person onto another to change who gets them.</span></div>'
      : '';
    return (
      '<div class="ms-ags-actions">' +
      actions +
      '</div>' +
      proposal
    );
  }

  var api = {
    destSetStripHtml: destSetStripHtml,
    splitActionsHtml: splitActionsHtml,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) global.AllocationDestStrip = api;
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
