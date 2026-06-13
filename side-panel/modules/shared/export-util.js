// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — shared CSV / clipboard export helper
//
// Why this exists: the appraisal's manager and power-user personas both wanted
// to get numbers OUT (board packs, their own trend tracking), but only Referrals
// had an export. Rather than each module re-implementing CSV escaping and Blob
// download, this is the single sanctioned helper. Keep all new data exports here.
//
// Usage:
//   import { downloadCsv, copyTsv } from '../shared/export-util.js';
//   downloadCsv('slots-2026-06-13.csv', ['Clinician', 'Slots'], rows);
//   await copyTsv(['Clinician', 'Slots'], rows); // for paste into a spreadsheet

'use strict';

// RFC-4180 cell escaping: quote when the value contains a comma, quote or newline.
export function csvCell(val) {
  const s = String(val ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toMatrix(header, rows) {
  const head = Array.isArray(header) ? header : [];
  const body = Array.isArray(rows) ? rows : [];
  return [head, ...body];
}

// Build a CSV string from a header array and an array of row arrays.
export function toCsv(header, rows) {
  return toMatrix(header, rows)
    .map((r) => r.map(csvCell).join(','))
    .join('\r\n');
}

// Trigger a client-side CSV download. No data leaves the browser.
export function downloadCsv(filename, header, rows) {
  const blob = new Blob([toCsv(header, rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Tab-separated text is what spreadsheets expect on paste. Returns true on success.
export async function copyTsv(header, rows) {
  const text = toMatrix(header, rows)
    .map((r) => r.map((c) => String(c ?? '').replace(/\t/g, ' ')).join('\t'))
    .join('\n');
  return copyText(text);
}

// Clipboard write with the execCommand fallback the rest of the suite uses
// (navigator.clipboard is not always available in the side-panel context).
export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) {
    /* fall through to legacy path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (_) {
    return false;
  }
}
