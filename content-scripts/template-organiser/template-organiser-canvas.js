// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — template & document organiser canvas
//
// Full-bleed overlay, same mount shape as the allocate canvases. Group
// edits confirm into chrome.storage.local only. Open on a card uses
// Medicus’s own template form (the same control the slash menu uses).
// This canvas does not POST a create body. The pack
// suite.ui.templateOrganiser stays off until a practice switches it on.
// The launcher shows while the cursor is in History, Examination,
// Impression, or Plan on a consultation or plan page.
'use strict';

(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__msTemplateOrganiserCanvas) return;
  window.__msTemplateOrganiserCanvas = true;

  var C = window.TemplateOrganiserCore;
  if (!C) return;

  var OVERLAY_ID = 'ms-toc-overlay';
  var LAUNCH_ID = 'ms-toc-launch';
  var FEATURE_NAME = 'Document and Template Organiser';
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
  var _clientBase = '';

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

  var _apiRing = [];

  function noteClinicalUrl(url) {
    _apiRing = C.rememberClinicalUrl(_apiRing, url);
  }

  function watchClinicalUrls() {
    try {
      var existing = performance.getEntriesByType('resource') || [];
      existing.forEach(function (entry) {
        if (entry && entry.name) noteClinicalUrl(entry.name);
      });
      if (typeof PerformanceObserver !== 'function') return;
      var observer = new PerformanceObserver(function (list) {
        var entries = list.getEntries();
        for (var i = 0; i < entries.length; i += 1) {
          if (entries[i] && entries[i].name) noteClinicalUrl(entries[i].name);
        }
      });
      observer.observe({ type: 'resource', buffered: true });
    } catch (err) {
      /* resource timing is optional; overview hydrate still runs */
    }
  }

  function resourceUrls() {
    var live = [];
    try {
      live = performance.getEntriesByType('resource').map(function (entry) {
        return entry && entry.name;
      });
    } catch (err) {
      live = [];
    }
    return C.mergeResourceUrls(_apiRing, live);
  }

  function readLiveContext() {
    return C.readSessionContext({
      href: location.href,
      resourceUrls: resourceUrls(),
      headingId: _headingId,
      headingKind: _fieldKind,
    });
  }

  function practiceCodeHint() {
    try {
      var helper = window.PracticeCode;
      if (!helper || typeof helper.getPracticeCodeSync !== 'function') return '';
      var code = helper.getPracticeCodeSync();
      if (helper.isValidPracticeCode && !helper.isValidPracticeCode(code)) return '';
      return code || '';
    } catch (err) {
      return '';
    }
  }

  function apiBase() {
    return C.resolveApiBase({
      href: location.href,
      pathname: location.pathname,
      hostname: location.hostname,
      resourceUrls: resourceUrls(),
      practiceCode: practiceCodeHint(),
    });
  }

  function client() {
    var factory = window.TemplateOrganiserClient;
    if (!factory || typeof factory.createClient !== 'function') return null;
    var base = apiBase();
    if (!base) return null;
    if (_client && _clientBase === base) return _client;
    _clientBase = base;
    _client = factory.createClient({ apiBase: base });
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
        if (!window.TemplateOrganiserClient) throw new Error('Template list client is not loaded.');
        if (!api) throw new Error('No practice API host on this page. Nothing was read.');
        return api.hydrate(
          C.readSessionContext({
            href: href,
            resourceUrls: urls,
            headingId: _headingId,
            headingKind: _fieldKind,
          }),
          href,
          urls,
          _headingId,
          _fieldKind
        );
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
      '<button type="button" class="ms-toc-text ms-toc-use" data-open="' +
      esc(item.id) +
      '" aria-label="Open ' +
      esc(item.title) +
      ' with Medicus">Open</button>' +
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
    var surfaceGap = _surface === 'documents' ? gaps.documents || '' : gaps.templates || '';
    var banner =
      'Groups are kept on this install. Open uses Medicus’s own template form. Medicus places the finished item at the cursor.';
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
      '<h1 class="ms-toc-title">' +
      esc(FEATURE_NAME) +
      '</h1>' +
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
      (surfaceGap ? '<p class="ms-toc-gap" role="status">' + esc(surfaceGap) + '</p>' : '') +
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
    if (_fieldEl && _fieldEl.isConnected) {
      try {
        _fieldEl.focus();
      } catch (err) {
        /* the field may reject focus */
      }
    }
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
    if (_pending.kind === 'confirm') persistDraft();
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
    var openBtn = t.closest('[data-open]');
    if (openBtn) {
      var openId = openBtn.getAttribute('data-open');
      var opened = itemsForSurface().filter(function (item) {
        return item.id === openId;
      })[0];
      if (!opened) return;
      openNative(opened);
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
    if (e.target.closest && e.target.closest('[data-open]')) {
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
      el.setAttribute('aria-label', FEATURE_NAME);
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

  var _fieldEl = null;
  var _fieldKind = '';
  var _headingId = '';

  function consultPage() {
    try {
      var path = String(location.pathname || '');
      if (path.indexOf('/clinical/encounter/') !== -1) return true;
      if (path.indexOf('/clinical/plan') !== -1) return true;
    } catch (err) {
      /* location can throw in a torn-down frame */
    }
    return false;
  }

  function nodeEditable(el) {
    if (!el || el.nodeType !== 1) return false;
    var tag = String(el.tagName || '').toLowerCase();
    if (tag === 'textarea') return true;
    if (tag === 'input') {
      var type = String(el.getAttribute('type') || 'text').toLowerCase();
      return type === '' || type === 'text' || type === 'search';
    }
    if (el.isContentEditable) return true;
    return el.getAttribute && el.getAttribute('role') === 'textbox';
  }

  function inOrganiser(node) {
    if (!node || !node.closest) return false;
    if (node.id === LAUNCH_ID) return true;
    if (node.closest('#' + LAUNCH_ID)) return true;
    if (node.closest('#' + OVERLAY_ID)) return true;
    return false;
  }

  // The uuid often sits on an ancestor (heading-history-{uuid}) while the
  // visible word History is a sibling with no id. Stopping at that sibling
  // leaves document search without a context id.
  function headingIdNear(el) {
    var node = el;
    for (var i = 0; i < 8 && node && node.nodeType === 1; i += 1) {
      if (C.headingContextId(node.id || '')) return node.id;
      var labelled = node.getAttribute ? node.getAttribute('aria-labelledby') || '' : '';
      if (C.headingContextId(labelled)) return labelled;
      var prev = node.previousElementSibling;
      var steps = 0;
      while (prev && steps < 6) {
        if (C.headingContextId(prev.id || '')) return prev.id;
        prev = prev.previousElementSibling;
        steps += 1;
      }
      node = node.parentElement;
    }
    return '';
  }

  // Walk from the focused node to a History / Examination / Impression / Plan
  // signal. Heading ids (heading-history-{uuid}) are the slash-menu label.
  // A sibling or ancestor heading with that exact word counts when the
  // focused node is an editor.
  function headingKindFrom(el) {
    if (!el || el.nodeType !== 1) return '';
    var tag = String(el.tagName || '').toLowerCase();
    var role = el.getAttribute && el.getAttribute('role');
    var isHeading = tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || role === 'heading';
    if (!isHeading) return '';
    return C.clinicalFieldKind({
      id: el.id || '',
      labelledBy: '',
      headingText: (el.textContent || '').replace(/\s+/g, ' ').trim(),
      editable: true,
    });
  }

  function fieldSignal(el) {
    if (!el || el.nodeType !== 1 || !nodeEditable(el)) return null;
    var node = el;
    for (var i = 0; i < 8 && node && node.nodeType === 1; i += 1) {
      var labelled = node.getAttribute ? node.getAttribute('aria-labelledby') || '' : '';
      var kind = C.clinicalFieldKind({
        id: node.id || '',
        labelledBy: labelled,
        headingText: '',
        editable: true,
      });
      if (kind) {
        return {
          kind: kind,
          el: el,
          headingId: headingIdNear(el) || (C.headingContextId(node.id || '') ? node.id : labelled),
        };
      }
      var prev = node.previousElementSibling;
      var steps = 0;
      var textKind = '';
      while (prev && steps < 6) {
        var sib = headingKindFrom(prev);
        if (sib) {
          textKind = sib;
          break;
        }
        prev = prev.previousElementSibling;
        steps += 1;
      }
      if (textKind) return { kind: textKind, el: el, headingId: headingIdNear(el) };
      node = node.parentElement;
    }
    return null;
  }

  function syncFieldFrom(node) {
    if (inOrganiser(node)) return;
    var hit = fieldSignal(node);
    if (hit) {
      _fieldEl = hit.el;
      _fieldKind = hit.kind;
      _headingId = hit.headingId || '';
      return;
    }
    _fieldEl = null;
    _fieldKind = '';
    _headingId = '';
  }

  function launcherWanted() {
    if (!_packOn || !consultPage()) return false;
    if (_open) return true;
    if (_fieldKind) return true;
    var active = document.activeElement;
    if (active && active.id === LAUNCH_ID) return true;
    return false;
  }

  function noteOutside(text) {
    var host = document.getElementById('ms-toc-note');
    if (!host) {
      host = document.createElement('div');
      host.id = 'ms-toc-note';
      host.setAttribute('aria-live', 'polite');
      host.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;';
      document.documentElement.appendChild(host);
    }
    host.textContent = text || '';
  }

  function clickNative(el) {
    if (!el || typeof el.click !== 'function') return false;
    el.click();
    return true;
  }

  function controlSpec(el) {
    var card = el.closest ? el.closest('.m-card, .template-list-item, .m-list-item, li') : null;
    var cardTitle = '';
    if (card && card.querySelector) {
      var label = card.querySelector('.description-list-item--label, .m-list-item--content');
      cardTitle = label ? label.textContent || '' : '';
    }
    return {
      text: el.textContent || '',
      title: el.getAttribute ? el.getAttribute('title') || '' : '',
      cardTitle: cardTitle,
    };
  }

  function findNativeControl(item) {
    var nodes = document.querySelectorAll('button, a, [role="button"]');
    for (var i = 0; i < nodes.length; i += 1) {
      var el = nodes[i];
      if (el.closest && (el.closest('#' + OVERLAY_ID) || el.closest('#' + LAUNCH_ID))) continue;
      if (C.nativeControlMatches(item, controlSpec(el))) return el;
    }
    return null;
  }

  function fieldText(el) {
    if (!el) return '';
    var tag = String(el.tagName || '').toLowerCase();
    if (tag === 'textarea' || tag === 'input') return String(el.value || '');
    return String(el.textContent || '');
  }

  function undoAccidentalSlash(el, before) {
    if (!el) return;
    var tag = String(el.tagName || '').toLowerCase();
    var now = fieldText(el);
    if (now !== before + '/' && now !== '/' + before) return;
    if (tag === 'textarea' || tag === 'input') el.value = before;
    else el.textContent = before;
  }

  function finishOpen(item) {
    noteOutside(
      'Medicus’s own template control was used for ' +
        item.title +
        '. Finish that form in Medicus. This canvas does not write the record.'
    );
  }

  function waitForControl(item, n) {
    var el = findNativeControl(item);
    if (el && clickNative(el)) {
      finishOpen(item);
      return;
    }
    if (n > 40) {
      noteOutside('Medicus’s template control for ' + item.title + ' was not on the page. Nothing was written.');
      return;
    }
    setTimeout(function () {
      waitForControl(item, n + 1);
    }, 50);
  }

  function waitForMenu(item, field, before, n) {
    var menuId = C.nativeMenuId(item);
    var menu = menuId ? document.getElementById(menuId) : null;
    if (menu) {
      undoAccidentalSlash(field, before);
      if (clickNative(menu)) waitForControl(item, 0);
      return;
    }
    if (n > 20) {
      undoAccidentalSlash(field, before);
      noteOutside('Medicus’s template menu did not open. Nothing was written.');
      return;
    }
    setTimeout(function () {
      waitForMenu(item, field, before, n + 1);
    }, 50);
  }

  function openNative(item) {
    if (_writing || !item) return;
    var live = readLiveContext();
    if (C.sessionDrift(_session, live)) {
      _error = 'The consultation on screen changed. Medicus’s template form was not opened.';
      _pending = null;
      announce(_error);
      render();
      return;
    }
    var field = _fieldEl && _fieldEl.isConnected ? _fieldEl : null;
    var before = fieldText(field);
    closeOverlay();
    if (field) {
      try {
        field.focus();
      } catch (err) {
        /* keep going; Medicus still inserts into the field that has focus */
      }
    }
    var direct = findNativeControl(item);
    if (direct && clickNative(direct)) {
      finishOpen(item);
      return;
    }
    var menuId = C.nativeMenuId(item);
    var menu = menuId ? document.getElementById(menuId) : null;
    if (menu && clickNative(menu)) {
      waitForControl(item, 0);
      return;
    }
    if (!field) {
      noteOutside('The cursor is not in History, Examination, Impression, or Plan. Nothing was opened.');
      return;
    }
    try {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: '/', code: 'Slash', bubbles: true, cancelable: true }));
    } catch (err) {
      noteOutside('Medicus’s template menu did not open. Nothing was written.');
      return;
    }
    waitForMenu(item, field, before, 0);
  }

  function ensureLauncher() {
    healIfWiped();
    if (!launcherWanted()) {
      if (!_open) muteOrganiserChrome();
      else {
        var stray = document.getElementById(LAUNCH_ID);
        if (stray) stray.remove();
      }
      return;
    }
    var launch = document.getElementById(LAUNCH_ID);
    if (!launch) {
      launch = document.createElement('button');
      launch.type = 'button';
      launch.id = LAUNCH_ID;
      launch.textContent = FEATURE_NAME;
      launch.setAttribute('aria-label', FEATURE_NAME);
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

  watchClinicalUrls();

  var Runtime = window.InjectorRuntime;
  if (Runtime && typeof Runtime.register === 'function') {
    Runtime.register('template-organiser', {
      match: function () {
        return launcherWanted();
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

  document.addEventListener(
    'focusin',
    function (e) {
      syncFieldFrom(e.target);
      if (window.InjectorRuntime && typeof window.InjectorRuntime.sync === 'function') {
        window.InjectorRuntime.sync();
      } else {
        ensureLauncher();
      }
    },
    true
  );
})();
