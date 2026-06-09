---
name: redteam-rules
description: >
  Adversarial red-team sweep of Sentinel's drug-monitoring rules. Spawns one Haiku subagent per rule
  (batched, parallel) to generate UK prescription strings that SHOULD trigger monitoring but are
  missing from the match list, plus potential false positives caused by substring overlap. Candidates
  are mechanically verified against the real drugMatchesRule() engine — LLM guesses are never
  trusted. Produces a patient-safety report: CRITICAL/HIGH confirmed gaps and false positives, with
  exact match-list additions needed. Report-only — no rule edits are made without CSO review.
  Use when Dave says: red-team the rules, find monitoring gaps, what brands are we missing, check
  rule coverage, are we missing any brands, coverage check, or after any drug-rules.json edit where
  new rules or brands were added. Do NOT trigger for routine feature work or the-keeper runs.
---

# Redteam Rules — adversarial coverage sweep for Sentinel drug monitoring

You are running the Redteam Rules skill for Witley and Milford Surgery. This is a
**patient-safety-critical** operation. The failure mode you are hunting is **silent**: a UK
prescription that should trigger monitoring simply never fires a chip — no error, no log, just a
missing alert. The gap may sit undetected for months until a clinician notices a patient on an
un-monitored DMARD or antipsychotic. This skill converts "a clinician notices a missing alert
months later" into "CI fails this week".

## Why this matters

From the project's own `CLAUDE.md` (internalise this):

- Drug matching is **case-insensitive substring** against `drug.match`. A med prescribed under a
  brand the rule doesn't list **never fires its alert** — no error, just a missing chip.
  That is a patient-safety risk, not a cosmetic one.
- `drug.exclude` is sharp: an exclude string silently drops every med whose name contains it,
  including legitimate ones. False positives (an unrelated drug matching a rule) are the inverse
  risk: spurious monitoring alerts erode clinician trust.

This skill finds both failure modes, verifies every candidate against the **real engine** (never
trusting model recall alone), and gives the CSO an unambiguous action list.

## Before you start

Read these files:
- `rules/drug-rules.json` — the 25 monitoring rules you are red-teaming; note each rule's
  `id`, `drug.match`, `drug.exclude`, `drugClass`, `source`, and `notes`.
