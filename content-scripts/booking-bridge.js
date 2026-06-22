// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Booking API bridge (content script, isolated world).
//
// The /scheduling/* booking endpoints on england.medicus.health only return
// JSON when called from the same origin (they serve the SPA HTML shell to
// cross-origin callers). This bridge listens for CH_BOOKING_FETCH messages
// from the extension side panel and relays those fetches from within the
// Medicus tab, so the browser treats them as same-origin XHR with full
// session-cookie context.
//
// Security: only relays to /scheduling/ paths on the tab's own hostname.
// Any other URL is rejected before the fetch fires.
'use strict';

chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
  if (msg.type !== 'CH_BOOKING_FETCH') return false;

  var url = msg.url;
  var allowed = false;
  try {
    var u = new URL(url);
    allowed = u.hostname === location.hostname && u.pathname.startsWith('/scheduling/');
  } catch (_) {}

  if (!allowed) {
    sendResponse({ error: 'disallowed_url' });
    return false;
  }

  var opts = {
    method: msg.method || 'GET',
    credentials: 'include',
    headers: Object.assign({ Accept: 'application/json, text/plain, */*' }, msg.headers || {}),
  };
  if (msg.body) opts.body = msg.body;

  fetch(url, opts)
    .then(function (resp) {
      return resp.text().then(function (text) {
        sendResponse({ ok: resp.ok, status: resp.status, text: text });
      });
    })
    .catch(function (err) {
      sendResponse({ error: err.message });
    });

  return true; // keep message channel open for async sendResponse
});
