// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — dest-set strip HTML for allocation canvases.
// Pure string builder. Canvases bind clicks on the ms-ags-* ids.

'use strict';

(function (global) {
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatDMmm(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return '';
    return String(parseInt(m[3], 10)) + ' ' + (MONTHS[parseInt(m[2], 10) - 1] || '');
  }

  function workingTodayChipLabel(state) {
    state = state || {};
    var n = state.inTodayCount;
    var count = n ? ' (' + n + ')' : '';
    var work = state.workDateISO || '';
    var cal = state.calendarTodayISO || '';
    if (work && cal && work !== cal) {
      var d = formatDMmm(work);
      if (d) return 'Working ' + d + count;
    }
    return 'Working today' + count;
  }

  function workingFlagLabel(state) {
    state = state || {};
    var work = state.workDateISO || '';
    var cal = state.calendarTodayISO || '';
    if (work && cal && work !== cal) {
      var d = formatDMmm(work);
      if (d) return 'Working ' + d;
    }
    return 'Working today';
  }

  function evenSplitDistributionPhrase(itemCount, destCount, noun) {
    var n = Number(itemCount) || 0;
    var k = Number(destCount) || 0;
    var word = noun || 'items';
    if (k <= 0) return '';
    var people = k === 1 ? '1 person' : k + ' people';
    var head = n + ' ' + word + ' would sit with ' + people;
    if (n <= 0) return head + '.';
    var base = Math.floor(n / k);
    var rem = n % k;
    if (rem === 0) return head + ': ' + base + ' each.';
    if (base === 0) return head + ': ' + rem + ' with 1, ' + (k - rem) + ' with none.';
    return head + ': ' + rem + ' with ' + (base + 1) + ', ' + (k - rem) + ' with ' + base + '.';
  }

  function chipPressed(on) {
    return on ? ' aria-pressed="true"' : ' aria-pressed="false"';
  }

  function chipMark(on) {
    return on ? '✓ ' : '';
  }

  function saveGroupRowHtml() {
    return (
      '<div class="ms-ags-save-row" id="ms-ags-save-row">' +
      '<label for="ms-ags-save-name">Group name</label>' +
      '<input type="text" id="ms-ags-save-name" maxlength="48" placeholder="e.g. Morning triage" aria-label="Group name">' +
      '<button type="button" class="ms-lac-confirm-btn" id="ms-ags-save-go">Save group</button>' +
      '<button type="button" class="ms-lac-ghost" id="ms-ags-save-cancel">Keep planning</button>' +
      '</div>'
    );
  }

  function destSetStripHtml(state) {
    state = state || {};
    var kind = state.destKind || 'in-today';
    var groupId = state.destGroupId || '';
    var groups = Array.isArray(state.visibleGroups) ? state.visibleGroups : [];
    var todayLabel = workingTodayChipLabel(state);
    var chips = [];
    var inOn = kind === 'in-today';
    chips.push(
      '<button type="button" class="ms-ags-chip' +
        (inOn ? ' ms-ags-chip-on' : '') +
        '" id="ms-ags-in-today"' +
        chipPressed(inOn) +
        ' title="Everyone with a session on the appointment book for that day">' +
        chipMark(inOn) +
        esc(todayLabel) +
        '</button>'
    );
    groups.forEach(function (g) {
      if (!g || !g.id) return;
      var on = kind === 'group' && g.id === groupId;
      chips.push(
        '<button type="button" class="ms-ags-chip' +
          (on ? ' ms-ags-chip-on' : '') +
          '" data-ags-group="' +
          esc(g.id) +
          '"' +
          chipPressed(on) +
          ' title="Split onto the people in this group.">' +
          chipMark(on) +
          esc(g.name) +
          (Array.isArray(g.memberIds) && g.memberIds.length ? ' (' + g.memberIds.length + ')' : '') +
          '</button>'
      );
    });
    var customOn = kind === 'custom';
    chips.push(
      '<button type="button" class="ms-ags-well' +
        (customOn ? ' ms-ags-well-on' : '') +
        '" id="ms-ags-new-group"' +
        chipPressed(customOn) +
        ' title="Drag a person onto this, or draw a box around names on the board.">' +
        chipMark(customOn) +
        'New group</button>'
    );
    chips.push(
      '<button type="button" class="ms-ags-chip" id="ms-ags-all" title="Every saved group, including ones outside their hours. Pick, rename, set hours or delete.">All groups…</button>'
    );
    var destLine = state.destPhrase ? '<div class="ms-ags-to">To: ' + esc(state.destPhrase) + '</div>' : '';
    var skip = state.skippedPhrase
      ? '<div class="ms-ags-skip" role="status">' + esc(state.skippedPhrase) + '</div>'
      : '';
    var save = state.canSave
      ? '<button type="button" class="ms-lac-ghost" id="ms-ags-save">Save as group…</button>'
      : '';
    var scheduleHint = state.scheduleHint
      ? '<div class="ms-ags-hint" role="status">' + esc(state.scheduleHint) + '</div>'
      : '';
    var newGroupHint = customOn
      ? '<div class="ms-ags-hint" role="status">Drag a person\'s name onto New group, or draw a box around names on the board, then Save as group.</div>'
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
      scheduleHint +
      newGroupHint +
      '</div>'
    );
  }

  function splitActionsHtml(state) {
    state = state || {};
    var destPhrase = state.destPhrase || '';
    var poolN = state.poolN || 0;
    var haveWork = !!state.haveWork;
    var dests = state.destCount || 0;
    var stagedN = state.stagedN || 0;
    var noun = state.surfaceNoun || 'items';
    var actions = '';
    if (state.collisionPhrase) {
      actions = '<span class="ms-lac-split-note">' + esc(state.collisionPhrase) + '</span>';
    } else if (!dests) {
      actions = '<span class="ms-lac-split-note">Pick Working today, a group, or encircle people.</span>';
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
    var dist = stagedN && dests ? evenSplitDistributionPhrase(stagedN, dests, noun) : '';
    var proposal = stagedN
      ? '<div class="ms-rxac-proposal" role="status"><strong>Proposal, not written yet.</strong> ' +
        esc(dist || stagedN + ' ' + noun + ' would sit with ' + dests + ' people.') +
        ' <span class="ms-rxac-drag-hint">Drag a patient from one person onto another to change who gets them.</span></div>'
      : '';
    return '<div class="ms-ags-actions">' + actions + '</div>' + proposal;
  }

  var api = {
    destSetStripHtml: destSetStripHtml,
    splitActionsHtml: splitActionsHtml,
    saveGroupRowHtml: saveGroupRowHtml,
    workingTodayChipLabel: workingTodayChipLabel,
    workingFlagLabel: workingFlagLabel,
    evenSplitDistributionPhrase: evenSplitDistributionPhrase,
    formatDMmm: formatDMmm,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) global.AllocationDestStrip = api;
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
