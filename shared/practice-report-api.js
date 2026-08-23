// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Practice Report public API (architecture plan Phase 3.4)
//
// The full-tab practice-report.js must not import condor module internals.
// This barrel is the one import surface; Condor keeps owning the files and
// also imports them directly. Re-export only — no new logic.

export { resolveRange, buildReport, localISO, buildSnapshotRow, saveSnapshot, loadSnapshots } from '../side-panel/modules/condor/report/report-data.js';
export { getProfile, applyProfile } from '../side-panel/modules/condor/report/report-profiles.js';
export { buildReportHtml, buildReportCsv, SECTION_LABELS } from '../side-panel/modules/condor/report/report-render.js';
export { fetchAllStreams } from '../side-panel/modules/condor/condor-data.js';
export { computeIndex } from '../side-panel/modules/condor/condor-index-core.js';
