// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Patient Alerts core logic (pure, no DOM / no chrome.*)
//
// Per-patient customisable alerts: free-text flags a clinician attaches to a
// specific patient (interpreter required, medication-seeking behaviour,
// safeguarding concern, …) that surface whenever that patient's record is
// open in Medicus.
//
// This is the suite's FIRST deliberately persisted per-patient store
// (chrome.storage.local 'patientAlerts.byPatient'). Everything else per-patient
// in the suite is in-memory-only by design (see content-scripts/sentinel.js).
// The wrong-patient hazard is therefore the top risk here: every render path
// must resolve the CURRENT patient identity from the live Sentinel snapshot at
// render time and look alerts up through findEntryForPatient — never cache a
// previous lookup across a navigation.
//
// Store shape ('patientAlerts.byPatient'):
//   { [patientUuid]: {
//       patient: { name, nhsNumber, dob },       // display metadata only
//       alerts:  [ { id, typeId, label, severity, note, createdAt, updatedAt } ],
//       updatedAt } }
//
// Palette shape ('patientAlerts.types'):
//   [ { id, label, severity, description } ]     // quick-add presets, fully editable

'use strict';

export const SEVERITIES = ['red', 'amber', 'info'];

// Lower rank = more severe (same convention as Sentinel's STATUS_RANK).
export const SEVERITY_RANK = { red: 0, amber: 1, info: 2 };

// Shipped quick-add presets. Users can edit/delete these and add their own —
// they are seeds, not a fixed vocabulary. Wording is deliberately professional
// and factual: these flags may be seen by any practice user and could be
// disclosed to the patient under subject access.
export const DEFAULT_ALERT_TYPES = [
  {
    id: 'interpreter',
    label: 'Interpreter required',
    severity: 'amber',
    description: 'Record the language needed in the note.',
  },
  {
    id: 'communication',
    label: 'Communication needs',
    severity: 'amber',
    description: 'Hearing/sight impairment, easy-read, longer appointments.',
  },
  {
    id: 'learning-disability',
    label: 'Learning disability — reasonable adjustments',
    severity: 'amber',
    description: 'Describe the adjustments needed in the note.',
  },
  {
    id: 'safeguarding',
    label: 'Safeguarding concern',
    severity: 'red',
    description: 'Active safeguarding concern — see record for detail.',
  },
  {
    id: 'violence-risk',
    label: 'Violence / aggression risk',
    severity: 'red',
    description: 'Staff-safety flag. Follow practice policy.',
  },
  {
    id: 'seeking-behaviour',
    label: 'Medication-seeking behaviour',
    severity: 'amber',
    description: 'Pattern of concern around controlled/abusable medicines.',
  },
  {
    id: 'vulnerable',
    label: 'Vulnerable patient',
    severity: 'amber',
    description: 'Needs additional care or priority handling.',
  },
  { id: 'carer', label: 'Is a carer', severity: 'info', description: 'Patient has caring responsibilities.' },
  {
    id: 'dna-risk',
    label: 'Frequent non-attendance',
    severity: 'info',
    description: 'Consider reminders / flexible booking.',
  },
];

// ── Identity helpers ──────────────────────────────────────────────────────────

// Normalise an NHS number to a bare 10-digit string, or null when it isn't one.
export function normaliseNhs(raw) {
  if (raw == null) return null;
  const digits = String(raw).replace(/\D/g, '');
  return digits.length === 10 ? digits : null;
}

// The canonical storage key for a patient context. UUID only — a name is never
// a safe storage key (namesakes), and NHS numbers are used only as a lookup
// fallback, never to create entries.
export function patientKey(pc) {
  if (!pc || typeof pc !== 'object') return null;
  const uuid = pc.patientUuid || pc.patientId || pc.id || pc.uuid || null;
  return typeof uuid === 'string' && uuid.length >= 8 ? uuid : null;
}

// Extract display metadata to denormalise onto the store entry.
export function patientMeta(pc) {
  if (!pc || typeof pc !== 'object') return { name: '', nhsNumber: null, dob: '' };
  return {
    name: pc.displayName || pc.patientName || pc.name || '',
    nhsNumber: normaliseNhs(pc.nhsNumber),
    dob: pc.dateOfBirth || pc.dobRaw || pc.dob || '',
  };
}

// Find the store entry for the patient currently on screen.
// Primary: exact UUID key. Fallback: scan for a matching normalised NHS number
// (covers views where the UUID could not be resolved but the banner shows NHS).
// Returns { key, entry } or null. Never matches on name alone.
export function findEntryForPatient(store, pc) {
  if (!store || typeof store !== 'object') return null;
  const key = patientKey(pc);
  if (key && store[key] && typeof store[key] === 'object') return { key, entry: store[key] };
  const nhs = normaliseNhs(pc && pc.nhsNumber);
  if (nhs) {
    for (const [k, entry] of Object.entries(store)) {
      if (entry && entry.patient && normaliseNhs(entry.patient.nhsNumber) === nhs) {
        return { key: k, entry };
      }
    }
  }
  return null;
}

