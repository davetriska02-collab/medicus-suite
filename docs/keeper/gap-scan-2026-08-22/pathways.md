# Pathways gap scan result (PF spec, CG151, NG156, NG141, CKS red eye, CKS DVT, CKS gastroenteritis all fetched; some CKS pages geo-restricted — marked VERIFY)

PF verification: sore-throat/AOM/sinusitis/UTI mapped; impetigo (1+), infected insect bites (1+), shingles (18+) exist ONLY as ungated combined label on `rash` (CSO 2026-07-28 removed auto-eligibility because one ageMin can't stand in for three gates and rash terms catch cellulitis). Gates confirmed unchanged by Oct 2025 PGD update.

Neutropenic-sepsis check: CONFIRMED — no pathway anywhere asks about chemo/anticancer treatment; fever caller lands on `general` which has no chemo/immunosuppression/meningism/non-blanching flag. NICE CG151 recs 1.3.1.1–1.3.1.2; NCEPOD avoidable deaths. Single most dangerous hole found.

## gap-pathway-01 — Fever/hot-and-unwell (adult) incl. neutropenic sepsis — RED, HIGH ★rank 1
- New pathway `fever-adult`. Key 999 flags: rf-chemo-fever ("chemotherapy or any other cancer treatment in the last few weeks?" — do not book, escalate NOW, check chemo alert-card/hotline), rf-sepsis (shivering/mottled/clammy/feel-might-die), rf-confusion, rf-nonblanching, rf-meningism. Duty: rf-immune-other (immunosuppressant meds/asplenia), rf-travel (Africa/Asia/S-C America <1mo — malaria; CKS page VERIFY), rf-fluids. Clinician-only (no disposition). Match terms: fever, high temperature, hot and shivery, flu.
- Sources: CG151 https://www.nice.org.uk/guidance/cg151/chapter/recommendations (fetched); NG253-255 sepsis.
- Frequency: 5–15 adult fever calls/day winter; ~40–80 patients on active SACT. Impact: hour-scale mortality; the classic reception death.
- Edge cases: "flu" phrasing; chemo >6wk ago (deliberately over-triages); immunotherapy/targeted agents covered by "any other cancer treatment"; COMPANION FLAG: feverish-child also lacks a chemo flag (single-flag addition, flagged separately).

## gap-pathway-02 — Skin infection / insect bite / shingles (completes Pharmacy First) — AMBER (bite flags RED-ish), HIGH ★rank 2
- New pathway `bite-sting-shingles` (impetigo stays on rash; narrow rash's PF label to impetigo-only same release). 999: rf-spreading (nec fasc — byte-identical to rash's), rf-anaphylaxis, rf-cellulitis-sepsis, rf-shingles-confusion. Duty: rf-face-eye (periorbital/nose — NG141 intracranial risk; ophthalmic shingles), rf-bite-human-animal (broke skin — same-day prophylaxis per CKS Bites, VERIFY page), rf-shingles-immune (+pregnant). PF: infected insect bite 1+; shingles 18+ (two gates — if engine pharmacyFirst block can't carry two, keep rules[] empty like rash).
- Sources: PF spec https://www.england.nhs.uk/primary-care/pharmacy/pharmacy-services/pharmacy-first/ (fetched); NG141.
- Frequency: skin ~5–8% of GP contacts; bites spike Jun–Sep; shingles ~20–40 cases/yr.
- Edge cases: Lyme bullseye not PF; shingles 72h antiviral window (age gate alone over-suggests PF late); match-term overlap on "blisters" with rash must be avoided.

## gap-pathway-03 — Abdominal pain (adult) — RED, HIGH ★rank 3
- New pathway `abdo-pain`. 999: rf-aaa (sudden abdo/back pain + collapse/pale/sweaty — NG156 1.1.7, esp >60/smoker/HTN), rf-rigid (peritonism), rf-gi-bleed (haematemesis/coffee-grounds/melaena), rf-preg-pain (ectopic — shared with gyn-female), rf-testicle (shared with gu-male), rf-sepsis. Duty: rf-hernia (irreducible painful lump + vomiting), rf-ng12 (≥50, weeks of pain + weight loss/bowel habit change — 2WW capture). Clinician-only. Match: tummy pain, stomach ache, abdominal pain, belly.
- Sources: NG156 https://www.nice.org.uk/guidance/ng156 (fetched; committee: non-specialists commonly fail to diagnose rupture).
- Frequency: 4–8 calls/day (top-5 symptom). Impact: ruptured AAA ~80% mortality, 100% if queued.
- Edge cases: AAA risk factors in parenthetical not conditional (symptoms alone fire — over-triage safe); renal colic over-captures on rf-rigid (acceptable); constipation volume case not escalated.

## gap-pathway-04 — Eye problems / red eye — AMBER, HIGH ★rank 4
- New pathway `eye`. 999: rf-chemical (splash — instruction: start rinsing OPEN eye NOW, keep 20 min, while escalating), rf-penetrating (hammering/grinding/glass — do NOT rinse), rf-vision-loss (sudden loss/curtain), rf-acg (painful red eye + halos + nausea), rf-orbital (lid swelling + fever + pain on movement/proptosis/diplopia). Duty: rf-contact-lens (red AND painful — remove lenses now), rf-flashes (flashes/floater shower/dark patch), rf-baby (red/sticky eye <4wk — ophthalmia neonatorum). Clinician-only. Match: eye, red eye, vision, conjunctivitis, something in eye.
- Sources: CKS red eye https://cks.nice.org.uk/topics/red-eye/ (geo-restricted, corroborated BMJ BP — revision dates VERIFY); CKS glaucoma "admit immediately".
- Frequency: 1.5–2% of contacts. Impact: alkali injury = minutes-to-irrigation determines outcome — reception is the only actor who can start it; CRAO/GCA irreversible in hours.
- Edge cases: painless sticky eye not escalated; deliberate overlap with headache's GCA flag; superglue = chemical; FB sensation without high-velocity NOT flagged (over-triage control).

## gap-pathway-05 — Leg pain / swelling (DVT / limb ischaemia / hot joint) — AMBER, HIGH ★rank 5
- New pathway `leg-pain-swelling`. 999: rf-pe (leg + breathless/chest pain/haemoptysis), rf-ischaemia (suddenly cold/pale/blue/numb leg), rf-spreading (byte-identical to rash's nec-fasc flag). Duty: rf-dvt (ONE calf swollen warm painful + surgery/journey/bedbound/cancer/prior clot), rf-preg-dvt (pregnant/6wk post-partum — CKS: immediate same-day referral), rf-septic-joint (ONE hot swollen joint + fever). Clinician-only. Match: leg pain, swollen leg/calf, DVT, clot.
- Sources: CKS DVT https://cks.nice.org.uk/topics/deep-vein-thrombosis/management/management/ (scan ≤4h or anticoagulate + scan ≤24h — incompatible with routine booking); ALI/gout pages VERIFY.
- Frequency: ~1–2 suspected DVT/wk. Impact: missed DVT → fatal PE (recurring coroner PFD theme); ALI → amputation ~6h.
- Edge cases: bilateral = HF/venous, flags require ONE leg; cellulitis-vs-DVT both duty (mis-sort safe); chronic lymphoedema repeat-trips rf-dvt (acceptable); limping child out of scope.

## gap-pathway-06 — Vomiting/diarrhoea (adult) — AMBER, HIGH ★rank 6
- New pathway `vomiting-diarrhoea`. 999: rf-gi-bleed (shared with abdo-pain), rf-dehydration-severe (confusion/drowsy/clammy/anuric), rf-dka-drowsy (insulin + vomiting + drowsy/deep breathing/pear-drops), rf-head-injury (vomiting after head knock — headache's rf-injury unreachable for vomiting callers). Duty: rf-dka (insulin + vomiting without those), rf-fluids (nothing down ≥12h), rf-frail-immune, rf-bloody-stool. Disposition: anp/gp_routine. Match: vomiting, sick, diarrhoea, D&V, tummy bug, food poisoning, norovirus.
- Sources: CKS gastroenteritis https://cks.nice.org.uk/topics/gastroenteritis/ (fetched); T1DM sick-day VERIFY (corroborated BMJ BP).
- Frequency: highest raw volume (dozens/wk in norovirus season). Impact: DKA/melaena/AKI hide in benign volume.
- Edge cases: child D&V without fever has no route (consider follow-up gap); SGLT2 euglycaemic DKA missed by insulin-keyed flag (CSO decision on broadening); hyperemesis routing note; UKHSA 48h exclusion = advice not escalation.

Discarded: breathlessness (covered by cough+general; gap is match terms not pathway), dental (weak, 111-deflected).
House rules respected: single-tier escalations, reception-safe verbatim phrasing, byte-identical shared flags (pin in test-reception-pathways.js), clinician-only pathways need CLINICIAN_ONLY_IDS + reception-match.js terms.
