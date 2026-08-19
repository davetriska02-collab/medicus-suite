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
  var _sick = null;
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
      (opts.canStretch
        ? '<button type="button" class="ms-aoc-tile-stretch" data-stretch-id="' +
          esc(appt.id) +
          '">+' +
          C.STRETCH_STEP_MINUTES +
          ' min</button>' +
          '<div class="ms-aoc-stretch-handle" data-stretch-handle="' +
          esc(appt.id) +
          '" title="Drag to stretch into a free following slot"></div>'
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
          var live = C.findAppointment(_board, a.id) || a;
          var nextLen = (a.duration || live.duration || 0) + C.STRETCH_STEP_MINUTES;
          var canStretch = !a.stagedMove && C.canStageStretch(live, nextLen, _board).ok;
          items.push({
            t: a.startDateTime,
            html: tileHtml(a, { staged: !!a.stagedMove || !!a.stagedStretch, canStretch: canStretch }),
          });
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
      'Stretch with <strong>+15 min</strong> or the bottom handle only when the following slot is free. ' +
      'If the next slot is booked the handle will not stage. Nothing is written until you Finalise. ' +
      'Arrived patients stay locked. Medicus will not send SMS or email from this board.' +
      '</div>' +
      '<div class="ms-aoc-body">' +
      bodyHtml() +
      '</div>' +
      (_sick ? sickHtml() : '') +
      confirmBarHtml() +
      '<footer class="ms-aoc-footer">' +
      '<button type="button" class="ms-aoc-ghost" id="ms-aoc-sick">Sick day…</button>' +
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

  function sickHtml() {
    if (!_sick) return '';
    if (_sick.step === 'pick') {
      var cols = ((_board && _board.columns) || [])
        .map(function (col) {
          var n = (col.appointments || []).length;
          return (
            '<button type="button" class="ms-aoc-tray-btn" data-sick-diary="' +
            esc(col.diaryId) +
            '">' +
            esc(col.staffName) +
            ' ' +
            esc(hhmm(col.sessionStart) + '–' + hhmm(col.sessionEnd)) +
            ' — ' +
            n +
            ' booked</button>'
          );
        })
        .join('');
      return (
        '<div class="ms-aoc-confirmbar">' +
        '<strong>Sick day.</strong> Whose list are we emptying? Arrived patients stay put. ' +
        'Suggestions are same type, length, site and delivery on another list today. SMS stays off.' +
        '<div class="ms-aoc-finalise-list">' +
        (cols || '<div class="ms-aoc-empty">No diaries.</div>') +
        '</div>' +
        '<div class="ms-aoc-confirmbar-actions">' +
        '<button type="button" class="ms-aoc-cancel" id="ms-aoc-sick-cancel">Cancel</button>' +
        '</div></div>'
      );
    }
    var leftovers = C.sickDayLeftovers(_sick.proposal);
    var cover = C.coverLoadPreview(_board, _sick.proposal);
    var cap = Number(_sick.proposal.destExtraCap) || C.SICK_DAY_DEST_EXTRA_CAP;
    if (_sick.step === 'leftovers') {
      return leftoverPanelHtml(leftovers, _sick.proposal.sickStaffName, true);
    }
    var coverHtml = cover.length
      ? '<div class="ms-aoc-cover-preview">' +
        '<div class="ms-aoc-cover-preview-title">Covering lists after this pile-on</div>' +
        cover
          .map(function (d) {
            return (
              '<div class="ms-aoc-cover-row' +
              (d.overCap ? ' ms-aoc-cover-over' : '') +
              '">' +
              esc(d.staffName) +
              ' ' +
              esc(hhmm(d.sessionStart) + '–' + hhmm(d.sessionEnd)) +
              ' — ' +
              d.alreadyBooked +
              ' already booked + ' +
              d.incoming +
              ' incoming = ' +
              d.afterBooked +
              '. ' +
              d.remainingFree +
              ' free tiles left' +
              (d.overCap ? ' — over the cap of ' + d.cap + ' extra.' : '.') +
              '</div>'
            );
          })
          .join('') +
        '</div>'
      : '<div class="ms-aoc-hint">No covering list would take anyone — this is a phone list.</div>';
    var moveRows = ((_sick.proposal && _sick.proposal.rows) || [])
      .filter(function (row) {
        return row.status !== 'locked';
      })
      .map(function (row) {
        var idx = _sick.proposal.rows.indexOf(row);
        var a = row.appointment;
        var opts = (row.alternatives || [])
          .map(function (s) {
            var val = s.diaryId + '|' + s.startDateTime;
            var sel = row.suggestion && s.diaryId === row.suggestion.diaryId && s.startDateTime === row.suggestion.startDateTime;
            return (
              '<option value="' +
              esc(val) +
              '"' +
              (sel ? ' selected' : '') +
              '>' +
              esc(hhmm(s.startDateTime) + ' ' + s.staffName) +
              '</option>'
            );
          })
          .join('');
        return (
          '<div class="ms-aoc-finalise-row">' +
          '<span class="ms-aoc-finalise-desc">' +
          esc(hhmm(a.startDateTime) + ' · ' + a.patientName + ' · ' + (a.appointmentTypeName || '') + ' · ' + a.duration + ' min') +
          '</span>' +
          (opts
            ? '<select class="ms-aoc-finalise-reason" data-sick-pick="' +
              idx +
              '"><option value="">Still needs rebook</option>' +
              opts +
              '</select>'
            : '<span class="ms-aoc-hint">Still needs rebook — ' +
              esc(row.reason || 'no similar free slot') +
              '</span>') +
          '</div>'
        );
      })
      .join('');
    return (
      '<div class="ms-aoc-confirmbar">' +
      '<strong>Sick day — ' +
      esc(_sick.proposal.sickStaffName) +
      '.</strong> Accept a similar slot, pick another, or leave as still needs rebook. ' +
      'Finalise uses the captured cross-list move. Confirm will say rebooked with the covering clinician. SMS stays off.' +
      '<label class="ms-aoc-cap-label">Max extra per covering list ' +
      '<input type="number" class="ms-aoc-cap-input" id="ms-aoc-sick-cap" min="1" max="20" value="' +
      esc(String(cap)) +
      '"></label>' +
      coverHtml +
      '<div class="ms-aoc-finalise-list">' +
      (moveRows || '<div class="ms-aoc-empty">Nobody can be moved on similar slots.</div>') +
      '</div>' +
      leftoverPanelHtml(leftovers, _sick.proposal.sickStaffName, false) +
      '<div class="ms-aoc-confirmbar-actions">' +
      '<button type="button" class="ms-aoc-cancel" id="ms-aoc-sick-cancel">Back</button>' +
      (C.sickDayAcceptCount(_sick.proposal)
        ? '<button type="button" class="ms-aoc-confirm-btn" id="ms-aoc-sick-apply">Stage accepted moves</button>'
        : '<span class="ms-aoc-hint">Nothing to stage — every row still needs rebook or is waiting room.</span>') +
      '</div></div>'
    );
  }

  function leftoverPanelHtml(leftovers, sickStaffName, persistOnly) {
    leftovers = leftovers || [];
    var rows = leftovers.length
      ? leftovers
          .map(function (row) {
            return (
              '<div class="ms-aoc-leftover-row' +
              (row.status === 'locked' ? ' ms-aoc-leftover-locked' : '') +
              '">' +
              '<span class="ms-aoc-leftover-when">' +
              esc(hhmm(row.originalTime)) +
              '</span>' +
              '<span class="ms-aoc-leftover-who">' +
              esc(row.patientName) +
              '</span>' +
              '<span class="ms-aoc-leftover-meta">' +
              esc((row.appointmentTypeName || 'Appointment') + (row.duration ? ' · ' + row.duration + ' min' : '')) +
              '</span>' +
              '<span class="ms-aoc-leftover-why">' +
              esc(row.status === 'locked' ? 'Waiting room — already here, do not phone to rebook' : row.reason) +
              '</span>' +
              '</div>'
            );
          })
          .join('')
      : '<div class="ms-aoc-leftover-row"><span class="ms-aoc-leftover-why">Nobody left to phone.</span></div>';
    return (
      '<div class="' +
      (persistOnly ? 'ms-aoc-confirmbar' : 'ms-aoc-phone-list') +
      '">' +
      '<div class="ms-aoc-phone-title">Still needs a phone call — ' +
      leftovers.length +
      ' from ' +
      esc(sickStaffName || 'this list') +
      '</div>' +
      '<div class="ms-aoc-hint">' +
      (leftovers.length
        ? 'Name, original time, and why it failed. No phone numbers on the appointment book — look the patient up in Medicus.'
        : 'Everyone who could move has a similar slot. This list stays visible so a quiet board is not mistaken for a missing phone list.') +
      '</div>' +
      '<div class="ms-aoc-finalise-list">' +
      rows +
      '</div>' +
      '<div class="ms-aoc-confirmbar-actions">' +
      '<button type="button" class="ms-aoc-ghost" id="ms-aoc-sick-copy">Copy phone list</button>' +
      (persistOnly
        ? '<button type="button" class="ms-aoc-cancel" id="ms-aoc-sick-cancel">Close leftover list</button>'
        : '') +
      '</div></div>'
    );
  }

  function tryStretch(apptId, extraMinutes) {
    var appt = C.findAppointment(_board, apptId);
    if (!appt) return;
    var next = (appt.duration || 0) + Number(extraMinutes);
    var gate = C.canStageStretch(appt, next, _board);
    if (!gate.ok) {
      _error = gate.reason;
      announce(gate.reason);
      render();
      return;
    }
    _draft = C.stageStretch(_draft, apptId, next);
    announce('Staged stretch for ' + appt.patientName + ' to ' + next + ' min');
    render();
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
        } else if (item.kind === 'stretch') {
          await api.commitStretch({
            date: _route.date,
            appointment: appt,
            newDuration: item.duration,
            pinned: { apiBase: _route.apiBase },
          });
          _draft = C.unstageStretch(_draft, item.id);
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
    root.querySelector('#ms-aoc-sick')?.addEventListener('click', function () {
      _sick = { step: 'pick', proposal: null };
      _pending = null;
      render();
    });
    root.querySelector('#ms-aoc-sick-cancel')?.addEventListener('click', function () {
      _sick = null;
      render();
    });
    root.querySelector('#ms-aoc-sick-apply')?.addEventListener('click', function () {
      if (!_sick || !_sick.proposal) return;
      _draft = C.applySickDayProposal(_draft, _sick.proposal);
      var leftovers = C.sickDayLeftovers(_sick.proposal);
      _sick = { step: 'leftovers', proposal: _sick.proposal };
      announce(
        leftovers.length
          ? 'Staged accepted sick-day moves. ' + leftovers.length + ' still need a phone call. Finalise when ready.'
          : 'Staged accepted sick-day moves. Nobody left to phone. Finalise when ready.'
      );
      render();
    });
    root.querySelector('#ms-aoc-sick-copy')?.addEventListener('click', function () {
      if (!_sick || !_sick.proposal) return;
      var text = C.leftoverPhoneText(_sick.proposal);
      if (!text) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          function () {
            announce('Phone list copied.');
          },
          function () {
            announce(text);
          }
        );
      } else {
        announce(text);
      }
    });
    var capInput = root.querySelector('#ms-aoc-sick-cap');
    if (capInput) {
      capInput.addEventListener('change', function () {
        if (!_sick || !_sick.proposal) return;
        var n = Number(capInput.value);
        _sick = {
          step: 'review',
          proposal: C.proposeSickDay(_board, _sick.proposal.sickDiaryId, { destExtraCap: n }),
        };
        render();
      });
    }
    root.querySelectorAll('[data-sick-diary]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        _sick = { step: 'review', proposal: C.proposeSickDay(_board, btn.getAttribute('data-sick-diary')) };
        render();
      });
    });
    root.querySelectorAll('[data-sick-pick]').forEach(function (sel) {
      sel.addEventListener('change', function () {
        if (!_sick || !_sick.proposal) return;
        var idx = Number(sel.getAttribute('data-sick-pick'));
        var row = _sick.proposal.rows[idx];
        if (!row) return;
        var val = sel.value;
        if (!val) {
          row.status = 'leave';
          row.suggestion = null;
        } else {
          var parts = val.split('|');
          var hit = (row.alternatives || []).filter(function (s) {
            return s.diaryId === parts[0] && s.startDateTime === parts[1];
          })[0];
          if (hit) {
            row.status = 'accept';
            row.suggestion = hit;
          }
        }
        render();
      });
    });
    root.querySelector('#ms-aoc-discard')?.addEventListener('click', function () {
      _draft = C.emptyDraft();
      _pending = null;
      _sick = null;
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
    root.querySelectorAll('[data-stretch-id]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        tryStretch(btn.getAttribute('data-stretch-id'), C.STRETCH_STEP_MINUTES);
      });
    });
    root.querySelectorAll('[data-stretch-handle]').forEach(function (handle) {
      handle.addEventListener('mousedown', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var id = handle.getAttribute('data-stretch-handle');
        var startY = e.clientY;
        function onMove(ev) {
          if (ev.clientY - startY < 8) return;
        }
        function onUp(ev) {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          var delta = ev.clientY - startY;
          if (delta < 12) {
            tryStretch(id, C.STRETCH_STEP_MINUTES);
            return;
          }
          var steps = Math.max(1, Math.round(delta / 24));
          tryStretch(id, steps * C.STRETCH_STEP_MINUTES);
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
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
