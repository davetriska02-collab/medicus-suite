# CSO / DPO / Caldicott Sign-off — GP Forge & AI Assist (Phase 1)

**Document reference:** MS-CSO-CHG-GPFORGE-001
**Status:** DRAFT change-proposal — pending sign-off
**Proposed baseline:** Medicus Suite v3.134.0
**Date raised:** 2026-06-23
**For review by:** the Clinical Safety Officer, the Data Protection Officer, and the deploying
practice's Caldicott Guardian. *(This is a change-proposal for review — it does not itself authorise
enablement.)*

## 1. What is changing

A new optional module, **AI Assist** (v3.133.0 administrative drafting; v3.134.0 verbatim **Dictate**),
connects the Medicus Suite to a **practice-hosted, on-premises GP Forge LLM server** (`gp-forge/`) for:

- **administrative drafting** (recall/invitation wording, internal admin text), and
- **verbatim speech-to-text transcription** of a consultation.

It is **disabled by default**, requires explicit practice enablement (server URL/key + a runtime
host-permission grant), sends data **only to the local GP Forge server** (no internet egress, no
cloud, no third-party processor), returns every output for **human review/edit**, and **writes
nothing to Medicus**. It performs **no generative clinical summarisation, diagnosis, triage or
decision support** (out of Phase-1 scope).

## 2. Why it (currently) sits outside the medical-device definition

Per MHRA Software-as-a-Medical-Device guidance and NHS England Ambient Voice Technology guidance:
verbatim transcription verified by a clinician, and non-clinical administrative drafting, are **not**
medical-device functions. Generative clinical summarisation would be (≥ MHRA Class 1) and is
**explicitly excluded** from Phase 1 (see `docs/INTENDED-PURPOSE-LLM-SERVER.md`).

## 3. Artefacts to review (all drafted, in-repo)

| Artefact | Change |
|---|---|
| `docs/INTENDED-PURPOSE.md` | Amendment: optional AI Assist module; local-egress carve-out to the "no transmission / no AI" statements. |
| `docs/INTENDED-PURPOSE-LLM-SERVER.md` | Phase-1 intended-purpose for the GP Forge server itself (the device boundary). |
| `docs/DPIA.md` §7 | Addendum: AI Assist / GP Forge processing (data flows, lawful basis, on-prem mitigation, residual risk). |
| `docs/HAZARD-LOG.md` H-036 | New hazard: AI Assist egress / out-of-scope draft / STT mis-transcription / consent. |

## 4. What each approver is asked to confirm

**Clinical Safety Officer** (DCB0129 manufacturer + DCB0160 deployer):
- [ ] H-036 risk assessment and controls are acceptable (residual 6, ALARP).
- [ ] The Phase-1 scope (admin + verbatim only; no clinical summarisation / decision support) is enforced and acceptable.
- [ ] The single fail-closed egress control is verified on the deployed GP Forge appliance before any patient data.
- [ ] Baseline H-036 / re-baseline the hazard log at v3.134.0.

**Data Protection Officer:**
- [ ] DPIA §7 addendum accepted; lawful basis (Art.6(1)(e)+9(2)(h)) and minimisation satisfied.
- [ ] Confirmed: no internet egress, no cloud, no third-party processor; no audio retained; audit stores hashes by default.

**Caldicott Guardian** (deploying practice):
- [ ] The use of confidential information (typed text / consultation audio to the local server) is justified and proportionate.
- [ ] The patient-information / consent process for Dictate is in place (patients informed at session start).

## 5. Conditions of safe enablement (ALL must hold before real patient use)

1. This change-proposal signed by CSO + DPO + Caldicott Guardian.
2. The deploying practice's **own DPIA and DCB0160** clinical safety case completed for the GP Forge appliance (see the practice CRMS).
3. The GP Forge single-egress control **enforced, monitored and verified** (fail-closed).
4. Documented retention/deletion policy for audio, transcripts, drafts and the audit log.
5. Staff trained on intended use, limitations, the consent step, and review-before-use.

Until all of the above hold, AI Assist remains **disabled** and is **not** authorised for real
patient activity.

## 6. Sign-off

| Role | Name | Signature | Date |
|---|---|---|---|
| Clinical Safety Officer | | | |
| Data Protection Officer | | | |
| Caldicott Guardian (practice) | | | |
