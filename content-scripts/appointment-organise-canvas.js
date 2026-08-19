// © 2026 Graysbrook Ltd. Proprietary — all rights reserved.
// Medicus Suite — appointment organise canvas (v1)
//
// Overlay on the Medicus appointment-book route. Columns are diaries, tiles
// are booked appointments, gaps are free slots, Cancel is a bin. Drag stages;
// Finalise writes. Same-list and cross-list moves are captured; extend is not.
// The canvas owns no raw fetch — window.AppointmentOrganiseCore does.
'use strict';

(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__msAppointmentOrganiseCanvas) return;
  window.__msAppointmentOrganiseCanvas = true;

  var C = window.AppointmentOrganiseCore;
  if (!C) return;

  var OVERLAY_ID = 'ms-aoc-overlay';
  var LAUNCH_ID = 'ms-aoc-launch';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function hhmm(dt) {
    var s = String(dt || '');
    return s.length >= 16 ? s.slice(11, 16) : s;
  }

  var _route = null;
  var _board = null;
  var _draft = C.emptyDraft();
  var _pending = null;
  var _error = null;
  var _loading = false;
  var _drag = null;
  var _open = false;
  var _booking = null;
  var _bookingWait = null;

  function announce(text) {
    var live = document.querySelector('#' + OVERLAY_ID + ' .ms-aoc-live');
    if (live) live.textContent = text || '';
  }

  function currentRoute() {
    return C.parseBookRoute(location.pathname, location.search);
  }

  function ensureBooking() {
    if (_booking) return Promise.resolve(_booking);
    if (_bookingWait) return _bookingWait;
    if (window.BookingCore) {
      _booking = window.BookingCore;
      return Promise.resolve(_booking);
    }
    _bookingWait = import(chrome.runtime.getURL('shared/booking-core.js'))
      .then(function (mod) {
        _booking = mod.default || mod;
        return _booking;
      })
      .catch(function (err) {
        _bookingWait = null;
        throw err;
      });
    return _bookingWait;
  }

  function client() {
    if (!_route) throw new Error('appointment-organise: no book route');
    if (!_booking) throw new Error('appointment-organise: booking-core reserve/create/release required');
    return C.createClient(_route.apiBase, { booking: _booking });
  }

  async function loadBoard() {
    _loading = true;
    _error = null;
    render();
    try {
      await ensureBooking();
      _board = await client().fetchBoard(_route.date);
    } catch (err) {
      _error = err && err.message ? err.message : 'Could not read the appointment book.';
      _board = { date: _route.date, columns: [] };
    } finally {
      _loading = false;
      render();
    }
  }

  function visualBoard() {
    return C.applyDraftToBoard(_board || { columns: [] }, _draft);
  }

  function tileHtml(appt, opts) {
    opts = opts || {};
    var locked = !!(appt.locked || appt.arrived);
    var staged = !!opts.staged;
    var cls =
      'ms-aoc-tile' +
      (locked ? ' ms-aoc-tile-locked' : '') +
      (staged ? ' ms-aoc-tile-staged' : '');
    return (
      '<div class="' +
      cls +
      '"' +
      (locked ? '' : ' draggable="true"') +
      ' data-appt-id="' +
      esc(appt.id) +
      '">' +
      '<div class="ms-aoc-tile-name">' +
      esc(hhmm(appt.startDateTime) + ' · ' + appt.patientName) +
      '</div>' +
      '<div class="ms-aoc-tile-meta">' +
      esc((appt.appointmentTypeName || 'Appointment') + (appt.duration ? ' · ' + appt.duration + ' min' : '')) +
      '</div>' +
      (locked ? '<div class="ms-aoc-tile-lock">Locked — arrived / in progress</div>' : '') +
      (staged ? '<div class="ms-aoc-tile-draft">Not written</div>' : '') +
      (!locked && !opts.inBin
        ? '<button type="button" class="ms-aoc-tile-cancel" data-cancel-id="' +
          esc(appt.id) +
          '">Cancel</button>'
        : '') +
      '</div>'
    );
  }

  function slotHtml(slot) {
    return (
      '<div class="ms-aoc-slot" data-slot="1" data-diary-id="' +
      esc(slot.diaryId) +
      '" data-start="' +
      esc(slot.startDateTime) +
      '" data-duration="' +
      esc(String(slot.duration || 0)) +
      '" data-staff="' +
      esc(slot.staffName || '') +
      '">' +
      esc(hhmm(slot.startDateTime) || 'Free') +
      ' free</div>'
    );
  }

  function confirmBarHtml() {
    if (_error && (!_pending || _pending.kind !== 'finalise')) {
      return (
        '<div class="ms-aoc-confirmbar ms-aoc-confirmbar-error">' +
        esc(_error) +
        ' <button type="button" class="ms-aoc-ghost" id="ms-aoc-error-dismiss">Dismiss</button></div>'
      );
    }
    if (!_pending) return '';
    if (_pending.kind === 'abandon') {
      return (
        '<div class="ms-aoc-confirmbar">You have <strong>' +
        (_pending.count || 0) +
        '</strong> unwritten staged action' +
        ((_pending.count || 0) === 1 ? '' : 's') +
        '. Discard them and close?' +
        '<div class="ms-aoc-confirmbar-actions">' +
        '<button type="button" class="ms-aoc-cancel" id="ms-aoc-action-cancel">Keep organising</button>' +
        '<button type="button" class="ms-aoc-confirm-btn" id="ms-aoc-action-confirm">Discard and close</button>' +
        '</div></div>'
      );
    }
    if (_pending.kind === 'finalise') {
      var s = _pending.summary || { items: [], count: 0 };
      var rows = s.items
        .map(function (item) {
          var reason =
            item.kind === 'cancel'
              ? '<input type="text" class="ms-aoc-finalise-reason" data-cancel-reason="' +
                esc(item.id) +
                '" value="' +
                esc(item.reason || '') +
                '" placeholder="Cancellation reason (required)">'
              : '';
          return (
            '<label class="ms-aoc-finalise-row">' +
            '<input type="checkbox" class="ms-aoc-finalise-inc" data-item-id="' +
            esc(item.id) +
            '"' +
            (item.included ? ' checked' : '') +
            '>' +
            '<span class="ms-aoc-finalise-desc">' +
            esc(item.text) +
            '</span>' +
            reason +
            '</label>'
          );
        })
        .join('');
      var missingReason = s.items.some(function (i) {
        return i.included && i.kind === 'cancel' && !String(i.reason || '').trim();
      });
      return (
        '<div class="ms-aoc-confirmbar">' +
        'This writes the ticked actions through Medicus’s own cancel / reschedule forms. ' +
        'Send-to is off — no SMS or email. Extend is not available. ' +
        'There is no canvas undo. Tick only what you have checked against the book.' +
        '<div class="ms-aoc-finalise-list">' +
        rows +
        '</div>' +
        (_pending.error ? '<div class="ms-aoc-error">' + esc(_pending.error) + '</div>' : '') +
        '<div class="ms-aoc-confirmbar-actions">' +
        '<button type="button" class="ms-aoc-cancel" id="ms-aoc-action-cancel"' +
        (_pending.writing ? ' disabled' : '') +
        '>Keep organising</button>' +
        '<button type="button" class="ms-aoc-confirm-btn" id="ms-aoc-action-confirm"' +
        (_pending.writing || !s.count || missingReason ? ' disabled' : '') +
        '>' +
        (_pending.writing ? 'Writing…' : 'Confirm — write ' + s.count) +
        '</button>' +
        '</div></div>'
      );
    }
    return '';
  }

  function bodyHtml() {
    if (_loading) return '<div class="ms-aoc-msg" style="padding:16px">Reading the appointment book…</div>';
    var visual = visualBoard();
    var cols = (visual.columns || [])
      .map(function (col) {
        var items = [];
        var seen = {};
        (col.appointments || []).forEach(function (a) {
          items.push({ t: a.startDateTime, html: tileHtml(a, { staged: !!a.stagedMove }) });
          seen[a.startDateTime] = true;
        });
        (col.slots || []).forEach(function (s) {
          if (seen[s.startDateTime]) return;
          items.push({ t: s.startDateTime, html: slotHtml(s) });
        });
        items.sort(function (a, b) {
          return String(a.t).localeCompare(String(b.t));
        });
        return (
          '<div class="ms-aoc-col" data-col-diary="' +
          esc(col.diaryId) +
          '" data-staff="' +
          esc(col.staffName) +
          '">' +
          '<h3 class="ms-aoc-col-heading">' +
          esc(col.staffName) +
          '</h3>' +
          '<div class="ms-aoc-col-meta">' +
          esc(hhmm(col.sessionStart) + '–' + hhmm(col.sessionEnd)) +
          '</div>' +
          (items.map(function (i) {
            return i.html;
          }).join('') || '<div class="ms-aoc-empty">No bookings or free slots.</div>') +
          '</div>'
        );
      })
      .join('');
    var cancelled = (_draft.cancelIds || [])
      .map(function (id) {
        var appt = C.findAppointment(_board, id);
        if (!appt) return '';
        return tileHtml(appt, { staged: true, inBin: true });
      })
      .join('');
    return (
      '<div class="ms-aoc-board">' +
      (cols || '<div class="ms-aoc-empty">No diaries on this day.</div>') +
      '</div>' +
      '<aside class="ms-aoc-bin" id="ms-aoc-bin">' +
      '<h3 class="ms-aoc-bin-heading">Cancel</h3>' +
      '<div class="ms-aoc-hint">Drop a booked tile here. Not written until Finalise. Arrived tiles stay locked.</div>' +
      (cancelled || '') +
      '</aside>'
    );
  }

  function render() {
    if (!_open) return;
    var root = document.getElementById(OVERLAY_ID);
    if (!root) return;
    var n = C.summariseDraft(_draft, _board || { columns: [] }).items.length;
    root.innerHTML =
      '<div class="ms-aoc-live" aria-live="polite"></div>' +
      '<div class="ms-aoc-backdrop">' +
      '<div class="ms-aoc-panel" role="dialog" aria-labelledby="ms-aoc-title">' +
      '<header class="ms-aoc-header">' +
      '<h2 class="ms-aoc-title" id="ms-aoc-title">Organise appointments — ' +
      esc((_route && _route.date) || '') +
      '</h2>' +
      '<button type="button" class="ms-aoc-close" id="ms-aoc-close">Close</button>' +
      '</header>' +
      '<div class="ms-aoc-explainer">' +
      'Drag a patient onto a <strong>free slot</strong> (same diary or another) to stage a move, or onto <strong>Cancel</strong>. ' +
      'Nothing is written until you Finalise. Extend is not in the captured contract. ' +
      'Arrived patients stay locked. Medicus will not send SMS or email from this board.' +
      '</div>' +
      '<div class="ms-aoc-body">' +
      bodyHtml() +
      '</div>' +
      confirmBarHtml() +
      '<footer class="ms-aoc-footer">' +
      '<button type="button" class="ms-aoc-ghost" id="ms-aoc-discard"' +
      (n ? '' : ' disabled') +
      '>Discard staged</button>' +
      '<button type="button" class="ms-aoc-finalise" id="ms-aoc-finalise"' +
      (n ? '' : ' disabled') +
      '>Finalise…</button>' +
      '</footer>' +
      '</div></div>';
    bind();
  }

  function readDrag(e) {
    try {
      var raw = e && e.dataTransfer && e.dataTransfer.getData('text/plain');
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.appointmentId) return parsed;
      }
    } catch (_) {}
    return _drag;
  }

  function stageFromDrop(apptId, target) {
    var appt = C.findAppointment(_board, apptId);
    if (!appt) return;
    if (target && target.kind === 'cancel') {
      var cg = C.canStageCancel(appt);
      if (!cg.ok) {
        _error = cg.reason;
        render();
        return;
      }
      _draft = C.stageCancel(_draft, apptId);
      announce('Staged cancel for ' + appt.patientName);
      render();
      return;
    }
    var gate = C.canStageMove(appt, target);
    if (!gate.ok) {
      _error = gate.reason;
      render();
      return;
    }
    _draft = C.stageMove(_draft, apptId, target);
    announce('Staged move for ' + appt.patientName);
    render();
  }

  async function commitFinalise() {
    var summary = C.summariseDraft(_draft, _board || { columns: [] });
    var included = summary.items.filter(function (i) {
      return i.included;
    });
    _pending = { kind: 'finalise', summary: summary, writing: true, error: null };
    render();
    var api = client();
    var failed = null;
    for (var i = 0; i < included.length; i++) {
      var item = included[i];
      var appt = C.findAppointment(_board, item.id);
      try {
        if (item.kind === 'cancel') {
          await api.commitCancel({
            date: _route.date,
            appointmentId: item.id,
            patientId: appt && appt.patientId,
            reason: item.reason,
            pinned: {
              apiBase: _route.apiBase,
              patientId: appt && appt.patientId,
              appointmentId: item.id,
              versionId: appt && appt.versionId,
            },
          });
          _draft = C.unstageCancel(_draft, item.id);
        } else if (item.kind === 'move') {
          var mv = _draft.moves[item.id];
          await api.commitMove({
            date: _route.date,
            appointment: appt,
            target: mv,
            pinned: { apiBase: _route.apiBase },
          });
          _draft = C.unstageMove(_draft, item.id);
        }
        _board = await api.fetchBoard(_route.date);
      } catch (err) {
        failed = (err && err.message) || 'Write failed.';
        break;
      }
    }
    if (failed) {
      _pending = {
        kind: 'finalise',
        summary: C.summariseDraft(_draft, _board || { columns: [] }),
        writing: false,
        error: failed + ' Earlier ticked actions in this list were written; the rest are still staged.',
      };
      render();
      return;
    }
    _pending = null;
    announce('Board written.');
    render();
  }

  function bind() {
    var root = document.getElementById(OVERLAY_ID);
    if (!root) return;

    root.querySelector('#ms-aoc-close')?.addEventListener('click', function () {
      requestClose();
    });
    root.querySelector('#ms-aoc-error-dismiss')?.addEventListener('click', function () {
      _error = null;
      render();
    });
    root.querySelector('#ms-aoc-discard')?.addEventListener('click', function () {
      _draft = C.emptyDraft();
      _pending = null;
      render();
    });
    root.querySelector('#ms-aoc-finalise')?.addEventListener('click', function () {
      _pending = { kind: 'finalise', summary: C.summariseDraft(_draft, _board || { columns: [] }), writing: false };
      render();
    });
    root.querySelector('#ms-aoc-action-cancel')?.addEventListener('click', function () {
      _pending = null;
      render();
    });
    root.querySelector('#ms-aoc-action-confirm')?.addEventListener('click', function () {
      if (!_pending) return;
      if (_pending.kind === 'abandon') {
        _draft = C.emptyDraft();
        closeOverlay();
        return;
      }
      if (_pending.kind === 'finalise') commitFinalise();
    });

    root.querySelectorAll('.ms-aoc-finalise-inc').forEach(function (box) {
      box.addEventListener('change', function () {
        _draft = C.setDraftIncluded(_draft, box.getAttribute('data-item-id'), box.checked);
        _pending = { kind: 'finalise', summary: C.summariseDraft(_draft, _board || { columns: [] }), writing: false };
        render();
      });
    });
    root.querySelectorAll('[data-cancel-reason]').forEach(function (input) {
      input.addEventListener('change', function () {
        _draft = C.setCancelReason(_draft, input.getAttribute('data-cancel-reason'), input.value);
        _pending = { kind: 'finalise', summary: C.summariseDraft(_draft, _board || { columns: [] }), writing: false };
        render();
      });
    });

    root.querySelectorAll('[data-cancel-id]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        stageFromDrop(btn.getAttribute('data-cancel-id'), { kind: 'cancel' });
      });
    });

    root.querySelectorAll('.ms-aoc-tile[draggable="true"]').forEach(function (tile) {
      tile.addEventListener('dragstart', function (e) {
        _drag = { appointmentId: tile.getAttribute('data-appt-id') };
        try {
          e.dataTransfer.setData('text/plain', JSON.stringify(_drag));
          e.dataTransfer.effectAllowed = 'move';
        } catch (_) {}
      });
      tile.addEventListener('dragend', function () {
        _drag = null;
      });
    });

    function markHover(el, on) {
      if (!el) return;
      el.classList.toggle('ms-aoc-drop-hover', on);
    }

    root.querySelectorAll('[data-slot]').forEach(function (slot) {
      slot.addEventListener('dragover', function (e) {
        e.preventDefault();
        markHover(slot, true);
      });
      slot.addEventListener('dragleave', function () {
        markHover(slot, false);
      });
      slot.addEventListener('drop', function (e) {
        e.preventDefault();
        markHover(slot, false);
        var payload = readDrag(e);
        if (!payload) return;
        stageFromDrop(payload.appointmentId, {
          diaryId: slot.getAttribute('data-diary-id'),
          startDateTime: slot.getAttribute('data-start'),
          duration: Number(slot.getAttribute('data-duration')) || 0,
          staffName: slot.getAttribute('data-staff') || '',
        });
      });
    });

    var bin = root.querySelector('#ms-aoc-bin');
    if (bin) {
      bin.addEventListener('dragover', function (e) {
        e.preventDefault();
        markHover(bin, true);
      });
      bin.addEventListener('dragleave', function () {
        markHover(bin, false);
      });
      bin.addEventListener('drop', function (e) {
        e.preventDefault();
        markHover(bin, false);
        var payload = readDrag(e);
        if (!payload) return;
        stageFromDrop(payload.appointmentId, { kind: 'cancel' });
      });
    }
  }

  function requestClose() {
    if (C.hasDraftChanges(_draft)) {
      _pending = { kind: 'abandon', count: C.summariseDraft(_draft, _board || { columns: [] }).items.length };
      render();
      return;
    }
    closeOverlay();
  }

  function closeOverlay() {
    _open = false;
    _pending = null;
    _draft = C.emptyDraft();
    _board = null;
    var el = document.getElementById(OVERLAY_ID);
    if (el) el.remove();
  }

  function openOverlay() {
    _route = currentRoute();
    if (!_route) return;
    _open = true;
    _draft = C.emptyDraft();
    _pending = null;
    _error = null;
    var existing = document.getElementById(OVERLAY_ID);
    if (existing) existing.remove();
    var wrap = document.createElement('div');
    wrap.id = OVERLAY_ID;
    document.documentElement.appendChild(wrap);
    render();
    loadBoard();
  }

  function ensureLauncher() {
    var route = currentRoute();
    var launch = document.getElementById(LAUNCH_ID);
    if (!route) {
      if (launch) launch.remove();
      if (_open) closeOverlay();
      return;
    }
    _route = route;
    if (launch) return;
    launch = document.createElement('button');
    launch.type = 'button';
    launch.id = LAUNCH_ID;
    launch.textContent = 'Organise on canvas…';
    launch.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      openOverlay();
    });
    document.documentElement.appendChild(launch);
  }

  document.addEventListener(
    'keydown',
    function (e) {
      if (e.key === 'Escape' && _open) {
        e.stopPropagation();
        requestClose();
      }
    },
    true
  );

  var _mo = new MutationObserver(function (records) {
    for (var i = 0; i < records.length; i++) {
      var t = records[i].target;
      if (t && t.closest && (t.closest('#' + OVERLAY_ID) || t.closest('#' + LAUNCH_ID))) return;
    }
    ensureLauncher();
  });
  _mo.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', ensureLauncher);
  setInterval(ensureLauncher, 1500);
  ensureLauncher();
})();
