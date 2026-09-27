// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Workload tracker on the Workflow dashboard.
//
// Read-only. One GET of /tasks/data/dashboard-data with the page session.
// No write to Medicus. Logs are counts and HTTP status only — never a name.

(function () {
  'use strict';

  var Core = window.WorkloadTrackerCore;
  if (!Core || window.__msWorkloadTrackerBoot) return;
  window.__msWorkloadTrackerBoot = true;

  var PACK_KEY = 'suite.ui.workloadTracker';
  var _packOn = false;
  var _panelOpen = false;
  var _view = 'staff';
  var _sort = 'total';
  var _query = '';
  var _data = null;
  var _updatedAt = 0;
  var _timer = null;
  var _inflight = false;
  var _host = null;
  var _display = {};

  var TONE_CLASS = {
    overdue: 'ms-wl-overdue',
    high: 'ms-wl-high',
    normal: 'ms-wl-normal',
    snoozed: 'ms-wl-snoozed',
  };

  function hidden() {
    return typeof document !== 'undefined' && document.hidden;
  }

  function debugOn() {
    try {
      return localStorage.getItem('ch-debug') === '1';
    } catch (err) {
      return false;
    }
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    var spec = attrs || {};
    Object.keys(spec).forEach(function (key) {
      if (key === 'className') node.className = spec[key];
      else if (key === 'text') node.textContent = spec[key];
      else node.setAttribute(key, spec[key]);
    });
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child) node.appendChild(child);
    }
    return node;
  }

  function clearTimer() {
    if (_timer) {
      clearTimeout(_timer);
      _timer = null;
    }
  }

  function armTimer() {
    clearTimer();
    if (!Core.shouldPoll({ packOn: _packOn, panelOpen: _panelOpen, hidden: hidden() })) return;
    _timer = setTimeout(function () {
      _timer = null;
      if (!Core.shouldPoll({ packOn: _packOn, panelOpen: _panelOpen, hidden: hidden() })) return;
      fetchData(false);
    }, Core.REFRESH_MS);
  }

  function formatTime(ms) {
    try {
      return new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    } catch (err) {
      return '';
    }
  }

  function applyTheme(prefs) {
    if (!_host) return;
    var d = Core.themeDataset(prefs);
    _host.className = Core.themeClassName(prefs);
    _host.setAttribute('data-theme', d.theme);
    _host.setAttribute('data-colorblind', d.colorblind);
    _host.setAttribute('data-size', d.size);
  }

  function setListMessage(kind, text) {
    var list = document.getElementById('ms-wl-list');
    if (!list) return;
    list.textContent = '';
    list.appendChild(el('div', { className: kind === 'error' ? 'ms-wl-empty' : 'ms-wl-loading', text: text }));
  }

  function renderCard(member, scale) {
    var tone = Core.cardTone(member);
    var card = el('article', { className: 'ms-wl-card' });
    if (tone === 'overdue') card.classList.add('ms-wl-has-overdue');
    if (tone === 'heavy') card.classList.add('ms-wl-heavy');
    var top = el('div', { className: 'ms-wl-card-top' });
    top.appendChild(el('div', { className: 'ms-wl-avatar', text: Core.initials(member.label), 'aria-hidden': 'true' }));
    top.appendChild(el('div', { className: 'ms-wl-name', text: member.label }));
    top.appendChild(el('div', { className: 'ms-wl-total', text: String(Core.totalLoad(member)) }));
    card.appendChild(top);
    var bars = el('div', { className: 'ms-wl-bars' });
    var rows = Core.barRows(member, scale);
    if (!rows.length) {
      bars.appendChild(el('div', { className: 'ms-wl-bar-label ms-wl-zero', text: 'Clear' }));
    }
    rows.forEach(function (row) {
      var line = el('div', { className: 'ms-wl-bar-row' });
      line.appendChild(el('div', { className: 'ms-wl-bar-label', text: row.label }));
      var track = el('div', { className: 'ms-wl-bar-track' });
      var fill = el('div', { className: 'ms-wl-bar-fill ' + (TONE_CLASS[row.key] || '') });
      fill.style.width = row.pct + '%';
      track.appendChild(fill);
      line.appendChild(track);
      line.appendChild(
        el('div', { className: 'ms-wl-bar-val ' + (TONE_CLASS[row.key] || ''), text: String(row.value) })
      );
      bars.appendChild(line);
    });
    card.appendChild(bars);
    return card;
  }

  function render() {
    if (!_host || !_data) return;
    var prepared = Core.prepareView(_data, _view, _query, _sort);
    var summary = document.getElementById('ms-wl-summary');
    if (summary) {
      summary.textContent = '';
      [
        ['overdue', prepared.summary.overdue, 'Overdue HP'],
        ['high', prepared.summary.high, 'All high P'],
        ['normal', prepared.summary.normal, 'Normal'],
        ['members', prepared.summary.members, _view === 'team' ? 'Teams' : 'Staff'],
      ].forEach(function (item) {
        var card = el('div', { className: 'ms-wl-stat ms-wl-s-' + item[0] });
        card.appendChild(el('div', { className: 'ms-wl-stat-val', text: String(item[1]) }));
        card.appendChild(el('div', { className: 'ms-wl-stat-lbl', text: item[2] }));
        summary.appendChild(card);
      });
    }
    var list = document.getElementById('ms-wl-list');
    if (list) {
      list.textContent = '';
      if (!prepared.members.length) {
        list.appendChild(
          el('div', {
            className: 'ms-wl-empty',
            text: _query ? 'No matching names' : 'No rows in this dashboard response.',
          })
        );
      } else {
        prepared.members.forEach(function (member) {
          list.appendChild(renderCard(member, prepared.scale));
        });
      }
    }
    var updated = document.getElementById('ms-wl-updated');
    if (updated && _updatedAt) {
      updated.textContent = 'Updated ' + formatTime(_updatedAt) + '. Counts can be a few minutes old.';
    }
    document.querySelectorAll('#ms-wl .ms-wl-tab').forEach(function (tab) {
      var on = tab.getAttribute('data-view') === _view;
      tab.classList.toggle('ms-wl-active', on);
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  function fetchData(manual) {
    if (_inflight || !_host || !_panelOpen || !_packOn) return;
    if (hidden() && !manual) return;
    var url = Core.dashboardDataUrl(
      Core.resolveApiBase({
        hostname: location.hostname,
        pathname: location.pathname,
        href: location.href,
        protocol: location.protocol,
      })
    );
    if (!url) {
      setListMessage('error', 'Could not find this practice’s Medicus address. Nothing is shown as zero.');
      return;
    }
    _inflight = true;
    if (!_data) setListMessage('loading', 'Fetching workload…');
    fetch(url, { method: 'GET', credentials: 'include', cache: 'no-store' })
      .then(function (resp) {
        if (!resp.ok) {
          var err = new Error('http');
          err.status = resp.status;
          throw err;
        }
        return resp.json();
      })
      .then(function (json) {
        if (!_host || !_panelOpen || !_packOn) return;
        _data = Core.parseDashboard(json);
        _updatedAt = Date.now();
        render();
        if (debugOn()) {
          console.info('[MSWL] loaded', { staff: _data.staff.length, teams: _data.teams.length });
        }
      })
      .catch(function (err) {
        var status = err && err.status ? err.status : 0;
        var msg = status ? 'Could not refresh (HTTP ' + status + ').' : 'Could not refresh.';
        if (_data) {
          render();
          var updated = document.getElementById('ms-wl-updated');
          if (updated) {
            updated.textContent = msg + (_updatedAt ? ' Showing ' + formatTime(_updatedAt) + '.' : '');
          }
        } else {
          setListMessage('error', msg + ' Nothing is shown as zero.');
        }
        if (debugOn()) console.info('[MSWL] load failed', { status: status });
      })
      .then(function () {
        _inflight = false;
        armTimer();
      });
  }

  function setOpen(open, opts) {
    var quiet = opts && opts.quiet;
    _panelOpen = open === true;
    var panel = document.getElementById('ms-wl-panel');
    var btn = document.getElementById('ms-wl-toggle');
    if (panel) panel.hidden = !_panelOpen;
    if (btn) btn.setAttribute('aria-expanded', _panelOpen ? 'true' : 'false');
    if (!_panelOpen) {
      clearTimer();
      if (!quiet && btn) btn.focus();
      return;
    }
    if (!_data || !_updatedAt || Date.now() - _updatedAt >= Core.REFRESH_MS) fetchData(true);
    else {
      render();
      armTimer();
    }
    if (!quiet) {
      var search = document.getElementById('ms-wl-search');
      if (search) search.focus();
    }
  }

  function buildHost() {
    var host = el('div', { id: 'ms-wl' });
    var toggle = el('button', {
      id: 'ms-wl-toggle',
      type: 'button',
      className: 'ms-wl-toggle',
      'aria-expanded': 'false',
      'aria-controls': 'ms-wl-panel',
    });
    toggle.appendChild(el('span', { className: 'ms-wl-dot', 'aria-hidden': 'true' }));
    toggle.appendChild(document.createTextNode('Workload'));
    toggle.addEventListener('click', function () {
      setOpen(!_panelOpen);
    });

    var panel = el('aside', {
      id: 'ms-wl-panel',
      className: 'ms-wl-panel',
      role: 'complementary',
      'aria-label': 'Workload tracker',
      hidden: 'hidden',
    });
    var header = el('div', { className: 'ms-wl-header' });
    var titles = el('div');
    titles.appendChild(el('h2', { text: 'Workload' }));
    titles.appendChild(
      el('p', {
        className: 'ms-wl-sub',
        text: 'Read-only counts from the Workflow dashboard. Not a staffing decision.',
      })
    );
    var close = el('button', { type: 'button', className: 'ms-wl-close', 'aria-label': 'Close workload' });
    close.textContent = 'Close';
    close.addEventListener('click', function () {
      setOpen(false);
    });
    header.appendChild(titles);
    header.appendChild(close);

    var controls = el('div', { className: 'ms-wl-controls' });
    ['staff', 'team'].forEach(function (view) {
      var tab = el('button', {
        type: 'button',
        className: 'ms-wl-tab' + (view === _view ? ' ms-wl-active' : ''),
        'data-view': view,
        role: 'tab',
        'aria-selected': view === _view ? 'true' : 'false',
        text: view === 'staff' ? 'Staff' : 'Teams',
      });
      tab.addEventListener('click', function () {
        _view = view;
        render();
      });
      controls.appendChild(tab);
    });
    var sortLabel = el('label', { className: 'ms-wl-sort-label', for: 'ms-wl-sort', text: 'Sort' });
    var sort = el('select', { id: 'ms-wl-sort' });
    [
      ['total', 'Total load'],
      ['overdue', 'Overdue first'],
      ['name', 'Name A–Z'],
    ].forEach(function (opt) {
      var option = el('option', { value: opt[0], text: opt[1] });
      if (opt[0] === _sort) option.selected = true;
      sort.appendChild(option);
    });
    sort.addEventListener('change', function () {
      _sort = sort.value;
      render();
    });
    controls.appendChild(sortLabel);
    controls.appendChild(sort);

    var refresh = el('button', { type: 'button', id: 'ms-wl-refresh', text: 'Refresh' });
    refresh.addEventListener('click', function () {
      fetchData(true);
    });
    var search = el('input', {
      id: 'ms-wl-search',
      type: 'search',
      placeholder: 'Search by name',
      'aria-label': 'Search by name',
    });
    search.value = _query;
    search.addEventListener('input', function () {
      _query = search.value;
      render();
    });

    panel.appendChild(header);
    panel.appendChild(controls);
    panel.appendChild(el('div', { id: 'ms-wl-summary', className: 'ms-wl-summary' }));
    panel.appendChild(refresh);
    panel.appendChild(search);
    panel.appendChild(el('div', { id: 'ms-wl-list', className: 'ms-wl-list' }));
    panel.appendChild(el('div', { id: 'ms-wl-updated', className: 'ms-wl-updated', 'aria-live': 'polite' }));
    host.appendChild(toggle);
    host.appendChild(panel);
    return host;
  }

  function mount() {
    if (!_packOn || !Core.isDashboardPath(location.pathname || '')) return;
    if (_host && _host.parentNode) _host.parentNode.removeChild(_host);
    _host = buildHost();
    (document.documentElement || document.body).appendChild(_host);
    applyTheme(_display);
    if (_panelOpen) setOpen(true, { quiet: true });
  }

  function ensureMounted() {
    if (!_packOn || !Core.isDashboardPath(location.pathname || '')) return;
    if (_host && document.documentElement.contains(_host)) return;
    mount();
  }

  function muteWorkloadChrome() {
    clearTimer();
    _panelOpen = false;
    _data = null;
    _updatedAt = 0;
    _query = '';
    _inflight = false;
    if (_host && _host.parentNode) _host.parentNode.removeChild(_host);
    _host = null;
  }

  function onVisible() {
    if (hidden()) {
      clearTimer();
      return;
    }
    if (!Core.shouldPoll({ packOn: _packOn, panelOpen: _panelOpen, hidden: false })) return;
    if (!_updatedAt || Date.now() - _updatedAt >= Core.REFRESH_MS) fetchData(false);
    else armTimer();
  }

  function onKey(e) {
    if (!_panelOpen || !e || e.key !== 'Escape') return;
    e.stopPropagation();
    setOpen(false);
  }

  document.addEventListener('visibilitychange', onVisible);
  document.addEventListener('keydown', onKey, true);

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get('suite.display', function (r) {
      _display = (r && r['suite.display']) || {};
      applyTheme(_display);
    });
    if (chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area && area !== 'local') return;
        if (!changes['suite.display']) return;
        _display = changes['suite.display'].newValue || {};
        applyTheme(_display);
      });
    }
  }

  var Runtime = window.InjectorRuntime;
  if (Runtime && typeof Runtime.register === 'function') {
    Runtime.register('workload-tracker', {
      match: function (pathname) {
        return (
          !!_packOn && Core.isDashboardPath(pathname || (typeof location !== 'undefined' ? location.pathname : ''))
        );
      },
      start: mount,
      place: ensureMounted,
      stop: muteWorkloadChrome,
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
    } else {
      _packOn = true;
      Runtime.sync();
    }
  } else if (window.PracticePacks && window.PracticePacks.bindInjector) {
    window.PracticePacks.bindInjector(PACK_KEY, {
      on: function () {
        _packOn = true;
        mount();
      },
      off: function () {
        _packOn = false;
        muteWorkloadChrome();
      },
    });
  }
})();
