# Triage queue next — pulse, act-from-row, thread + silent

**What this is:** a build plan and visual spec for the three moves that would
change a Wednesday morning on the request queue. It sits on top of
`docs/plans/TRIAGE-NORTHSTAR-2026-07-22.md` (especially Workstreams B and C).
It does **not** reopen scoring, diagnosis, or auto-disposition.

**Mocks:** `docs/design/triage-queue-next/mock.html` (static, not loaded by the
extension). Open in a browser; each frame is a screenshot target.
**Callback (before / after the live pulse cut):**
`docs/design/triage-queue-next/before-after.html` (`?shot=compare`).

**Status:** first live cut shipped in **v3.236.4** (pulse + why-tray + thin act
tray + thread mark). Pref `queuePulseCompress` (default on). Book / Park /
silent-unchecked rail / B1 context headlines are still later.

---

## What already ships (so this is not a recap)

On the live queue today, independently injected families pile up on the name /
preview:

| Family | Host | Source |
|---|---|---|
| Age, priority, days-open, ranked rule + `+N`, Pharmacy First / ask-back | `.ch-queue-chips` | DOM / preview text (`decorateOneRow`) |
| Monitoring due | `.ch-q-mon` | `fetchAll` + rules engine |
| Patient flags | `.ch-q-pa` | patient-alerts store |
| Pending result | `.ch-q-pending` | session result cache × patient |
| Repeat contact | `.ch-q-repeat` | contact ledger (B3) |
| Carry-over | `.ch-q-carry` | task-age ledger (B5) |
| Result severity (results queue) | `.ch-q-result` | report fetch + result-severity |
| Colleague presence | task-presence chip | shared folder |
| Left-edge tint | `.ch-row-sev-red/amber` | known cached severity only |
| Keyboard cursor | `.ch-kbd-cursor` | j/k (already shipped) |

Each family is truthful. Together they are a chip pile. The three moves below
**compress, stage, and cross-link** those signals. They do not invent a fourth
grading engine.

---

## Binding constraints (from the north star — not negotiable)

1. **No composite urgency score.** Named, sourced signals only. The GP is the
   aggregation function. A pulse is a *visual weight + one headline name*,
   never a number, never “P1”.
2. **Escalate, never reassure.** No pulse is “not assessed / nothing matched”,
   never “all clear”. Green stays admin-routing (Pharmacy First), never a
   clinical all-clear.
3. **Reasons on every mark.** Hover / Space expands the named list. A badge
   with no why is out of scope.
4. **The human decides.** Act-from-row **stages drafts**. Nothing books,
   messages, files, or assigns until the existing confirm pattern.
5. **Fail visible, fail closed.** A fetch that has not returned must not look
   like a quiet row. Silent marks that need the record wait on the B-substrate
   cache; until then the row shows a dashed “record not checked” tick, not a
   blank.
6. **Injection law unchanged.** PREPEND, re-inject on every refresh, durable
   `rowIndex→taskUuid` map, de-dupe, top-level class in the `hud.css`
   token-block list, smoke-harness fixture before the first inject.
7. **Host page is light.** Tokens live in the injected `hud.css` block
   (TOKENS.md §Injected surfaces). Colorblind mode must survive by shape, not
   hue: red rail **filled**, amber rail **hollow**, silent mark a **diamond**.

North-star item IDs this plan consumes rather than re-proposes: **B1** context
chips, **B2** pending-lab cross-link, **B3** repeat-contact (already a chip —
this plan is the *thread* UI), **B4** monitoring on request rows, **C2**
prepare-only action packs, **C4** next-green-day draft, **1.2** status bar
(home for the huddle counts), **E-1.1** fail-visible states.

---

## 1 · Pulse — compress the pile to one weight

### Job

A duty GP scans 40 rows in under a minute and knows **where to look first**,
without reading six chips. Opening *why* is optional and cheap.

### What it is

Per row, a **rail + headline**:

- **Rail** (left edge, 4px, inset box-shadow — same “don’t fight AG-Grid box
  model” rule as today’s 3px tint):
  - **Red, filled** — at least one red named signal is known.
  - **Amber, hollow** — worst known signal is amber; no red.
  - **None** — nothing matched *or* not yet assessed. These two states are
    told apart by a 6px dashed tick in the rail slot (`record not checked`)
    vs a truly empty slot (`checked, no matched escalation`). Empty is not
    green.
