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

  function destFlagLabel(state) {
    state = state || {};
    if (state.destKind === 'group') {
      var groupName = String(state.destGroupName || '').trim();
      if (groupName) return groupName;
    }
    return workingFlagLabel(state);
  }

  var DAY_SHORT = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };

  function padHm(s) {
    var m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(s || '').trim());
    if (!m) return '';
    var h = m[1].length === 1 ? '0' + m[1] : m[1];
    return h + ':' + m[2];
  }

  function scheduleHoursLabel(schedule) {
    if (!schedule) return '';
    var start = padHm(schedule.start);
    var end = padHm(schedule.end);
    if (!start || !end) return '';
    return start + '\u2013' + end;
  }

  function groupChipLabel(group) {
    group = group || {};
    var name = String(group.name || '').trim();
    var n = Array.isArray(group.memberIds) ? group.memberIds.length : 0;
    var hours = scheduleHoursLabel(group.schedule);
    var label = name;
    if (n) label += ' (' + n + ')';
    if (hours) label += ' \u00b7 ' + hours;
    return label;
  }

  function groupChipTitle(group) {
    group = group || {};
    var days = group.schedule && Array.isArray(group.schedule.days) ? group.schedule.days : [];
    var dayBits = [];
    days.forEach(function (d) {
      var short = DAY_SHORT[d] || '';
      if (short) dayBits.push(short);
    });
    var when = dayBits.length ? dayBits.join(', ') + '. ' : '';
    return when + 'Split onto the people in this group.';
  }

  function destTitleJoin(names) {
    if (!Array.isArray(names) || !names.length) return '';
    if (names.length === 1) return names[0];
    if (names.length === 2) return names[0] + ' and ' + names[1];
    return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  }

  function destTitleText(entry) {
    if (typeof entry === 'string') return entry.trim();
    if (entry && typeof entry === 'object') {
      if (typeof entry.title === 'string' && entry.title.trim()) return entry.title.trim();
      if (typeof entry.name === 'string' && entry.name.trim()) return entry.name.trim();
    }
    return '';
  }

  function destTitlesAreCountRows(destTitles) {
    if (!Array.isArray(destTitles) || !destTitles.length) return false;
    var first = destTitles[0];
    return !!(first && typeof first === 'object' && (typeof first.count === 'number' || first.title || first.name));
  }

  function smallerPileNames(destTitles, destCount, rem, smallerCount) {
    if (!Array.isArray(destTitles) || !destTitles.length) return '';
    var names = [];
    var i;
    if (destTitlesAreCountRows(destTitles)) {
      for (i = 0; i < destTitles.length; i++) {
        var row = destTitles[i];
        if (!row) continue;
        var c = Number(row.count);
        var title = destTitleText(row);
        if (c === smallerCount && title) names.push(title);
      }
      return destTitleJoin(names);
    }
    if (destTitles.length < destCount) return '';
    for (i = rem; i < destCount; i++) {
      var s = destTitleText(destTitles[i]);
      if (!s) return '';
      names.push(s);
    }
    return destTitleJoin(names);
  }

  function evenSplitDistributionPhrase(itemCount, destCount, noun, destTitles) {
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
    var highN = rem;
    var highCount = base === 0 ? 1 : base + 1;
    var smallerPeople = k - rem;
    var smallerCount = base;
    var highBit = highN + ' with ' + highCount;
    var named = smallerPileNames(destTitles, k, rem, smallerCount);
    var lowBit = named
      ? named + ' with ' + (smallerCount === 0 ? 'none' : smallerCount)
      : smallerPeople + ' with ' + (smallerCount === 0 ? 'none' : smallerCount);
    return head + ': ' + highBit + ', ' + lowBit + '.';
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
          ' title="' +
          esc(groupChipTitle(g)) +
          '">' +
          chipMark(on) +
          esc(groupChipLabel(g)) +
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
      var emptyBook = (state.destKind || 'in-today') === 'in-today' && state.inTodayCount === 0;
      actions = emptyBook
        ? '<span class="ms-lac-split-note">No one is on the book for this day. Type a name below to add them, or pick a saved group.</span>'
        : '<span class="ms-lac-split-note">Pick Working today, a group, or encircle people.</span>';
    } else if (poolN && !haveWork) {
      actions =
        '<button type="button" class="ms-lac-confirm-btn ms-lac-primary ms-ags-split" id="ms-ags-split" title="Split the unallocated pile evenly. Proposal only — nothing is written until you confirm.">Split equally</button>';
    } else if (poolN && haveWork) {
      actions =
        '<button type="button" class="ms-lac-confirm-btn ms-lac-primary ms-ags-split" id="ms-ags-topup" title="Give leftover unallocated work to whoever currently has least. Does not move sitting work. Proposal only.">Top up empty boxes</button>' +
        '<button type="button" class="ms-lac-confirm-btn ms-ags-split" id="ms-ags-level" title="Split equally again so each has the same number, or as near as it can be. Moves sitting work on this canvas. Proposal only.">Split equally</button>';
    } else if (haveWork) {
      actions =
        '<button type="button" class="ms-lac-confirm-btn ms-ags-split" id="ms-ags-level" title="Split equally again. Proposal only.">Split equally</button>';
    } else {
      actions =
        '<span class="ms-lac-split-note">Inbox is clear. Share this box on a person splits only that folder among the current destinations.</span>';
    }
    var dist = stagedN && dests ? evenSplitDistributionPhrase(stagedN, dests, noun, state.destTitles) : '';
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
    destFlagLabel: destFlagLabel,
    groupChipLabel: groupChipLabel,
    groupChipTitle: groupChipTitle,
    scheduleHoursLabel: scheduleHoursLabel,
    evenSplitDistributionPhrase: evenSplitDistributionPhrase,
    formatDMmm: formatDMmm,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) global.AllocationDestStrip = api;
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
