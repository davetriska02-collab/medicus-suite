// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// GP Forge — in-memory metrics (Prometheus text exposition). Aggregate counters only — NO PHI.
// Fed from the audit log (every append bumps gpf_actions_total{action}); the safety console reads
// these for post-market surveillance (refusals, rate-limits, caught fabrications, unavailability).

export function createMetrics() {
  const counters = new Map();
  const gauges = new Map();

  function key(name, labels) {
    if (!labels) return name;
    const l = Object.entries(labels)
      .sort()
      .map(([k, v]) => `${k}="${String(v)}"`)
      .join(',');
    return l ? `${name}{${l}}` : name;
  }

  return {
    inc(name, labels) {
      const k = key(name, labels);
      counters.set(k, (counters.get(k) || 0) + 1);
    },
    setGauge(name, val) {
      gauges.set(name, val);
    },
    actionCounts() {
      const out = {};
      for (const [k, v] of counters) {
        const m = /^gpf_actions_total\{action="(.+)"\}$/.exec(k);
        if (m) out[m[1]] = v;
      }
      return out;
    },
    snapshot() {
      return { counters: Object.fromEntries(counters), gauges: Object.fromEntries(gauges) };
    },
    prometheus() {
      const out = [];
      const typed = new Set();
      const emit = (k, v) => {
        const base = k.split(/[ {]/)[0];
        if (!typed.has(base)) {
          typed.add(base);
          out.push(`# TYPE ${base} ${base.endsWith('_total') ? 'counter' : 'gauge'}`);
        }
        out.push(`${k} ${v}`);
      };
      for (const [k, v] of gauges) emit(k, v);
      for (const [k, v] of counters) emit(k, v);
      return out.join('\n') + '\n';
    },
  };
}
