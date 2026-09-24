// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — template & document organiser canvas
//
// Full-bleed overlay, same mount shape as the allocate canvases. Group
// edits confirm into chrome.storage.local only. Use on a card inserts
// through TemplateOrganiserClient, which repeats the slash-menu GET and
// POST. The pack suite.ui.templateOrganiser stays off until a practice
// switches it on. The launcher mounts on the encounter / plan page, or
// while a Template or Document drawer is open.
'use strict';

(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__msTemplateOrganiserCanvas) return;
  window.__msTemplateOrganiserCanvas = true;

  var C = window.TemplateOrganiserCore;
  if (!C) return;

  var OVERLAY_ID = 'ms-toc-overlay';
  var LAUNCH_ID = 'ms-toc-launch';
  var PACK_KEY = (window.PracticePacks && window.PracticePacks.KEYS.templateOrganiser) || 'suite.ui.templateOrganiser';
  var CONFIG_KEY = 'templateOrganiser.config';
  // Opt-in pack: a missing PracticePacks helper stays off (unlike grandfathered canvases).
  var _packOn = !!(window.PracticePacks && window.PracticePacks.peek(PACK_KEY));

  var _open = false;
  var _surface = 'templates';
  var _saved = null;
  var _draft = null;
  var _persisted = false;
  var _catalogue = null;
  var _loading = false;
  var _writing = false;
  var _error = null;
  var _pending = null;
  var _dragId = '';
  var _harvestGen = 0;
  var _editingGroupId = '';
  var _editingName = '';
  var _newGroupName = '';
  var _focusClose = false;
  var _session = null;
  var _client = null;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function announce(text) {
    setTimeout(function () {
      var live = document.querySelector('#' + OVERLAY_ID + ' .ms-toc-live');
      if (live) live.textContent = text || '';
    }, 0);
  }

  function currentSurfaceState() {
    if (!_draft || !_draft.surfaces) return C.sanitiseConfig(null).surfaces.templates;
    return _draft.surfaces[_surface];
  }

  function dirty() {
    if (!_saved || !_draft) return false;
    return !C.sameConfig(_saved, _draft);
  }

  function canSave() {
    return !_loading && !_writing && (!!dirty() || !_persisted);
  }

  function itemsForSurface() {
    if (!_catalogue) return [];
    var list = _catalogue[_surface];
    return Array.isArray(list) ? list : [];
  }

  function applySurface(result) {
    if (!result || !result.ok) {
      announce((result && result.error) || 'Could not change that group.');
      return;
    }
    _draft = C.replaceSurface(_draft, _surface, result.surface);
    _pending = null;
    render();
  }

  // Group save stays on this install. Medicus template rows are not rewritten.
  function persistDraft() {
    if (_writing || !_draft) return;
    _writing = true;
    _error = null;
    var payload = C.confirmPayload(_draft, _catalogue);
    render();
    try {
      var stored = {};
      stored[CONFIG_KEY] = payload;
      chrome.storage.local.set(stored, function () {
        _writing = false;
        var runtimeError = chrome.runtime && chrome.runtime.lastError;
        if (runtimeError) {
          _error = 'Could not save on this install.';
          _pending = null;
          announce(_error);
          render();
          return;
        }
        _saved = C.cloneConfig(payload);
        _draft = C.cloneConfig(payload);
        _persisted = true;
        _pending = null;
        announce('Saved on this install. Medicus lists are unchanged.');
        render();
      });
    } catch (err) {
      _writing = false;
      _error = 'Could not save on this install.';
      _pending = null;
      announce(_error);
      render();
    }
  }

  function loadConfig() {
    return new Promise(function (resolve) {
      function useSeed() {
        _saved = C.seedConfig();
        _draft = C.cloneConfig(_saved);
        _persisted = false;
        resolve();
      }
      try {
        if (!chrome.storage || !chrome.storage.local) {
          useSeed();
          return;
        }
        chrome.storage.local.get(CONFIG_KEY, function (r) {
          var raw = r ? r[CONFIG_KEY] : undefined;
          if (raw == null) useSeed();
          else {
            _saved = C.sanitiseConfig(raw);
            _draft = C.cloneConfig(_saved);
            _persisted = true;
            resolve();
          }
        });
      } catch (err) {
        useSeed();
      }
    });
  }

  function resourceUrls() {
    try {
      return performance.getEntriesByType('resource').map(function (entry) {
        return entry && entry.name;
      });
    } catch (err) {
      return [];
    }
  }

  function readLiveContext() {
    return C.readSessionContext({ href: location.href, resourceUrls: resourceUrls() });
  }

  function client() {
    if (_client) return _client;
    var factory = window.TemplateOrganiserClient;
    if (!factory || typeof factory.createClient !== 'function') return null;
    _client = factory.createClient({ origin: location.origin });
    return _client;
  }

  function runHarvest() {
    var gen = ++_harvestGen;
    _loading = true;
    _error = null;
    render();
    var api = client();
    var href = location.href;
    var urls = resourceUrls();
    Promise.resolve()
      .then(function () {
        if (!api) throw new Error('Template list client is not loaded.');
        return api.hydrate(C.readSessionContext({ href: href, resourceUrls: urls }), href, urls);
      })
      .then(function (ctx) {
        if (gen !== _harvestGen) return null;
        _session = ctx;
        return Promise.all([api.listTemplates(ctx), api.listDocuments(ctx)]);
      })
      .then(function (lists) {
        if (gen !== _harvestGen || !lists) return;
        var templates = lists[0] || { items: [], gap: '' };
        var documents = lists[1] || { items: [], gap: '' };
        _catalogue = {
          source: 'medicus',
          templates: templates.items || [],
          documents: documents.items || [],
          gaps: {
            templates: templates.ok === false ? templates.gap || 'Template list was not read.' : '',
            documents: documents.ok === false ? documents.gap || 'Document list was not read.' : '',
          },
        };
      })
      .catch(function (err) {
        if (gen !== _harvestGen) return;
        _error = err && err.message ? err.message : 'Could not read the Medicus lists.';
        _catalogue = {
          source: 'medicus',
          templates: [],
          documents: [],
          gaps: { templates: _error, documents: _error },
        };
      })
      .then(function () {
        if (gen !== _harvestGen) return;
        _loading = false;
        _focusClose = true;
        render();
      });
  }

  function cardHtml(item) {
    var dragging = _dragId === item.id ? ' ms-toc-dragging' : '';
    return (
      '<article class="ms-toc-card' +
      dragging +
      '" draggable="true" data-item-id="' +
      esc(item.id) +
      '">' +
      '<h3 class="ms-toc-card-title">' +
      esc(item.title) +
      '</h3>' +
      '<p class="ms-toc-card-preview">' +
      esc(item.preview) +
      '</p>' +
      (item.category ? '<span class="ms-toc-tag">' + esc(item.category) + '</span>' : '') +
      '<button type="button" class="ms-toc-text ms-toc-use" data-use="' +
      esc(item.id) +
      '">Use</button>' +
      '</article>'
    );
  }

  function columnHtml(group) {
    var count = group.items.length;
    var head;
    if (!group.locked && _editingGroupId === group.id) {
      head =
        '<div class="ms-toc-col-head">' +
        '<input class="ms-toc-rename" data-rename="' +
        esc(group.id) +
        '" value="' +
        esc(_editingName) +
        '" maxlength="60" aria-label="Group name" />' +
        '<button type="button" class="ms-toc-text" data-commit-rename="' +
        esc(group.id) +
        '">Save name</button>' +
        '<button type="button" class="ms-toc-text" data-cancel-rename="1">Cancel</button>' +
        '</div>';
    } else if (group.locked) {
      head =
        '<div class="ms-toc-col-head">' +
        '<h2 class="ms-toc-col-title">' +
        esc(group.name) +
        '</h2>' +
        '<span class="ms-toc-count">' +
        count +
        '</span>' +
        '</div>';
    } else {
      head =
        '<div class="ms-toc-col-head">' +
        '<h2 class="ms-toc-col-title">' +
        esc(group.name) +
        '</h2>' +
        '<span class="ms-toc-count">' +
        count +
        '</span>' +
        '<button type="button" class="ms-toc-text" data-edit-group="' +
        esc(group.id) +
        '">Rename</button>' +
        '<button type="button" class="ms-toc-text ms-toc-danger" data-delete-group="' +
        esc(group.id) +
        '" aria-label="Delete group ' +
        esc(group.name) +
        '">Delete</button>' +
        '</div>';
    }
    var cards = group.items.map(cardHtml).join('');
    if (!cards) {
      cards =
        '<p class="ms-toc-empty">' +
        (group.locked ? 'Drop a card here to take it out of a group.' : 'Drop cards here.') +
        '</p>';
    }
    return (
      '<section class="ms-toc-col' +
      (group.locked ? ' ms-toc-col-locked' : '') +
      '" data-group-id="' +
      esc(group.id) +
      '">' +
      head +
      '<div class="ms-toc-cards">' +
      cards +
      '</div></section>'
    );
  }

  function confirmHtml() {
    if (_error && (!_pending || _pending.kind !== 'confirm')) {
      return (
        '<div class="ms-toc-confirm ms-toc-confirm-error" role="status">' +
        esc(_error) +
        ' <button type="button" class="ms-toc-text" id="ms-toc-dismiss-error">Dismiss</button></div>'
      );
    }
    if (!_pending) return '';
    if (_pending.kind === 'insert') {
      var title = _pending.item && _pending.item.title ? _pending.item.title : 'this template';
      var frozenInsert = _writing ? ' disabled' : '';
      return (
        '<div class="ms-toc-confirm" role="region" aria-label="Insert into the consultation">' +
        '<p>Insert “' +
        esc(title) +
        '” into this consultation with Medicus’s own template action? This writes the record. Cancel leaves it unchanged.</p>' +
        '<div class="ms-toc-confirm-actions">' +
        '<button type="button" class="ms-toc-ghost" id="ms-toc-cancel-pending"' +
        frozenInsert +
        '>Keep organising</button>' +
        '<button type="button" class="ms-toc-primary" id="ms-toc-confirm-pending"' +
        frozenInsert +
        '>Insert into consultation</button>' +
        '</div></div>'
      );
    }
    if (_pending.kind === 'abandon') {
      return (
        '<div class="ms-toc-confirm" role="region" aria-label="Discard unsaved organisation">' +
        '<p>You have unsaved group changes. Discard them and close?</p>' +
        '<div class="ms-toc-confirm-actions">' +
        '<button type="button" class="ms-toc-ghost" id="ms-toc-cancel-pending">Keep organising</button>' +
        '<button type="button" class="ms-toc-primary" id="ms-toc-confirm-pending">Discard and close</button>' +
        '</div></div>'
      );
    }
    var lines = (_pending.lines || []).map(function (line) {
      return '<li>' + esc(line) + '</li>';
    });
    var frozen = _writing ? ' disabled' : '';
    return (
      '<div class="ms-toc-confirm" role="region" aria-label="Save organisation on this install">' +
      '<p>Save this organisation on this install? Medicus template and document lists stay as they are.</p>' +
      '<ul class="ms-toc-diff">' +
      lines.join('') +
      '</ul>' +
      '<div class="ms-toc-confirm-actions">' +
      '<button type="button" class="ms-toc-ghost" id="ms-toc-cancel-pending"' +
      frozen +
      '>Keep editing</button>' +
      '<button type="button" class="ms-toc-primary" id="ms-toc-confirm-pending"' +
      frozen +
      '>Save on this install</button>' +
      '</div></div>'
    );
  }

  function shellHtml() {
    var gaps = (_catalogue && _catalogue.gaps) || {};
    var seenGap = {};
    var gapLine = [gaps.templates, gaps.documents]
      .filter(function (line) {
        if (!line || seenGap[line]) return false;
        seenGap[line] = true;
        return true;
      })
      .join(' ');
    var banner =
      'Groups are kept on this install. Use on a card inserts with the same Medicus action as the slash menu.' +
      (gapLine ? ' ' + gapLine : '');
    var templatesN = _catalogue && _catalogue.templates ? _catalogue.templates.length : 0;
    var documentsN = _catalogue && _catalogue.documents ? _catalogue.documents.length : 0;
    var board = '';
    if (_loading) {
      board = '<p class="ms-toc-status">Reading Medicus template lists…</p>';
    } else if (_draft) {
      var view = C.buildBoard(itemsForSurface(), currentSurfaceState());
      board =
        '<div class="ms-toc-board">' +
        view.groups.map(columnHtml).join('') +
        '<section class="ms-toc-new">' +
        '<h2 class="ms-toc-col-title">New group</h2>' +
        '<input id="ms-toc-new-name" class="ms-toc-rename" maxlength="60" placeholder="Group name" aria-label="New group name" value="' +
        esc(_newGroupName) +
        '" />' +
        '<button type="button" class="ms-toc-ghost" id="ms-toc-add-group">Add group</button>' +
        '</section></div>';
    }
    var foot = 'Sample organisation — not saved on this install yet.';
    if (_persisted && !dirty()) foot = 'Saved on this install. Medicus lists are unchanged.';
    else if (dirty()) foot = 'Unsaved changes on this canvas.';
    var saveDisabled = canSave() ? '' : ' disabled';
    return (
      '<div class="ms-toc-panel" role="document">' +
      '<header class="ms-toc-header">' +
      '<div class="ms-toc-heading">' +
      '<h1 class="ms-toc-title">Template and document organiser</h1>' +
      '<p class="ms-toc-banner">' +
      esc(banner) +
      '</p>' +
      '</div>' +
      '<div class="ms-toc-tabs" role="tablist" aria-label="List surface">' +
      '<button type="button" class="ms-toc-tab' +
      (_surface === 'templates' ? ' is-on' : '') +
      '" role="tab" aria-selected="' +
      (_surface === 'templates' ? 'true' : 'false') +
      '" data-surface="templates">Templates (' +
      templatesN +
      ')</button>' +
      '<button type="button" class="ms-toc-tab' +
      (_surface === 'documents' ? ' is-on' : '') +
      '" role="tab" aria-selected="' +
      (_surface === 'documents' ? 'true' : 'false') +
      '" data-surface="documents">Documents (' +
      documentsN +
      ')</button>' +
      '</div>' +
      '<button type="button" class="ms-toc-close" id="ms-toc-close">Close</button>' +
      '</header>' +
      board +
      '<footer class="ms-toc-footer">' +
      '<p class="ms-toc-foot-note">' +
      esc(foot) +
      '</p>' +
      '<button type="button" class="ms-toc-primary" id="ms-toc-save"' +
      saveDisabled +
      '>Save organisation</button>' +
      '</footer>' +
      confirmHtml() +
      '</div>'
    );
  }

  function render() {
    var root = document.getElementById(OVERLAY_ID);
    if (!root) return;
    var shell = root.querySelector('.ms-toc-shell');
    if (!shell) return;
    shell.innerHTML = shellHtml();
    if (_editingGroupId) {
      var input = shell.querySelector('[data-rename="' + _editingGroupId + '"]');
      if (input) {
        input.focus();
        var end = input.value.length;
        try {
          input.setSelectionRange(end, end);
        } catch (err) {
          /* input type may reject selection */
        }
      }
      return;
    }
    if (_focusClose) {
      _focusClose = false;
      var closeBtn = shell.querySelector('#ms-toc-close');
      if (closeBtn) closeBtn.focus();
    }
  }

  function closeOverlay() {
    _harvestGen += 1;
    _open = false;
    _pending = null;
    _dragId = '';
    _editingGroupId = '';
    _editingName = '';
    _loading = false;
    _writing = false;
    _error = null;
    var el = document.getElementById(OVERLAY_ID);
    if (el) el.remove();
    var launch = document.getElementById(LAUNCH_ID);
    if (launch) launch.focus();
  }

  function requestClose() {
    if (_writing) return;
    if (dirty()) {
      _pending = { kind: 'abandon' };
      announce('Unsaved group changes.');
      render();
      return;
    }
    closeOverlay();
  }

  function requestSave() {
    if (!canSave() || !_draft || !_saved) return;
    _pending = { kind: 'confirm', lines: C.diffSummary(_saved, _draft) };
    announce('Review the local save. Medicus lists stay as they are.');
    render();
  }

  function onConfirmPending() {
    if (!_pending || _writing) return;
    if (_pending.kind === 'abandon') {
      closeOverlay();
      return;
    }
    if (_pending.kind === 'insert') {
      runInsert(_pending.item);
      return;
    }
    if (_pending.kind === 'confirm') persistDraft();
  }

  function runInsert(item) {
    if (_writing || !item) return;
    var api = client();
    if (!api) {
      _error = 'Template list client is not loaded.';
      _pending = null;
      announce(_error);
      render();
      return;
    }
    var live = readLiveContext();
    if (C.sessionDrift(_session, live)) {
      _error = 'The consultation on screen changed. The insert did not run.';
      _pending = null;
      announce(_error);
      render();
      return;
    }
    var ctx = C.mergeSession(_session, live);
    _writing = true;
    _error = null;
    render();
    api
      .insertItem(item, ctx)
      .then(function (result) {
        _writing = false;
        _pending = null;
        if (result && result.ok) {
          announce('Medicus accepted the insert for ' + item.title + '.');
          render();
          return;
        }
        if (result && result.gap) _error = result.gap;
        else if (result && result.status) {
          _error = 'Medicus did not accept the insert (HTTP ' + result.status + ').';
        } else _error = 'The insert did not run.';
        announce(_error);
        render();
      })
      .catch(function (err) {
        _writing = false;
        _pending = null;
        _error = err && err.message ? err.message : 'The insert did not run.';
        announce(_error);
        render();
      });
  }

  function commitRename(groupId) {
    var shell = document.querySelector('#' + OVERLAY_ID + ' .ms-toc-shell');
    var input = shell && shell.querySelector('[data-rename="' + groupId + '"]');
    var name = input ? input.value : _editingName;
    _editingGroupId = '';
    _editingName = '';
    applySurface(C.renameGroup(currentSurfaceState(), groupId, name));
  }

  function addGroup() {
    var shell = document.querySelector('#' + OVERLAY_ID + ' .ms-toc-shell');
    var input = shell && shell.querySelector('#ms-toc-new-name');
    var name = input ? input.value : _newGroupName;
    _newGroupName = '';
    var result = C.createGroup(currentSurfaceState(), name);
    if (!result.ok) {
      _newGroupName = name;
      announce(result.error);
      render();
      return;
    }
    applySurface(result);
    announce('Group added on this canvas. Save to keep it on this install.');
  }

  function onClick(e) {
    if (!_open) return;
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.id === 'ms-toc-close' || t.closest('#ms-toc-close')) {
      e.preventDefault();
      requestClose();
      return;
    }
    if (t.classList && t.classList.contains('ms-toc-shell')) {
      requestClose();
      return;
    }
    var surfaceBtn = t.closest('[data-surface]');
    if (surfaceBtn && surfaceBtn.closest('#' + OVERLAY_ID)) {
      var next = surfaceBtn.getAttribute('data-surface');
      if (next === 'templates' || next === 'documents') {
        _surface = next;
        _editingGroupId = '';
        _pending = null;
        render();
      }
      return;
    }
    var editBtn = t.closest('[data-edit-group]');
    if (editBtn) {
      _editingGroupId = editBtn.getAttribute('data-edit-group');
      var group = currentSurfaceState().groups.filter(function (g) {
        return g.id === _editingGroupId;
      })[0];
      _editingName = group ? group.name : '';
      _pending = null;
      render();
      return;
    }
    if (t.closest('[data-cancel-rename]')) {
      _editingGroupId = '';
      _editingName = '';
      render();
      return;
    }
    var commitBtn = t.closest('[data-commit-rename]');
    if (commitBtn) {
      commitRename(commitBtn.getAttribute('data-commit-rename'));
      return;
    }
    var deleteBtn = t.closest('[data-delete-group]');
    if (deleteBtn) {
      var gid = deleteBtn.getAttribute('data-delete-group');
      var deleted = C.deleteGroup(currentSurfaceState(), gid);
      if (!deleted.ok) {
        announce(deleted.error);
        return;
      }
      _editingGroupId = '';
      applySurface(deleted);
      announce('Group removed on this canvas. Its cards moved to Not in a group.');
      return;
    }
    var useBtn = t.closest('[data-use]');
    if (useBtn) {
      var useId = useBtn.getAttribute('data-use');
      var used = itemsForSurface().filter(function (item) {
        return item.id === useId;
      })[0];
      if (!used) return;
      _pending = { kind: 'insert', item: used };
      _error = null;
      _editingGroupId = '';
      announce('Review the insert. Nothing is written until you confirm.');
      render();
      return;
    }
    if (t.closest('#ms-toc-add-group')) {
      addGroup();
      return;
    }
    if (t.closest('#ms-toc-save')) {
      requestSave();
      return;
    }
    if (t.closest('#ms-toc-dismiss-error')) {
      _error = null;
      render();
      return;
    }
    if (t.closest('#ms-toc-cancel-pending')) {
      _pending = null;
      render();
      return;
    }
    if (t.closest('#ms-toc-confirm-pending')) {
      onConfirmPending();
    }
  }

  function onInput(e) {
    var t = e.target;
    if (!t || !t.closest || !t.closest('#' + OVERLAY_ID)) return;
    if (t.id === 'ms-toc-new-name') _newGroupName = t.value;
    if (t.getAttribute && t.getAttribute('data-rename')) _editingName = t.value;
  }

  function onKeyDown(e) {
    if (!_open) return;
    var rename = e.target && e.target.getAttribute && e.target.getAttribute('data-rename');
    if (e.key === 'Enter' && rename) {
      e.preventDefault();
      commitRename(rename);
      return;
    }
    if (e.key === 'Enter' && e.target && e.target.id === 'ms-toc-new-name') {
      e.preventDefault();
      addGroup();
    }
  }

  function healIfWiped() {
    if (_open && !document.getElementById(OVERLAY_ID)) {
      _harvestGen += 1;
      _open = false;
      _writing = false;
      _loading = false;
      _pending = null;
      _dragId = '';
    }
  }

  document.addEventListener(
    'keydown',
    function (e) {
      if (!_open || e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      if (_writing) return;
      if (_editingGroupId) {
        _editingGroupId = '';
        _editingName = '';
        render();
        return;
      }
      if (_pending) {
        _pending = null;
        announce('Still organising.');
        render();
        return;
      }
      requestClose();
    },
    true
  );

  function onDragStart(e) {
    if (_writing || _loading) {
      e.preventDefault();
      return;
    }
    var card = e.target && e.target.closest ? e.target.closest('[data-item-id]') : null;
    if (!card || !card.closest('#' + OVERLAY_ID)) return;
    if (e.target.closest && e.target.closest('[data-use]')) {
      e.preventDefault();
      return;
    }
    _dragId = card.getAttribute('data-item-id') || '';
    if (!_dragId) return;
    try {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', _dragId);
    } catch (err) {
      /* dataTransfer can throw in odd hosts; _dragId still drives the drop */
    }
    card.classList.add('ms-toc-dragging');
  }

  function onDragOver(e) {
    if (!_dragId || !_open) return;
    var col = e.target && e.target.closest ? e.target.closest('[data-group-id]') : null;
    if (!col || !col.closest('#' + OVERLAY_ID)) return;
    e.preventDefault();
    try {
      e.dataTransfer.dropEffect = 'move';
    } catch (err) {
      /* ignore */
    }
    var prev = document.querySelector('#' + OVERLAY_ID + ' .ms-toc-drop');
    if (prev && prev !== col) prev.classList.remove('ms-toc-drop');
    col.classList.add('ms-toc-drop');
  }

  function clearDropMarks() {
    document.querySelectorAll('#' + OVERLAY_ID + ' .ms-toc-drop').forEach(function (node) {
      node.classList.remove('ms-toc-drop');
    });
  }

  function onDrop(e) {
    if (!_dragId || !_open) return;
    var col = e.target && e.target.closest ? e.target.closest('[data-group-id]') : null;
    if (!col || !col.closest('#' + OVERLAY_ID)) return;
    e.preventDefault();
    var toGroup = col.getAttribute('data-group-id');
    var card = e.target.closest('[data-item-id]');
    var beforeId = '';
    if (card) beforeId = card.getAttribute('data-item-id') || '';
    if (beforeId === _dragId) beforeId = '';
    var moving = _dragId;
    _dragId = '';
    clearDropMarks();
    var result = C.moveItem(currentSurfaceState(), moving, toGroup, beforeId || null);
    if (!result.ok) {
      announce(result.error);
      render();
      return;
    }
    applySurface(result);
  }

  function onDragEnd() {
    _dragId = '';
    clearDropMarks();
    document.querySelectorAll('#' + OVERLAY_ID + ' .ms-toc-dragging').forEach(function (node) {
      node.classList.remove('ms-toc-dragging');
    });
  }

  function wireOverlay(el) {
    el.addEventListener('click', onClick);
    el.addEventListener('input', onInput);
    el.addEventListener('keydown', onKeyDown);
    el.addEventListener('dragstart', onDragStart);
    el.addEventListener('dragover', onDragOver);
    el.addEventListener('drop', onDrop);
    el.addEventListener('dragend', onDragEnd);
  }

  function openOverlay() {
    healIfWiped();
    if (!_packOn || _open) return;
    _open = true;
    _surface = 'templates';
    _pending = null;
    _error = null;
    _editingGroupId = '';
    _editingName = '';
    _newGroupName = '';
    _catalogue = null;
    _loading = true;
    var el = document.getElementById(OVERLAY_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = OVERLAY_ID;
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'true');
      el.setAttribute('aria-label', 'Template and document organiser');
      el.innerHTML = '<div class="ms-toc-live" aria-live="polite"></div><div class="ms-toc-shell"></div>';
      wireOverlay(el);
      document.documentElement.appendChild(el);
    }
    render();
    loadConfig().then(function () {
      if (!_open) return;
      runHarvest();
    });
  }

  function muteOrganiserChrome() {
    var launch = document.getElementById(LAUNCH_ID);
    if (launch) launch.remove();
    if (_open) closeOverlay();
    else {
      var el = document.getElementById(OVERLAY_ID);
      if (el) el.remove();
    }
  }

  function nativeSurface() {
    try {
      var path = String(location.pathname || '');
      if (path.indexOf('/clinical/encounter/') !== -1) return true;
      if (path.indexOf('/clinical/plan') !== -1) return true;
    } catch (err) {
      /* location can throw in a torn-down frame */
    }
    var nodes = document.querySelectorAll('.drawer-modal, .m-action-menu');
    for (var i = 0; i < nodes.length; i += 1) {
      var text = nodes[i].textContent || '';
      if (text.indexOf('Data Entry Templates') !== -1) return true;
      if (text.indexOf('Document Templates') !== -1) return true;
      if (text.indexOf('New Document') !== -1) return true;
    }
    return false;
  }

  function ensureLauncher() {
    healIfWiped();
    if (!_packOn || !nativeSurface()) {
      muteOrganiserChrome();
      return;
    }
    var launch = document.getElementById(LAUNCH_ID);
    if (!launch) {
      launch = document.createElement('button');
      launch.type = 'button';
      launch.id = LAUNCH_ID;
      launch.textContent = 'Organise templates…';
      launch.setAttribute('aria-label', 'Organise templates and documents');
      launch.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        openOverlay();
      });
      document.documentElement.appendChild(launch);
    }
  }

  function startHeavyChrome() {
    ensureLauncher();
  }

  function stopHeavyChrome() {
    muteOrganiserChrome();
  }

  var Runtime = window.InjectorRuntime;
  if (Runtime && typeof Runtime.register === 'function') {
    Runtime.register('template-organiser', {
      match: function () {
        return !!_packOn && nativeSurface();
      },
      start: startHeavyChrome,
      place: ensureLauncher,
      stop: stopHeavyChrome,
    });
    if (window.PracticePacks && window.PracticePacks.bindInjector) {
      window.PracticePacks.bindInjector(PACK_KEY, {
        on: function () {
          _packOn = true;
          Runtime.sync();
        },
        off: function () {
          _packOn = false;
          Runtime.sync();
        },
      });
    }
  } else if (window.PracticePacks && window.PracticePacks.bindInjector) {
    window.PracticePacks.bindInjector(PACK_KEY, {
      on: function () {
        _packOn = true;
        startHeavyChrome();
      },
      off: function () {
        _packOn = false;
        stopHeavyChrome();
      },
    });
  }
})();
