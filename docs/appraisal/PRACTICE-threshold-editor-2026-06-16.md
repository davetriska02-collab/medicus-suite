# The Practice — appraisal: alert-threshold editor (v3.98.0)

**Date:** 2026-06-16 · **Scope:** ONLY the new in-palette alert-threshold editor
(`side-panel/thresholds/thresholds.js`, palette command, `thresh-*` CSS,
configurable waiting-room minutes). Questions: is it clear, does it clutter, is
it discoverable, can it be misused.

> **Synthetic panel — not user research.** A heuristic for finding friction.

## 1. Verdict

The editor is genuinely clean and **does not clutter the UI** — it lives behind
Ctrl+K, invisible until summoned, and the two non-target personas (receptionist,
and the technophobe once she's *in* it) both found it tidy and obviously "not for
me / safe to leave". For the people who'll actually use it (manager, power user)
it's operable and the red≥amber guard is the right instinct. Three real gaps hold
it back: (1) it is **palette-only**, so the new waiting-room threshold has *no
visible entry point* and the technophobe partner can never reach it; (2) its
**scope is ambiguous and mis-stated** — it's a per-browser setting, but a line
copied from the tab chooser ("your choice is yours alone") actively misleads,
which the manager can't defend; (3) the **live-apply vs DONE** model and the
**silently-disabled strip** are under-explained.

## 2. The panel

| Persona | Band | Score /10 | One-line |
|---|---|---|---|
| Margaret | technophobe partner | **3** | "I'd never find it — Ctrl+K isn't a thing I do; no visible Settings" |
| Chloe | receptionist | **8** | "Doesn't clutter my day; I'd know to leave it alone" |
| Janet | practice manager | **6** | "I can set it, but I can't *defend* it — whose setting is this?" |
| Raj | pharmacist | **7** | "Safe enough for an *operational* strip; disabled-state needs a loud warning" |
| Geoff | power user | **8** | "You delivered my ask, in the palette — now give me defaults/reset and triage inline" |

## 3. Findings

### Discoverability (the headline)

- **T1 · Palette-only entry locks out the technophobe. [MAJOR, blocker for floor]**
  *Verified:* the waiting-room threshold is reachable **only** via Ctrl+K — the
  "Waiting room" mention in Options is just a connection-probe, not an editor.
  Margaret (who doesn't use shortcuts) can't reach it at all; she'd "ask someone
  younger". Demand thresholds at least also live in Options › Submissions; the
  waiting-room one is stranded. **Fix:** add a visible entry point — surface the
  same editor from Options (a settings section) and/or the settings gear, keeping
  the palette command for power users. *This is the single biggest fix.*

### Trust / defensibility

- **T2 · Scope is mis-stated. [MAJOR]** *Verified:* settings write to
  `chrome.storage.local` — **per browser profile**, not practice-wide. The footer
  hint "Your choice is yours alone" is a copy-paste from the tab chooser (where it
  meant "practice-pushed config won't override your tabs") and here it muddies the
  question Janet most needs answered: is this *my* setting or the *practice's*?
  Raj read the same line as "no guard rails / no audit". **Fix:** remove that line;
  state scope plainly ("Applies to this device") so the manager can defend it.
- **T3 · Live-apply vs DONE is ambiguous. [MAJOR, 3 bands]** The copy says "changes
  apply straight away" but the button says **DONE**, which reads as Save. Margaret
  mistrusts the missing Save; Janet asks "what's DONE for, is there undo?"; Geoff
  wants it labelled honestly. *Verified:* edits persist on field change; DONE only
  closes. **Fix:** relabel DONE → "Close", and show a transient "Saved ✓" on each
  committed edit.

### Safety (operational class)

- **T4 · A disabled strip is silent AND invisible. [MAJOR, Raj/Geoff]** Unticking
  "Alert on this" just clears a checkbox — the row isn't greyed and nothing says
  the strip is now off. For a workload strip a muted-and-unmarked alert is a real
  footgun. **Fix:** grey the row and show an inline "OFF — no alerts for this"
  when unticked. *(Raj's #1 ask.)* Raj's wider point stands and is reassuring:
  this is an **operational** alert class (waiting room / backlog), not clinical
  drug-monitoring, so user-tunable thresholds and mute toggles are *legitimate*
  here in a way they would never be on a clinical alert.

### Clarity (minor)

- **T5 · "/day" and "amber/red" meaning. [MINOR, Janet/Chloe]** *Verified:* "/day"
  = tasks created today (resets midnight). Chloe wants a tooltip so she can answer
  a GP; Janet wants the counting basis and what amber/red actually *do* (colour
  only, vs a notification). **Fix:** tooltips — "per day (resets midnight)" and a
  one-line note that the strips change colour (no pop-up is sent).

### Power-user polish (minor)

- **T6 · Show shipped defaults + reset-to-default. [MINOR, Raj/Geoff]** A faint
  "default 10/20" and a one-click reset per row.
- **T7 · Soft sanity nudge on absurd values. [MINOR, Raj]** Not a hard cap — a hint
  if red waiting > ~60 min ("this will rarely fire — sure?").
- **T8 · Waiting room has no enable toggle, demand does. [MINOR, Geoff]** *Verified:*
  the waiting strip is always-on by design (it reflects the live waiting room, not
  a thing you enable). **Adapt:** a small "always on" note for parity, rather than a
  toggle that wouldn't mean anything.

### Standout strengths (protect)

Does **not** clutter the UI (hidden in the palette; Chloe 8, Geoff 8) · the
red≥amber guard stated in plain English · per-strip enable toggles · units printed
on every field (min, /day) · honest "operational, not clinical" framing · the
palette is the right home for the power user who asked for it.

## 4. Prioritised path to 9

Quick wins (S):
1. **T2** remove the misleading line + state device scope.
2. **T3** DONE → "Close" + "Saved ✓" confirmation.
3. **T4** greyed + "OFF" caption on a disabled row.
4. **T5** tooltips for "/day" and amber/red meaning.
5. **T6** show defaults + reset-to-default per row.
6. **T8** "always on" note on the waiting row.

Medium (M):
7. **T1** add a visible (Options/settings) entry point to the same editor — the
   one that unblocks Margaret.
8. **T7** soft sanity nudge.

Feature (L, roadmap):
9. Inline triage editing (or its own palette command) — Geoff's last asymmetry.
10. Current-value anchor ("practice average 18/day") beside each field — Janet.

## 5. Judgement calls

- **Change audit / "last changed by" (Raj)** — overruled: these are per-device
  local prefs; the suite has no central account to audit against. *Reverse if* a
  practice-wide settings sync is ever added.
- **Margaret's "move it out of the palette entirely"** — adapted, not adopted: keep
  the palette command (power users + tidy UI), and *add* a visible entry point
  rather than removing the palette home. *Reverse by:* dropping the palette command
  if it ever proves redundant.

## 6. Reproduce

States in `/tmp/the-practice/thresh/` (editor dark + light with values; validation;
the palette showing the command). Panel: personas 1, 4, 8, 9, 10. Editor driven
through the real Ctrl+K palette in the harness.
