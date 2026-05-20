// Medicus Suite — Referrals API
//
// Endpoint:
//   GET {practiceCode}.api.england.medicus.health/referrals/clinical-audit-report
//     ?referralStartDate=YYYY-MM-DD
//     &referralEndDate=YYYY-MM-DD
//     &priorities[]=Routine&priorities[]=Urgent&priorities[]=TwoWeekWait
//     &statuses[]=Completed&statuses[]=Incomplete&statuses[]=Cancelled
//     &limit=2000
//
// Config response (no filter params):
//   { defaultReferralStartDate, defaultReferralEndDate, priorityOptions, statusOptions }
//
// Data response (with filter params):
//   { referrals: [{ referralId, referralDate, referralService, referringClinician,
//                   priority, displayStatus, isManualReferral, isNhsEReferral,
//                   patientGivenName, patientFamilyName }],
//     totalCount: number }

(function(global) {
  'use strict';

  const PRIORITY_COLOURS = {
    'Routine':       '#3b82f6',  // blue
    'Urgent':        '#f59e0b',  // amber
    'TwoWeekWait':   '#ef4444',  // red
  };

  const STATUS_COLOURS = {
    'Completed':  '#4ade80',  // green
    'Incomplete': '#f59e0b',  // amber
    'Cancelled':  '#94a3b8',  // grey
  };

  const ALL_PRIORITIES = ['Routine', 'Urgent', 'TwoWeekWait'];
  const ALL_STATUSES   = ['Completed', 'Incomplete', 'Cancelled'];

  function buildApiUrl(practiceCode, startDate, endDate, priorities, statuses) {
    const base = `https://${practiceCode}.api.england.medicus.health/referrals/clinical-audit-report`;
    const params = new URLSearchParams();
    params.append('referralStartDate', startDate);
    params.append('referralEndDate',   endDate);
    (priorities || ALL_PRIORITIES).forEach(p => params.append('priorities[]', p));
    (statuses   || ALL_STATUSES).forEach(s => params.append('statuses[]',   s));
    params.append('limit', '2000');
    return `${base}?${params.toString()}`;
  }

  async function fetchReferrals(practiceCode, startDate, endDate, opts) {
    opts = opts || {};
    const fetchImpl = opts.fetch || (typeof fetch !== 'undefined' ? fetch : null);
    if (!fetchImpl) throw new Error('No fetch impl');
    if (!practiceCode) throw new Error('No practice code');
    if (!startDate || !endDate) throw new Error('Date range required');

    const url = buildApiUrl(practiceCode, startDate, endDate, opts.priorities, opts.statuses);
    const r = await fetchImpl(url, { credentials: 'include' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();

    // If we got config instead of data (shouldn't happen with filter params, but guard it)
    if (data && Array.isArray(data.priorityOptions)) {
      throw new Error('Got config response instead of referral data — check API URL');
    }

    return { referrals: data.referrals || [], totalCount: data.totalCount || 0 };
  }

  // Parse the referralService field which uses ` – ` (em-dash) or ` - ` separators.
  // Typical format: "Service Name – Specialty – Hospital Name – TrustCode"
  // Returns { service, specialty, hospital, trustCode }
  function parseReferralService(s) {
    if (!s) return { service: '(unknown)', specialty: '(unknown)', hospital: '(unknown)', trustCode: '' };
    // Split on em-dash or plain hyphen surrounded by spaces
    const parts = s.split(/\s[–-]\s/);
    return {
      service:   (parts[0] || '').trim() || '(unknown)',
      specialty: (parts[1] || '').trim() || '(unknown)',
      hospital:  (parts[2] || '').trim() || '(unknown)',
      trustCode: (parts[3] || '').trim(),
    };
  }

  // Aggregate raw referrals array into chart-ready shapes.
  //
  // Returns:
  //   {
  //     byClinician:  [{ name, count, priorities: {Routine,Urgent,TwoWeekWait} }]  sorted desc
  //     bySpecialty:  [{ name, count }]  sorted desc
  //     byHospital:   [{ name, count }]  sorted desc
  //     byPriority:   { Routine: n, Urgent: n, TwoWeekWait: n }
  //     byStatus:     { Completed: n, Incomplete: n, Cancelled: n }
  //     total:        number
  //   }
  function aggregate(referrals) {
    const rows = Array.isArray(referrals) ? referrals : [];

    const clinicianMap  = new Map();
    const specialtyMap  = new Map();
    const hospitalMap   = new Map();
    const byPriority    = { Routine: 0, Urgent: 0, TwoWeekWait: 0 };
    const byStatus      = { Completed: 0, Incomplete: 0, Cancelled: 0 };

    for (const row of rows) {
      const clinician = row.referringClinician || '(unknown)';
      const { specialty, hospital } = parseReferralService(row.referralService);
      const priority = row.priority || '';
      const status   = row.displayStatus || '';

      // Clinician map — also track priority breakdown per clinician
      if (!clinicianMap.has(clinician)) {
        clinicianMap.set(clinician, { name: clinician, count: 0, priorities: { Routine: 0, Urgent: 0, TwoWeekWait: 0 } });
      }
      const cd = clinicianMap.get(clinician);
      cd.count++;
      if (priority in cd.priorities) cd.priorities[priority]++;

      // Specialty
      specialtyMap.set(specialty, (specialtyMap.get(specialty) || 0) + 1);

      // Hospital
      hospitalMap.set(hospital, (hospitalMap.get(hospital) || 0) + 1);

      // Priority totals
      if (priority in byPriority) byPriority[priority]++;

      // Status totals
      if (status in byStatus) byStatus[status]++;
    }

    const sortDesc = (map) =>
      [...map.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);

    return {
      byClinician: [...clinicianMap.values()].sort((a, b) => b.count - a.count),
      bySpecialty: sortDesc(specialtyMap),
      byHospital:  sortDesc(hospitalMap),
      byPriority,
      byStatus,
      total:       rows.length,
    };
  }

  // Date preset helpers — return [startDate, endDate] as YYYY-MM-DD strings (local time)
  function formatDate(d) {
    const yyyy = d.getFullYear();
    const mm   = String(d.getMonth() + 1).padStart(2, '0');
    const dd   = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  function preset(name, now) {
    const today = now ? new Date(now) : new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    const end   = new Date(today);

    switch (name) {
      case 'last7':
        start.setDate(start.getDate() - 6);
        break;
      case 'last30':
        start.setDate(start.getDate() - 29);
        break;
      case 'last90':
        start.setDate(start.getDate() - 89);
        break;
      case 'thisMonth':
        start.setDate(1);
        break;
      case 'last3m':
        start.setMonth(start.getMonth() - 3);
        start.setDate(1);
        end.setDate(0); // last day of month before current
        end.setMonth(end.getMonth());
        break;
      case 'last6m':
        start.setMonth(start.getMonth() - 6);
        start.setDate(1);
        break;
      case 'last12m':
        start.setFullYear(start.getFullYear() - 1);
        start.setDate(start.getDate() + 1);
        break;
      default:
        return null;
    }
    return [formatDate(start), formatDate(end)];
  }

  const api = {
    PRIORITY_COLOURS,
    STATUS_COLOURS,
    ALL_PRIORITIES,
    ALL_STATUSES,
    buildApiUrl,
    fetchReferrals,
    parseReferralService,
    aggregate,
    preset,
    formatDate,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.ReferralsApi = api;
  }
})(typeof window !== 'undefined' ? window : global);