- **Headline** — the single worst *named* signal, 10px sans, max ~18ch,
  ellipsis + `title` (same discipline as `.ch-q-rule-chip`). Examples:
  `MH crisis`, `Chest pain`, `MTX · FBC overdue`, `Pending K 5.8`.
- **Overflow** — quiet `· 3` (mono, `--text-3`). Click / Space opens the
  why-tray. Never drops a signal; it only hides it until asked.

Presence (colleague in the row) and Pharmacy First stay **out of the rail**.
Presence is team state; PF is a routing action. Both remain visible: eye on
the name, PF as a right-side action glyph once Act ships (or the existing
green chip until then).

Age-alone and days-open-alone do **not** own the rail. A 7-year-old with a
routine cream request is not a red row; a 7-year-old plus “wants to die” is
red because **MH crisis** owns the headline. Contract-clock / SLA (north-star
A1) lives in the Created column as a mono deadline, not in the clinical rail
— mixing “must action today” with “chest pain” teaches the wrong lesson.

### Composition (named max, not a score)

Reuse the existing kind rank (`red > amber > info > meta`). Within a kind,
prefer **request-text rules** over record-cross signals only when both are
the same kind — the words in *this* request are why the row is in the queue.
Record-cross (B1/B2/B4) may still *raise* the rail when the request itself
is quiet (that is the silent-request case).

```
worstKind = max(rule, monitoring, pendingResult, patientFlag, pathwayEscalation)
headline  = first item at worstKind, request-text preferred
overflow  = count(all named signals) - 1
rail      = filled red | hollow amber | dashed unchecked | empty
```

No arithmetic. No “3 reds = more urgent than 1 red”. One red MH-crisis and
one red chest-pain are the same rail; the headline names which.

### Why-tray (Space / click overflow / click headline)

A full-width tray **under the preview**, not a sibling of the name cell
(composer layout rule: hoist, `flex: 0 0 100%`, `grid-column: 1 / -1`).

Each line is a named signal + source + the evidence already shipped
(match sentence, analyte + date, ledger count). Footer, always:

> Not a score. A quiet rail is not all-clear.

Demoted / negated matches (3.4) stay in the tray as dashed outline chips —
never omitted.

### Data / inject

- **v1 (no new fetch):** compose from signals already on the row — rule
  chips, age/priority/days-open (as tray context, not rail), PF/ask-back,
  plus whatever fetch-driven chips have already landed (mon, pending,
  repeat, flags). Pulse is a **re-render of known state**, same durability
  as `decorateOneRow`.
- **v2:** silent headlines ride B-substrate caches (B1/B2/B4). Until a
  row’s record pass has run, rail = dashed unchecked.

New top-level hosts: `.ch-q-pulse`, `.ch-q-why`. Both go on the `hud.css`
token-block selector list. Marker class `.ch-row-pulse-red/amber` may
replace or thicken today’s `.ch-row-sev-*` so we do not run two left-edge
tints.

### Safety

- Hazard: pulse-as-score / automation bias. Control: no number; named
  headline; tray footer; Clinical Safety Notice sentence that a quiet rail
  is not clearance (same family as H-026 / limitation 30).
- Hazard: headline hides a second red. Control: overflow count is
  mandatory whenever `n > 1`; tray lists every red first.
- Colorblind: filled vs hollow vs diamond vs dashed. Do not add a new hue.

---

## 2 · Act-from-the-row — stage the next step

### Job

Kill the open-task-and-lose-your-place round trip for the rows that do not
need a record. The expensive click becomes the exception.

### What it is

A `›` control on the preview (keyboard: `Enter` on the j/k cursor). Opens
an **act tray** under the row — same full-width hoist as the why-tray.

Four prepare-only actions, numbered, consequence-stated (reception-composer
lessons):

