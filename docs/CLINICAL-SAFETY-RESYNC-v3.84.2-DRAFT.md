# Clinical-Safety Document Re-synchronisation — v3.64.0 → v3.84.2

**Document reference:** MS-CSO-RESYNC-001
**Status:** DRAFT change-proposal — **prepared for CSO review; NOT signed off**
**Date prepared:** 2026-06-14
**Prepared by:** Assistant (Claude Code), for CSO review by Dr Dave Triska (GMC 6159481)
**Completes:** audit task **T4** (safety-doc refresh outstanding since v3.64.0 — see
`scripts/check-doc-versions.js` `KNOWN_STALE` pins)

> This proposal does **not** itself alter the signed clinical-safety documents and
> makes **no** clinical-safety attestation. It classifies what shipped since the
> last CSO reissue (v3.64.0) and proposes the specific edits required to bring
> `CLINICAL-SAFETY-NOTICE.md`, `HAZARD-LOG.md`, and `SOUP.md` onto v3.84.2. The
> CSO reviews, amends, and applies it under sign-off; only then are the
> `KNOWN_STALE` pins removed.

---

## 1. Headline conclusion

Across the ~20 releases v3.65.0 → v3.84.2, **no release introduces a hazard not
already covered by the existing register (H-001…H-030).** The new clinical
content is overwhelmingly **additive** and concentrated in two places:

1. **The Investigation Results queue (H-030)** — a substantially expanded built-in
   result-rule set and culture-text false-calm hardening. The *hazard shape is
   unchanged* (chip misread as assurance; escalate-only; no "all-normal" chip), so
   the **residual score (4) does not change**; the controls section needs updating
   to record the new rules.
2. **Clinical rule currency (v3.81.0 Keeper sweep)** — additive term/brand/criterion
   additions that **strengthen** existing controls (H-002, H-004, H-016) rather
   than create new risk; "all additive; no monitoring weakened" (CSO-signed at the
   time of the sweep).

Plus one escalation-tier change (Reception 999 promotion, H-024) and several
surfacing/UX hardenings that strengthen H-002 / H-007 / H-012. **No new hazard
register entry is required.** (Glossary tooltips, v3.79.0, were considered — a
static jargon map — and judged not to warrant a register entry; flagged here for
CSO confirmation.)

## 2. What shipped, classified

| Release(s) | Change | Class | Doc impact |
|---|---|---|---|
| v3.65.0, v3.66.0 | Result chips persist (durable re-injection); base rules red-only + attributable chips; conditional HbA1c flags; pack of built-in threshold rules | Clinical (results) | H-030 controls; CSN §2 |
| v3.76.0 | Six built-in result rules — lithium, digoxin, low K⁺, high adjusted Ca²⁺, low eGFR amber band, blood-culture text rule (escalate-only) | Clinical (results) | H-030 controls; CSN §2 |
| v3.77.0 / v3.77.2 | Four more result rules — hypocalcaemia, hypomagnesaemia, high TSH, suppressed TSH; shipped **disabled**, then **enabled on CSO sign-off** | Clinical (results) | H-030 controls; CSN §2 |
| v3.77.7–v3.77.11 | Attributable normal labels; stray "0 abnormal" fix; culture-only fetch fix; **culture false-calm hardening** (positive `abnormalText` flags; word-boundary `normalText`) | Clinical-safety hardening (results) | H-030 controls |
| v3.75.0 | Bowel-screening non-responder result rule; leaner urgent chips | Clinical (results) | H-030 controls; CSN §2 |
| v3.81.0 | Keeper currency sweep: STOPP/START + PINCER + ACB term/brand additions (ACEi/ARB/β-blocker/statin), azathioprine brand `jayempi`, GLP-1 pancreatitis alert, new STOPP anticholinergic-elderly criterion, QOF HF003/HF006 retired-disabled, vaccine specVersion 2026/27 | Clinical (additive, strengthens) | H-002/H-004/H-016 controls; CSN §2 |
| v3.81.1 | Reception: five red flags promoted urgent-duty → **999** on CSO review | Clinical (escalation tier) | H-024 controls; CSN §2 |
| v3.80.0 | Matched-rule-term tooltip; brief never hides a RED item; identity banner "Monitoring for" lead-in | Surfacing/HF (strengthens) | H-002/H-007/H-012 controls |
| v3.79.0 | Glossary tooltips (jargon explainer) | UX/informational | None (CSN §2 optional) |
| v3.78.0, v3.82.0–v3.84.0 | Usability fixes; practice-profile attestation; Sweep choose-day + multi-clinician | UX / operational | None (covered by H-023/H-027) |
| v3.74.x, v3.75.1–3, v3.77.3–6 | Result-rules settings tab; config-migration fixes; `defaults-config-lock` guard; SECURITY.md; VISION.md | Technical / docs | None |

