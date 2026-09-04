// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — per-tab "?" help content (single source, consumed by both shells)
//
// Plain-English, UK English, two-line summary per module: what the tab is, and
// what to do first. Reference aid only — these descriptions are orientation
// help, NOT clinical decision support. Keep copy concise and clinically careful.
//
// Every tab id in side-panel/tab-catalog.js's TAB_CATALOG must have an entry
// here, including the panel-only tabs (duplicate-checker, rota-app) — see
// CLAUDE.md "Panel-only tabs (intentional exceptions)". test-tab-help-coverage.js
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
    what: 'Shows drug-monitoring and QOF (Quality and Outcomes Framework) reminders for the patient record you have open in Medicus. The panel auto-follows whichever patient is open — no need to search or refresh.',
    firstStep:
      'Open a patient in Medicus, then check the reminders here against the record. If the audit line shows "N unmatched", click it to name the medicines that didn’t match a monitoring rule.',
  },
  record: {
    title: 'Record',
    what: 'A live snapshot of the patient open in Medicus: problems, current medicines, recent results and prescribing-safety prompts — no PDF needed. It is incomplete by design (no allergies or immunisations, limited history) and never replaces reading the record.',
    firstStep: 'Open a patient in Medicus, then read the summary here.',
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
  signing: {
    title: 'Signing',
    what: 'Your open repeat-prescription requests, each shown with the monitoring already recorded for that patient — riskiest first.',
    firstStep:
      'Work the pile top-down; anything flagged red deserves the record open before you sign. No flag is not an all-clear.',
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
  leaflets: {
    title: 'Leaflets',
    what: 'Find the right NHS patient information leaflet for a condition or medicine, ready to open or copy a link to share.',
    firstStep: 'Type a condition or medicine name — every search also offers a direct nhs.uk search as a fallback.',
  },
  'patient-alerts': {
    title: 'Patient Alerts',
    what: 'Your practice’s own per-patient flags — interpreter required, safeguarding concern, medication-seeking behaviour, or anything you define. Flags appear here, on the alert strip and on the Monitoring banner whenever that patient is open in Medicus. Stored in this browser profile; share practice-wide via Options → Backup.',
    firstStep:
      'Open a patient in Medicus, then add an alert — pick a preset or write your own. Keep wording professional and factual: flags are visible to every practice user and disclosable to the patient.',
  },
  phrases: {
    title: 'Phrases',
    what: 'A library of reusable message blocks — openers, results wording, safety-netting, sign-offs — you compose into one message and copy. It copies text only: you paste it into the right Medicus box and send it yourself; nothing is sent or written for you.',
    firstStep:
      'Tap blocks to build a message (or type /trigger in search), press Copy, then paste into Medicus. Type over every *** with the patient’s details — they are never filled in for you.',
  },
  rota: {
    title: 'Rota',
    what: 'Today’s duty cover, who is on leave, sessions still needing cover and this week’s high-priority staffing warnings.',
    firstStep: 'Glance at duty cover for AM and PM, then open the Rota manager (new tab) to fix any gap.',
  },
  board: {
    title: 'Note',
    what: 'A configurable display board for a waiting-room TV or a staff-room monitor. You add boards and set the words. Public profiles show only counts, wait bands and the message you type — never patient names.',
    firstStep:
      'Pick a style, add or rename a board, set the words and when the room looks busy, optionally paste a practice YouTube playlist, then open it on the computer already plugged into the TV and press Fullscreen (or F).',
  },
  'rota-app': {
    title: 'Rota manager',
    what: 'Opens the full rota application in a new browser tab: working patterns, leave (April–March, session-accounted), registrar supervision, duty fairness pro-rata to contracted sessions and a cover worklist.',
    firstStep:
      'Add your staff and their contracted sessions first — everything else (leave, duty fairness, safe-staffing warnings) is calculated from them.',
  },
  'duplicate-checker': {
    title: 'Duplicates',
    what: 'Practice-wide scan for GP2GP duplicate-record reimport errors — flags candidate duplicate entries per patient by confidence tier for bulk-removal or merge.',
    firstStep:
      'Run a full or incremental practice scan, then click on a flagged patient in the results list to analyse their record.',
  },
};