- `test-drug-brand-coverage.js` — the existing EXPECTED map (what's already regression-tested);
  read it as text and extract the EXPECTED and MUST_NOT maps so you know what's already covered.
- `agents/REDTEAMER.md` — the Haiku adversary brief you will dispatch per rule.

## The pipeline

Two stages: parallel adversarial generation, then mechanical verification.

| Stage | Who | Model tier | Job |
|-------|-----|-----------|-----|
| 1 Generate | One Haiku subagent per rule/group | Haiku (fast, cheap, parallel) | Generate UK prescription strings that should match the rule but might not, plus potential false positives. Return structured JSON. |
| 2 Verify + Report | You, the orchestrator | Sonnet (this session) | Run every candidate through the real drugMatchesRule() engine via Node subprocess. Classify: CONFIRMED GAP / FALSE POSITIVE / OK. Write the report. |

There are no edits in this skill. Report-only. The CSO (Dave) decides what to add.

## Stage 1 — Generate (parallel Haiku sweep)

### Prepare per-rule packets

For each enabled drug-monitoring rule in `rules/drug-rules.json`, build a packet:
```json
{
  "ruleId": "...",
  "drugClass": "...",
  "match": [...],
  "exclude": [...],
  "source": "...",
  "notes": "...",
  "alreadyTested": [...]   // from EXPECTED[ruleId] in test-drug-brand-coverage.js
}
```

To extract `EXPECTED[ruleId]` from the test file (it's not exported), read
`test-drug-brand-coverage.js` as text and parse the object literal. The simplest approach: use
Node `vm.runInNewContext` in `scripts/verify_candidates.js` — or just read the file text and pass
the relevant slice as a string in the agent prompt.

### Grouping and batching

There are ~25 rules. Group before dispatching:
- `adhd-stimulant-paediatric` and `adhd-stimulant-adult` share identical `match`/`exclude` — one
  agent covers both.
- `hrt-systemic`, `cocp`, and `pop` share a contraceptive/oestrogen substring-overlap concern —
  dispatch together as one packet so the agent can reason about cross-rule false positives
  (ethinylestradiol / estradiol / qlaira etc.).
- All other rules: one agent per rule.

This collapses 25 rules to ~22 agent tasks. Dispatch in batches of **8 parallel agents per wave**
(send all 8 in a single message with multiple Agent tool calls — do not interleave awaiting):
- Wave 1: 8 agents
- Wave 2: 8 agents
- Wave 3: remaining agents

Collect all responses before moving to Stage 2.

### Agent model intent

Request Haiku tier for all REDTEAMER agents. The agents/REDTEAMER.md brief is self-contained;
pass the per-rule packet as a JSON block in the prompt using the template in that brief.

### Each agent returns

```json
{
  "ruleId": "...",
  "potentialGaps": [
    {"drug": "Brand 10mg tablets", "reason": "UK brand of X; name contains no current match substring"}
  ],
  "potentialFalsePositives": [
    {"drug": "Unrelated 5mg", "reason": "contains match substring 'xyz' from an unrelated drug class"}
  ]
}
```

Discard any response that is not valid JSON or has no `ruleId`. A hallucinated brand that doesn't
exist on dm+d is harmless — the mechanical verifier will classify it correctly (a non-existent brand
either matches or doesn't; if it matches a rule it's worth flagging; if it doesn't it's ignored).

## Stage 2 — Mechanical verification

This is the safety-critical anti-hallucination step. No candidate is reported as a confirmed gap
or false positive unless the **real engine** agrees.

### Prepare candidates file

Merge all agent JSON responses into `/tmp/redteam-rules/candidates.json`:
```json
[
  {"ruleId": "methotrexate-maintenance", "drug": "Methofar 10mg tablets", "kind": "gap", "reason": "..."},
  {"ruleId": "hrt-systemic", "drug": "Livial 2.5mg tablets", "kind": "fp", "reason": "..."},
  ...
]
```
Use `kind: "gap"` for potentialGaps and `kind: "fp"` for potentialFalsePositives.

### Run the verifier

```bash
node .claude/skills/redteam-rules/scripts/verify_candidates.js \
  /tmp/redteam-rules/candidates.json \
  /tmp/redteam-rules/findings.json
```

The script uses `require('./engine/rules-engine.js')` and `require('./rules/drug-rules.json')`
against the live files. It classifies each candidate:

| Candidate kind | `drugMatchesRule` result | Classification |
|---|---|---|
| gap | false | **CONFIRMED GAP** — should fire, doesn't |
| gap | true | OK / already covered |
| fp | true | **FALSE POSITIVE** — fires when it shouldn't |
| fp | false | OK / correctly rejected |

**HRT rule special case:** The `hrt-systemic` rule applies an additional oestrogen gate in
`evaluateDrugRule` *after* `drugMatchesRule` — so a progestogen-only drug passing
`drugMatchesRule('hrt-systemic', …)` is an engine-level correct rejection, not a code bug.
The verifier script handles this: for `hrt-systemic` false-positive candidates, a
`drugMatchesRule` true result is still flagged but annotated
`"note": "hrtContext oestrogen gate may suppress this at eval time — verify manually"`.

**Severity assignment** (in the script):
- CONFIRMED GAP on a high-risk rule → `severity: "CRITICAL"`:
  `methotrexate-maintenance`, `leflunomide-maintenance`, `azathioprine-maintenance`,
  `hydroxychloroquine-maintenance`, `carbamazepine-maintenance`, `lithium-maintenance`,
  `amiodarone-maintenance`, `carbimazole-propylthiouracil`, `antipsychotic`
- CONFIRMED GAP on any other rule → `severity: "HIGH"`
- FALSE POSITIVE on any rule → `severity: "MEDIUM"` (erodes clinician trust)

### Generate the report

```bash
node .claude/skills/redteam-rules/scripts/build_report.js \
  /tmp/redteam-rules/findings.json \
  /tmp/redteam-rules/run-meta.json \
  /tmp/redteam-rules/redteam-report.md
```

Write `run-meta.json` before calling the report builder:
```json
{
  "practice_name": "Witley and Milford Surgery",
  "generated_at": "<ISO timestamp>",
  "rules_checked": <n>,
  "agents_dispatched": <n>,
  "manifest_version": "<current version from manifest.json>",
  "engine_file": "engine/rules-engine.js",
  "total_candidates": <n>,
  "confirmed_gaps": <n>,
  "false_positives": <n>,
  "ok_count": <n>
}
```

## Stage 3 — Present the report

After `build_report.js` completes, print the console summary and tell Dave:
1. How many rules were checked and how many agents ran.
2. How many CONFIRMED GAPS were found (with severity breakdown).
3. How many FALSE POSITIVES were found.
4. The exact strings to add to `drug.match` for each confirmed gap.
5. That no edits were made — this is a proposal for CSO review.

Offer to apply the changes directly if Dave confirms. If he does, follow the drug-rule editing
discipline from `CLAUDE.md`: add to `drug.match`, update `EXPECTED` in
`test-drug-brand-coverage.js`, run `node test-drug-brand-coverage.js`, bump manifest (patch),
add CHANGELOG entry, commit, push.

## Scope and honest limitations

- Red-team agents use their training knowledge of UK drug brands (BNF / dm+d / emc sourced).
  They will not find every brand — the value is in finding classes of gaps the existing test set
  missed, not exhaustive enumeration.
- Mechanical verification catches hallucinated brand names that don't match any pattern — they
  appear in the OK count, not in findings.
- A confirmed gap is a brand the engine misses; it is not a guarantee the brand is currently
  prescribed in this practice. The CSO decides which gaps warrant a rule edit.
- This skill does not edit rules. Clinical rule changes need CSO sign-off.

## File structure

```
redteam-rules/
├── SKILL.md                  ← this file (orchestrator brief)
├── agents/
│   └── REDTEAMER.md          ← Haiku adversary brief (one instance per rule/group)
├── scripts/
│   ├── verify_candidates.js  ← mechanical matcher (real engine, Node)
│   └── build_report.js       ← red-team report builder (Markdown)
└── references/
    └── state/
        └── last-run.json     ← written after each run for diff tracking (created at runtime)
```
