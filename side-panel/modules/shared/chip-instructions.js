// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — shared chip-instruction helpers (ESM)
//
// Exports only the IDENTICAL parts of sweep-core.js and sentinel.js chip logic:
//   - NON_BLOOD_TEST_RE / isBloodTest()  — same regex, same logic in both consumers
//   - groupInstructionsByAction()        — the byAction Map dedup, same structure in both
//
// The QOF wording tables and action strings remain per-consumer ON PURPOSE
// (reception print handout vs admin copy-text audiences).
// Do not unify them; test-chip-instructions.js pins both independently.
//
// Future option (deferred — see ws4-hygiene.md §C1):
//   if this file grows, consider extracting shared/clinical-thresholds.js with the
//   UMD guard pattern used by engine/ and shared/ files.

'use strict';

// Monitoring "tests" are a mix of venous bloods (FBC, U&E, LFT, lithium level…)
// and physical checks done by an HCA (BP, weight, pulse, height, ECG). Calling
// a blood-pressure check a "blood test" sends reception to book the wrong slot.
// Character-identical in sweep-core.js and sentinel.js — do not modify without
// updating both consumers and re-running test-chip-instructions.js.
export const NON_BLOOD_TEST_RE =
  /\b(b\.?p\.?|blood pressure|pulse|heart rate|weight|height|bmi|ecg|cxr|chest x-?ray|waist|peak flow|spirometr|annual review)\b/i;

// Returns true when the test name refers to a venous blood test (not an HCA check).
export function isBloodTest(name) {
  return !NON_BLOOD_TEST_RE.test(String(name || ''));
}

// Group chip instructions by their booking action, deduplicating detail strings.
//
// chips:         array of chip objects
// instructionFn: (chip) => { action, detail } | null  — per-consumer chipInstruction
//
// Returns [{ action, details: string[] }] in Map insertion order.
// Callers join details with '; ' — consistent with both buildHandout and buildAdminSummaryText.
export function groupInstructionsByAction(chips, instructionFn) {
  const byAction = new Map(); // action → [unique details], insertion-ordered
  for (const chip of chips || []) {
    const instr = instructionFn(chip);
    if (!instr) continue;
    if (!byAction.has(instr.action)) byAction.set(instr.action, []);
    const details = byAction.get(instr.action);
    if (instr.detail && !details.includes(instr.detail)) details.push(instr.detail);
  }
  return [...byAction.entries()].map(([action, details]) => ({ action, details }));
}
