// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Transactional request concurrency gate
//
// Multiple contexts (Sweep tab batches, Record tab, the sentinel content
// script, shadow-mode comparisons) can all message the service worker at
// once, each triggering its own proxy round trip. Without a shared limit
// those calls stampede the proxy and Medicus staging together. This is a
// tiny FIFO concurrency gate the service worker runs every txn network call
// through: at most `maxConcurrent` run at a time, the rest queue and are
// released in order as slots free up.
//
// Dependency-free and timer-free on purpose — it's a pure promise queue, not
// a rate limiter, so it adds no latency once a slot is free.

(function (global) {
  'use strict';

  // createRequestGate({ maxConcurrent }) -> { run, inFlight, queued }
  //   maxConcurrent — max number of fn()s allowed to be in flight at once
  //                   (default 3)
  //   run(fn)       — fn is a zero-arg function returning a promise (or value).
  //                   Runs immediately if a slot is free, otherwise queues
  //                   FIFO until one is. Always resolves/rejects with fn's
  //                   own result — the gate never swallows or rewrites it.
  //   inFlight()    — number of fn()s currently running
  //   queued()      — number of fn()s waiting for a slot
  function createRequestGate({ maxConcurrent = 3 } = {}) {
    let active = 0;
    const queue = []; // FIFO of { fn, resolve, reject }

    function scheduleNext() {
      if (active >= maxConcurrent) return;
      const next = queue.shift();
      if (!next) return;
      runNow(next.fn, next.resolve, next.reject);
    }

    function runNow(fn, resolve, reject) {
      active += 1;
      Promise.resolve()
        .then(fn)
        .then(
          (value) => {
            resolve(value);
          },
          (err) => {
            reject(err);
          }
        )
        .finally(() => {
          active -= 1;
          scheduleNext();
        });
    }

    function run(fn) {
      return new Promise((resolve, reject) => {
        if (active < maxConcurrent) {
          runNow(fn, resolve, reject);
        } else {
          queue.push({ fn, resolve, reject });
        }
      });
    }

    function inFlight() {
      return active;
    }

    function queued() {
      return queue.length;
    }

    return { run, inFlight, queued };
  }

  const api = { createRequestGate };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.TxnRequestGate = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
