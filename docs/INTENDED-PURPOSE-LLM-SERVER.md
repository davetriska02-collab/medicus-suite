# Intended Purpose Statement — Surgery LLM Server (Phase 1)

**Version:** 0.1.0 (draft)
**Date:** June 2026
**Author:** Dr Dave Triska, Graysbrook Ltd
**Status:** Draft for review — proposed system, NOT yet built or deployed. This statement scopes
**Phase 1 only** (see *Device-status boundary*). It is the document against which device status is
asserted; it must be finalised, dated and signed by the Clinical Safety Officer before any
deployment.

---

## Why this document exists

Under MHRA Software as a Medical Device guidance, **the intended purpose — not the technology —
decides whether software is a regulated medical device.** This statement fixes the intended purpose
of the Phase-1 surgery LLM server tightly enough that, on a good-faith reading of current MHRA
guidance, it falls **outside** the UK Medical Devices Regulations 2002 (as amended). Any feature
that would move it inside that scope is explicitly out of scope here and is deferred to a separate,
separately-classified statement (Phase 2 / Phase 3).

This mirrors the discipline already applied to the Medicus Suite extension in
`docs/INTENDED-PURPOSE.md`.

---

## Software description

The Surgery LLM Server is a self-contained inference appliance hosted **on the practice's own local
network**. It runs an open-weight large language model and a local speech-to-text engine. It is
reached by practice workstations over a single internal API endpoint. It has **no internet access
except one firewall-allow-listed connection to the Medicus clinical API**; no patient data is
transmitted to any cloud service, model vendor, or other external system, and no patient data is
used to train or fine-tune any model.

In **Phase 1** the appliance provides the following functions, all of which are administrative,
documentation, retrieval or reformatting support — none of which generates a clinical
recommendation, diagnosis, triage, or risk output, and none of which is relied upon for a clinical
decision:

| Function | What it does | What it is not |
|----------|--------------|----------------|
| **Verbatim transcription** | Produces a verbatim text transcript of a consultation (with speaker labels) from audio captured at the clinician's workstation, for the clinician to read, verify and use as they see fit. | Not a generative summary; not a clinical note authored by the software; not filed to the record by the software. |
| **Administrative drafting** | Drafts non-clinical text — recall/invitation wording, internal administrative summaries, routine correspondence scaffolding — which a human author edits, completes and approves. | Not a clinical letter that conveys a diagnosis or management decision; the human is the author. |
| **Local-guidance retrieval / signposting** | Searches a local corpus of reference documents (e.g. NICE/CKS/BNF text, local pathways and practice policies) and surfaces relevant passages **with citations** for the clinician to read and verify. | Not a generated clinical recommendation, answer, or decision; it surfaces existing reference text, analogous to the Suite's existing Pharmacy First / risk-tool signposting. |
| **Reformatting / reorganising data already present** | Re-presents or reorganises information the clinician is already viewing (e.g. arranging a list the clinician has open) to aid their own review. | Not a new clinical inference; it adds no information not already in the source the clinician is viewing. |

All outputs are presented to a qualified human who reviews, edits where appropriate, and decides
whether and how to use them. The software files nothing to the patient record autonomously.

---

## Frozen intended-purpose statement (Phase 1)

> Software hosted on the practice's local network that provides administrative and documentation
> support to authorised practice staff, comprising: (a) verbatim speech-to-text transcription of a
> consultation for the clinician to read and verify; (b) drafting of non-clinical administrative
> text that a human author edits and approves; (c) retrieval and citation-linked display of
> passages from a local corpus of existing reference and policy documents, for the user to read and
> verify; and (d) reformatting or reorganising, for the user's own review, information the user is
> already viewing.
>
> The software does not generate clinical diagnoses, clinical recommendations, prescribing
> decisions, triage decisions, risk scores, prognoses, or clinical summaries used in the patient
> record. It does not autonomously write to, modify, or submit any data to the patient record. It
> does not transmit patient data outside the practice's local network other than via a single
> controlled connection to the Medicus clinical system, and it does not use patient data to train
> or adapt any model. It does not replace clinical judgement. All clinical decisions, and
> verification of any displayed or drafted content against the source record, remain the sole
> responsibility of the qualified user.