| # | Action | What it stages | What it does *not* do |
|---|---|---|---|
| 1 | **Book** | C4 next-green-day snippet (preset + day + “N free as of hh:mm”) into a draft | Does not hold or book a slot |
| 2 | **Pharmacy First** | Pathway’s own CSO-signed draft sentence | Does not divert, message, or claim eligibility beyond the existing fail-closed age gate |
| 3 | **Ask-back** | Reception-match gap questions / flagged-in-text list as comment draft | Does not send an SMS |
| 4 | **Park until…** | Local parked-until timestamp on this `taskUuid` (session + ledger, no clinical text) | Does not change Medicus status; a parked row must still look *touched*, not unseen |

Actions that do not apply are present and disabled, with the reason
(“no matched pathway”, “age unknown — Pharmacy First not offered”).
Disabled is information, not a missing button.

### Confirm bar

Staging is not completion. A row with a draft shows a persistent strip
(not a timeout):

> Not yet submitted — reception sees nothing until you confirm.

Confirm opens the existing pattern: named list of exactly what will be
written (comment insert / task create / nothing-but-local-park). Copy ban
from `test-reception-quick-actions-ui.js`: no “Done / Sent / Booked /
Submitted” on a click. Undo where a write happened (1.4).

Opening the Medicus task remains one click on the name. Act is additive.

### Data / inject

- Book and PF/ask-back reuse C2/C4 + `window.SentinelReceptionMatch` —
  already computed in `decorateOneRow` for the pathway chip.
- Park is a new small ledger (taskUuid + until + actor), same
  not-backed-up doctrine as the contact ledger (a restore must not
  fabricate “I parked this”).
- Host: `.ch-q-act`. Must not insert as a bare sibling of the patient-name
  cell (H-049 layout rule). Prefer the preview row, prepend, full-span.

### Safety

- Hazard: staging read as done (H-049 family). Control: numbered steps,
  persistent “not yet submitted”, source-grep for completion words.
- Hazard: Book draft looks like a held slot. Control: snippet always
  includes “or nearest equivalent” + timestamp; never a slot id.
- North-star non-goal holds: no autonomous disposition.

---

## 3 · Thread + silent cross-signal

### Job

Two misses the chip pile cannot see:

1. **Thread** — this is the fourth message, not a new patient.
2. **Silent** — the request text is quiet; the record is not
   (overdue MTX bloods, unfiled K, open 2WW, structured allergy).

### Thread (B3, visual)

B3 already chips `3rd contact in 14d` / `2 open requests`. The new object
is a **stack under the name**, not another chip.

- Collapsed: mono `4 · 10d` next to the name (count · window).
- Expanded: last few request *titles / first lines* already visible on
  this device’s contact ledger or current-session open tasks — **no new
  free-text store**. If we only have counts, we show counts; we do not
  invent titles.
- Household (stretch): same-address / same-family if a contacts or
  household hook exists — otherwise omit. Do not guess on surname.

Presence of a thread never raises the rail by itself. Four cream requests
are a story, not a red flag. A thread **plus** a red rule still names the
rule as headline; the stack explains the shape.

### Silent mark (B1 / B2 / B4, one diamond)

When the request-text rules are quiet (or info-only) and a record-cross
signal is red/amber:

- Rail may rise (amber hollow / red filled) with the **record** headline
  (`MTX · FBC overdue`, `Pending K 5.8`, `Open 2WW`).
- A **diamond** (shape, not a fourth hue) sits on the headline so a GP
  can see *this red did not come from the words on the row*. That is the
  whole point of HSSIB’s “record not at the moment of triage”.

v1 silent set (escalate-only, absence never chipped):

| Signal | Source | Headline example |
|---|---|---|
| Monitoring due (B4) | existing `.ch-q-mon` eval | `MTX · FBC overdue` |
| Unfiled abnormal (B2) | session `_queueResultCache` × patient | `Pending K 5.8` |
| Context subset (B1) | same HUD evaluators, cap 2 | `Frailty`, `Recent admission` |
| Structured allergy × request words | `AllergyIntolerance` via `fetchAll`, not banner text | `Penicillin · mentioned amox` |

Allergy is the one new matcher: request text mentions a substance that is
an active allergy. Fail closed if structured allergies have not loaded.
Do not use banner-warning string matching (today’s HUD gap).

Open 2WW / active referral is **discovery-gated** — only if a reachable
field exists. If the spike fails, omit; do not scrape letters.