// ── Alert construction / validation ──────────────────────────────────────────

let _idCounter = 0;

// Generate a unique alert id. Time-based with a per-session counter suffix so
// rapid adds can't collide.
export function generateAlertId(now = Date.now()) {
  _idCounter += 1;
  return `pa-${now.toString(36)}-${_idCounter.toString(36)}`;
}

// Build a validated alert entry. Throws on a blank label or bad severity.
// `author` (optional) is the acting user's name/initials (from the practice
// letterhead config) — stamped as createdBy/updatedBy for the H-042 audit
// trail ("who put this flag here, when"). Older alerts without these fields
// stay valid (isValidAlert does not require them).
export function makeAlert({ label, severity, note = '', typeId = null, author = null }, nowIso, id) {
  const cleanLabel = String(label || '')
    .trim()
    .slice(0, 120);
  if (!cleanLabel) throw new Error('Alert label is required.');
  if (!SEVERITIES.includes(severity)) throw new Error(`Severity must be one of: ${SEVERITIES.join(', ')}.`);
  const cleanAuthor = author ? String(author).trim().slice(0, 60) || null : null;
  return {
    id: id || generateAlertId(),
    typeId: typeId || null,
    label: cleanLabel,
    severity,
    note: String(note || '')
      .trim()
      .slice(0, 500),
    createdAt: nowIso,
    updatedAt: nowIso,
    createdBy: cleanAuthor,
    updatedBy: cleanAuthor,
  };
}

// True when an alert object is structurally sound (used defensively on read —
// a corrupt entry must degrade to "skipped", never break rendering).
export function isValidAlert(a) {
  return !!(
    a &&
    typeof a === 'object' &&
    typeof a.id === 'string' &&
    a.id &&
    typeof a.label === 'string' &&
    a.label.trim() &&
    SEVERITIES.includes(a.severity)
  );
}

// ── Pure store transforms (always return a NEW store object) ─────────────────

// Add or update an alert for a patient. Requires a resolvable UUID key —
// callers must not offer "add" when the current patient has no UUID.
export function upsertAlert(store, pc, alert, nowIso) {
  const key = patientKey(pc);
  if (!key) throw new Error('No patient identifier — cannot save an alert.');
  if (!isValidAlert(alert)) throw new Error('Invalid alert.');
  const prev = store && store[key] && typeof store[key] === 'object' ? store[key] : null;
  const alerts = (prev && Array.isArray(prev.alerts) ? prev.alerts : []).filter(isValidAlert);
  const idx = alerts.findIndex((a) => a.id === alert.id);
  // Edit path: the original createdAt/createdBy are immutable provenance —
  // only updatedAt/updatedBy move (H-042 audit trail).
  const nextAlerts =
    idx >= 0
      ? alerts.map((a, i) =>
          i === idx ? { ...alert, createdAt: a.createdAt, createdBy: a.createdBy ?? null, updatedAt: nowIso } : a
        )
      : [...alerts, alert];
  return {
    ...(store || {}),
    [key]: {
      patient: patientMeta(pc),
      alerts: nextAlerts,
      updatedAt: nowIso,
    },
  };
}

// Remove one alert; drops the whole patient entry when its last alert goes.
export function removeAlert(store, key, alertId, nowIso) {
  if (!store || !store[key]) return store || {};
  const entry = store[key];
  const alerts = (Array.isArray(entry.alerts) ? entry.alerts : []).filter((a) => isValidAlert(a) && a.id !== alertId);
  const next = { ...store };
  if (alerts.length === 0) {
    delete next[key];
  } else {
    next[key] = { ...entry, alerts, updatedAt: nowIso };
  }
  return next;
}

// Remove a whole patient entry.
export function removePatient(store, key) {
  if (!store || !store[key]) return store || {};
  const next = { ...store };
  delete next[key];
  return next;
}

// ── Presentation helpers ─────────────────────────────────────────────────────

// Most-severe-first, then label.
export function sortAlerts(alerts) {
  return [...(alerts || [])].filter(isValidAlert).sort((a, b) => {
    const r = (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9);
    return r !== 0 ? r : a.label.localeCompare(b.label);
  });
}

