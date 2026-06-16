// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Practice Report — audience profiles.
//
// Three shipped profiles tune WHICH sections render and HOW figures are framed,
// for three audiences (see docs/plans/PRACTICE-REPORT-PLAN.md §3):
//   - management : full operational detail incl. per-clinician drill-down
//   - staff      : AGGREGATE ONLY — never per-clinician (Goodhart's law / morale);
//                  framed as shared workload, not individual productivity
//   - icb        : GPAD-aligned access/capacity; practice-level (no per-clinician)
//
// `applyProfile` is pure and is the single enforcement point for the staff
// aggregate-only rule: it STRIPS per-clinician rows from the data when the profile
// forbids them, so no individual figure can leak into a staff briefing even if the
// renderer is later changed. This invariant is unit-tested.

'use strict';

export const PROFILES = {
  management: {
    id: 'management',
    name: 'Practice Management',
    audience: 'management',
    blurb:
      'Operational detail for the partnership — demand, capacity, activity and backlog, with per-clinician breakdown. Every figure carries its source period.',
    perClinician: true,
    sections: {
      currentSnapshot: true,
      demand: true,
      capacity: true,
      activity: true,
      referrals: true,
      trends: true,
    },
  },
  staff: {
    id: 'staff',
    name: 'Staff Briefing',
    audience: 'staff',
    blurb:
      'How busy we were and what we got through, as a team. Workload is shown for the practice as a whole — not by individual clinician.',
    perClinician: false,
    sections: {
      currentSnapshot: true,
      demand: true,
      capacity: true,
      activity: true, // aggregate totals only — per-clinician rows are stripped
      referrals: false,
      trends: true,
    },
  },
  icb: {
    id: 'icb',
    name: 'ICB / System',
    audience: 'icb',
    blurb:
      'Access, demand and capacity in standard NHS terms. Practice-level figures only; metrics that cannot be derived from the source are omitted rather than estimated.',
    perClinician: false,
    sections: {
      currentSnapshot: false, // ICB cares about the period, not "right now"
      demand: true,
      capacity: true,
      activity: true,
      referrals: true,
      trends: true,
    },
  },
};

export const DEFAULT_PROFILE_ID = 'management';

export function getProfile(id) {
  return PROFILES[id] || PROFILES[DEFAULT_PROFILE_ID];
}

// Shape report data for a profile. PURE. The critical rule: when a profile is not
// per-clinician, every per-clinician collection is reduced to its aggregate so no
// individual row survives into the rendered report.
export function applyProfile(report, profile) {
  if (!report) return report;
  const out = { ...report, profile: { id: profile.id, name: profile.name, audience: profile.audience } };

  if (!profile.perClinician) {
    // Activity: keep totals, drop the per-HCP `users`/`rows`.
    if (out.activity) {
      out.activity = {
        totals: out.activity.totals || null,
        // explicit marker so the renderer can show "aggregate only" rather than a blank
        aggregateOnly: true,
      };
    }
    // Referrals: keep priority/status/specialty breakdowns (not person-identifying),
    // but drop the per-clinician table.
    if (out.referrals && out.referrals.byClinician) {
      out.referrals = { ...out.referrals, byClinician: undefined, aggregateOnly: true };
    }
  }

  // Drop sections the profile doesn't want (the renderer also checks, but stripping
  // here keeps any exported/serialised report honest to the profile).
  out.sectionsEnabled = { ...profile.sections };
  return out;
}

// Returns true if the given (already profile-applied) report contains any
// per-clinician/person-identifying data. Used by the test to assert the staff
// profile never leaks individuals.
export function containsPerClinician(report) {
  if (!report) return false;
  const a = report.activity;
  if (a && Array.isArray(a.users) && a.users.length) return true;
  if (a && Array.isArray(a.rows) && a.rows.length) return true;
  const r = report.referrals;
  if (r && Array.isArray(r.byClinician) && r.byClinician.length) return true;
  return false;
}
