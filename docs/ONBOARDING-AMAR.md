# Getting started on Medicus Suite — a guide for Dr Amar Ahmed

Hi Amar. Welcome aboard. This is everything you need to go from zero to
making useful contributions on this repo with Claude Code. Work through it
top to bottom the first time; after that it's a reference.

The repo is set up with conventions and "skills" so Claude does the heavy
lifting — your job is to describe the clinical problem precisely, review what
it builds, and tell it when it's wrong. The clinical knowledge is your
department; the code is Claude's.

---

## 1. What this repo is — the one-paragraph version

**Medicus Suite** is a Chrome extension that sits on top of the Medicus GP
clinical system (the EPR used in your practice). It is read-only — it never
writes to a record, never sends patient data anywhere, and performs no AI
inference at runtime. What it does is read data that's already on screen and
reorganise it to make GP life faster and safer.

The main things it does, in plain English:

- **Sentinel / Monitoring** — flags patients who are overdue for drug
  monitoring (e.g. lithium levels, methotrexate bloods) or who are falling
  short on QOF targets. Appears as coloured chips in the waiting room queue
  and on the patient record.
- **Triage Lens** — overlays the waiting room queue with structured triage
  info: age chips, flagged results, prescribing-combination prompts (STOPP/
  START style), risk-tool links, Pharmacy First signposting.
- **Patient Record Visualiser** — you load a Medicus EPR export and it
  produces a clinical dashboard: investigation trends, medication monitoring
  compliance, frailty index, PINCER prescribing-safety flags, a timeline.
  All local, no data leaves the browser.
- **Slots / Capacity Forecast** — appointment availability and practice
  capacity at a glance.
- **Submissions / Activity / Referrals** — QOF, enhanced-service, and
  referral audit data surfaced without leaving Medicus.
- **Waiting Room / Request Monitor** — live demand strips: how many patients
  are waiting, how many new admin requests have landed.

It is not a medical device and does not generate clinical decisions. It
surfaces data that's already there and lets the clinician decide.

---

## 2. The two accounts you need

### GitHub
You should already have collaborator (Write) access on this repo — Dave will
have added you, and you'd have received an email invite to accept. If you
haven't accepted it yet, check your email and do so.

You'll use GitHub to see the code, open **pull requests** (your proposed
changes), and follow the CI checks that run on them. You don't need to know
Git commands — Claude handles that for you.

### Claude
You need your **own** Claude subscription. There is no shared pool — you can't
run tasks on Dave's account.

- **Start on Claude Pro (~£20/month).** That is genuinely fine for learning
  and light contributions. You only need Max (~£180) if you're running Claude
  all day. Start small; upgrade if you hit limits.
- Sign up at **claude.ai** with your own email.

---

## 3. How you'll actually work

### The recommended route: Claude Code on the web
Nothing to install. This is the right place to start.

1. Go to **claude.ai/code** and sign in with your Claude account.
2. Connect your GitHub account and pick the `medicus-suite` repo.
3. Start a session. It runs in a cloud sandbox — a fresh, throwaway copy of
   the repo — so you can't break anything on your machine or on `main`.
4. Type what you want in plain English. Claude reads the whole codebase and
   the house rules automatically (from a file called `CLAUDE.md`).
5. When you're happy with what Claude's built, ask it to commit and push to
   a branch and open a pull request.

Docs: https://code.claude.com/docs/en/claude-code-on-the-web

### Later: Claude Code on your laptop (once comfortable)
Lets you actually load the extension in Chrome and see changes live. Not
needed to start — get comfortable with the web route first.

---

## 4. What a pull request (PR) is and how merging works

This is the most important workflow to understand. Everything goes through here.

A **pull request** is a proposal to change the code. Instead of editing the
"live" version directly, you:

1. Work on your own **branch** (a named copy of the code, just for your
   change — Claude creates this automatically when you ask it to commit your
   work).
2. Open a **PR**: a side-by-side view of what changed, with a title and
   description. GitHub shows the diff and runs automated checks (tests, lint).
3. Dave reviews it — or **Virtual Dave** (Dave's AI digital twin, described
   below) gives an automated first-pass verdict.
4. Once it's green and approved, Dave **merges** it — meaning your changes
   are folded back into `main` (the live version everyone runs).

You never push straight to `main`. That's a hard rule. Branch → PR → review
→ merge is the only path.