// 'red' | 'amber' | 'info' | null for an alert list.
export function maxSeverity(alerts) {
  let best = null;
  for (const a of alerts || []) {
    if (!isValidAlert(a)) continue;
    if (best === null || SEVERITY_RANK[a.severity] < SEVERITY_RANK[best]) best = a.severity;
  }
  return best;
}

// { patients, alerts } totals for a store — used by the envelope preview.
export function countStore(store) {
  let patients = 0;
  let alerts = 0;
  for (const entry of Object.values(store || {})) {
    const list = entry && Array.isArray(entry.alerts) ? entry.alerts.filter(isValidAlert) : [];
    if (list.length > 0) {
      patients += 1;
      alerts += list.length;
    }
  }
  return { patients, alerts };
}

// Filter the store to entries whose patient name / NHS number / alert labels
// match a search query (case-insensitive substring). Empty query = everything.
export function searchStore(store, query) {
  const q = String(query || '')
    .trim()
    .toLowerCase();
  const out = [];
  for (const [key, entry] of Object.entries(store || {})) {
    if (!entry || typeof entry !== 'object') continue;
    const alerts = sortAlerts(entry.alerts);
    if (alerts.length === 0) continue;
    if (q) {
      const hay = [
        entry.patient && entry.patient.name,
        entry.patient && entry.patient.nhsNumber,
        ...alerts.map((a) => a.label),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) continue;
    }
    out.push({ key, entry: { ...entry, alerts } });
  }
  // Most recently updated patients first.
  out.sort((a, b) => String(b.entry.updatedAt || '').localeCompare(String(a.entry.updatedAt || '')));
  return out;
}

// ── Palette helpers ──────────────────────────────────────────────────────────

export function isValidType(t) {
  return !!(
    t &&
    typeof t === 'object' &&
    typeof t.id === 'string' &&
    t.id &&
    typeof t.label === 'string' &&
    t.label.trim() &&
    SEVERITIES.includes(t.severity)
  );
}

// Defensive load: a corrupt/absent stored palette falls back to the defaults.
export function sanitiseTypes(raw) {
  if (!Array.isArray(raw)) return DEFAULT_ALERT_TYPES.map((t) => ({ ...t }));
  const seen = new Set();
  const out = [];
  for (const t of raw) {
    if (!isValidType(t) || seen.has(t.id)) continue;
    seen.add(t.id);
    out.push({
      id: t.id,
      label: t.label.trim().slice(0, 120),
      severity: t.severity,
      description: typeof t.description === 'string' ? t.description.slice(0, 300) : '',
    });
  }
  return out.length > 0 ? out : DEFAULT_ALERT_TYPES.map((t) => ({ ...t }));
}

export function generateTypeId(label, now = Date.now()) {
  const slug = String(label || 'type')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${slug || 'type'}-${now.toString(36)}`;
}

// ── Merge semantics (import/sharing) ─────────────────────────────────────────
// Shared-file imports UNION rather than overwrite, so a colleague's export can
// never silently delete locally-recorded alerts. Same-id items: incoming wins
// (the newer edit is assumed intentional).

export function mergeTypes(current, incoming) {
  const cur = sanitiseTypes(current);
  const inc = Array.isArray(incoming) ? incoming.filter(isValidType) : [];
  const incIds = new Set(inc.map((t) => t.id));
  return sanitiseTypes([...cur.filter((t) => !incIds.has(t.id)), ...inc]);
}

export function mergeStores(current, incoming) {
  const out = {};
  const cur = current && typeof current === 'object' ? current : {};
  const inc = incoming && typeof incoming === 'object' ? incoming : {};
  for (const key of new Set([...Object.keys(cur), ...Object.keys(inc)])) {
    const a = cur[key];
    const b = inc[key];
    if (!b || typeof b !== 'object') {
      out[key] = a;
      continue;
    }
    if (!a || typeof a !== 'object') {
      const bAlerts = (Array.isArray(b.alerts) ? b.alerts : []).filter(isValidAlert);
      if (bAlerts.length > 0) out[key] = { ...b, alerts: bAlerts };
      continue;
    }
    const aAlerts = (Array.isArray(a.alerts) ? a.alerts : []).filter(isValidAlert);
    const bAlerts = (Array.isArray(b.alerts) ? b.alerts : []).filter(isValidAlert);
    const bIds = new Set(bAlerts.map((x) => x.id));
    const merged = [...aAlerts.filter((x) => !bIds.has(x.id)), ...bAlerts];
    if (merged.length === 0) continue;
    out[key] = {
      patient: b.patient || a.patient || { name: '', nhsNumber: null, dob: '' },
      alerts: merged,
      updatedAt: String(b.updatedAt || '') > String(a.updatedAt || '') ? b.updatedAt || null : a.updatedAt || null,
    };
  }
  return out;
}