### Data / inject

- Thread expand reads `_contactLogMem` + `_sessionContacts` (already in
  `content.js`). Titles only when the current task-list or session still
  holds them.
- Silent diamond is a modifier on `.ch-q-pulse`, not a new chip family.
  Still needs the B-substrate; dashed rail until the pass has run.
- Stale-cache rules from B2 stand: timestamp on the why-line; die with
  the source cache entry; respect the sort-canary.

### Safety

- Hazard: thread count as deterioration (automation bias). Control: rail
  does not rise on count alone; tray says “count, not a grade”.
- Hazard: stale pending-K (H-045 family). Control: B2 timestamp + TTL.
- Hazard: navigator sees “risk to self” / palliative in a silent
  headline. Control: north-star role-visibility decision **before** B1
  headlines ship on the queue. Until then, silent v1 = monitoring +
  pending-lab only (clinician-weight, already on results rows).
- MHRA: B2/B4 remain the classification boundary the north star already
  named. Pulse composition of *already-shipping* signals is workflow
  chrome; new silent matchers (allergy × mention, 2WW) need the same
  CSO pass as B1.

---

## How the three compose on one row

```
[rail]  ADEYEMI, Chioma   29y      Photo of rash, spreading          MH crisis     ›
        4 · 10d                     yesterday still itching          · 2
```

- Rail / headline = Pulse.
- `›` = Act.
- `4 · 10d` = Thread.
- If the headline is a record signal, it carries the diamond.

One why-tray, one act-tray — never both open. `Space` = why, `Enter` = act,
`Esc` = close. j/k still moves the cursor (already shipped).

Huddle counts (medical remaining / pulsed-red / children / claimed) belong
on the **1.2 status bar**, not a fifth strip and not this plan’s first
cut. Mentioned so we do not invent a new chrome home.

---

## What we will not build

- A canvas on the queue.
- A score, a P-rank, or a “likely UTI”.
- Auto-file / auto-book / auto-assign from the tray.
- Green ticks that mean clinically fine.
- Hiding chips with no overflow / no tray (that is an all-clear).
- A second left-edge tint fighting `.ch-row-sev-*`.
- Household matching by surname.

---

## Suggested build order (technical)

1. **Pulse v1** over signals already on the row. Replace the chip pile in
   the preview with rail + headline + overflow. Keep today’s chips inside
   the why-tray. Smoke-harness + token-block class. Pref-gate
   (`queue.pulseCompress`, default on for new, off until one duty session
   of feedback if you want a belt).
2. **Why-tray** as the only place chips still render. Keyboard Space.
3. **Act tray v1** — PF + ask-back drafts only (already in hand). Confirm
   bar + copy-ban test extension. Book and Park after.
4. **Thread expand** on the existing B3 count (no new fetch).
5. **Silent diamond + B4/B2 headlines** once the B-substrate has been
   soak-tested (north-star release 3 gate, including MHRA opinion).
   Allergy × mention after structured allergy is on the queue fetch.
6. Role-visibility decision, then B1 context headlines.

Pulse v1 is the only step that changes every row on day one. Everything
else can land behind the same tray.

---

## Open questions (need a Dave call, not a guess)

1. **Pref default.** Pulse-on for everyone, or opt-in for a week?
2. **Navigators.** Silent v1 without B1 (monitoring + pending-lab only)
   until the role question is answered — agree?
3. **Park.** Local-only vs a Medicus status we would have to write. Local
   is honest and limited; a write is a new HAR.
4. **SLA vs rail.** Keep A1 in the Created column, never in the rail?
5. **Results queue.** Same pulse chrome (severity already has a tint +
   chips) or leave results as today’s chip + fileable tick?

---

## Mock frames

| File / frame | What to look at |
|---|---|
| `today` | Honest chip pile on a busy duty list |
| `pulse-scan` | Same list, rail + headline only |
| `pulse-why` | Named reasons, not a score |
| `act-stage` | Numbered prepare-only actions |
| `act-confirm` | Persistent “not yet submitted” |
| `thread` | Stack under the name |
| `silent` | Quiet request, record headline + diamond |
| `composed` | All three on one list |
| `colorblind` | Filled / hollow / diamond / dashed |