## 3. Proposed edits, by document

### 3.1 `HAZARD-LOG.md`

- **Header:** Product version `3.64.0` → `3.84.2`; Document version `3.9` → `3.10`;
  Date issued → [SIGN-OFF DATE]. *(CSO attestation — apply on sign-off.)*
- **§2 Scope:** extend the Triage Lens bullet to record the expanded built-in
  result-rule set (v3.65–v3.77: lithium, digoxin, K⁺ low, adjusted Ca²⁺ high/low,
  magnesium, TSH high/suppressed, eGFR amber band, bowel-screening non-responder,
  blood-culture text rule) and the culture false-calm hardening (v3.77.10–11).
  Add the v3.81.0 rule-currency additions to the Sentinel/visualiser bullets and
  the Reception 999-tier change to the Reception bullet.
- **H-030 Controls:** update control (b) to list the now-shipped built-in
  threshold and text rules (several enabled on CSO sign-off, v3.77.2); record the
  v3.77.10–11 false-calm hardening (positive `abnormalText` flags override
  `normalText`; word-boundary `normalText`) as a strengthened control. **Residual
  unchanged (4).**
- **H-024 Controls:** record the v3.81.1 promotion of five red flags to 999.
- **H-002 / H-004 / H-016 Controls:** add the v3.81.0 Keeper additions (term/brand
  completeness, new STOPP/ACB criterion) as additive false-negative-reducing
  controls. **Residuals unchanged.**
- **H-007 / H-012 Controls:** record v3.80.0 surfacing hardenings (matched-term
  attribution, RED-never-hidden digest, identity lead-in).
- **§6 release statement & §9 sign-off:** *do not pre-fill* — these are the CSO
  attestation. Proposed new §8 version-history row (for the CSO to confirm):

  > | [DATE] | 3.10 | DT | Synchronised to v3.84.2. **Scope (§2)** updated:
  > expanded built-in Investigation-Results rule set (v3.65–v3.77) and culture
  > false-calm hardening (v3.77.10–11); v3.81.0 Keeper rule-currency additions;
  > Reception 999-tier promotion (v3.81.1); practice-profile attestation and Sweep
  > day/multi-clinician (v3.82–v3.84). **H-030** controls updated for the new
  > result rules and false-calm hardening (residual unchanged, 4). **H-024**
  > updated for the 999 promotion. **H-002/H-004/H-016** controls updated for the
  > Keeper additions; **H-007/H-012** for v3.80.0 surfacing. No new hazard; no
  > residual increased. |

### 3.2 `CLINICAL-SAFETY-NOTICE.md`

- **Header:** Product version `3.64.0` → `3.84.2`; Document version `3.8` → `3.9`;
  Date issued → [SIGN-OFF DATE]. *(CSO attestation.)*
- **§2 Intended purpose:** append the result-rule expansion and culture text rules,
  the v3.81.0 currency additions, Reception 999 tier, glossary tooltips, and the
  Sweep day/multi-clinician and practice-profile changes — mirroring the existing
  per-version narrative style.
- **Limitation 35** (Investigation Results) already covers the chip model; confirm
  it still reads correctly against the enabled rule set (it does) — no change needed
  beyond noting the enabled built-ins.
- **§ CSO statement / sign-off blocks:** leave for CSO completion.

### 3.3 `SOUP.md`

- **No content change** — no vendored library was added, removed, or upgraded
  between v3.64.0 and v3.84.2 (PDF.js NF6 upgrade remains the only open item, already
  recorded). **Header only:** Product version `3.64.0` → `3.84.2`; Document version
  `1.5` → `1.6`; Date issued → [SIGN-OFF DATE]. *(CSO attestation.)*

## 4. Actions to complete on CSO sign-off

1. Apply the §3 edits to the three documents (header versions, scope, hazard
   controls, version-history rows) and complete the sign-off/release statements.
2. Remove the three `KNOWN_STALE` entries from `scripts/check-doc-versions.js`
   (`CLINICAL-SAFETY-NOTICE.md`, `HAZARD-LOG.md`, `SOUP.md`) so the guard tracks
   normally again.
3. Ensure the `manifest.json` major.minor (`3.84`) matches the reissued docs so
   `check-doc-versions.js` passes (it compares major.minor; patch lag is allowed).
4. Add a CHANGELOG entry recording the safety-doc reissue.

## 5. CSO review and sign-off

> I have reviewed this re-synchronisation proposal against the releases v3.65.0 –
> v3.84.2, confirm that no new hazard arises and no residual risk is increased, and
> approve the proposed edits (as amended) for application to the signed
> clinical-safety documents.

**Dr Dave Triska, GMC 6159481 — Clinical Safety Officer, Graysbrook Ltd**
**Date:** ____________________