Any use of the Surgery LLM Server outside this stated purpose is at the user's sole risk and may
constitute use of an unclassified medical device.

---

## Device-status boundary (READ THIS — it is the whole point)

The Phase-1 scope above stays outside the medical-device definition **only while the following lines
are not crossed.** Each of these is a deliberate, separately-governed step, not a feature toggle:

- **Generative summarisation of a consultation into the clinical record** (an "ambient scribe" note
  produced by generative AI) is, per NHS England's AVT guidance, **likely a medical device requiring
  at least MHRA Class 1 registration.** → **Phase 2.** Out of scope for this statement.
- **Any output that informs diagnosis, triage, screening, risk prediction, prognosis or treatment**
  — even as "support" — is **likely a medical device at Class IIa or higher**, requiring Approved
  Body conformity assessment and UKCA marking. → **Phase 3** (likely via the MHRA AI Airlock). Out
  of scope for this statement.
- **A retrieval/assistant feature that crosses from surfacing existing reference text into
  generating a clinical answer or recommendation** crosses the same line. The Phase-1 retrieval
  function must surface cited source passages, not synthesise a clinical recommendation.

The MHRA explicitly warns that generative-AI tools can **drift beyond their stated intended
purpose**. Scope creep from Phase 1 into Phase 2/3 by incremental feature change, without the
corresponding device classification, is itself the primary regulatory hazard and must be controlled
through change management under DCB0160.

---

## What this software is not (Phase 1)

- It is not a medical device. The author asserts, on a good-faith reading of MHRA Software as a
  Medical Device guidance current at the date of this document, that the Phase-1 Surgery LLM Server
  as scoped above falls outside the UK Medical Devices Regulations 2002 (as amended). No CE/UKCA
  mark is claimed. **This assertion does not extend to any Phase 2 or Phase 3 function.**
- It is not clinical decision support software.
- It is not an ambient scribe in the generative-summarisation sense; Phase 1 produces verbatim
  transcripts only.
- It is not endorsed by or affiliated with Medicus Health Ltd, NHS England, any ICB/PCN, or any
  regulator.
- It is not a substitute for reading the patient record or for clinical judgement.
- Its transcripts and drafts are unverified machine output; absence of an error in a draft does not
  indicate the draft is complete or correct.
- It is not a record-of-truth; nothing it produces is a clinical record until a qualified human has
  reviewed it and entered it into Medicus.

---

## Intended user

Authorised practice staff acting within their role: qualified clinicians (GPs, nurses, AHPs) for the
transcription and retrieval functions; clinical and administrative staff for the administrative
drafting and reformatting functions. All users must be authorised to access the data they are
working with and must understand that all clinical decisions, and verification of all output,
remain their own responsibility.

---

## Intended environment

Practice workstations on the surgery's own local network, authenticated to the appliance under the
user's own credentials, in a practice that has lawful access to Medicus and that has completed the
governance prerequisites (DPIA, DCB0160 deployment safety case, DSPT, Caldicott Guardian sign-off)
before the appliance is used with any real patient data.

---

## Contraindications

This software must not be used:
- By anyone not authorised to access the underlying data.
- As a substitute for reading the source patient record, or as the sole basis for any clinical
  decision.
- For generative clinical summarisation, clinical question-answering, diagnosis, triage, or risk
  assessment (those are Phase 2/3 functions and are not authorised under this statement).
- Before the deployment-side clinical safety case (DCB0160) and DPIA are complete and signed.
- In any configuration where its single controlled egress is not enforced (i.e. if the appliance
  can reach the internet beyond the allow-listed Medicus endpoint, it must not process patient
  data).
- Where its limitations (see the Phase-1 hazard log) are not understood and accepted by the user.

---

## Prerequisites before this statement can be relied upon

1. Finalised, CSO-signed version of this statement.
2. Phase-1 hazard log and DCB0160 deployment clinical safety case report.
3. Completed DPIA with DPO and Caldicott Guardian input.
4. Confirmed enforcement of the single-egress network control.
5. Documented retention/deletion policy for audio, transcripts and drafts.
