// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — per-tab "?" help content (single source, consumed by both shells)
//
// Plain-English, UK English, two-line summary per module: what the tab is, and
// what to do first. Reference aid only — these descriptions are orientation
// help, NOT clinical decision support. Keep copy concise and clinically careful.
//
// Every tab id in side-panel/tab-catalog.js's TAB_CATALOG must have an entry
// here, including the two panel-only tabs (visualiser, about) — see CLAUDE.md
// "Panel-only tabs (intentional exceptions)". test-tab-help-coverage.js
// enforces this against both panel.html and pop-out.html's data-module set.
//
// Consumed as a plain ES module (`import { TAB_HELP } from '../shared/tab-help.js'`)
// by side-panel/panel.js and pop-out/pop-out.js — same pattern as
// shared/medicus-api.js / shared/task-api.js (see eslint.config.mjs's ESM
// file allowlist), so no dual-mode IIFE wrapper is needed here.

'use strict';

export const TAB_HELP = {
  today: {
    title: 'Today',
    what: 'A morning overview of the practice: waiting room, triage load, demand and free slots, all on one screen.',
    firstStep: 'Read it top to bottom before clinic to see what the day looks like.',
  },
  slots: {
    title: 'Slots',
    what: 'Counts of free appointment slots by type for any chosen date.',
    firstStep: 'Pick a date to see how many slots of each type are still free.',
  },
  capacity: {
    title: 'Forecast',
    what: 'A short-term projection of appointment capacity against expected demand.',
    firstStep: 'Check the coming days for any shortfall between slots and demand.',
  },
  sentinel: {
    title: 'Monitoring',
    what: 'Shows drug-monitoring and QOF (Quality and Outcomes Framework) reminders for the patient record you have open in Medicus.',
    firstStep: 'Open a patient in Medicus, then check the reminders here against the record.',
  },
  record: {
    title: 'Record',
    what: 'A live snapshot of the patient open in Medicus: problems, current medicines, recent results and prescribing-safety prompts — no PDF needed. It is incomplete by design (no allergies or immunisations, limited history) and never replaces reading the record.',
    firstStep:
      'Open a patient in Medicus, then read the summary here. For the multi-year timeline and continuity, open the full visualiser from the footer.',
  },
  activity: {
    title: 'Activity',
    what: 'Workload per staff member over a date range, broken down by task type.',
    firstStep: 'Choose a date range to see each person’s totals.',
  },
  referrals: {
    title: 'Referrals',
    what: 'A summary of referrals over a date range by priority, status, clinician and specialty.',
    firstStep: 'Set a date range to see referral counts and breakdowns.',
  },
  condor: {
    title: 'Condor',
    what: 'A live dashboard of practice pressure, pulling several demand signals together.',
    firstStep: 'Glance at the headline level to gauge how busy the practice is right now.',
  },
  trends: {
    title: 'Trends',
    what: 'How key practice figures have moved over time, shown as charts.',
    firstStep: 'Pick a measure and time window to see the trend line.',
  },
  reception: {
    title: 'Reception',
    what: 'Quick-reference pathways to help reception direct patient requests to the right place.',
    firstStep: 'Search or browse for the request type to see the suggested pathway.',
  },
  sweep: {
    title: 'Sweep',
    what: 'A pre-clinic scan of your upcoming patients that flags points worth a look beforehand.',
    firstStep: 'Run the sweep before clinic, then review each flagged patient in Medicus.',
  },
  knowledge: {
    title: 'Knowledge',
    what: 'A searchable store of the practice’s own notes, contacts and how-to information.',
    firstStep: 'Type a keyword to find the relevant practice note.',
  },
  submissions: {
    title: 'Submissions',
    what: 'Daily inbound task counts across medical, admin, investigation and prescription categories.',
    firstStep: 'Check today’s counts, or set a date range to compare days.',
  },
  visualiser: {
    title: 'Visualiser',
    what: 'Opens a full browser tab to analyse an exported patient-record PDF — a multi-year timeline view, separate from the panel.',
    firstStep: 'Export the patient record from Medicus as a PDF, then drop it into the visualiser tab that opens.',
  },
  about: {
    title: 'About',
    what: 'Module version info, an update check, and a feedback form for bugs or feature requests.',
    firstStep: 'Use "Check for updates" to confirm you are on the latest version.',
  },
};