**What the automated checks are:**
- **Tests** — automated test suite that checks the logic still works.
- **Lint** — code-style checker.
- **Patient-data guard** — a script that scans for NHS numbers or files from
  the uploads/data folders. Fails hard if anything patient-identifiable
  appears in the change. This is not optional.

If a check goes red on your PR, ask Claude to explain it and fix it. Do not
ask Dave to merge a red PR.

---

## 5. The golden rules (patient-adjacent software — please read)

1. **Never commit patient data.** No real records, exports, or screenshots of
   real patients ever go into git. If in doubt, don't.
2. **Never push straight to `main`.** Always use a branch and open a PR.
3. **One change at a time.** Small, focused changes are easy to review and
   easy to undo.
4. **Let the tests run.** Don't merge red. Ask Claude to fix it first.
5. **When unsure, ask.** Ask Claude to explain what it's about to do, or ping
   Dave. There are no daft questions on clinical software.

---

## 6. Your first 20 minutes — get a feel for it

Don't start with the hard problem. Warm up first:

1. Open a session (Route A above) on the repo.
2. Ask: *"Give me a tour of this codebase — what does this extension do and
   how is it laid out?"*
3. Ask: *"Show me the drug-monitoring rules and explain how they work."*
4. Ask it to make a trivial, safe change (e.g. fix a typo in a doc), commit
   it to a branch, and open a pull request. Watch the whole flow happen. Then
   close the PR without merging.

That round-trip — ask → change → branch → PR → review — *is* the job.
Once that feels natural, you're ready for real work.

---

## 7. The agents — your specialist team

Claude Code comes with a team of specialist agents that Dave has built into
this repo. You don't manage them — you just ask, and Claude picks the right
one. The ones most useful to you as a new collaborator:

- **Virtual Dave** — Dave's digital twin. Gives a safety-first verdict on any
  proposed change: "is this safe, does it do what it claims, would I run it
  in my own practice?" He auto-reviews every pull request you open. You can
  also ask him directly: *"what would Dave think of this?"*

- **The Keeper** — the clinical-rules watchman. Checks drug monitoring rules,
  QOF indicators, vaccine schedules, and STOPP/START flags against current
  UK guidance (BNF, NICE, MHRA, Green Book). Useful if you want to check
  whether a clinical rule is still correct. Ask: *"run The Keeper."*

- **The Practice** — a synthetic GP-practice team (receptionist, technophobe
  partner, practice manager, power-user pharmacist…) that road-tests the
  suite for usability. Ask: *"ask The Practice what they make of the slots
  page."*

- **repo-audit** — a technical audit of the whole codebase. Analysis only,
  no changes. Ask: *"run a repo audit."*

Full agent guide: `docs/AGENTS-AND-THE-BOYS.md` — worth reading once you've
done your first warm-up session.

---

## 8. Where to look for things

| What you're after | Where it lives |
|---|---|
| Drug-monitoring rules | `rules/drug-rules.json` |
| QOF indicator rules | `rules/qof-rules.json` |
| Triage / STOPP-START rules | `rules/` (various) |
| Waiting-room / result chip logic | `content-scripts/triage-lens/` |
| Patient record visualiser | `visualiser.html`, `visualiser-core.html` |
| Side-panel modules (slots, activity, etc.) | `side-panel/modules/` |
| Shipped default config | `defaults.json` |
| Clinical safety docs | `docs/CLINICAL-SAFETY-CASE-REPORT.md` |

When in doubt, ask Claude: *"where does the code for X live?"* — it reads
the whole repo.

---

## 9. Handy things to know

- **You don't need to know JavaScript** to be useful. You know the clinical
  reality and the data — that's the bit Claude can't get right on its own.
  Describe the problem precisely; let it write the code; you sanity-check the
  result.
- **Claude can run the tests for you** — just ask "run the tests."
- **If a change goes wrong**, nothing is permanent until it's merged to
  `main`. Branches and PRs are cheap and disposable. Experiment freely.
- **Stuck?** Ask Claude *"explain what you just did and why"* in plain
  English. It's a patient teacher.
- **Ask for a plan before a big build.** "Plan how you'd do this, don't write
  code yet." Read the plan, push back on anything that smells clinically off,
  *then* let it build. Asking it to plan before coding is the single best
  habit you can build.

Welcome aboard. Start with section 6, then ping Dave about what you'd like to
tackle first.
