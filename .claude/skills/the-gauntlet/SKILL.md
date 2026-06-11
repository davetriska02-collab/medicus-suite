---
name: the-gauntlet
description: >-
  Competitive product benchmarking. Given a product Dave is building or specifying,
  interview him to scope the comparison, identify the 4 to 8 strongest comparable
  products on the market via web research from primary sources, build a verified
  feature matrix, run an honest gap analysis, and produce a three-tier plan to
  match, beat and leapfrog the best of them. Use when Dave says run the gauntlet,
  benchmark this against the market, competitive analysis, what's the competition
  doing, or names one of his products and asks how it compares. Do NOT trigger for
  feature requests, code review, or repo audits; this skill is about the market,
  not the codebase.
---

# The Gauntlet: competitive product benchmarking

You are running The Gauntlet. The subject is one of Dave's products and the question is brutal
and simple: who else does this, are they better, and what would it take not just to catch them
but to make them look dated?

The product of this skill is an **honest, sourced comparison**, not a pep talk. A matrix that
flatters our product by listing competitors' weaknesses and our roadmap items as if shipped is
worse than no matrix at all. Where a competitor is simply better, the report says so plainly.
Every competitor capability is cited to a primary source and date-stamped, because vendor
marketing pages routinely describe vapourware in the present tense.

Work through the five phases below in order. Do not skip ahead. Phase 1 is mandatory even if
you think you already know the answers.

## Phase 1: scoping interview (never skip)

Before any research, ask Dave (use AskUserQuestion where available, otherwise ask in chat):

1. What is the product? One paragraph, plus where the code or spec lives if applicable.
2. Who is the user? Be specific: practice manager, GP partner, consumer, IT buyer.
3. Deployment context: NHS, consumer, B2B, regulated or not. This changes what "comparable"
   means and which dimensions matter (a compliance gap is fatal in the NHS and irrelevant in
   consumer).
4. What counts as a comparable? Direct substitutes only, or adjacent tools users actually use
   instead (including spreadsheets and paper)?
5. Which dimensions matter most, ranked: features, UX, price, compliance posture, integration
   surface, support, data residency.

If the product lives in the current repo, read its README, CHANGELOG and any docs/research/
folder before interviewing, so the questions are sharp rather than generic.

## Phase 2: market scan

Use web search to identify the **4 to 8 strongest** comparable products. Prioritise market
leaders and best-in-class niche players over also-rans; two excellent competitors beat six
mediocre ones, but do not stop below four without saying why.

For each competitor, pull features from **primary sources**: vendor documentation, changelogs,
release notes, pricing pages, app store listings, support knowledge bases. Review sites and
forums are admissible for sentiment and pain points, not for feature claims.

Rules of evidence:
- **Flag marketing claims**: anything described only on a landing page, with no docs,
  changelog entry or screenshot behind it, is recorded as claimed-unverified, never as shipped.
- **Date-stamp everything**: each finding carries the date you verified it and the source URL.
- If a vendor's site is inaccessible or vague, say so rather than inferring.

## Phase 3: feature matrix

Build one comprehensive comparison table. Rows are features grouped by category; columns are
the competitors plus Dave's product. Every cell takes exactly one of four values:

- **shipped**: verified in docs, changelog or the product itself
- **partial**: exists but materially weaker than the best implementation
- **claimed**: vendor asserts it, no verification found
- **absent**: no evidence it exists

Dave's product is scored by the same standard: roadmap items are absent, not shipped.
Include non-feature rows where the Phase 1 interview said they matter: pricing model, support
channel and hours, compliance posture (DSPT, DTAC, CE/UKCA, GDPR), integration surface, data
residency.

## Phase 4: gap analysis

Three lists, each honest:

1. **Table stakes we are missing**: features most or all serious competitors ship and we do
   not. These embarrass us in a procurement comparison regardless of our cleverness elsewhere.
2. **Parity**: where we are level. One line each, no padding.
3. **White space**: what nobody covers well, including the gaps the whole market shares.

Where a competitor is simply better on a dimension Dave ranked as important, name the
competitor, the dimension, and how far ahead they are.

## Phase 5: the exceed plan

A prioritised roadmap in three tiers:

- **Match**: close the table-stakes gaps. Cheapest credible versions first.
- **Beat**: outdo the best competitor on the two or three dimensions Dave's users care about
  most (from Phase 1), not on every axis.
- **Leapfrog**: exploit the white space.

Each item gets: effort estimate (S under 2h, M half-day, L 1 to 2 days, XL needs breakdown),
rationale, and **which competitor it neutralises**.

Then stress-test the plan. For every leapfrog item, argue explicitly **why competitors have
not done it already**. Acceptable answers: they lack our data access, their architecture
forbids it, their business model punishes it, the market segment is too small for them, it
only recently became possible. Unacceptable: they have not thought of it. If no credible
answer exists, either demote the item or state the genuine risk that incumbents will copy it
within a quarter. This test is what separates a plan from a fantasy.

## Output

One report document, in this order: Executive Summary (our position in one paragraph, the
three most dangerous competitors, the single biggest gap and the single biggest opportunity),
Feature Matrix, Gap Analysis, Exceed Plan with stress test, Sources (every URL with its
verification date).

Present it in chat; if long, also write it to `docs/benchmark/GAUNTLET-<YYYY-MM-DD>.md` so it
survives the session and the next run can diff against it.

Style: UK English. No em-dashes. No fluff. If a dimension is a draw, one sentence and move on.

## Constraints

- Research and report only: never modify product code during a Gauntlet run.
- Never present a competitor's claimed feature as shipped, and never present our roadmap as
  shipped.
- If the scan finds fewer than four genuine comparables, report that finding honestly; a thin
  market is itself a strategic fact.
