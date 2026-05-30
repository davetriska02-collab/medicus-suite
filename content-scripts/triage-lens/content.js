/* Triage Lens - content script
 * v0.1.0
 * Runs entirely client-side. Scrapes the existing Care Record DOM,
 * computes triage-relevant signals, and renders an overlay HUD.
 * No network calls. No persistence beyond chrome.storage (not used in v0.1).
 */
(() => {
  'use strict';

  const VERSION = '0.5.4';
  const DEBUG = false;
  const log = (...a) => DEBUG && console.log('[ClinHUD]', ...a);

  // Inlined hud.css — substituted at build time so PiP can style its detached
  // window without depending on chrome.runtime.getURL (content_scripts CSS does
  // NOT appear in document.styleSheets, so we can't copy it back out).
  const EMBEDDED_CSS = `/* Triage Lens styles
   Two scopes:
   1. #medicus-clinical-hud — the floating panel (record + detail pages)
   2. .ch-queue-chips — chips injected into Medicus DOM (queue page)
*/

/* ---- Universal chip — usable inside HUD and inline in Medicus DOM ---- */
.ch-chip {
  display: inline-block;
  padding: 2px 7px;
  border-radius: 10px;
  font-size: 10.5px;
  font-weight: 500;
  line-height: 1.4;
  border: 1px solid transparent;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  white-space: nowrap;
}
.ch-chip-red    { background: #fbe6e7; color: #b8262e; border-color: rgba(184,38,46,0.25); }
.ch-chip-amber  { background: #fdf3e1; color: #b8771a; border-color: rgba(184,119,26,0.25); }
.ch-chip-green  { background: #e8f4ec; color: #2f8a4a; border-color: rgba(47,138,74,0.25); }
.ch-chip-info   { background: #e7eef7; color: #2a4d7a; border-color: rgba(42,77,122,0.20); }

/* ---- Queue row chips ---- */
.ch-queue-chips {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-right: 6px;
  vertical-align: middle;
}
.ch-queue-chips .ch-chip {
  padding: 1px 6px;
  font-size: 10px;
  border-radius: 9px;
}

/* ---- HUD panel ---- */
#medicus-clinical-hud {
  position: fixed;
  top: 88px;
  right: 16px;
  width: 340px;
  max-height: calc(100vh - 110px);
  z-index: 99999;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 12px;
  line-height: 1.4;
  color: #1c2733;
  background: #ffffff;
  border: 1px solid #cdd6e0;
  border-radius: 8px;
  box-shadow: 0 6px 24px rgba(20, 30, 50, 0.18);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
#medicus-clinical-hud * { box-sizing: border-box; }

#medicus-clinical-hud .ch-head {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px 12px;
  background: #1f3a5f; color: #fff;
  border-bottom: 1px solid #15294a;
}
#medicus-clinical-hud .ch-title { font-weight: 600; font-size: 12px; letter-spacing: 0.02em; }
#medicus-clinical-hud .ch-ver { font-weight: 400; opacity: 0.7; font-size: 10px; margin-left: 4px; }
#medicus-clinical-hud .ch-actions { display: flex; gap: 4px; }
#medicus-clinical-hud .ch-btn {
  background: transparent; color: #fff; border: 1px solid rgba(255,255,255,0.25);
  width: 22px; height: 22px; border-radius: 4px; cursor: pointer; font-size: 12px;
  padding: 0; display: inline-flex; align-items: center; justify-content: center;
}
#medicus-clinical-hud .ch-btn:hover { background: rgba(255,255,255,0.12); }

#medicus-clinical-hud .ch-body { padding: 10px; overflow-y: auto; }
#medicus-clinical-hud.ch-min .ch-body { display: none; }

#medicus-clinical-hud .ch-patient {
  display: block; width: 100%; box-sizing: border-box;
  background: #eef2f7; color: #1f3a5f;
  border: 1px solid #cdd6e0; border-radius: 4px;
  padding: 4px 8px; margin-bottom: 8px;
  font-size: 11px; font-weight: 600; text-align: left; cursor: pointer;
  font-family: inherit;
}
#medicus-clinical-hud .ch-patient:hover { background: #1f3a5f; color: #fff; border-color: #1f3a5f; }

#medicus-clinical-hud .ch-request {
  border: 1px solid #cdd6e0; border-radius: 6px; background: #f5f7fa;
  padding: 7px 8px; margin-bottom: 10px;
}
#medicus-clinical-hud .ch-request-head {
  font-weight: 600; font-size: 9.5px; text-transform: uppercase;
  letter-spacing: 0.05em; color: #5a6878; margin-bottom: 5px;
}
#medicus-clinical-hud .ch-request-row {
  display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 4px;
}
#medicus-clinical-hud .ch-request-row:last-child { margin-bottom: 0; }
#medicus-clinical-hud .ch-request-snippet {
  margin-top: 5px; font-size: 11px; color: #4a5568;
  border-top: 1px dashed #cdd6e0; padding-top: 5px;
  font-style: italic; max-height: 70px; overflow: hidden;
  display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical;
}

#medicus-clinical-hud .ch-chips {
  display: flex; flex-wrap: wrap; gap: 4px;
  margin-bottom: 10px;
}

#medicus-clinical-hud .ch-grid {
  display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px;
  margin-bottom: 10px;
}
#medicus-clinical-hud .ch-tile {
  background: #f5f7fa; border: 1px solid #dde3eb; border-radius: 6px;
  padding: 6px 8px; cursor: pointer; transition: transform 0.06s, border-color 0.1s;
  display: flex; flex-direction: column; gap: 2px;
}
#medicus-clinical-hud .ch-tile:hover { border-color: #1f3a5f; transform: translateY(-1px); }
#medicus-clinical-hud .ch-tile.ch-tile-sel { border-color: #1f3a5f; box-shadow: 0 0 0 2px rgba(31,58,95,0.15); }
#medicus-clinical-hud .ch-tile-label { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: #5a6878; }
#medicus-clinical-hud .ch-tile-status { font-size: 13px; font-weight: 700; }
#medicus-clinical-hud .ch-tile-count { font-size: 10px; color: #5a6878; }

#medicus-clinical-hud .ch-tile.ch-red { background: #fbe6e7; border-color: rgba(184,38,46,0.4); }
#medicus-clinical-hud .ch-tile.ch-red .ch-tile-status { color: #b8262e; }
#medicus-clinical-hud .ch-tile.ch-amber { background: #fdf3e1; border-color: rgba(184,119,26,0.4); }
#medicus-clinical-hud .ch-tile.ch-amber .ch-tile-status { color: #b8771a; }
#medicus-clinical-hud .ch-tile.ch-green { background: #e8f4ec; border-color: rgba(47,138,74,0.3); }
#medicus-clinical-hud .ch-tile.ch-green .ch-tile-status { color: #2f8a4a; }

#medicus-clinical-hud .ch-detail {
  border: 1px solid #e2e7ee; border-radius: 6px;
  background: #fafbfd; padding: 8px; margin-bottom: 8px;
  min-height: 60px;
}
#medicus-clinical-hud .ch-detail-head {
  font-weight: 600; font-size: 11px; text-transform: uppercase;
  letter-spacing: 0.03em; color: #1f3a5f; margin-bottom: 6px;
}
#medicus-clinical-hud .ch-detail-row {
  border-left: 3px solid #dde3eb; padding: 4px 8px;
  margin-bottom: 4px; background: #fff; border-radius: 0 4px 4px 0;
}
#medicus-clinical-hud .ch-detail-row.ch-red { border-left-color: #b8262e; }
#medicus-clinical-hud .ch-detail-row.ch-amber { border-left-color: #b8771a; }
#medicus-clinical-hud .ch-detail-row.ch-green { border-left-color: #2f8a4a; }
#medicus-clinical-hud .ch-detail-text { font-weight: 500; font-size: 11.5px; }
#medicus-clinical-hud .ch-detail-sub { font-size: 10.5px; color: #5a6878; margin-top: 2px; }
#medicus-clinical-hud .ch-detail-empty { color: #8a96a4; font-style: italic; font-size: 11px; }

#medicus-clinical-hud .ch-foot {
  font-size: 10px; color: #8a96a4; padding-top: 6px;
  border-top: 1px dashed #dde3eb; text-align: center;
}

/* ---- Action menu popover (works for HUD chips and queue chips) ---- */
.ch-action-menu {
  background: #ffffff;
  border: 1px solid #cdd6e0;
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(20, 30, 50, 0.22);
  min-width: 220px;
  max-width: 320px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 12px;
  line-height: 1.4;
  color: #1c2733;
  overflow: hidden;
}
.ch-action-menu * { box-sizing: border-box; }
.ch-action-menu-head {
  padding: 8px 10px;
  background: #f5f7fa;
  border-bottom: 1px solid #e2e7ee;
  display: flex; align-items: center; gap: 8px;
}
.ch-action-note-title {
  font-weight: 600;
  font-size: 11px;
  color: #1f3a5f;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.ch-action-back {
  background: transparent;
  border: 1px solid #cdd6e0;
  border-radius: 3px;
  padding: 2px 6px;
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  color: #1f3a5f;
}
.ch-action-back:hover { background: #eef2f7; }
.ch-action-menu-empty {
  padding: 10px;
  color: #8a96a4;
  font-style: italic;
  font-size: 11px;
}
.ch-action-menu-item {
  padding: 8px 12px;
  display: flex; align-items: center; gap: 8px;
  cursor: pointer;
  border-bottom: 1px solid #f0f3f7;
}
.ch-action-menu-item:last-child { border-bottom: none; }
.ch-action-menu-item:hover { background: #eef2f7; }
.ch-action-icon { font-size: 13px; opacity: 0.8; flex-shrink: 0; width: 18px; text-align: center; }
.ch-action-label { flex: 1; }

.ch-action-menu-note {
  padding: 10px 12px;
  white-space: pre-wrap;
  font-size: 11.5px;
  max-height: 360px;
  overflow-y: auto;
  color: #1c2733;
}

/* Actionable chip cursor + chevron */
.ch-chip-actionable { cursor: pointer; }
.ch-chip-actionable:hover { filter: brightness(0.96); }
.ch-chev { opacity: 0.55; font-size: 9px; margin-left: 2px; }
`;

  // ============================================================
  // 1. DATE HELPERS
  // ============================================================
  const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  const NOW = () => new Date();

  const parseDate = (s) => {
    if (!s) return null;
    const t = String(s).trim().replace(/\*$/, '');
    let m;
    if ((m = t.match(/^(\d{1,2})\s+([A-Z][a-z]{2})\s+(\d{4})$/))) return new Date(+m[3], MONTHS[m[2]], +m[1]);
    if ((m = t.match(/^([A-Z][a-z]{2})\s+(\d{4})$/))) return new Date(+m[2], MONTHS[m[1]], 1);
    if ((m = t.match(/^(\d{4})$/))) return new Date(+m[1], 0, 1);
    return null;
  };

  const monthsAgo = (d) => {
    if (!d) return null;
    const n = NOW();
    return (n.getFullYear() - d.getFullYear()) * 12 + (n.getMonth() - d.getMonth());
  };

  const daysAgo = (d) => {
    if (!d) return null;
    return Math.floor((NOW() - d) / 86400000);
  };

  // ============================================================
  // 1b. CONFIG & RULE ENGINE
  // ============================================================
  // Config (rules + thresholds + prefs) is loaded from chrome.storage.local
  // on init and re-loaded when chrome.storage.onChanged fires. In demo mode
  // (no chrome.storage), falls back to EMBEDDED_DEFAULTS substituted at build.

  const EMBEDDED_DEFAULTS = `{"version":1,"rules":[{"id":"mh-crisis","enabled":true,"label":"MH crisis","kind":"red","patterns":["suicid\\\\w*","self.?harm\\\\w*","kill myself","end my life","want to die","don.?t want to be here","harm myself"],"regex":true,"fields":["request","banner"],"pages":["queue","detail","record"],"bumpsTile":"safeguarding","builtin":true,"actions":[{"type":"link","label":"Samaritans","url":"https://www.samaritans.org/"},{"type":"link","label":"NHS 111 mental health","url":"https://111.nhs.uk/"},{"type":"snippet","label":"Risk assessment","text":"MH risk assessment:\\n- Current intent / plan / means:\\n- Recent triggers:\\n- Protective factors:\\n- Past attempts / hospital admissions:\\n- Substance use:\\n- MH services involvement:\\n- Capacity:\\n\\nAction:\\n- Same-day F2F vs phone vs crisis team\\n- Safety plan documented\\n- Safeguarding referral if children in household\\n- Follow-up timeframe agreed"},{"type":"note","label":"Safeguarding check","text":"Always consider:\\n\\u2022 Children / dependents in household \\u2192 safeguarding referral threshold\\n\\u2022 Mental Capacity Assessment\\n\\u2022 Document risk assessment in full\\n\\u2022 Crisis team contact readily available\\n\\u2022 Clear follow-up plan with named clinician"}]},{"id":"safeguarding","enabled":true,"label":"Safeguarding","kind":"red","patterns":["safeguarding","abuse","neglect","domestic violence","coercive control","hit me","afraid at home"],"regex":false,"fields":["request","banner","problems"],"pages":["queue","detail","record"],"bumpsTile":"safeguarding","builtin":true,"actions":[{"type":"link","label":"Local safeguarding (replace URL)","url":"https://www.gov.uk/government/publications/safeguarding-adults"},{"type":"note","label":"Documentation","text":"Safeguarding considerations:\\n\\u2022 Notify practice safeguarding lead\\n\\u2022 MARAC / DASH risk assessment if DV suspected\\n\\u2022 Code in record (Safeguarding adult / child concern)\\n\\u2022 Document concerns verbatim\\n\\u2022 Information sharing per local policy\\n\\u2022 Children in household \\u2014 separate referral if at risk"}]},{"id":"chest-pain","enabled":true,"label":"Chest pain","kind":"red","patterns":["chest pain","chest tightness","crushing","central chest"],"regex":false,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"Acute pathway","text":"If acute / ongoing pain \\u2192 999.\\n\\nIf resolved:\\n\\u2022 Onset, duration, character, radiation, exertion-related?\\n\\u2022 Cardiac risk factors: age, smoker, FH, DM, lipids, BP, prior CVD\\n\\u2022 Associated: SOB, sweating, N&V, syncope\\n\\u2022 Differential: ACS, PE, dissection, pericarditis, GORD, MSK, anxiety\\n\\nThresholds:\\n\\u2022 HEART score for risk stratification\\n\\u2022 Same-day clinical assessment if any concerning features"},{"type":"snippet","label":"HEART score template","text":"HEART score:\\n- History (suspicious 0/1/2):\\n- ECG (normal / non-spec / abnormal 0/1/2):\\n- Age (<45 / 45-64 / >65 = 0/1/2):\\n- Risk factors (count: 0 / 1-2 / 3+ or known CVD = 0/1/2):\\n- Troponin (norm / 1-3x / >3x ULN = 0/1/2):\\n\\nTotal: __\\n0-3 = low risk \\u00b7 4-6 = moderate \\u00b7 7-10 = high"}]},{"id":"cauda-equina","enabled":true,"label":"Cauda equina","kind":"red","patterns":["saddle.?(numb|anaesthe|paresth)","bladder retention","urinary retention","bowel incontinence","perineal numb"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"Emergency MRI","text":"Suspected cauda equina = same-day emergency MRI.\\n\\nRed flags (any):\\n\\u2022 Bilateral sciatica\\n\\u2022 Saddle anaesthesia / paraesthesia\\n\\u2022 Bladder dysfunction (retention / overflow)\\n\\u2022 Bowel incontinence / loss of anal tone\\n\\u2022 Sexual dysfunction\\n\\nAction:\\n\\u2022 Discuss with on-call neurosurgery / spinal team\\n\\u2022 Direct ED referral if no urgent MRI access\\n\\u2022 Document neuro exam including PR if appropriate"}]},{"id":"thunderclap","enabled":true,"label":"Thunderclap headache","kind":"red","patterns":["worst headache","thunderclap","sudden severe headache","sudden onset headache"],"regex":false,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"SAH pathway","text":"Thunderclap headache \\u2192 consider SAH.\\n\\n\\u2022 Maximum intensity within seconds-minutes\\n\\u2022 Same-day CT head (CT >95% sensitive within 6h)\\n\\u2022 If CT negative & onset <6h, may exclude\\n\\u2022 If onset >6h or symptoms ongoing, LP at 12h\\n\\nOther differentials: cervical artery dissection, RCVS, pituitary apoplexy, venous sinus thrombosis.\\n\\nAction: same-day ED referral."}]},{"id":"gi-bleed","enabled":true,"label":"GI bleed","kind":"red","patterns":["melaena","haematemesis","vomiting blood","coffee.?ground","fresh blood per rectum","haematochezia"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"Acute pathway","text":"Suspected upper / lower GI bleed.\\n\\n\\u2022 Haemodynamics: HR, BP, lying/standing\\n\\u2022 Anticoagulants / antiplatelets / NSAIDs\\n\\u2022 Liver disease / known varices\\n\\u2022 Glasgow-Blatchford for upper GI bleed\\n\\nAction:\\n\\u2022 Acute / unstable \\u2192 999\\n\\u2022 Stable + suspicious \\u2192 same-day medical admission\\n\\u2022 Painless rectal bleeding > 50y \\u2192 2WW colorectal"},{"type":"snippet","label":"Glasgow-Blatchford template","text":"Glasgow-Blatchford:\\n- Urea (mmol/L):\\n- Hb (g/L):\\n- Systolic BP:\\n- Pulse \\u2265100:\\n- Melaena:\\n- Syncope:\\n- Hepatic disease:\\n- Cardiac failure:\\n\\nScore: __\\n0 = consider outpatient \\u00b7 \\u22651 = admit"}]},{"id":"methotrexate","enabled":true,"label":"Methotrexate","kind":"amber","patterns":["methotrexate"],"regex":false,"fields":["meds","request","problems"],"pages":["detail","record"],"bumpsTile":"meds","builtin":true,"actions":[{"type":"note","label":"DMARD monitoring","text":"Methotrexate monitoring (NICE / BSR):\\n\\n\\u2022 FBC + U&E + LFT every 12 weeks (or 4-weekly if dose change / new abnormalities)\\n\\u2022 Annual chest X-ray if respiratory symptoms\\n\\u2022 Pneumococcal + annual flu vaccine\\n\\u2022 Folic acid 5mg weekly (\\u226524h after MTX)\\n\\nWarnings:\\n\\u2022 Teratogenic \\u2014 6mo washout F, 3mo M before conception\\n\\u2022 Hepatotoxic \\u2014 alcohol limits\\n\\u2022 Pulmonary toxicity \\u2014 investigate any new SOB / dry cough\\n\\u2022 Drug interactions \\u2014 esp. trimethoprim, NSAIDs (caution)"},{"type":"snippet","label":"Bloods reminder","text":"Methotrexate monitoring bloods:\\n- FBC + film:\\n- U&E:\\n- LFTs:\\n- Date of last MTX dose:\\n- Current dose:\\n- Folic acid:\\n- Symptoms? (SOB, mouth ulcers, infection):\\n\\nNext review due:"}]},{"id":"lithium","enabled":true,"label":"Lithium","kind":"amber","patterns":["lithium"],"regex":false,"fields":["meds","request","problems"],"pages":["detail","record"],"bumpsTile":"meds","builtin":true,"actions":[{"type":"note","label":"Lithium monitoring","text":"Lithium monitoring (NICE):\\n\\n\\u2022 Level 12h post-dose, 3-monthly (more often if dose change, illness, drug interaction)\\n\\u2022 U&E + TFT + Ca every 6 months\\n\\u2022 Target range typically 0.6-0.8 mmol/L (0.4-1.0 acceptable)\\n\\u2022 Toxicity above 1.5 mmol/L\\n\\nCommon traps:\\n\\u2022 Dehydration / D&V \\u2192 toxicity\\n\\u2022 NSAIDs, ACEi, thiazides \\u2191 levels\\n\\u2022 Pregnancy considerations \\u2014 specialist advice\\n\\u2022 Hypothyroidism long-term"}]},{"id":"anticoag","enabled":true,"label":"Anticoagulant","kind":"amber","patterns":["warfarin","apixaban","rivaroxaban","edoxaban","dabigatran"],"regex":false,"fields":["meds"],"pages":["detail","record"],"bumpsTile":"meds","builtin":true,"actions":[{"type":"note","label":"Anticoag review","text":"Annual anticoagulant review:\\n\\n\\u2022 Indication still valid?\\n\\u2022 Renal function \\u2014 dose adjustment for DOACs\\n\\u2022 Bleeding risk reassessment (HAS-BLED, ORBIT)\\n\\u2022 CHA\\u2082DS\\u2082-VASc for AF (consider stopping if low risk)\\n\\u2022 Patient knows what to do if a dose is missed\\n\\u2022 Has Yellow Book / DOAC alert card\\n\\u2022 Interacting meds review (esp. NSAIDs, antibiotics, antifungals)\\n\\u2022 Bleeding episodes \\u2014 frequency, severity, source\\n\\u2022 Falls risk if elderly"}]},{"id":"uti","enabled":true,"label":"UTI","kind":"amber","patterns":["UTI","urinary tract infection","burning passing water","burning when peeing","burning when i pee","dysuria","cystitis"],"regex":false,"fields":["request","problems"],"pages":["queue","detail","record"],"bumpsTile":null,"builtin":true,"actions":[{"type":"link","label":"NICE CKS UTI (women)","url":"https://cks.nice.org.uk/topics/urinary-tract-infection-lower-women/"},{"type":"link","label":"NICE CKS UTI (men)","url":"https://cks.nice.org.uk/topics/urinary-tract-infection-lower-men/"},{"type":"snippet","label":"UTI history & exam","text":"UTI history:\\n- Dysuria / frequency / urgency:\\n- Suprapubic pain / loin pain:\\n- Duration of symptoms:\\n- Fever / rigors / vomiting:\\n- Vaginal discharge:\\n- Sexually active / new partner:\\n- Pregnancy possible:\\n- Catheter / structural abnormality:\\n- Recent abx / hospitalisation:\\n- Recurrence (\\u22653 in 12mo or \\u22652 in 6mo):\\n- Diabetes / immunosuppression:\\n\\nO/E:\\n- Vitals (sepsis screen):\\n- Abdominal exam:\\n- Loin tenderness:\\n- (Dipstick: not for \\u226565y or catheterised):\\n\\nPlan:\\n- 1st line: nitrofurantoin or trimethoprim per local sensitivity\\n- 2nd line: pivmecillinam / fosfomycin\\n- Pyelonephritis features \\u2192 admit / IV abx"}]},{"id":"sore-throat","enabled":true,"label":"Sore throat","kind":"amber","patterns":["sore throat","tonsillitis","throat pain","pharyngitis"],"regex":false,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"link","label":"NICE CKS sore throat","url":"https://cks.nice.org.uk/topics/sore-throat-acute/"},{"type":"snippet","label":"FeverPAIN scoring","text":"FeverPAIN score (1 point each):\\n- Fever in last 24h:\\n- Purulence (tonsils):\\n- Attended within 3 days of onset:\\n- Inflamed tonsils (severe):\\n- No cough or coryza:\\n\\nTotal: __\\n0-1: 13-18% strep \\u2014 no abx, self-care\\n2-3: 34-40% strep \\u2014 delayed abx (3d) or no abx\\n4-5: 62-65% strep \\u2014 immediate abx\\n\\nAbx of choice: phenoxymethylpenicillin 500mg QDS 5-10d (clarithromycin if pen-allergic)"}]},{"id":"otitis","enabled":true,"label":"Otitis media","kind":"amber","patterns":["otitis","earache","ear infection","ear pain","ear hurts"],"regex":false,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"link","label":"NICE CKS OM","url":"https://cks.nice.org.uk/topics/otitis-media-acute/"},{"type":"snippet","label":"OM history & exam","text":"Otitis media history:\\n- Onset / duration:\\n- Fever / unwell:\\n- Otalgia laterality:\\n- Discharge / hearing loss:\\n- Recent URTI:\\n- Recurrent OM (\\u22653 in 6mo or \\u22654/yr):\\n- Eardrum perforation history:\\n- Grommets:\\n\\nO/E:\\n- TM appearance: bulging / erythematous / dull / perforated / effusion\\n- Mastoid tenderness:\\n- General \\u2014 temp, fluid intake:\\n\\nPlan:\\n- Most resolve in 3 days, paracetamol / ibuprofen\\n- Abx if: <2y bilateral, perforation + discharge, systemically unwell, deteriorating\\n- Amoxicillin 5-7d (clarithromycin if pen-allergic)\\n- Safety net: persistent fever 3-4d, mastoid swelling, hearing loss >2-4w"}]},{"id":"back-pain","enabled":true,"label":"Back pain","kind":"amber","patterns":["back pain","lower back","lumbar pain","sciatica"],"regex":false,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"link","label":"NICE LBP & sciatica","url":"https://www.nice.org.uk/guidance/ng59"},{"type":"snippet","label":"Back pain assessment","text":"Back pain \\u2014 red flags (refer urgently):\\n- Cauda equina (saddle anaesthesia, bladder/bowel)\\n- Significant trauma\\n- Age <20 or >55 new onset\\n- Progressive neurological deficit\\n- Fever / weight loss / night pain (cancer/infection)\\n- IVDU / immunosuppression\\n- History of malignancy\\n- Severe progressive limb weakness\\n\\nYellow flags (psychosocial):\\n- Belief pain is harmful\\n- Avoidance behaviour\\n- Low mood / withdrawal\\n- Job dissatisfaction\\n- Compensation/legal issues\\n\\nManagement (no red flags):\\n- Stay active, return to normal activities\\n- Analgesia: NSAIDs first-line (with PPI cover if indicated)\\n- Avoid opioids and gabapentinoids for non-specific LBP\\n- Refer to physio / MSK if not improving in 4-6 weeks"}]},{"id":"cough-resp","enabled":true,"label":"Cough/SOB","kind":"amber","patterns":["cough","shortness of breath","breathless","wheez","chest infection","phlegm"],"regex":false,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"Resp red flags","text":"Cough / breathlessness \\u2014 concerning features:\\n\\u2022 Haemoptysis\\n\\u2022 Weight loss / night sweats\\n\\u2022 Smoker / ex-smoker, esp. age >40\\n\\u2022 Persistent cough >3 weeks\\n\\u2022 Hoarseness >3 weeks\\n\\u2022 Acute onset breathlessness (PE / pneumothorax)\\n\\u2022 Tachypnoea, hypoxia, accessory muscle use\\n\\u2022 Single-lobe / focal signs\\n\\u2022 Failure to respond to abx\\n\\nThresholds:\\n\\u2022 Same-day F2F if any red flag, hypoxia, or systemic unwellness\\n\\u2022 2WW chest if haemoptysis + age >40, or persistent cough + smoker"},{"type":"snippet","label":"Resp assessment","text":"Respiratory presentation:\\n- Onset / duration:\\n- Cough: dry / productive (colour, consistency):\\n- Haemoptysis:\\n- Breathlessness \\u2014 exertional / rest, MRC grade:\\n- Wheeze:\\n- Fever, night sweats, weight loss:\\n- Chest pain \\u2014 pleuritic / cardiac:\\n- PE risk: travel, immobility, surgery, OCP, malignancy, leg swelling:\\n- Smoking pack-years:\\n- Asthma / COPD:\\n\\nO/E:\\n- Vitals: HR, BP, RR, sats, temp:\\n- WOB / accessory muscles:\\n- Chest exam:\\n- PEFR (if asthma):\\n\\nPlan:"}]},{"id":"skin-2ww","enabled":true,"label":"Skin lesion","kind":"amber","patterns":["mole","skin lesion","skin changes","changing mole","dark spot","growing lesion","non.?healing","ulcerated"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"link","label":"NICE 2WW skin","url":"https://www.nice.org.uk/guidance/ng12/chapter/Recommendations-organised-by-site-of-cancer#skin-cancers"},{"type":"snippet","label":"7-point checklist","text":"Weighted 7-point checklist for pigmented lesion (refer 2WW if score \\u22653 OR any major):\\n\\nMajor (2 points each):\\n- Change in size:\\n- Irregular shape:\\n- Irregular colour:\\n\\nMinor (1 point each):\\n- Largest diameter \\u22657mm:\\n- Inflammation:\\n- Oozing / bleeding:\\n- Change in sensation (itch):\\n\\nTotal: __\\n\\nLesion description:\\n- Site:\\n- Diameter:\\n- Colour:\\n- Border:\\n- Evolution (timeline):\\n- Symptoms:\\n- ABCDE: Asymmetry / Border / Colour / Diameter / Evolving:\\n\\nPhoto on record? Y/N"}]},{"id":"mh-general","enabled":true,"label":"Mental health","kind":"amber","patterns":["anxiety","depress","low mood","panic attack","stressed","insomnia","mental health","therapy","counselling","feeling down"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"link","label":"PHQ-9","url":"https://patient.info/doctor/patient-health-questionnaire-phq-9"},{"type":"link","label":"GAD-7","url":"https://patient.info/doctor/generalised-anxiety-disorder-assessment-gad-7"},{"type":"link","label":"Local IAPT / Talking Therapies (replace)","url":"https://www.nhs.uk/mental-health/talking-therapies-medicine-treatments/talking-therapies-and-counselling/nhs-talking-therapies/"},{"type":"snippet","label":"MH consultation","text":"MH presentation:\\n- Onset / duration / triggers:\\n- Symptoms (mood, anhedonia, sleep, appetite, energy, concentration):\\n- Anxiety symptoms / panic:\\n- Functional impact (work, relationships, self-care):\\n- Risk: thoughts of self-harm / suicide / harm to others:\\n- Substance use:\\n- Past MH history / family history:\\n- Social context: housing, finances, support network:\\n- Recent losses / life events:\\n- PHQ-9: __ / GAD-7: __\\n\\nPlan:\\n- Self-help / IAPT / counselling\\n- SSRI if moderate-severe (caution under 25 \\u2014 review 2 weekly):\\n- Safety net + follow-up:"}]},{"id":"post-discharge","enabled":true,"label":"Post-discharge","kind":"amber","patterns":["discharge","discharged","just home from hospital","out of hospital","recently in hospital"],"regex":false,"fields":["request","docs"],"pages":["queue","detail","record"],"bumpsTile":"openLoops","builtin":true,"actions":[{"type":"note","label":"Post-discharge checklist","text":"After hospital discharge \\u2014 review:\\n\\n\\u2022 Medication reconciliation (new / changed / stopped)\\n\\u2022 Follow-up appointments booked?\\n\\u2022 Outstanding investigations / results pending?\\n\\u2022 Self-monitoring / safety-net advice given?\\n\\u2022 District nurse / community support arranged?\\n\\u2022 Social: home situation, carer, equipment\\n\\u2022 Code recent admission in record\\n\\u2022 Update problem list and registers (e.g. HF, COPD, AF post-MI)\\n\\u2022 Consider proactive care plan if frail / multimorbid"},{"type":"snippet","label":"Post-discharge review","text":"Post-discharge review:\\n\\nAdmission:\\n- Dates:\\n- Diagnoses:\\n- Procedures:\\n- Discharge medications (new/changed):\\n- Follow-up planned:\\n\\nReview today:\\n- Recovery progress:\\n- Symptoms \\u2014 concerning / improving:\\n- Pain control:\\n- Mobility / ADLs:\\n- Med compliance / side effects:\\n- Outstanding actions chased:\\n- Safety net advice:"}]},{"id":"repeat-meds","enabled":true,"label":"Repeat meds","kind":"info","patterns":["repeat prescription","repeat medication","ran out","running out","reorder","top.?up","more of my"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"snippet","label":"SMR template","text":"Structured Medication Review (SMR):\\n\\nPatient understanding:\\n- Knows why each med is prescribed:\\n- Adherence / compliance:\\n- Side effects experienced:\\n- Self-monitoring (BP, BG, peak flow):\\n\\nFor each medication:\\n- Indication still valid?\\n- Dose appropriate (renal/hepatic adjustment)?\\n- Duplications / interactions / cascades?\\n- Anticholinergic burden / falls risk?\\n- Recent monitoring done?\\n\\nDeprescribe candidates:\\n- PPI > 8 weeks without indication\\n- Long-term benzo / Z-drug\\n- Statin in extreme frailty / limited life expectancy\\n- Anti-hypertensives if postural hypotension\\n- Aspirin without clear secondary prevention indication\\n\\nAgreed plan:"}]},{"id":"fit-note","enabled":true,"label":"Fit note","kind":"info","patterns":["fit note","sick note","med ?3","fitness for work","off work"],"regex":false,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"link","label":"GOV.UK Med3 guidance","url":"https://www.gov.uk/government/publications/fit-note-guidance-for-healthcare-professionals"},{"type":"snippet","label":"Fit note template","text":"Med3 considerations:\\n\\n- Diagnosis (the condition affecting work):\\n- Functional limitations (what can / can't do):\\n- Duration: <3mo (any duration) / >3mo (max 3mo):\\n- 'Not fit' or 'May be fit' (consider phased return / amended duties / altered hours / workplace adaptations):\\n- Assessment date and end date:\\n- Comments / advice to employer:\\n\\nFor mental health:\\n- Avoid jargon \\u2014 concrete functional language\\n- Consider OH referral / IAPT signposting\\n\\nFor MSK:\\n- Active management plan\\n- Avoid bed rest > 1-2 days"}]},{"id":"menopause","enabled":true,"label":"Menopause/HRT","kind":"info","patterns":["menopaus","hot flush","perimenopaus","HRT","hormone replacement"],"regex":false,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"link","label":"NICE menopause (NG23)","url":"https://www.nice.org.uk/guidance/ng23"},{"type":"link","label":"British Menopause Society","url":"https://thebms.org.uk/"},{"type":"snippet","label":"HRT consultation","text":"Menopause / HRT consultation:\\n\\nSymptoms:\\n- Vasomotor (flushes, sweats, night sweats):\\n- Mood, sleep, cognition:\\n- GU: vaginal dryness, dyspareunia, urinary:\\n- Joint / muscle pain:\\n- Libido:\\n- Functional impact:\\n\\nHistory:\\n- LMP / cycle changes:\\n- Contraception still needed?\\n- Migraine with aura?\\n- VTE / clotting history (personal / family):\\n- Breast / endometrial / ovarian cancer history:\\n- BMI / smoking / alcohol:\\n- Cardiovascular risk:\\n- Liver disease:\\n- Current meds:\\n\\nDiscussion:\\n- Risk / benefit balance\\n- Options: sequential vs continuous combined; oestrogen-only if hysterectomy; transdermal preferred if VTE / migraine / hepatic / >60\\n- Vaginal oestrogen for GU symptoms (no extra systemic risk)\\n- Testosterone for low libido (off-label)\\n- Lifestyle, CBT for vasomotor\\n\\nPlan / review timeframe:"}]}],"thresholds":{"polypharmacyRed":15,"polypharmacyAmber":10,"bpAgeMonthsLtc":9,"bpAgeMonthsNoLtc":24,"weightAgeMonths":24,"frailtyHitsRed":3,"frailtyHitsAmber":1,"lastContactMonths":12,"recentDischargeRed":14,"recentDischargeAmber":90,"anticholinergicAmber":3,"qofOverdueRed":2,"recentReferralDays":60,"taskAgeAmber":3,"taskAgeRed":7,"elderAge":80,"childAge":16},"prefs":{"showAgeChip":true,"showFootStats":true,"showRequestSnippet":true,"snippetMaxChars":240,"showBuiltInTiles":true},"systemChips":{"queue.child":{"enabled":true,"label":"Child ({age})","kind":"amber","actions":[]},"queue.elder":{"enabled":true,"label":"Elder ({age})","kind":"amber","actions":[]},"queue.taskAgeAmber":{"enabled":true,"label":"{days}d","kind":"amber","actions":[]},"queue.taskAgeRed":{"enabled":true,"label":"{days}d","kind":"red","actions":[]},"queue.priority":{"enabled":true,"label":"{priority}","kind":"red","actions":[]},"detail.statusAwaiting":{"enabled":true,"label":"{status}","kind":"amber","actions":[]},"detail.statusReplyReceived":{"enabled":true,"label":"{status}","kind":"red","actions":[]},"detail.statusClosed":{"enabled":true,"label":"{status}","kind":"green","actions":[]},"detail.statusOther":{"enabled":true,"label":"{status}","kind":"info","actions":[]},"detail.priority":{"enabled":true,"label":"{priority}","kind":"red","actions":[]},"detail.daysOpenInfo":{"enabled":true,"label":"{days}d open","kind":"info","actions":[]},"detail.daysOpenAmber":{"enabled":true,"label":"{days}d open","kind":"amber","actions":[]},"detail.daysOpenRed":{"enabled":true,"label":"{days}d open","kind":"red","actions":[]},"detail.today":{"enabled":true,"label":"today","kind":"info","actions":[]},"detail.proxy":{"enabled":true,"label":"via {relationship}","kind":"info","actions":[]},"detail.attachments":{"enabled":true,"label":"{count} attach","kind":"info","actions":[]},"record.age":{"enabled":true,"label":"{age}y","kind":"info","actions":[]},"record.palliative":{"enabled":true,"label":"Palliative","kind":"red","actions":[]},"record.riskToSelf":{"enabled":true,"label":"Risk to self","kind":"red","actions":[]},"record.frailtyRed":{"enabled":true,"label":"Frailty x{count}","kind":"red","actions":[]},"record.frailtyAmber":{"enabled":true,"label":"Frailty x{count}","kind":"amber","actions":[]},"record.recentAdmissionRed":{"enabled":true,"label":"Admit {days}d","kind":"red","actions":[]},"record.recentAdmissionAmber":{"enabled":true,"label":"Admit {days}d","kind":"amber","actions":[]},"record.polypharmacyRed":{"enabled":true,"label":"Meds x{count}","kind":"red","actions":[]},"record.polypharmacyAmber":{"enabled":true,"label":"Meds x{count}","kind":"amber","actions":[]},"record.monitoringDueRed":{"enabled":true,"label":"Monitoring due x{count}","kind":"red","actions":[]},"record.monitoringDueAmber":{"enabled":true,"label":"Monitoring x{count}","kind":"amber","actions":[]},"detail.monitoringDueRed":{"enabled":true,"label":"Monitoring due x{count}","kind":"red","actions":[]},"detail.monitoringDueAmber":{"enabled":true,"label":"Monitoring x{count}","kind":"amber","actions":[]},"detail.docType":{"enabled":true,"label":"{docType}","kind":"info","actions":[]},"detail.docSpecialty":{"enabled":true,"label":"{specialty}","kind":"info","actions":[]},"detail.docEntries":{"enabled":true,"label":"Filed notes ×{count}","kind":"info","actions":[]},"detail.docUrgent":{"enabled":false,"label":"Urgent: {term}","kind":"red","actions":[]},"detail.docAction":{"enabled":false,"label":"Action: {phrase}","kind":"amber","actions":[]},"queue.monitoringDueRed":{"enabled":false,"label":"Monitoring ×{count}","kind":"red","actions":[]},"queue.monitoringDueAmber":{"enabled":false,"label":"Monitoring {count}","kind":"amber","actions":[]}}}`;

  let CONFIG = null;
  let COMPILED_RULES = [];

  const fallbackConfig = () => {
    try {
      if (EMBEDDED_DEFAULTS && !EMBEDDED_DEFAULTS.includes('DEFAULTS_PLACEHOLDER')) {
        return JSON.parse(EMBEDDED_DEFAULTS);
      }
    } catch (e) {}
    return { version: 1, rules: [], thresholds: {}, prefs: {} };
  };

  const compileRule = (rule) => {
    if (!rule || !rule.enabled) return null;
    const compiled = [];
    for (const p of rule.patterns || []) {
      const s = String(p || '').trim();
      if (!s) continue;
      try {
        // Plain-text mode: leading \b only — pattern is treated as a word stem
        // ("cough" matches "cough" + "coughing" + "coughed"). This is what
        // clinical keyword lists usually want.
        // Regex mode: keep both \b — power-user mode, predictable bounds.
        const src = rule.regex ? s : s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const wrapped = rule.regex ? ('\\b' + src + '\\b') : ('\\b' + src);
        compiled.push(new RegExp(wrapped, 'i'));
      } catch (e) { /* invalid regex — skip */ }
    }
    if (!compiled.length) return null;
    return { ...rule, _compiled: compiled };
  };

  const recompileRules = () => {
    COMPILED_RULES = (CONFIG?.rules || []).map(compileRule).filter(Boolean);
  };

  const loadConfig = async () => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        // Phase 0: use namespaced key; fall back to legacy 'config' key and migrate on first load
        let r = await chrome.storage.local.get('triagelens.config');
        if (r['triagelens.config']) {
          CONFIG = r['triagelens.config'];
        } else {
          const legacy = await chrome.storage.local.get('config');
          CONFIG = legacy.config || fallbackConfig();
          // Write under new key so future loads skip this branch
          if (CONFIG && (CONFIG.version || CONFIG.rules || CONFIG.systemChips)) {
            chrome.storage.local.set({ 'triagelens.config': CONFIG }).catch(() => {});
          }
        }
      } catch (e) {
        CONFIG = fallbackConfig();
      }
    } else if (typeof window !== 'undefined' && window.__TL_CONFIG) {
      CONFIG = window.__TL_CONFIG;
    } else {
      CONFIG = fallbackConfig();
    }
    recompileRules();
    return CONFIG;
  };

  const watchConfig = (onChange) => {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.onChanged) return;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      // Accept updates on either key for a clean transition period
      const newVal = changes['triagelens.config']?.newValue || changes['config']?.newValue;
      if (!newVal) return;
      CONFIG = newVal || fallbackConfig();
      recompileRules();
      try { onChange(); } catch (e) {}
    });
  };

  // Match all enabled rules against the field-data bag for the given page.
  // fieldsData: { request?: string, problems?: string[], registers?: string[], meds?: string[], allergies?: string[], banner?: string[], consultations?: string[], docs?: string[] }
  const matchRules = (page, fieldsData) => {
    const out = [];
    for (const rule of COMPILED_RULES) {
      if (!rule.pages?.includes(page)) continue;
      let matched = false;
      for (const fname of rule.fields || []) {
        const fv = fieldsData[fname];
        if (fv == null) continue;
        const text = Array.isArray(fv) ? fv.join('\n') : String(fv);
        if (!text) continue;
        if (rule._compiled.some(re => re.test(text))) { matched = true; break; }
      }
      if (matched) out.push(rule);
    }
    return out;
  };

  // Threshold getter (with fallback to defaults baked into builtins)
  const TH_DEFAULTS = {
    polypharmacyRed: 15, polypharmacyAmber: 10, bpAgeMonthsLtc: 9, bpAgeMonthsNoLtc: 24,
    weightAgeMonths: 24, frailtyHitsRed: 3, frailtyHitsAmber: 1, lastContactMonths: 12,
    recentDischargeRed: 14, recentDischargeAmber: 90, anticholinergicAmber: 3,
    qofOverdueRed: 2, recentReferralDays: 60, taskAgeAmber: 3, taskAgeRed: 7,
    elderAge: 80, childAge: 16
  };
  const TH = (k) => {
    const v = CONFIG?.thresholds?.[k];
    return Number.isFinite(v) ? v : TH_DEFAULTS[k];
  };
  const PREF = (k, dflt) => {
    if (!CONFIG || !CONFIG.prefs) return dflt;
    const v = CONFIG.prefs[k];
    return v === undefined ? dflt : v;
  };

  // ---- System chips (configurable baseline chips, distinct from text-pattern rules) ----
  // Each chip has stable id, configurable label/kind/actions/enabled. The match
  // logic is hardcoded (computed against extracted patient/task data); only
  // *what gets displayed* is user-controlled.
  //
  // The shipped defaults are the single source of truth in EMBEDDED_DEFAULTS
  // (above) — we derive the per-chip fallback map from there rather than keeping
  // a second hand-maintained copy in sync. (defaults.json is the third copy, kept
  // identical by test-triage-defaults.js.)
  const SYS_CHIP_DEFAULTS = fallbackConfig().systemChips || {};

  // Resolve a system chip's current config, falling back to defaults if user
  // hasn't customised it yet.
  const findSystemChip = (id) => {
    const cfg = CONFIG?.systemChips?.[id];
    const def = SYS_CHIP_DEFAULTS[id];
    if (!cfg && !def) return null;
    return { ...(def || {}), ...(cfg || {}) };
  };

  // Build a chip object for rendering, performing variable substitution on the
  // configured label. Returns null if the chip is disabled. ruleId is set to
  // 'system:<id>' so the action menu can find it.
  const getSystemChip = (id, vars) => {
    const cfg = findSystemChip(id);
    if (!cfg || cfg.enabled === false) return null;
    let text = cfg.label || '';
    if (vars) {
      for (const k of Object.keys(vars)) {
        text = text.split('{' + k + '}').join(String(vars[k]));
      }
    }
    return {
      kind: cfg.kind || 'info',
      text,
      ruleId: 'system:' + id,
      hasActions: (cfg.actions || []).length > 0
    };
  };

  // ============================================================
  // 1c. PAGE ROUTING
  // ============================================================
  const pageType = () => {
    if (typeof window !== 'undefined' && window.__clinHudForcePage) return window.__clinHudForcePage;
    const u = location.href;

    // Patient care record (any variant — clinical summary, journal, medication,
    // results & observations, problems, appointments, admin record, audit etc.)
    if (/\/care-record\//.test(u)) return 'record';
    if (/\/patient\/patient\//.test(u)) return 'record';
    if (/\/administrative-record\//.test(u)) return 'record';

    // Any *list view* across the task system. Medicus has many task types —
    // medical_patient_request_task, investigation_result_task,
    // routine_prescription_request_task, miscellaneous_task,
    // appointments_required_task, patient_questionnaire_response_task etc.
    // All use the same /tasks/{type}/task-list URL shape.
    if (/\/tasks\/[^/]+\/task-list/.test(u)) return 'queue';

    // Any other view under /tasks/ — communication threads, investigation
    // result detail pages, prescription request detail, etc — render as a
    // detail page so the HUD attaches and rules fire.
    if (/\/tasks\//.test(u)) return 'detail';

    // Encounter / consultation views
    if (/\/clinical\/encounter\//.test(u)) return 'detail';

    return null;
  };

  // ============================================================
  // 2. DOM EXTRACTION
  // ============================================================
  const findCardByTitle = (title) => {
    const h2 = [...document.querySelectorAll('h2, h3, h4')].find(h => h.textContent.trim() === title);
    return h2 ? (h2.closest('.m-card-v2') || h2.closest('[class*="m-card"]') || h2.parentElement?.parentElement) : null;
  };

  const cardContent = (card) => {
    if (!card) return null;
    return card.querySelector('.m-card-v2__content, [class*="card-v2__content"], [class*="card__content"]') || card;
  };

  // innerText polyfill — returns line-broken text from an element. Works in
  // real browsers (uses native innerText if non-empty) and in jsdom (custom walk).
  const ROW_TAGS = new Set(['DIV','P','LI','TR','UL','OL','SECTION','HEADER','FOOTER','ARTICLE','H1','H2','H3','H4','H5','H6','BR','TBODY','THEAD','TFOOT','TABLE','BLOCKQUOTE','PRE']);
  const getText = (el) => {
    if (!el) return '';
    if (typeof el.innerText === 'string' && el.innerText.length) return el.innerText;
    const out = [];
    const walk = (n) => {
      if (n.nodeType === 3) { out.push(n.textContent); return; }
      if (n.nodeType !== 1) return;
      const isRow = ROW_TAGS.has(n.tagName);
      if (isRow && out.length && !/[\s\n]$/.test(out[out.length - 1])) out.push('\n');
      const kids = [...n.childNodes];
      kids.forEach((c, i) => {
        // Insert a space between adjacent inline element siblings if there's no whitespace
        if (i > 0 && c.nodeType === 1 && !ROW_TAGS.has(c.tagName)) {
          const last = out[out.length - 1];
          if (last && !/\s$/.test(last) && c.textContent.trim()) out.push(' ');
        }
        walk(c);
      });
      if (isRow && out.length && !/[\s\n]$/.test(out[out.length - 1])) out.push('\n');
    };
    walk(el);
    return out.join('').replace(/[ \t]+/g, ' ').replace(/\n[ \t]+/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n').trim();
  };
  const getLines = (el) => getText(el).split('\n').map(r => r.trim()).filter(Boolean);

  // Extract patient banner data
  const extractBanner = () => {
    // Find badges. Exclude HUD's own DOM so its tile labels don't pollute warnings.
    const allBadges = [...document.querySelectorAll('button, span, div, a')].filter(el => {
      if (el.children.length > 0) return false;
      if (el.closest('#' + HUD_ID)) return false;
      const txt = el.textContent.trim();
      return /^(Risk to Self|EMIS Imported Warning|Carer|Veteran|Looked After|Safeguarding|DNACPR|ReSPECT)/i.test(txt);
    });
    const warnings = allBadges.map(b => b.textContent.trim());

    // Find banner element. Try common Medicus selectors first, then walk up from a badge if any.
    let bannerEl = document.querySelector('.m-patient-banner, [class*="patient-banner"], [class*="PatientBanner"], .m-banner');
    if (!bannerEl && allBadges.length > 0) {
      let p = allBadges[0];
      for (let i = 0; i < 8 && p; i++) {
        if (p.tagName === 'HEADER' || /banner|patient-summary/i.test(p.className?.toString() || '')) {
          bannerEl = p; break;
        }
        p = p.parentElement;
      }
      if (!bannerEl) bannerEl = allBadges[0].closest('section') || allBadges[0].parentElement?.parentElement;
    }

    const bannerText = bannerEl?.textContent || '';
    // Try to spot an age "(NNy" or a DOB string
    let age = null;
    const ageMatch = bannerText.match(/\b(\d{1,3})\s*y(?:ears?)?\b/i);
    if (ageMatch) {
      const n = +ageMatch[1];
      if (n > 0 && n < 120) age = n;
    }
    if (!age) {
      const dobMatch = bannerText.match(/(\d{1,2})[\s/.-]([A-Z][a-z]{2}|\d{1,2})[\s/.-](\d{4})/);
      if (dobMatch) {
        let mo = dobMatch[2];
        if (isNaN(+mo)) mo = MONTHS[mo]; else mo = +mo - 1;
        const dob = new Date(+dobMatch[3], mo, +dobMatch[1]);
        if (!isNaN(dob)) age = Math.floor((NOW() - dob) / (365.25 * 86400000));
      }
    }

    return { warnings: [...new Set(warnings)], age };
  };

  const extractRegisters = () => {
    const card = findCardByTitle('Registers');
    if (!card) return [];
    const c = cardContent(card);
    return [...c.querySelectorAll('li, a')].map(el => el.textContent.trim()).filter((t, i, arr) => t && arr.indexOf(t) === i);
  };

  const DATE_LINE = /^(\d{1,2}\s+[A-Z][a-z]{2}\s+\d{4}|[A-Z][a-z]{2}\s+\d{4}|\d{4})\*?$/;

  const extractActiveProblems = () => {
    const card = findCardByTitle('Active Problems');
    if (!card) return [];
    const c = cardContent(card);
    if (!c) return [];

    const problems = [];
    let currentSection = null;
    let pendingName = null;

    const rows = getLines(c);

    const flushPending = () => {
      if (pendingName) {
        problems.push({ section: currentSection, name: pendingName, date: null });
        pendingName = null;
      }
    };

    for (const row of rows) {
      if (['Major', 'Minor', 'Unknown Significance'].includes(row)) {
        flushPending();
        currentSection = row;
        continue;
      }
      if (row.startsWith('*')) continue;
      if (/^\*?Not the onset/i.test(row)) continue;

      // Date-only line — pair with pending name
      if (DATE_LINE.test(row)) {
        if (pendingName) {
          problems.push({ section: currentSection, name: pendingName, date: parseDate(row) });
          pendingName = null;
        }
        continue;
      }

      // Combined "<name> <date>" line
      const combined = row.match(/^(.+?)\s+(\d{1,2}\s+[A-Z][a-z]{2}\s+\d{4}\*?|[A-Z][a-z]{2}\s+\d{4}\*?|\d{4}\*?)$/);
      if (combined && DATE_LINE.test(combined[2].replace(/\*$/, ''))) {
        flushPending();
        problems.push({ section: currentSection, name: combined[1].trim(), date: parseDate(combined[2]) });
        continue;
      }

      // Otherwise this is a problem name awaiting a date
      flushPending();
      pendingName = row;
    }
    flushPending();
    return problems;
  };

  const extractMedications = () => {
    const card = findCardByTitle('Current Medication');
    if (!card) return { repeats: [], acutes: [], otc: [] };
    const c = cardContent(card);
    if (!c) return { repeats: [], acutes: [], otc: [] };

    const repeats = [];
    const acutes = [];
    const otc = [];
    let mode = null;

    const rows = getLines(c);
    for (const row of rows) {
      if (/^Current Repeat Medications?$/i.test(row)) { mode = 'repeat'; continue; }
      if (/^Acute Prescriptions/i.test(row)) { mode = 'acute'; continue; }
      if (/^Over-?the-?Counter/i.test(row)) { mode = 'otc'; continue; }
      if (mode === 'repeat') repeats.push(row);
      else if (mode === 'acute') acutes.push(row);
      else if (mode === 'otc') otc.push(row);
    }
    return { repeats, acutes, otc };
  };

  const extractTasks = () => {
    const card = findCardByTitle('Tasks & Actions');
    if (!card) return { qofOverdue: [], futureActions: [], appts: [], incomplete: [] };
    const c = cardContent(card);
    if (!c) return { qofOverdue: [], futureActions: [], appts: [], incomplete: [] };

    const qofOverdue = [];
    const futureActions = [];
    const appts = [];
    const incomplete = [];
    let mode = null;
    let pending = null;
    const flushPending = () => { if (pending) { qofOverdue.push(pending); pending = null; } };

    const rows = getLines(c);
    for (const raw of rows) {
      // Strip an "Overdue" token that may appear combined with code or date
      const hasOverdue = /\bOverdue\b/i.test(raw);
      const row = raw.replace(/\s*\bOverdue\b\s*/gi, ' ').replace(/\s+/g, ' ').trim();

      // Pure "Overdue" line — flag the pending QOF item
      if (row === '' && hasOverdue) {
        if (pending) pending.overdue = true;
        continue;
      }

      // Section switches
      if (/^QOF\s+\d+\/\d+$/i.test(row)) { flushPending(); mode = 'qof'; continue; }
      if (/^Other Future Actions$/i.test(row)) { flushPending(); mode = 'future'; continue; }
      if (/^Upcoming Appointments$/i.test(row)) { flushPending(); mode = 'appt'; continue; }
      if (/^Incomplete Tasks$/i.test(row)) { flushPending(); mode = 'inc'; continue; }

      if (mode === 'qof') {
        const codeMatch = row.match(/^([A-Z]{2,}\d+):/);
        if (codeMatch) {
          flushPending();
          pending = { code: row, overdue: hasOverdue, date: null };
          continue;
        }
        if (pending && parseDate(row)) {
          pending.date = parseDate(row);
          if (hasOverdue) pending.overdue = true;
          qofOverdue.push(pending);
          pending = null;
          continue;
        }
        // Code row that already had a date appended? "DM006: ... Mar 2026"
        const inlineCodeWithDate = row.match(/^([A-Z]{2,}\d+:.+?)\s+(\d{1,2}\s+[A-Z][a-z]{2}\s+\d{4}|[A-Z][a-z]{2}\s+\d{4})$/);
        if (inlineCodeWithDate) {
          flushPending();
          qofOverdue.push({ code: inlineCodeWithDate[1].trim(), overdue: hasOverdue, date: parseDate(inlineCodeWithDate[2]) });
          continue;
        }
      } else if (mode === 'future') {
        if (/^None\.?$/i.test(row)) continue;
        if (parseDate(row) && futureActions.length && !futureActions[futureActions.length - 1].date) {
          futureActions[futureActions.length - 1].date = parseDate(row);
        } else {
          futureActions.push({ name: row, date: null });
        }
      } else if (mode === 'appt') {
        if (/^None\.?$/i.test(row)) continue;
        appts.push(row);
      } else if (mode === 'inc') {
        if (/^None\.?$/i.test(row)) continue;
        incomplete.push(row);
      }
    }
    flushPending();
    return { qofOverdue, futureActions, appts, incomplete };
  };

  const extractObservations = () => {
    const card = findCardByTitle('Observations & Results');
    if (!card) return {};
    const c = cardContent(card);
    if (!c) return {};
    const obs = {};
    const rows = getLines(c);

    const isFiltered = (s) => !s || /^(Key Observations|View all|Observations & Results|Recent Results|Recent Observations|None recorded|Measured on)/i.test(s);
    const PURE_DATE = /^(\d{1,2}\s+[A-Z][a-z]{2}\s+\d{4})$/;
    const VAL_DATE  = /^(.+?)\s+(\d{1,2}\s+[A-Z][a-z]{2}\s+\d{4})$/;
    const FULL      = /^([A-Za-z][A-Za-z0-9]{0,15})\s+(.+?)\s+(\d{1,2}\s+[A-Z][a-z]{2}\s+\d{4})$/;
    const LABEL     = /^[A-Za-z][A-Za-z0-9 /-]{0,15}$/; // single short label, may include space (e.g. "Pulse rate")

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (isFiltered(row)) continue;

      // Pattern A: "Label Value Date" all combined on one line (single-word label only)
      let m = row.match(FULL);
      if (m && parseDate(m[3]) && !obs[m[1]]) {
        obs[m[1]] = { value: m[2].trim(), date: parseDate(m[3]), raw: row };
        continue;
      }

      // Pattern B: "Value Date" — label is on a recent prior unfiltered row
      m = row.match(VAL_DATE);
      if (m && parseDate(m[2])) {
        for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
          if (isFiltered(rows[j])) continue;
          if (LABEL.test(rows[j]) && !obs[rows[j]]) {
            obs[rows[j]] = { value: m[1].trim(), date: parseDate(m[2]), raw: `${rows[j]} ${row}` };
          }
          break; // first non-filtered row up is the only candidate
        }
        continue;
      }

      // Pattern C: pure date row — label and value on previous two non-filtered rows
      if (PURE_DATE.test(row) && i >= 2) {
        // Walk back skipping filtered rows
        let lbl = null, val = null;
        for (let j = i - 1; j >= Math.max(0, i - 4); j--) {
          if (isFiltered(rows[j])) continue;
          if (val === null) { val = rows[j]; continue; }
          if (lbl === null) { lbl = rows[j]; break; }
        }
        if (lbl && val && LABEL.test(lbl) && !obs[lbl]) {
          obs[lbl] = { value: val.trim(), date: parseDate(row), raw: `${lbl} ${val} ${row}` };
        }
      }
    }

    return obs;
  };

  const extractDocuments = () => {
    const titles = [...document.querySelectorAll('h2, h3, h4, strong, b, div')].filter(el => /Recent Documents/i.test(el.textContent) && el.textContent.length < 60);
    if (!titles.length) return [];
    const t = titles[0];
    // Use immediate parent (the task-group / subsection) so we don't bleed into adjacent groups like Consultations
    const container = t.parentElement;
    if (!container) return [];
    const rows = getLines(container);
    const docs = [];
    const COMBINED = /^(.+?)\s+(\d{1,2}\s+[A-Z][a-z]{2}\s+\d{4})$/;

    let pendingName = null;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (/Recent Documents|View all/i.test(row)) { pendingName = null; continue; }

      // "Name  Date" combined
      const combined = row.match(COMBINED);
      if (combined && parseDate(combined[2])) {
        if (pendingName) pendingName = null;
        docs.push({ name: combined[1].trim(), date: parseDate(combined[2]) });
        continue;
      }

      // Date alone — pair with previous name
      if (parseDate(row) && /^\d{1,2}\s+[A-Z]|^[A-Z][a-z]{2}\s+\d{4}/.test(row)) {
        if (pendingName) {
          docs.push({ name: pendingName, date: parseDate(row) });
          pendingName = null;
        }
        continue;
      }

      // Otherwise it's a name awaiting a date
      pendingName = row;
    }
    return docs;
  };

  const extractConsultations = () => {
    const titles = [...document.querySelectorAll('h2, h3, h4, strong, b, div')].filter(el => /Last 3 Consultations|Recent Consultations/i.test(el.textContent) && el.textContent.length < 60);
    if (!titles.length) return [];
    const t = titles[0];
    const container = t.parentElement;
    if (!container) return [];
    const rows = getLines(container);
    const cons = [];
    const COMBINED_DATE_RE = /^(.+?)\s+(\d{1,2}\s+[A-Z][a-z]{2}\s+\d{4})$/;

    let pending = null;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (/Last 3 Consultations|Recent Consultations|View all/i.test(row)) { pending = null; continue; }

      // Case A: "Type  Date" combined on one row, clinician on next row
      const combined = row.match(COMBINED_DATE_RE);
      if (combined && parseDate(combined[2])) {
        if (pending) { cons.push(pending); pending = null; }
        pending = { type: combined[1].trim(), clinician: '', date: parseDate(combined[2]) };
        continue;
      }

      // Case B: pure date row → close out pending entry's date
      if (parseDate(row) && /^\d{1,2}\s+[A-Z]|^[A-Z][a-z]{2}\s+\d{4}/.test(row)) {
        if (pending) {
          if (!pending.date) pending.date = parseDate(row);
          cons.push(pending);
          pending = null;
        } else if (cons.length === 0 && i >= 2) {
          // Fallback for "Type / Clinician / Date" 3-line shape
          cons.push({ type: rows[i - 2], clinician: rows[i - 1], date: parseDate(row) });
        }
        continue;
      }

      // Otherwise: this is either a Type (no date yet) or a Clinician line for a pending entry
      if (pending && !pending.clinician) {
        pending.clinician = row;
        cons.push(pending);
        pending = null;
      } else {
        if (pending) cons.push(pending);
        pending = { type: row, clinician: '', date: null };
      }
    }
    if (pending && pending.date) cons.push(pending);
    return cons;
  };

  // ---- Detail page (communication thread) extractors ----
  // Parse "Label  Value" pairs that may render same-line or split across rows
  const parseLabelValue = (lines, knownLabels) => {
    const out = {};
    const labelRe = new RegExp('^(' + knownLabels.map(l => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\s+(.+)$');
    for (let i = 0; i < lines.length; i++) {
      const row = lines[i];
      const m = row.match(labelRe);
      if (m) {
        out[m[1]] = m[2].trim();
      } else if (knownLabels.includes(row) && i + 1 < lines.length && !knownLabels.includes(lines[i + 1])) {
        out[row] = lines[i + 1].trim();
      }
    }
    return out;
  };

  const extractTaskDetails = () => {
    const card = findCardByTitle('Task Details');
    if (!card) return {};
    const c = cardContent(card);
    if (!c) return {};
    return parseLabelValue(getLines(c), ['Status', 'Priority', 'Due date', 'Assigned to', 'Created']);
  };

  const extractRequester = () => {
    const card = findCardByTitle('Requester Details');
    if (!card) return {};
    const c = cardContent(card);
    if (!c) return {};
    return parseLabelValue(getLines(c), ['Proxy name', 'Relationship to patient', 'Patient mobile', 'Patient email', 'Phone']);
  };

  const extractInitialRequest = () => {
    const card = findCardByTitle('Initial Request');
    if (!card) return { text: '', attachmentCount: 0 };
    const c = cardContent(card);
    if (!c) return { text: '', attachmentCount: 0 };
    const text = getText(c).replace(/^Initial Request\s*/i, '').trim();
    const attachmentCount = [...c.querySelectorAll('a')].filter(a =>
      /\.(pdf|docx?|jpe?g|png|tiff?|heic|gif)$/i.test((a.href || '') + ' ' + (a.textContent || ''))
    ).length;
    return { text, attachmentCount };
  };

  const isDocumentTask = () => /\/tasks\/data\/document\/overview\//.test(location.href);

  const extractDocumentTaskInfo = () => {
    // Use findCardByTitle (handles both .m-card-v2 and legacy .m-card selectors)
    const getCardText = (heading) => {
      const card = findCardByTitle(heading);
      return card ? getText(card) : '';
    };
    const overviewText = getCardText('Task Overview');
    const detailText   = getCardText('Document Details');
    const commentText  = getCardText('Internal Comments');
    const codesText    = getCardText('Codes & Actions');

    // Anchor key match to line-start to avoid substring collisions (e.g. 'Type' in 'Document Type')
    const field = (text, key, stopRe) => {
      const re = new RegExp('(?:^|\\n)' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\n?');
      const m = re.exec(text);
      if (!m) return '';
      const rest = text.slice(m.index + m[0].length);
      const stop = stopRe ? rest.match(stopRe) : null;
      return (stop ? rest.slice(0, stop.index) : rest.split(/Edit task|Expand|New task|Save/i)[0]).trim();
    };

    // Strip heading and autocomplete chrome line-by-line (avoid lazy [\s\S]*?suggestions)
    const codes = codesText
      .replace(/^Codes & Actions\s*/i, '')
      .replace(/^Type to enter[^\n]*\n?/gim, '')
      .trim();

    return {
      taskDetails: {
        Status:   field(overviewText, 'Status',   /Priority|Edit task/),
        Priority: field(overviewText, 'Priority', /Edit task|Due/),
        Created:  (overviewText.match(/Created\s*(\d{1,2}\s+\w+\s+\d{4})/) || [])[1] || ''
      },
      docType:   field(detailText, 'Type',                /Document date|Author/),
      docDate:   (detailText.match(/Document date\s*(\d{1,2}\s+\w+\s+\d{4})/) || [])[1] || '',
      author:    field(detailText, 'Author',               /Clinical specialty|Linked/i),
      specialty: field(detailText, 'Clinical specialty',   /Linked/i),
      comments:  commentText
        .replace(/Internal Comments \(\d+\)\s*/i, '')
        .replace(/New task comment[\s\S]*/i, '')
        // Strip author attribution lines (Name • timestamp); allow hyphens/apostrophes in names
        .replace(/^[A-Z][A-Za-z'\-]+(?: [A-Z][A-Za-z'\-]+)+\s*•[^\n]*/gm, '')
        .trim(),
      codes
    };
  };

  const extractAll = () => {
    return {
      banner: extractBanner(),
      registers: extractRegisters(),
      problems: extractActiveProblems(),
      meds: extractMedications(),
      tasks: extractTasks(),
      obs: extractObservations(),
      docs: extractDocuments(),
      cons: extractConsultations()
    };
  };

  // ============================================================
  // 3. SIGNAL COMPUTATION (deterministic; no AI)
  // ============================================================

  const FRAILTY_TERMS = [
    'postural hypotension', 'falls', 'fall', 'breathlessness', 'confusion', 'delirium',
    'double incontinence', 'urinary incontinence', 'urine incontinence', 'faecal incontinence',
    'dressing', 'unsteadiness', 'dizziness', 'cognitive', 'frail', 'reduced mobility',
    'pressure sore', 'pressure ulcer', 'malnutrition', 'weight loss', 'sarcopenia'
  ];

  const HIGH_RISK_DRUGS = [
    { match: /methotrexate/i, name: 'Methotrexate', monitoring: 'FBC/LFT/U&E q12wk' },
    { match: /lithium/i, name: 'Lithium', monitoring: 'Level + U&E + TFT q3mo' },
    { match: /azathioprine/i, name: 'Azathioprine', monitoring: 'FBC/LFT q12wk' },
    { match: /sulfasalazine/i, name: 'Sulfasalazine', monitoring: 'FBC/LFT q12wk' },
    { match: /leflunomide/i, name: 'Leflunomide', monitoring: 'FBC/LFT q12wk' },
    { match: /warfarin/i, name: 'Warfarin', monitoring: 'INR' },
    { match: /amiodarone/i, name: 'Amiodarone', monitoring: 'TFT/LFT q6mo' },
    { match: /clozapine/i, name: 'Clozapine', monitoring: 'FBC' },
    { match: /spironolactone/i, name: 'Spironolactone', monitoring: 'U&E' },
    { match: /digoxin/i, name: 'Digoxin', monitoring: 'Level + U&E' }
  ];

  const ANTICOAGS = [/warfarin/i, /apixaban/i, /rivaroxaban/i, /edoxaban/i, /dabigatran/i];
  const ANTIPLATELETS = [/aspirin/i, /clopidogrel/i, /ticagrelor/i, /prasugrel/i, /dipyridamole/i];

  const ANTICHOLINERGIC = [
    { match: /amitriptyline|nortriptyline|dosulepin|imipramine/i, score: 3 },
    { match: /oxybutynin|tolterodine|solifenacin|trospium|fesoterodine/i, score: 3 },
    { match: /chlorphenamine|promethazine|hydroxyzine/i, score: 3 },
    { match: /amantadine|orphenadrine/i, score: 2 },
    { match: /loperamide/i, score: 2 },
    { match: /paroxetine/i, score: 3 },
    { match: /cyclizine|prochlorperazine/i, score: 2 },
    { match: /codeine|tramadol/i, score: 1 },
    { match: /furosemide|metformin|prednisolone/i, score: 1 },
    { match: /ranitidine|cimetidine/i, score: 2 }
  ];

  const computeSignals = (d) => {
    const sig = {
      risk: { level: 'green', items: [] },
      monitoring: { level: 'green', items: [] },
      meds: { level: 'green', items: [] },
      openLoops: { level: 'green', items: [] },
      carePlan: { level: 'green', items: [] },
      safeguarding: { level: 'green', items: [] },
      headerChips: []
    };

    const bumpLevel = (cur, lvl) => {
      const ord = { green: 0, amber: 1, red: 2 };
      return ord[lvl] > ord[cur] ? lvl : cur;
    };

    // ---- HEADER CHIPS ----
    // All chips now route through getSystemChip so they're user-configurable
    // (label, severity, enabled, actions). Push only if not null.
    const pushSys = (id, vars) => {
      const c = getSystemChip(id, vars);
      if (c) sig.headerChips.push(c);
    };

    if (d.banner.age) pushSys('record.age', { age: d.banner.age });
    if (d.registers.some(r => /palliative/i.test(r))) pushSys('record.palliative');
    if (d.banner.warnings.some(w => /risk to self/i.test(w))) pushSys('record.riskToSelf');
    // (Dementia / LD / SMI / Safeguarding header chips now come from default rules
    //  matched against the registers/banner fields — they were never tied to actions.)

    // ---- RISK TILE ----
    const recentProblems = d.problems.filter(p => p.date && monthsAgo(p.date) !== null && monthsAgo(p.date) <= 18);
    const frailtyHits = recentProblems.filter(p => FRAILTY_TERMS.some(t => p.name.toLowerCase().includes(t)));
    if (frailtyHits.length >= TH('frailtyHitsRed')) {
      sig.risk.level = bumpLevel(sig.risk.level, 'red');
      sig.risk.items.push({ severity: 'red', text: `Frailty signature: ${frailtyHits.length} recent symptoms`, detail: frailtyHits.map(h => h.name).join(', ') });
      pushSys('record.frailtyRed', { count: frailtyHits.length });
    } else if (frailtyHits.length >= TH('frailtyHitsAmber')) {
      sig.risk.level = bumpLevel(sig.risk.level, 'amber');
      sig.risk.items.push({ severity: 'amber', text: `${frailtyHits.length} frailty symptom${frailtyHits.length > 1 ? 's' : ''} in last 18mo`, detail: frailtyHits.map(h => h.name).join(', ') });
      pushSys('record.frailtyAmber', { count: frailtyHits.length });
    }

    // Recent admission - look for discharge summary in docs
    const recentDischarge = d.docs.find(doc => /discharge/i.test(doc.name) && daysAgo(doc.date) !== null && daysAgo(doc.date) <= TH('recentDischargeAmber'));
    if (recentDischarge) {
      const da = daysAgo(recentDischarge.date);
      const lvl = da <= TH('recentDischargeRed') ? 'red' : 'amber';
      sig.risk.level = bumpLevel(sig.risk.level, lvl);
      sig.risk.items.push({ severity: lvl, text: `Recent admission (${da}d ago)`, detail: `Discharge summary dated ${recentDischarge.date.toLocaleDateString('en-GB', {day:'numeric',month:'short',year:'numeric'})}` });
      pushSys(lvl === 'red' ? 'record.recentAdmissionRed' : 'record.recentAdmissionAmber', { days: da });
    }

    // Stroke / AF / cancer presence (informational)
    const heavyRegisters = d.registers.filter(r => /stroke|cancer|heart failure|dementia/i.test(r));
    if (heavyRegisters.length >= 2 && sig.risk.level === 'green') {
      sig.risk.level = bumpLevel(sig.risk.level, 'amber');
      sig.risk.items.push({ severity: 'amber', text: 'Multimorbidity (registers)', detail: heavyRegisters.join(', ') });
    }

    // ---- MONITORING TILE ----
    const qofOd = d.tasks.qofOverdue.filter(q => q.overdue);
    if (qofOd.length >= TH('qofOverdueRed')) {
      sig.monitoring.level = bumpLevel(sig.monitoring.level, 'red');
      sig.monitoring.items.push({ severity: 'red', text: `${qofOd.length} QOF overdue`, detail: qofOd.map(q => q.code).join('; ') });
    } else if (qofOd.length === 1) {
      sig.monitoring.level = bumpLevel(sig.monitoring.level, 'amber');
      sig.monitoring.items.push({ severity: 'amber', text: '1 QOF overdue', detail: qofOd[0].code });
    }

    // BP age vs LTC presence
    const findObs = (...labels) => {
      const keys = Object.keys(d.obs);
      for (const want of labels) {
        const k = keys.find(k => k.toLowerCase() === want.toLowerCase());
        if (k) return d.obs[k];
      }
      return null;
    };
    const bp = findObs('BP', 'Blood pressure', 'Blood Pressure');
    const hasLtc = d.registers.some(r => /diabetes|hypertension|CKD|heart failure|stroke|atrial fib|IHD/i.test(r));
    if (bp?.date) {
      const m = monthsAgo(bp.date);
      const limit = hasLtc ? TH('bpAgeMonthsLtc') : TH('bpAgeMonthsNoLtc');
      if (m > limit) {
        const lvl = m > limit * 1.5 ? 'red' : 'amber';
        sig.monitoring.level = bumpLevel(sig.monitoring.level, lvl);
        sig.monitoring.items.push({ severity: lvl, text: `BP ${m}mo old${hasLtc ? ' (LTC)' : ''}`, detail: `${bp.value} on ${bp.date.toLocaleDateString('en-GB')}` });
      }
    } else if (hasLtc) {
      sig.monitoring.level = bumpLevel(sig.monitoring.level, 'amber');
      sig.monitoring.items.push({ severity: 'amber', text: 'No BP recorded', detail: 'LTCs present' });
    }

    // Weight age
    const wt = findObs('Weight');
    if (wt?.date && monthsAgo(wt.date) > TH('weightAgeMonths')) {
      sig.monitoring.level = bumpLevel(sig.monitoring.level, 'amber');
      sig.monitoring.items.push({ severity: 'amber', text: `Weight ${monthsAgo(wt.date)}mo old`, detail: `${wt.value} on ${wt.date.toLocaleDateString('en-GB')}` });
    }

    // Last GP face-to-face / non-admin consultation
    const gpCons = d.cons.filter(c => !/admin/i.test(c.type));
    if (gpCons.length) {
      const last = gpCons.reduce((a, b) => a.date > b.date ? a : b);
      const m = monthsAgo(last.date);
      if (m > TH('lastContactMonths')) {
        sig.monitoring.level = bumpLevel(sig.monitoring.level, 'amber');
        sig.monitoring.items.push({ severity: 'amber', text: `Last clinician contact ${m}mo ago`, detail: `${last.type}, ${last.clinician}` });
      }
    }

    // ---- MEDS TILE ----
    const repeatCount = d.meds.repeats.length;
    if (repeatCount >= TH('polypharmacyRed')) {
      sig.meds.level = bumpLevel(sig.meds.level, 'red');
      sig.meds.items.push({ severity: 'red', text: `Polypharmacy (${repeatCount} repeats)`, detail: 'NICE threshold for structured medication review' });
      pushSys('record.polypharmacyRed', { count: repeatCount });
    } else if (repeatCount >= TH('polypharmacyAmber')) {
      sig.meds.level = bumpLevel(sig.meds.level, 'amber');
      sig.meds.items.push({ severity: 'amber', text: `Polypharmacy (${repeatCount} repeats)`, detail: 'Consider SMR' });
      pushSys('record.polypharmacyAmber', { count: repeatCount });
    }

    // High-risk drugs
    const allMeds = [...d.meds.repeats, ...d.meds.acutes];
    const hrFound = HIGH_RISK_DRUGS.filter(hr => allMeds.some(m => hr.match.test(m)));
    if (hrFound.length) {
      sig.meds.level = bumpLevel(sig.meds.level, 'amber');
      hrFound.forEach(hr => sig.meds.items.push({ severity: 'amber', text: `High-risk: ${hr.name}`, detail: `Monitoring: ${hr.monitoring}` }));
    }

    // AF without anticoag (basic)
    const hasAF = d.registers.some(r => /atrial fib/i.test(r));
    const onAnticoag = ANTICOAGS.some(re => allMeds.some(m => re.test(m)));
    const onAntiplatelet = ANTIPLATELETS.some(re => allMeds.some(m => re.test(m)));
    if (hasAF && !onAnticoag) {
      const lvl = onAntiplatelet ? 'amber' : 'red';
      sig.meds.level = bumpLevel(sig.meds.level, lvl);
      sig.meds.items.push({ severity: lvl, text: 'AF without anticoagulation', detail: onAntiplatelet ? 'Antiplatelet only — verify CHA₂DS₂-VASc rationale' : 'No DOAC/warfarin found in repeats' });
    }

    // Anticholinergic burden
    let acbScore = 0;
    const acbHits = [];
    ANTICHOLINERGIC.forEach(a => {
      const hit = allMeds.find(m => a.match.test(m));
      if (hit) { acbScore += a.score; acbHits.push(`${hit.split(' ')[0]} (+${a.score})`); }
    });
    if (acbScore >= TH('anticholinergicAmber')) {
      sig.meds.level = bumpLevel(sig.meds.level, 'amber');
      sig.meds.items.push({ severity: 'amber', text: `Anticholinergic burden ≥${acbScore}`, detail: acbHits.join(', ') });
    }

    // ---- OPEN LOOPS ----
    if (d.tasks.incomplete.length) {
      const lvl = d.tasks.incomplete.length >= 3 ? 'red' : 'amber';
      sig.openLoops.level = bumpLevel(sig.openLoops.level, lvl);
      sig.openLoops.items.push({ severity: lvl, text: `${d.tasks.incomplete.length} incomplete task${d.tasks.incomplete.length > 1 ? 's' : ''}`, detail: d.tasks.incomplete.join('; ') });
    }
    const recentReferral = d.docs.find(doc => /referral/i.test(doc.name) && daysAgo(doc.date) !== null && daysAgo(doc.date) <= 60);
    if (recentReferral) {
      sig.openLoops.level = bumpLevel(sig.openLoops.level, 'amber');
      sig.openLoops.items.push({ severity: 'amber', text: `Referral ${daysAgo(recentReferral.date)}d ago`, detail: 'Outcome to chase?' });
    }
    if (recentDischarge) {
      sig.openLoops.level = bumpLevel(sig.openLoops.level, 'amber');
      sig.openLoops.items.push({ severity: 'amber', text: 'Discharge summary present', detail: 'Confirm post-discharge actions completed' });
    }

    // ---- CARE PLAN ----
    const onPalliative = d.registers.some(r => /palliative/i.test(r));
    const hasACP = d.problems.some(p => /DNACPR|do not attempt|advance care|ReSPECT/i.test(p.name)) ||
                   d.banner.warnings.some(w => /DNACPR|ReSPECT/i.test(w));
    if (onPalliative && !hasACP) {
      sig.carePlan.level = bumpLevel(sig.carePlan.level, 'red');
      sig.carePlan.items.push({ severity: 'red', text: 'Palliative without visible ACP', detail: 'No DNACPR/ReSPECT entry found in record' });
    } else if (frailtyHits.length >= TH('frailtyHitsRed') && !hasACP) {
      sig.carePlan.level = bumpLevel(sig.carePlan.level, 'amber');
      sig.carePlan.items.push({ severity: 'amber', text: 'Severe frailty without visible ACP', detail: 'Consider proactive ACP discussion' });
    } else if (hasACP) {
      sig.carePlan.items.push({ severity: 'green', text: 'ACP documented', detail: '' });
    }

    // ---- SAFEGUARDING ----
    if (d.banner.warnings.some(w => /risk to self/i.test(w))) {
      sig.safeguarding.level = bumpLevel(sig.safeguarding.level, 'amber');
      sig.safeguarding.items.push({ severity: 'amber', text: 'Risk-to-self marker present', detail: 'Verify currency and check care plan' });
    }
    const emisCount = d.banner.warnings.filter(w => /EMIS Imported Warning/i.test(w)).length;
    if (emisCount > 0) {
      sig.safeguarding.level = bumpLevel(sig.safeguarding.level, 'amber');
      sig.safeguarding.items.push({ severity: 'amber', text: `${emisCount} unparsed EMIS warning${emisCount > 1 ? 's' : ''}`, detail: 'Click to inspect — content not exposed by Medicus' });
    }
    if (d.registers.some(r => /child.*safeguarding|adult.*safeguarding/i.test(r))) {
      sig.safeguarding.level = bumpLevel(sig.safeguarding.level, 'red');
      sig.safeguarding.items.push({ severity: 'red', text: 'Safeguarding register', detail: '' });
    }

    return sig;
  };

  // Apply user rules: merge matching rules into header chips & bump tiles.
  // Also returns the matched rules separately so the renderer can attach
  // action-menu handlers to their chips.
  const applyRules = (sig, page, fieldsData) => {
    const matched = matchRules(page, fieldsData);
    sig.ruleChips = [];
    const bumpLevel = (cur, lvl) => ({ green: 0, amber: 1, red: 2, info: 0 })[lvl] > ({ green: 0, amber: 1, red: 2, info: 0 })[cur] ? lvl : cur;
    for (const rule of matched) {
      sig.ruleChips.push({
        kind: rule.kind,
        text: rule.label,
        ruleId: rule.id,
        hasActions: (rule.actions || []).length > 0
      });
      // Tile bump
      if (rule.bumpsTile && sig[rule.bumpsTile] && (rule.kind === 'red' || rule.kind === 'amber')) {
        const tile = sig[rule.bumpsTile];
        tile.level = bumpLevel(tile.level, rule.kind);
        tile.items.push({
          severity: rule.kind,
          text: 'Rule: ' + rule.label,
          detail: 'Matched user rule (configurable in settings)'
        });
      }
    }
    return sig;
  };

  // ---- Request-side signals (detail page) ----
  const computeRequestSignals = (taskDetails, requester, initialReq) => {
    const t = taskDetails || {};
    const r = requester || {};
    const ir = initialReq || { text: '', attachmentCount: 0 };

    const out = { chips: [], snippet: '' };
    const pushOut = (id, vars) => {
      const c = getSystemChip(id, vars);
      if (c) out.chips.push(c);
    };

    // Status chip — pick the right id based on status text
    if (t.Status) {
      let id = 'detail.statusOther';
      if (/awaiting/i.test(t.Status)) id = 'detail.statusAwaiting';
      else if (/reply received/i.test(t.Status)) id = 'detail.statusReplyReceived';
      else if (/closed|completed|resolved/i.test(t.Status)) id = 'detail.statusClosed';
      pushOut(id, { status: t.Status });
    }

    // Priority - only flag if escalated
    if (t.Priority && /high|urgent/i.test(t.Priority)) {
      pushOut('detail.priority', { priority: t.Priority });
    }

    // Days open from Created timestamp
    if (t.Created) {
      const m = t.Created.match(/(\d{1,2})\s+([A-Z][a-z]{2})\s+(\d{4})/);
      if (m) {
        const d = parseDate(m[0]);
        const days = daysAgo(d);
        if (Number.isFinite(days)) {
          if (days === 0) pushOut('detail.today');
          else if (days >= TH('taskAgeRed')) pushOut('detail.daysOpenRed', { days });
          else if (days >= TH('taskAgeAmber')) pushOut('detail.daysOpenAmber', { days });
          else pushOut('detail.daysOpenInfo', { days });
        }
      }
    }

    // Proxy relationship
    const rel = r['Relationship to patient'];
    if (rel && !/self/i.test(rel)) pushOut('detail.proxy', { relationship: rel });

    // Attachments
    if (ir.attachmentCount > 0) pushOut('detail.attachments', { count: ir.attachmentCount });

    // Snippet of request body for context (truncated, configurable via prefs)
    if (ir.text && PREF('showRequestSnippet', true)) {
      const body = ir.text.replace(/\s+/g, ' ').trim();
      const max = PREF('snippetMaxChars', 240);
      out.snippet = body.length > max ? body.slice(0, max) + '…' : body;
    }

    return out;
  };

  // ============================================================
  // 3b. MONITORING-DUE OVERLAY CHIP
  // ============================================================
  // Surfaces high-risk-drug monitoring that is overdue / due-soon on
  // single-patient views (record / detail), reusing the SAME Sentinel engine
  // Sentinel itself uses (window.SentinelDataFetcher + window.SentinelRules +
  // canonical rules/drug-rules.json). The overlay computes nothing clinical
  // itself — it only filters + formats what the rules engine returns. If any
  // global is missing or the fetch fails, we emit NO chip (never a false
  // "all clear", never a false "overdue").

  // Pure filter/format step — kept as a standalone function so it can be
  // unit-tested in isolation (see test-monitoring-chip.js). Given the chip
  // array from SentinelRules.evaluatePatient, returns { count, level, items }
  // for the action-needed drug-monitoring entries, or null when none.
  function selectMonitoringDue(chips) {
    if (!Array.isArray(chips)) return null;
    const ACTION = ['overdue', 'stale', 'due_soon'];
    const due = chips.filter(c => c && c.type === 'drug-monitoring' && ACTION.includes(c.status));
    if (due.length === 0) return null;
    const items = due.map(c => ({
      // Engine emits `drugName`; tolerate `displayName` for forward-compat.
      name: c.displayName || c.drugName || c.label || 'Medication',
      status: c.status,
      // Human detail: engine puts the readable summary on evidence.summary;
      // tolerate a flat `detail` field too.
      detail: c.detail || (c.evidence && c.evidence.summary) || c.status
    }));
    const level = due.some(c => c.status === 'overdue' || c.status === 'stale') ? 'red' : 'amber';
    return { count: due.length, level, items };
  }

  // Cache the canonical drug-rules JSON across navigations (do not refetch).
  let _monitoringRulesCache = null;
  // Last computed monitoring result + the token it belongs to, so a HUD
  // re-render can re-paint the chip from cache (it lives outside the base
  // template and would otherwise be wiped) without waiting for a refetch.
  let _lastMonitoring = null; // { token, result|null }
  // Dynamic action lists for system chips whose actions are built at runtime
  // (keyed by the 'system:<id>' ruleId so findRuleById can resolve them).
  const _dynamicSysActions = {};
  const MONITORING_CHIP_IDS = ['record.monitoringDueRed', 'record.monitoringDueAmber', 'detail.monitoringDueRed', 'detail.monitoringDueAmber'];
  // Drop any retained per-patient monitoring note (clinical text must not
  // outlive the patient it belongs to).
  const clearMonitoringDynActions = () => { MONITORING_CHIP_IDS.forEach(k => { delete _dynamicSysActions['system:' + k]; }); };
  const removeMonitoringChipEl = () => { hudEl?.querySelectorAll?.('.ch-monitoring-chip').forEach(el => el.remove()); };

  const loadMonitoringRules = async () => {
    if (_monitoringRulesCache) return _monitoringRulesCache;
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.getURL) return null;
      const url = chrome.runtime.getURL('rules/drug-rules.json');
      const doc = await fetch(url).then(r => r.json());
      _monitoringRulesCache = (doc && doc.rules) || [];
      return _monitoringRulesCache;
    } catch (e) {
      log('monitoring rules load failed', e);
      return null;
    }
  };

  // Async: fetch patient data via Sentinel, evaluate, and return the
  // selectMonitoringDue() result (or null). Guards every global access.
  const computeMonitoringChip = async () => {
    const pt = pageType();
    if (pt !== 'record' && pt !== 'detail') return null;
    // Honour the enabled flag — if disabled, don't even fetch.
    const redCfg = findSystemChip(pt + '.monitoringDueRed');
    const amberCfg = findSystemChip(pt + '.monitoringDueAmber');
    const enabled = (redCfg && redCfg.enabled !== false) || (amberCfg && amberCfg.enabled !== false);
    if (!enabled) return null;
    // Guard globals — if Sentinel isn't present in this world, no chip.
    if (typeof window === 'undefined') return null;
    const fetcher = window.SentinelDataFetcher;
    const engine = window.SentinelRules;
    if (!fetcher || typeof fetcher.fetchPatientData !== 'function') return null;
    if (!engine || typeof engine.evaluatePatient !== 'function') return null;
    const rules = await loadMonitoringRules();
    if (!rules || rules.length === 0) return null;
    let data;
    try {
      data = await fetcher.fetchPatientData('live');
    } catch (e) {
      log('monitoring fetchPatientData failed', e);
      return null;
    }
    if (!data || data.error) return null;
    // No usable data → no chip (never a false all-clear).
    if (!Array.isArray(data.medications) || data.medications.length === 0) return null;
    let chips;
    try {
      chips = engine.evaluatePatient(
        data.medications || [],
        data.observations || [],
        rules,
        {
          now: new Date().toISOString(),
          problems: data.problems || [],
          patientContext: data.patientContext || null,
          observationHistory: data.observationHistory || []
        }
      );
    } catch (e) {
      log('monitoring evaluatePatient failed', e);
      return null;
    }
    return selectMonitoringDue(chips);
  };

  // Identity token captured before the await — pageType + best-effort patient
  // id/URL — so a result that resolves after the user navigated away (or to a
  // different patient) is discarded rather than injected against the wrong page.
  // Patient-granular: fetchPatientData resolves the patient from location.href,
  // so the full URL is the identity. (Do NOT use the sticky lastPatientUrl — it
  // only updates on /care-record/ pages, so two different task-detail patients
  // would otherwise alias to the same token and a slow fetch could paint the
  // wrong patient's chip.)
  const monitoringToken = () => pageType() + '|' + location.href;

  // Kick off the async monitoring computation after the synchronous HUD render.
  // Captures the page/patient token before awaiting; on resolve, discards if the
  // token changed (staleness guard), otherwise injects the chip into the already
  // rendered HUD without a full re-render (deduped by ruleId).
  const runMonitoringChip = () => {
    const token = monitoringToken();
    // Navigated to a different patient/page: drop the previous patient's cached
    // result and any retained note before doing anything else.
    if (_lastMonitoring && _lastMonitoring.token !== token) {
      _lastMonitoring = null;
      clearMonitoringDynActions();
    }
    // Re-paint instantly from cache for the same patient — the HUD was just
    // rebuilt (innerHTML) and wiped the injected chip, so without this the chip
    // flickers out until the (re)fetch resolves.
    if (_lastMonitoring && _lastMonitoring.token === token && _lastMonitoring.result) {
      injectMonitoringChip(_lastMonitoring.result);
    }
    computeMonitoringChip().then(result => {
      // Staleness guard: page/patient changed while we were fetching.
      if (monitoringToken() !== token) { log('monitoring chip discarded (stale)'); return; }
      _lastMonitoring = { token, result };
      if (result) {
        injectMonitoringChip(result);
      } else {
        // No monitoring due for this patient now — clear any cached chip/note.
        clearMonitoringDynActions();
        removeMonitoringChipEl();
      }
    }).catch(e => log('monitoring chip error', e));
  };

  // Inject (or replace) the monitoring chip into the live HUD chips row.
  const injectMonitoringChip = (result) => {
    const pt = pageType();
    if (pt !== 'record' && pt !== 'detail') return;
    const id = pt + (result.level === 'red' ? '.monitoringDueRed' : '.monitoringDueAmber');
    const chip = getSystemChip(id, { count: result.count });
    if (!chip) return;
    // Build the dynamic note action listing each item, one per line.
    const noteLines = result.items.map(it => `${it.name} — ${it.detail}`);
    noteLines.push('');
    noteLines.push('Decision support — verify against the record.');
    _dynamicSysActions[chip.ruleId] = [
      { type: 'note', label: 'Monitoring detail', text: noteLines.join('\n') }
    ];
    chip.hasActions = true;
    const hud = hudEl;
    if (!hud || !hud.isConnected) return;
    const row = hud.querySelector('.ch-chips');
    if (!row) return;
    // Dedupe: remove any previously injected monitoring chip (either severity)
    // before adding the current one.
    row.querySelectorAll('.ch-monitoring-chip').forEach(el => el.remove());
    // If the "No flags" placeholder is the only thing present, clear it.
    const placeholder = row.querySelector('.ch-chip-info');
    if (placeholder && row.children.length === 1 && /No flags/i.test(placeholder.textContent)) {
      placeholder.remove();
    }
    const tmp = document.createElement('div');
    tmp.innerHTML = renderChipHtml(chip);
    const el = tmp.firstElementChild;
    if (!el) return;
    el.classList.add('ch-monitoring-chip');
    el.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      showActionMenu(el, el.dataset.ruleId);
    });
    row.appendChild(el);
  };

  // ============================================================
  // 4. RENDERING + PIP
  // ============================================================

  const HUD_ID = 'medicus-clinical-hud';

  // Persistent state
  let hudEl = null;          // the HUD <aside>; survives doc moves
  let pipWindow = null;      // active Document PiP window if popped out
  let lastSignals = null;    // for tile click handlers when re-binding
  let lastPatientUrl = '';   // sticky link target — set whenever we successfully extract a patient
  let lastPatientName = '';

  const inPip = () => !!pipWindow && !pipWindow.closed;
  const hudDoc = () => inPip() ? pipWindow.document : document;
  const hudHost = () => inPip() ? pipWindow.document.body : document.body;
  const pipSupported = () => typeof window.documentPictureInPicture !== 'undefined';

  // Extract patient display name from document.title.
  // Medicus uses "Patient Care Record, Mrs Elizabeth Waring | Medicus".
  // Updates the sticky cache only when we actually find one.
  const extractPatientName = () => {
    const t = document.title || '';
    let m = t.match(/Patient Care Record,\s+([^|]+?)\s*\|/i);
    let name = '';
    if (m) name = m[1].trim();
    else {
      m = t.match(/^([^|]+?)\s*\|\s*Medicus/i);
      if (m && m[1].trim().length < 80 && !/dashboard|workflow|home/i.test(m[1])) name = m[1].trim();
    }
    if (name) {
      lastPatientName = name;
      // Cache URL only when we know we're on a patient page
      if (/\/care-record\//i.test(location.href)) lastPatientUrl = location.href;
    }
    // Return the display name — fall back to last known so pill stays sticky
    return name || lastPatientName;
  };

  const tile = (key, label, signal) => `
    <div class="ch-tile ch-${signal.level}" data-tile="${key}">
      <div class="ch-tile-label">${label}</div>
      <div class="ch-tile-status">${signal.level === 'green' && signal.items.length === 0 ? '—' : signal.level.toUpperCase()}</div>
      <div class="ch-tile-count">${signal.items.length ? signal.items.length + ' signal' + (signal.items.length > 1 ? 's' : '') : ''}</div>
    </div>`;

  const detailList = (items) => {
    if (!items.length) return '<div class="ch-detail-empty">No flags</div>';
    return items.map(it => `
      <div class="ch-detail-row ch-${it.severity}">
        <div class="ch-detail-text">${escapeHtml(it.text)}</div>
        ${it.detail ? `<div class="ch-detail-sub">${escapeHtml(it.detail)}</div>` : ''}
      </div>`).join('');
  };

  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  const ensureHudEl = () => {
    const doc = hudDoc();
    const host = hudHost();
    if (!hudEl || !hudEl.isConnected || hudEl.ownerDocument !== doc) {
      // Either first run, detached, or in the wrong doc — (re-)create / re-attach
      if (hudEl && hudEl.parentElement) hudEl.parentElement.removeChild(hudEl);
      if (!hudEl || hudEl.ownerDocument !== doc) {
        hudEl = doc.createElement('aside');
        hudEl.id = HUD_ID;
      }
      host.appendChild(hudEl);
    }
    return hudEl;
  };

  // ---- Chip rendering with optional action menu trigger ----
  // chip: { kind, text, ruleId?, hasActions? }
  const renderChipHtml = (chip) => {
    const ruleAttr = chip.ruleId ? ` data-rule-id="${escapeHtml(chip.ruleId)}"` : '';
    const cursorClass = chip.hasActions ? ' ch-chip-actionable' : '';
    const chevron = chip.hasActions ? ' <span class="ch-chev">▾</span>' : '';
    return `<span class="ch-chip ch-chip-${escapeHtml(chip.kind)}${cursorClass}"${ruleAttr}>${escapeHtml(chip.text)}${chevron}</span>`;
  };

  // ---- Action menu popover ----
  // Anchored to document.body so it works in HUD, queue rows, and the request
  // panel. One menu open at a time. Click outside to dismiss.
  let activeActionMenu = null;
  const closeActionMenu = () => {
    if (activeActionMenu) {
      activeActionMenu.remove();
      activeActionMenu = null;
    }
    document.removeEventListener('click', onDocClickForMenu, true);
  };
  const onDocClickForMenu = (e) => {
    if (!activeActionMenu) return;
    if (activeActionMenu.contains(e.target)) return;
    closeActionMenu();
  };

  const findRuleById = (id) => {
    if (!id) return null;
    if (id.startsWith('system:')) {
      const sysId = id.slice(7);
      const sys = findSystemChip(sysId);
      if (!sys) return null;
      // Runtime-built actions (e.g. the monitoring-due note) take precedence
      // over the static config actions for this chip.
      const dynamic = _dynamicSysActions[id];
      return {
        id, label: sys.label, kind: sys.kind,
        actions: dynamic || sys.actions || []
      };
    }
    if (!CONFIG || !CONFIG.rules) return null;
    return CONFIG.rules.find(r => r.id === id) || null;
  };

  const showActionMenu = (anchor, ruleId) => {
    closeActionMenu();
    const rule = findRuleById(ruleId);
    if (!rule) return;
    const actions = rule.actions || [];
    const r = anchor.getBoundingClientRect();

    const menu = document.createElement('div');
    menu.className = 'ch-action-menu';
    menu.style.position = 'fixed';
    menu.style.top = (r.bottom + 4) + 'px';
    menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 320)) + 'px';
    menu.style.zIndex = '2147483647';

    const header = document.createElement('div');
    header.className = 'ch-action-menu-head';
    header.innerHTML = `<span class="ch-chip ch-chip-${escapeHtml(rule.kind)}">${escapeHtml(rule.label)}</span>`;
    menu.appendChild(header);

    if (!actions.length) {
      const empty = document.createElement('div');
      empty.className = 'ch-action-menu-empty';
      empty.textContent = 'No actions configured for this rule.';
      menu.appendChild(empty);
    }

    actions.forEach((a) => {
      const item = document.createElement('div');
      item.className = 'ch-action-menu-item ch-action-menu-item-' + escapeHtml(a.type || 'note');
      const iconMap = { link: '🔗', snippet: '📋', note: '📌' };
      item.innerHTML = `<span class="ch-action-icon">${iconMap[a.type] || '•'}</span><span class="ch-action-label">${escapeHtml(a.label || '(unlabelled)')}</span>`;
      item.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        executeAction(a, item, menu);
      });
      menu.appendChild(item);
    });

    document.body.appendChild(menu);
    activeActionMenu = menu;
    setTimeout(() => document.addEventListener('click', onDocClickForMenu, true), 0);
  };

  const executeAction = (action, anchorEl, menuEl) => {
    if (!action) return;
    if (action.type === 'link' && action.url) {
      try { window.open(action.url, '_blank', 'noopener'); } catch (e) {}
      closeActionMenu();
      return;
    }
    if (action.type === 'snippet' && action.text) {
      const text = action.text;
      const writeClipboard = async () => {
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
          } else {
            const ta = document.createElement('textarea');
            ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
            document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
          }
          if (anchorEl) {
            const orig = anchorEl.innerHTML;
            anchorEl.innerHTML = '<span class="ch-action-icon">✓</span><span class="ch-action-label">Copied</span>';
            setTimeout(() => { try { anchorEl.innerHTML = orig; } catch(e){} closeActionMenu(); }, 700);
          } else {
            closeActionMenu();
          }
        } catch (e) {
          if (anchorEl) {
            anchorEl.innerHTML = '<span class="ch-action-icon">✗</span><span class="ch-action-label">Copy failed</span>';
          }
        }
      };
      writeClipboard();
      return;
    }
    if (action.type === 'note' && action.text) {
      // Replace menu body with the note text, with a back button
      menuEl.innerHTML = '';
      const head = document.createElement('div');
      head.className = 'ch-action-menu-head';
      head.innerHTML = `<button class="ch-action-back" type="button">← Back</button><span class="ch-action-note-title">${escapeHtml(action.label || 'Note')}</span>`;
      menuEl.appendChild(head);
      const body = document.createElement('div');
      body.className = 'ch-action-menu-note';
      body.textContent = action.text;
      menuEl.appendChild(body);
      head.querySelector('.ch-action-back').addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        closeActionMenu();
      });
    }
  };

  const renderHUD = (data, signals, requestSignals) => {
    lastSignals = signals;
    const hud = ensureHudEl();
    const minimised = hud.classList.contains('ch-min');
    let collapsed = false;
    try { collapsed = (typeof localStorage !== 'undefined' && localStorage.getItem('ch-collapsed') === '1'); } catch (e) {}
    const patient = extractPatientName();

    const requestPanel = (rs) => {
      if (!rs || (!rs.chips?.length && !rs.snippet)) return '';
      return `
        <div class="ch-request">
          <div class="ch-request-head">REQUEST</div>
          ${rs.chips.length ? `<div class="ch-request-row">${rs.chips.map(c => renderChipHtml(c)).join('')}</div>` : ''}
          ${rs.snippet ? `<div class="ch-request-snippet">${escapeHtml(rs.snippet)}</div>` : ''}
        </div>`;
    };

    // Combine header chips + rule chips for the chips row
    const allHeaderChips = [
      ...signals.headerChips,
      ...(signals.ruleChips || [])
    ];

    const showTiles = PREF('showBuiltInTiles', true);
    const showFoot = PREF('showFootStats', true);

    hud.innerHTML = `
      <header class="ch-head">
        <div class="ch-title">Triage Lens <span class="ch-ver">v${VERSION}</span></div>
        <div class="ch-actions">
          ${pipSupported() ? `<button class="ch-btn" data-act="${inPip() ? 'unpip' : 'pip'}" title="${inPip() ? 'Return to tab' : 'Pop out (always-on-top)'}">${inPip() ? '↙' : '↗'}</button>` : ''}
          <button class="ch-btn" data-act="refresh" title="Re-scan">↻</button>
          <button class="ch-btn" data-act="settings" title="Open settings">⚙</button>
          <button class="ch-btn" data-act="min" title="Minimise">${minimised ? '▢' : '_'}</button>
        </div>
      </header>
      <div class="ch-body">
        ${patient ? `<button class="ch-patient" data-act="focus-tab" title="Bring source tab to front">${escapeHtml(patient)} →</button>` : ''}
        ${requestPanel(requestSignals)}
        <div class="ch-chips">
          ${allHeaderChips.length ? allHeaderChips.map(c => renderChipHtml(c)).join('') : '<span class="ch-chip ch-chip-info">No flags</span>'}
        </div>
        ${showTiles ? `<div class="ch-grid">
          ${tile('risk', 'Risk', signals.risk)}
          ${tile('monitoring', 'Monitoring', signals.monitoring)}
          ${tile('meds', 'Meds', signals.meds)}
          ${tile('openLoops', 'Open loops', signals.openLoops)}
          ${tile('carePlan', 'Care plan', signals.carePlan)}
          ${tile('safeguarding', 'Safeguarding', signals.safeguarding)}
        </div>
        <div class="ch-detail" id="ch-detail">
          <div class="ch-detail-head">Click a tile for detail</div>
        </div>` : ''}
        ${showFoot ? `<div class="ch-foot">
          ${data.registers.length} registers · ${data.problems.length} problems · ${data.meds.repeats.length} repeats · ${data.docs.length} recent docs
        </div>` : ''}
      </div>`;

    // Tile detail
    hud.querySelectorAll('.ch-tile').forEach(t => {
      t.addEventListener('click', () => {
        hud.querySelectorAll('.ch-tile').forEach(x => x.classList.remove('ch-tile-sel'));
        t.classList.add('ch-tile-sel');
        const key = t.dataset.tile;
        const sig = lastSignals[key];
        const labels = { risk: 'Risk', monitoring: 'Monitoring', meds: 'Meds', openLoops: 'Open loops', carePlan: 'Care plan', safeguarding: 'Safeguarding' };
        hud.querySelector('#ch-detail').innerHTML = `
          <div class="ch-detail-head">${labels[key]}</div>
          ${detailList(sig.items)}`;
      });
    });

    // Header buttons
    const refreshBtn = hud.querySelector('[data-act="refresh"]');
    if (refreshBtn) refreshBtn.addEventListener('click', () => run(true));
    const minBtn = hud.querySelector('[data-act="min"]');
    if (minBtn) minBtn.addEventListener('click', () => {
      hud.classList.toggle('ch-min');
      try { localStorage.setItem('ch-collapsed', hud.classList.contains('ch-min') ? '1' : '0'); } catch (e) {}
    });
    const pipBtn = hud.querySelector('[data-act="pip"]');
    if (pipBtn) pipBtn.addEventListener('click', enterPip);
    const unpipBtn = hud.querySelector('[data-act="unpip"]');
    if (unpipBtn) unpipBtn.addEventListener('click', exitPip);
    const focusBtn = hud.querySelector('[data-act="focus-tab"]');
    if (focusBtn) focusBtn.addEventListener('click', focusSourceTab);
    const settingsBtn = hud.querySelector('[data-act="settings"]');
    if (settingsBtn) settingsBtn.addEventListener('click', () => {
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.openOptionsPage) {
          chrome.runtime.openOptionsPage();
        } else if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
          window.open(chrome.runtime.getURL('options.html'), '_blank');
        }
      } catch (e) { console.warn('[TL] settings open failed', e); }
    });

    // Rule chip click handlers — open action menu
    hud.querySelectorAll('[data-rule-id]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        showActionMenu(el, el.dataset.ruleId);
      });
    });

    if (collapsed) hud.classList.add('ch-min');
  };

  const injectStylesInto = (doc, id = 'ch-style') => {
    if (!EMBEDDED_CSS || EMBEDDED_CSS.indexOf('CSS_PLACEHOLDER') !== -1) return; // build error guard
    if (doc.getElementById(id)) return;
    const style = doc.createElement('style');
    style.id = id;
    style.textContent = EMBEDDED_CSS;
    (doc.head || doc.documentElement).appendChild(style);
  };

  const PIP_BODY_CSS = 'margin:0;background:#f0f3f7;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';
  const PIP_HUD_CSS = 'position:static !important;top:auto !important;right:auto !important;left:auto !important;width:100% !important;max-height:none !important;border-radius:0 !important;border:none !important;box-shadow:none !important;';

  const enterPip = async () => {
    if (inPip() || !pipSupported()) return;
    try {
      pipWindow = await window.documentPictureInPicture.requestWindow({ width: 360, height: 600 });
      pipWindow.document.title = 'Triage Lens — ' + (extractPatientName() || 'Patient');
      pipWindow.document.body.setAttribute('style', PIP_BODY_CSS);
      injectStylesInto(pipWindow.document);

      // Stash docked positioning, switch to fill-window for PiP
      ensureHudEl();
      hudEl.dataset.dockedStyle = hudEl.getAttribute('style') || '';
      hudEl.setAttribute('style', PIP_HUD_CSS);

      pipWindow.addEventListener('pagehide', () => {
        // Return HUD to source tab and restore docked positioning
        pipWindow = null;
        if (hudEl) {
          hudEl.setAttribute('style', hudEl.dataset.dockedStyle || '');
          delete hudEl.dataset.dockedStyle;
          if (!hudEl.isConnected) document.body.appendChild(hudEl);
          restorePosition(hudEl);
        }
        run(true);
      });

      run(true);
    } catch (e) {
      console.error('[ClinHUD] PiP failed', e);
      pipWindow = null;
    }
  };

  const exitPip = () => { if (inPip()) pipWindow.close(); };

  // Bring the originating browser tab to the front and, if it has navigated
  // away from the patient that the HUD was bound to, return it there.
  // From a PiP child the click handler still runs in source-tab JS context, so
  // `window`, `location` and `document` here all refer to the source tab.
  const focusSourceTab = () => {
    try {
      if (lastPatientUrl && location.href !== lastPatientUrl) {
        location.href = lastPatientUrl;
      }
      window.focus();
    } catch (e) {}
  };

  // ============================================================
  // 5. RUN, OBSERVE, DRAG, QUEUE DECORATION
  // ============================================================

  let lastRun = 0;

  const hideHud = () => {
    if (hudEl && hudEl.parentElement) hudEl.parentElement.removeChild(hudEl);
  };

  // Build a bag of field values for rule matching from extracted patient data
  const buildFieldsData = (data, requestText) => {
    const safe = (arr, prop) => (arr || []).map(x => (prop ? (x && x[prop]) || '' : x || '')).filter(Boolean);
    return {
      request: requestText || '',
      problems: safe(data?.problems, 'name'),
      registers: data?.registers || [],
      meds: [...safe(data?.meds?.repeats), ...safe(data?.meds?.acutes), ...safe(data?.meds?.otc)],
      allergies: data?.banner?.warnings || [],
      banner: data?.banner?.warnings || [],
      consultations: safe(data?.cons || [], 'type').concat(safe(data?.cons || [], 'clinician')),
      docs: safe(data?.docs || [], 'name')
    };
  };

  // ---- Per-page handlers ----
  const runRecord = () => {
    const data = extractAll();
    const signals = computeSignals(data);
    applyRules(signals, 'record', buildFieldsData(data, ''));
    renderHUD(data, signals, null);
    restorePosition(hudEl);
    enableDrag(hudEl);
    runMonitoringChip();
    log('record rendered', { data, signals });
  };

  const runDetail = () => {
    const data = extractAll();
    const signals = computeSignals(data);

    const docInfo = isDocumentTask() ? extractDocumentTaskInfo() : null;

    let taskDetails, requester, initialReq;
    if (docInfo) {
      taskDetails = docInfo.taskDetails;
      requester = {};
      const parts = [docInfo.docType, docInfo.specialty || docInfo.author, docInfo.comments, docInfo.codes]
        .filter(Boolean);
      initialReq = { text: parts.join(' — '), attachmentCount: 0 };
    } else {
      taskDetails = extractTaskDetails();
      requester = extractRequester();
      initialReq = extractInitialRequest();
    }

    applyRules(signals, 'detail', buildFieldsData(data, initialReq.text || ''));
    const requestSignals = computeRequestSignals(taskDetails, requester, initialReq);

    if (docInfo) {
      const newChips = [];
      if (docInfo.docType) {
        const c = getSystemChip('detail.docType', { docType: docInfo.docType });
        if (c) newChips.push(c);
      }
      if (docInfo.specialty) {
        const c = getSystemChip('detail.docSpecialty', { specialty: docInfo.specialty });
        if (c) newChips.push(c);
      }
      if (newChips.length) requestSignals.chips.unshift(...newChips);
    }

    renderHUD(data, signals, requestSignals);
    restorePosition(hudEl);
    enableDrag(hudEl);
    runMonitoringChip();
    // Document-context chips (Phase 1): paint from any already-arrived doc
    // context (the interceptor events may have fired before runDetail ran).
    // Late-arriving events are handled by the ch-doc-* listeners.
    if (docInfo) { runDocContextChips(); requestDocPdfText(); }
    log('detail rendered', { data, signals, taskDetails, initialReq, docInfo });
  };

  const runQueue = () => {
    teardownQueueObserver();
    hideHud();
    // Clear row-to-UUID mapping so stale UUIDs from a previous queue never
    // inject chips onto wrong rows in the new queue before the fresh
    // ch-task-list-data event arrives. Prune cache entries older than 2×TTL.
    _queueRowUuids.clear();
    const pruneTs = Date.now() - 2 * _MON_CACHE_TTL;
    for (const [uuid, entry] of _queueMonCache) {
      if (entry.ts && entry.ts < pruneTs) _queueMonCache.delete(uuid);
    }
    decorateQueueRows();
    setupQueueObserver();
    injectTaskListInterceptor();
    scheduleQueueMonitoring();
  };

  const run = (force = false) => {
    try {
      const now = Date.now();
      if (!force && now - lastRun < 400) return;
      lastRun = now;
      const type = pageType();
      // If we've navigated away from the queue, release the observer so the
      // next queue visit always rebuilds it against a fresh container.
      if (type !== 'queue') teardownQueueObserver();
      if (type === 'record') runRecord();
      else if (type === 'detail') runDetail();
      else if (type === 'queue') runQueue();
      else hideHud();
    } catch (e) {
      console.error('[ClinHUD] error', e);
    }
  };

  // ---- Queue chip decoration ----
  // Renders age + days-open + category + read-time chips inline at the top of
  // the request preview row beneath each queue row. AG Grid virtualises rows,
  // so we re-decorate any time the row container mutates.

  // ---- Queue monitoring chips (fetch-intercepted UUIDs) ----

  // Page-world injected script — intercepts fetch to capture task-list row UUIDs
  // and posts them back as a CustomEvent. Installed once per page load.
  const injectTaskListInterceptor = () => {
    // Guard lives entirely in page-world via window.__chIntercepted (the script
    // element is removed immediately after injection so a DOM attribute check
    // would never match on re-entry). beforeunload clears the flag so that SPA
    // navigations that reset window.fetch get a fresh interceptor installation.
    const s = document.createElement('script');
    s.textContent = `(function(){
      if(window.__chIntercepted)return;window.__chIntercepted=true;
      window.addEventListener('beforeunload',function(){delete window.__chIntercepted;},{once:true});
      const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const orig=window.fetch;
      window.fetch=async function(url,...a){
        const r=await orig.apply(this,[url,...a]);
        try{
          const u=typeof url==='string'?url:(url&&url.url)||'';
          const m=u.match(/\\/tasks\\/data\\/([^/?]+)\\/task-list/);
          if(m){const clone=r.clone();clone.json().then(body=>{
            const items=body&&(body.data||body.results||(Array.isArray(body)?body:null));
            if(!Array.isArray(items))return;
            const rows=items.map((item,i)=>({
              rowIndex:i,
              // Prefer explicit uuid/taskId fields over generic id to avoid
              // numeric surrogate-key false-positives
              taskUuid:typeof item.uuid==='string'&&UUID_RE.test(item.uuid)?item.uuid
                      :typeof item.taskId==='string'&&UUID_RE.test(item.taskId)?item.taskId
                      :typeof item.id==='string'&&UUID_RE.test(item.id)?item.id
                      :null
            })).filter(r=>r.taskUuid);
            if(rows.length)window.dispatchEvent(new CustomEvent('ch-task-list-data',{detail:{rows,taskTypeSlug:m[1]}}));
          }).catch(e=>console.warn('[ClinHUD] task-list parse error',e));}
        }catch(_){}
        return r;
      };
    })();`;
    (document.head || document.documentElement).appendChild(s);
    s.remove();
  };

  // ---- Document-context interceptor (Phase 1) ----
  // Page-world injected script — passively wraps BOTH window.fetch AND
  // XMLHttpRequest (the document task JSON comes through Axios/XHR, so a
  // fetch-only wrapper would miss it). It re-dispatches the cheap JSON text the
  // page already loaded — the GP's filed care-record entries and the electronic
  // covering message (inboundMessage) — back to the isolated world as
  // CustomEvents. It reads NOTHING that the page itself didn't already request,
  // makes no network calls of its own, and sends nothing anywhere. The document
  // body PDF (download-file) is deliberately NOT touched here — that's a later
  // phase. Installed once per page load; guarded by window.__chDocIntercepted.
  const injectDocContextInterceptor = () => {
    const s = document.createElement('script');
    s.textContent = `(function(){
      if(window.__chDocIntercepted)return;window.__chDocIntercepted=true;
      window.addEventListener('beforeunload',function(){delete window.__chDocIntercepted;},{once:true});
      var TAIL=/\\/([0-9a-f-]+)(?:\\?|$)/i;
      function tailId(u){var m=String(u||'').match(TAIL);return m?m[1]:null;}
      function handle(url,text){
        try{
          var u=String(url||'');
          if(/\\/clinical\\/document\\/entries\\//.test(u)){
            var body=JSON.parse(text);
            window.dispatchEvent(new CustomEvent('ch-doc-entries',{detail:{
              documentId:tailId(u),
              entries:(body&&body.entries)||[]
            }}));
          }else if(/\\/document\\/modals\\/version\\/preview\\//.test(u)){
            var body2=JSON.parse(text);
            window.dispatchEvent(new CustomEvent('ch-doc-preview',{detail:{
              documentId:(body2&&body2.documentId)||null,
              inboundMessage:(body2&&body2.inboundMessage)||'',
              typeLabel:(body2&&body2.document&&body2.document.typeLabel)||''
            }}));
          }
        }catch(e){console.warn('[ClinHUD] doc-context parse error',e);}
      }
      var origFetch=window.fetch;
      window.fetch=async function(url,...a){
        var r=await origFetch.apply(this,[url,...a]);
        try{
          var u=typeof url==='string'?url:(url&&url.url)||'';
          if(/\\/clinical\\/document\\/entries\\//.test(u)||/\\/document\\/modals\\/version\\/preview\\//.test(u)){
            r.clone().text().then(function(t){handle(u,t);}).catch(function(e){console.warn('[ClinHUD] doc-context parse error',e);});
          }
        }catch(_){}
        return r;
      };
      var origOpen=XMLHttpRequest.prototype.open;
      var origSend=XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open=function(method,url){
        try{this.__chDocUrl=url;}catch(_){}
        return origOpen.apply(this,arguments);
      };
      XMLHttpRequest.prototype.send=function(){
        try{
          var xhr=this;var u=xhr.__chDocUrl||'';
          if(/\\/clinical\\/document\\/entries\\//.test(u)||/\\/document\\/modals\\/version\\/preview\\//.test(u)){
            xhr.addEventListener('load',function(){
              try{handle(u,xhr.responseText);}catch(e){console.warn('[ClinHUD] doc-context parse error',e);}
            });
          }
        }catch(_){}
        return origSend.apply(this,arguments);
      };
    })();`;
    (document.head || document.documentElement).appendChild(s);
    s.remove();
  };

  // ---- Document-context state + chips (Phase 1) ----
  // Ephemeral, in-memory only. The combined text (filed entries + electronic
  // covering message) is held solely in this module-level variable for keyword
  // matching: it is NEVER written to chrome.storage and NEVER added to any
  // shared/io backup. It is overwritten on the next document and cleared by the
  // staleness token guard so it cannot outlive the patient it belongs to.
  let _docCtx = { documentId: null, entries: [], inboundMessage: '', typeLabel: '', pdfText: '', at: 0 };
  // Last document id we requested a body-PDF extraction for (de-dupe guard).
  let _docPdfRequestedFor = null;
  // Clear prose extracted from document A so it can never match on document B.
  const _docCtxMaybeClearPdf = (incomingDocId) => {
    if (incomingDocId && _docCtx.documentId && incomingDocId !== _docCtx.documentId) {
      _docCtx.pdfText = '';
      _docPdfRequestedFor = null;
    }
  };

  window.addEventListener('ch-doc-entries', (e) => {
    const d = e.detail || {};
    _docCtxMaybeClearPdf(d.documentId);
    if (Array.isArray(d.entries)) _docCtx.entries = d.entries;
    if (d.documentId) _docCtx.documentId = d.documentId;
    _docCtx.at = Date.now();
    if (isDocumentTask()) runDocContextChips();
  });

  window.addEventListener('ch-doc-preview', (e) => {
    const d = e.detail || {};
    _docCtxMaybeClearPdf(d.documentId);
    if (typeof d.inboundMessage === 'string') _docCtx.inboundMessage = d.inboundMessage;
    if (typeof d.typeLabel === 'string' && d.typeLabel) _docCtx.typeLabel = d.typeLabel;
    if (d.documentId) _docCtx.documentId = d.documentId;
    _docCtx.at = Date.now();
    if (isDocumentTask()) runDocContextChips();
  });

  // Combined lowercased text for keyword matching: covering message + every
  // filed entry's text (and code, where present).
  const extractDocContextText = () => {
    const parts = [];
    if (_docCtx.inboundMessage) parts.push(_docCtx.inboundMessage);
    if (_docCtx.pdfText) parts.push(_docCtx.pdfText);
    for (const en of _docCtx.entries || []) {
      if (en && en.text) parts.push(String(en.text));
      if (en && en.code) parts.push(String(en.code));
    }
    const display = parts.join('\n');
    return { display, lower: display.toLowerCase() };
  };

  // Negation guard: skip a keyword match if it's immediately preceded (within
  // ~15 chars) by a negating phrase ("no", "not", "denies", "ruled out", etc).
  const DOC_NEGATION_RE = /(no |not |denies |ruled out |nil |without )[^.]{0,15}$/i;
  const matchDocTerm = (lower, termRe) => {
    let m;
    termRe.lastIndex = 0;
    while ((m = termRe.exec(lower)) !== null) {
      const before = lower.slice(Math.max(0, m.index - 20), m.index);
      if (!DOC_NEGATION_RE.test(before)) return m[0];
      if (m.index === termRe.lastIndex) termRe.lastIndex++; // avoid zero-width loop
    }
    return null;
  };

  const DOC_URGENT_RE  = /2 week wait|two week wait|2ww|suspected cancer|urgent referral|red flag|safeguarding|deteriorating/gi;
  const DOC_ACTION_RE  = /please arrange|gp to |we recommend|please prescribe|please monitor|follow[- ]up in|kindly/gi;

  // Async chip render — modelled on runMonitoringChip. Surfaces the cheap JSON
  // document context (filed entries + electronic covering message) as HUD chips.
  // Staleness token guard prevents wrong-document/wrong-patient bleed. Urgent /
  // action chips default OFF (opt-in) and use the negation guard; only the
  // purely descriptive "Filed notes" info chip defaults on.
  // requestDocPdfText: ask the service worker to fetch + extract the document
  // body PDF (server-converted, parsed via offscreen PDF.js) and feed the prose
  // into _docCtx.pdfText so it flows through the EXISTING docUrgent/docAction chips.
  //  - Only on a document task page.
  //  - Only if at least one of detail.docUrgent / detail.docAction is enabled
  //    (opt-in; both default OFF). No fetch/parse for users who have not opted in.
  //  - De-duped per document (do not re-request the same open document).
  //  - Staleness-token guarded + bound to the current document; a late reply that
  //    arrives after navigation is dropped (no wrong-document prose).
  //  - PDF bytes + extracted text are ephemeral; never persisted.
  const requestDocPdfText = () => {
    if (!isDocumentTask()) return;
    if (!(typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function')) return;
    const urgentCfg = findSystemChip('detail.docUrgent');
    const actionCfg = findSystemChip('detail.docAction');
    const urgentOn = urgentCfg && urgentCfg.enabled !== false;
    const actionOn = actionCfg && actionCfg.enabled !== false;
    if (!urgentOn && !actionOn) return; // neither opted in — skip entirely
    const ctx = (typeof API !== 'undefined' && API.detectMedicusContext) ? API.detectMedicusContext(location.href) : null;
    if (!ctx || !ctx.apiBase || !ctx.taskUuid) return;
    // De-dupe: do not re-request body text for a document we already asked about.
    if (_docPdfRequestedFor === ctx.taskUuid) return;
    _docPdfRequestedFor = ctx.taskUuid;
    const reqToken = (typeof monitoringToken === 'function') ? monitoringToken() : location.href;
    try {
      chrome.runtime.sendMessage(
        { type: 'sentinelDocPdfText', apiBase: ctx.apiBase, taskUuid: ctx.taskUuid },
        (resp) => {
          if (chrome.runtime.lastError) { log('doc pdf text request failed:', chrome.runtime.lastError.message); return; }
          if (!resp || !resp.ok || !resp.text) return; // no text layer / pending / failed → no chip
          const tokNow = (typeof monitoringToken === 'function') ? monitoringToken() : location.href;
          if (tokNow !== reqToken) return;
          if (!isDocumentTask()) return;
          _docCtx.pdfText = String(resp.text);
          _docCtx.at = Date.now();
          runDocContextChips();
        }
      );
    } catch (e) { log('doc pdf text sendMessage threw:', e && e.message); }
  };

  const runDocContextChips = async () => {
    if (!isDocumentTask()) return;
    const token = (typeof monitoringToken === 'function') ? monitoringToken() : location.href;
    const { lower } = extractDocContextText();
    const entryCount = (_docCtx.entries || []).length;
    if (!lower && entryCount === 0) return; // no text → no chip (never a false all-clear)

    const chips = [];

    if (entryCount > 0) {
      const c = getSystemChip('detail.docEntries', { count: entryCount });
      if (c) chips.push(c);
    }

    if (lower) {
      const urgentTerm = matchDocTerm(lower, DOC_URGENT_RE);
      if (urgentTerm) {
        const c = getSystemChip('detail.docUrgent', { term: urgentTerm });
        if (c) chips.push(c);
      }
      const actionPhrase = matchDocTerm(lower, DOC_ACTION_RE);
      if (actionPhrase) {
        const c = getSystemChip('detail.docAction', { phrase: actionPhrase });
        if (c) chips.push(c);
      }
    }

    if (!chips.length) return;

    // Re-check the token before injecting — abort if the page/patient changed
    // while we were assembling (prevents wrong-document/wrong-patient display).
    const tokenNow = (typeof monitoringToken === 'function') ? monitoringToken() : location.href;
    if (tokenNow !== token) { log('doc-context chips discarded (stale)'); return; }

    const hud = hudEl;
    if (!hud || !hud.isConnected) return;
    const row = hud.querySelector('.ch-reqsig-chips') || hud.querySelector('.ch-chips');
    if (!row) return;

    // Dedupe: remove any previously injected doc-context chips before re-adding.
    row.querySelectorAll('.ch-doc-ctx').forEach(el => el.remove());
    // Clear the "No flags" placeholder if it's the only thing present.
    const placeholder = row.querySelector('.ch-chip-info');
    if (placeholder && row.children.length === 1 && /No flags/i.test(placeholder.textContent)) {
      placeholder.remove();
    }

    for (const chip of chips) {
      const tmp = document.createElement('span');
      tmp.className = 'ch-doc-ctx';
      tmp.innerHTML = renderChipHtml(chip);
      row.appendChild(tmp);
    }
    log('doc-context chips', { entryCount, hasMessage: !!_docCtx.inboundMessage, chips: chips.map(c => c.text) });
  };

  // rowIndex → taskUuid for the current queue load
  const _queueRowUuids = new Map();
  // taskUuid → { taskTypeSlug, result, ts } — session-level cache with TTL
  const _queueMonCache = new Map();
  const _MON_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  let _queueMonRunning = false;
  let _queueMonGeneration = 0; // incremented on each new data arrival

  window.addEventListener('ch-task-list-data', (e) => {
    const { rows, taskTypeSlug } = e.detail || {};
    if (!Array.isArray(rows) || !taskTypeSlug) return;
    if (pageType() !== 'queue') return;
    _queueRowUuids.clear();
    for (const { rowIndex, taskUuid } of rows) {
      _queueRowUuids.set(rowIndex, taskUuid);
      if (!_queueMonCache.has(taskUuid)) _queueMonCache.set(taskUuid, { taskTypeSlug });
    }
    scheduleQueueMonitoring();
  });

  const computeQueueRowMonitoring = async (taskTypeSlug, taskUuid) => {
    const redCfg  = findSystemChip('queue.monitoringDueRed');
    const amberCfg = findSystemChip('queue.monitoringDueAmber');
    if (!((redCfg && redCfg.enabled !== false) || (amberCfg && amberCfg.enabled !== false))) return null;
    const API    = window.SentinelApiClient;
    const NORM   = window.SentinelNormalisers;
    const engine = window.SentinelRules;
    if (!API || !NORM || !engine) { log('queue-mon: globals not loaded', taskUuid); return null; }
    const ctx = API.detectMedicusContext(location.href);
    if (!ctx) { log('queue-mon: no medicus context'); return null; }
    const patientUuid = await API.resolveTaskToPatient(ctx.apiBase, taskTypeSlug, taskUuid);
    if (!patientUuid) { log('queue-mon: patient resolution failed', taskUuid); return null; }
    let apiResults;
    try { apiResults = await API.fetchAll(ctx.apiBase, patientUuid); }
    catch (e) { log('queue-mon: fetchAll threw', e.message); return null; }
    if (!apiResults?.banner) { log('queue-mon: api returned no banner', patientUuid); return null; }
    const normalised = NORM.normaliseAll(apiResults, {
      url: location.href, title: '', view: null,
      patientUuid, resolutionSource: 'queue-monitoring'
    });
    const rules = await loadMonitoringRules();
    if (!rules?.length) { log('queue-mon: no monitoring rules loaded'); return null; }
    let chips;
    try {
      chips = engine.evaluatePatient(
        normalised.medications || [],
        normalised.observations || [],
        rules,
        { now: new Date().toISOString(), problems: normalised.problems || [],
          patientContext: normalised.patientContext || null,
          observationHistory: normalised.observationHistory || [] }
      );
    } catch (e) { log('queue-mon: evaluatePatient threw', e.message); return null; }
    return selectMonitoringDue(chips);
  };

  const injectQueueMonitoringChip = (rowIndex, result) => {
    if (!result) return;
    const row = document.querySelector(`.ag-row[row-index="${rowIndex}"]:not(.ag-full-width-row)`);
    if (!row) return;
    const id = 'queue.' + (result.level === 'red' ? 'monitoringDueRed' : 'monitoringDueAmber');
    const chip = getSystemChip(id, { count: result.count });
    if (!chip) return;
    const previewRow = findQueuePreviewRow(row);
    let target = previewRow
      ? (previewRow.querySelector('.h-full.w-full') || previewRow.firstElementChild || previewRow)
      : row.querySelector('[col-id="patientName"]');
    if (!target || target.querySelector('.ch-q-mon')) return;
    const span = document.createElement('span');
    span.className = 'ch-q-mon';
    span.innerHTML = renderChipHtml(chip);
    target.insertBefore(span, target.firstChild);
  };

  const scheduleQueueMonitoring = async () => {
    const gen = ++_queueMonGeneration;
    // If a run is already in progress, the generation bump above is sufficient —
    // when that run finishes it will see the generation has changed and restart.
    if (_queueMonRunning) return;
    _queueMonRunning = true;
    const MAX = 8;
    let done = 0;
    for (const [rowIndex, taskUuid] of _queueRowUuids) {
      // Abort if we've hit the row cap, navigated away, or newer data arrived
      if (done >= MAX || pageType() !== 'queue' || _queueMonGeneration !== gen) break;
      const entry = _queueMonCache.get(taskUuid);
      if (!entry) continue;
      const stale = entry.result !== undefined && entry.ts && (Date.now() - entry.ts) > _MON_CACHE_TTL;
      if (entry.result !== undefined && !stale) {
        injectQueueMonitoringChip(rowIndex, entry.result);
      } else {
        const result = await computeQueueRowMonitoring(entry.taskTypeSlug, taskUuid);
        entry.result = result;
        entry.ts = Date.now();
        injectQueueMonitoringChip(rowIndex, result);
        done++;
        if (done < MAX) await new Promise(res => setTimeout(res, 200));
      }
    }
    _queueMonRunning = false;
    // If a newer generation was queued while we were running, start a fresh pass
    if (_queueMonGeneration !== gen) scheduleQueueMonitoring();
  };

  const QUEUE_DECORATED_KEY = 'chQDec';

  // Find the preview/detail row that goes with this master row.
  // In real Medicus, master rows live in .ag-center-cols-container and detail
  // rows live in a separate .ag-full-width-container. They're linked by id:
  // master has row-id="<UUID>", detail has row-id="detail_<UUID>".
  // Master rows are absolutely positioned, so DOM-order siblings are unrelated.
  const findQueuePreviewRow = (row) => {
    const rowId = row.getAttribute('row-id');
    if (!rowId) return null;
    // Try detail row by id first (works for real Medicus master/detail layout)
    const detailEsc = rowId.replace(/"/g, '\\"');
    const byId = document.querySelector('[row-id="detail_' + detailEsc + '"]');
    if (byId) return byId;
    // Fallback: legacy DOM-order sibling (covers test mocks and simpler layouts)
    let p = row.nextElementSibling;
    let hops = 0;
    while (p && hops < 3) {
      if (p.classList && p.classList.contains('ag-full-width-row')) return p;
      p = p.nextElementSibling;
      hops++;
    }
    return null;
  };

  const decorateOneRow = (row) => {
    if (!row || !row.classList || !row.classList.contains('ag-row')) return;
    // Only decorate master rows. Skip detail/preview rows (they have no cells).
    if (row.classList.contains('ag-full-width-row')) return;
    // Skip header rows / pinned rows / anything without cells
    if (!row.querySelector('[col-id="dateOfBirth"]')) return;
    if (row.dataset[QUEUE_DECORATED_KEY] === '1') return;

    const cellText = (colId) => {
      const cell = row.querySelector('[col-id="' + colId + '"]');
      return cell ? cell.textContent.trim() : '';
    };

    const dob = cellText('dateOfBirth');
    const priority = cellText('priorityDisplay');
    const created = cellText('createdAt');

    // Find preview row to read request body & inject chips
    const previewRow = findQueuePreviewRow(row);
    let previewText = '';
    if (previewRow) {
      // Prefer the inner <p> with the actual request text — avoids picking up
      // any sibling chrome elements
      const p = previewRow.querySelector('p, .q-pa-xs');
      previewText = (p ? p.textContent : previewRow.textContent).trim();
      // Strip leading "Request:" label that Medicus prepends
      previewText = previewText.replace(/^\s*Request\s*:?\s*/i, '');
    }

    // Compute chips
    const chips = [];
    const pushSysChip = (id, vars) => {
      const c = getSystemChip(id, vars);
      if (c) chips.push(c);
    };

    // Age extremes
    const ageMatch = dob.match(/\((\d+)\s*y/i);
    if (ageMatch) {
      const age = +ageMatch[1];
      if (age < TH('childAge')) pushSysChip('queue.child', { age });
      else if (age >= TH('elderAge')) pushSysChip('queue.elder', { age });
    }

    // Priority escalation
    if (priority && /high|urgent/i.test(priority)) {
      pushSysChip('queue.priority', { priority });
    }

    // Days since created (visible age of task)
    const cm = created.match(/(\d{1,2})\s+([A-Z][a-z]{2})\s+(\d{4})/);
    if (cm) {
      const d = parseDate(cm[0]);
      const days = daysAgo(d);
      if (Number.isFinite(days)) {
        if (days >= TH('taskAgeRed')) pushSysChip('queue.taskAgeRed', { days });
        else if (days >= TH('taskAgeAmber')) pushSysChip('queue.taskAgeAmber', { days });
      }
    }

    // User rules — match against the request preview text
    const ruleMatches = matchRules('queue', { request: previewText });
    for (const rule of ruleMatches) {
      chips.push({
        kind: rule.kind,
        text: rule.label,
        ruleId: rule.id,
        hasActions: (rule.actions || []).length > 0
      });
    }

    if (!chips.length) {
      row.dataset[QUEUE_DECORATED_KEY] = '1';
      return;
    }

    // Inject chips. Preferred target is the inner content wrapper of the
    // preview row (Medicus uses <div class="h-full w-full"><p class="q-pa-xs">…)
    // so chips render on the same line as the request preview text. Fallbacks
    // for simpler layouts and the no-preview-row case (e.g. test mocks).
    let target = null;
    if (previewRow) {
      target = previewRow.querySelector('.h-full.w-full')
            || previewRow.querySelector('.ag-full-width-container')
            || previewRow.firstElementChild
            || previewRow;
    } else {
      target = row.querySelector('[col-id="patientName"]');
    }

    if (target && !target.querySelector('.ch-queue-chips')) {
      const strip = document.createElement('span');
      strip.className = 'ch-queue-chips';
      strip.innerHTML = chips.map(c => renderChipHtml(c)).join('');
      target.insertBefore(strip, target.firstChild);
      // Wire action menu handlers onto chips that have actions
      strip.querySelectorAll('[data-rule-id]').forEach(el => {
        el.addEventListener('click', (e) => {
          e.preventDefault(); e.stopPropagation();
          showActionMenu(el, el.dataset.ruleId);
        });
      });
    }

    row.dataset[QUEUE_DECORATED_KEY] = '1';
  };

  const decorateQueueRows = () => {
    document.querySelectorAll('.ag-row').forEach(decorateOneRow);
  };

  // Queue observer with self-write protection.
  // AG Grid recycles row DOM nodes when rows shift (e.g. when a task is cleared
  // and the next moves up). The old chip strip stays attached to the recycled
  // preview row, the duplicate-check trips, and the row ends up with stale or
  // missing chips. Fix: every mutation tick, strip ALL chip strips, clear all
  // decoration flags, and re-decorate from scratch. Disconnect the observer
  // during our own writes so we don't loop on ourselves.
  let queueObserver = null;
  let queueObservedContainer = null;   // tracks which DOM node the observer is watching
  let queueRafScheduled = false;

  // Fully tear down the queue observer and forget the container reference.
  // Called whenever we navigate AWAY from the queue so that the next visit
  // to the queue page always rebuilds against the current (possibly fresh) DOM.
  const teardownQueueObserver = () => {
    if (queueObserver) { queueObserver.disconnect(); queueObserver = null; }
    queueObservedContainer = null;
    queueRafScheduled = false;
  };

  const refreshQueueChips = () => {
    if (queueObserver) queueObserver.disconnect();
    document.querySelectorAll('.ch-queue-chips, .ch-q-mon').forEach(s => s.remove());
    document.querySelectorAll('.ag-row').forEach(r => { delete r.dataset[QUEUE_DECORATED_KEY]; });
    decorateQueueRows();
    // Re-attach via setupQueueObserver so the observer is created if it was
    // never initialised, and re-bound to the current container if it was.
    queueObservedContainer = null;
    setupQueueObserver();
    // Re-inject monitoring chips — AG Grid row recycling on scroll destroys them
    if (_queueRowUuids.size > 0) scheduleQueueMonitoring();
  };

  const setupQueueObserver = () => {
    // If we already have an observer AND the container it's watching is still
    // live in the document, nothing to do.  But if the container was removed
    // (Medicus SPA tore down AG Grid on navigation), discard the stale observer
    // and build a fresh one.
    if (queueObserver && queueObservedContainer && document.contains(queueObservedContainer)) return;

    // Stale or missing — start clean.
    if (queueObserver) { queueObserver.disconnect(); queueObserver = null; }

    // Observe ag-body-viewport — parent of BOTH the master rows container
    // (.ag-center-cols-container) AND the detail rows container
    // (.ag-full-width-container), so we catch mutations in either.
    const container = document.querySelector('.ag-body-viewport') || document.querySelector('.ag-root-wrapper');
    if (!container) {
      setTimeout(setupQueueObserver, 400);
      return;
    }
    queueObservedContainer = container;
    queueObserver = new MutationObserver(() => {
      if (queueRafScheduled) return;
      queueRafScheduled = true;
      requestAnimationFrame(() => {
        queueRafScheduled = false;
        refreshQueueChips();
      });
    });
    queueObserver.observe(container, { childList: true, subtree: true });
  };

  // ---- Drag-to-position (docked HUD only) ----
  const POS_KEY = 'ch-pos';

  const restorePosition = (hud) => {
    if (inPip() || !hud) return;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(POS_KEY) || 'null'); } catch (e) {}
    if (!saved || !Number.isFinite(saved.left) || !Number.isFinite(saved.top)) return;
    const maxX = window.innerWidth - 60;
    const maxY = window.innerHeight - 40;
    const left = Math.max(0, Math.min(maxX, saved.left));
    const top = Math.max(0, Math.min(maxY, saved.top));
    hud.style.left = left + 'px';
    hud.style.top = top + 'px';
    hud.style.right = 'auto';
  };

  const enableDrag = (hud) => {
    if (inPip() || !hud) return;
    const header = hud.querySelector('.ch-head');
    if (!header || header.dataset.chDrag === '1') return;
    header.dataset.chDrag = '1';
    header.style.cursor = 'move';

    let dragging = false, sx = 0, sy = 0, sl = 0, st = 0;

    const onDown = (e) => {
      if (e.target.closest('button')) return;
      const rect = hud.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY;
      sl = rect.left; st = rect.top;
      dragging = true;
      e.preventDefault();
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp, { once: true });
    };
    const onMove = (e) => {
      if (!dragging) return;
      const left = Math.max(0, Math.min(window.innerWidth - 60, sl + (e.clientX - sx)));
      const top  = Math.max(0, Math.min(window.innerHeight - 40, st + (e.clientY - sy)));
      hud.style.left = left + 'px';
      hud.style.top = top + 'px';
      hud.style.right = 'auto';
    };
    const onUp = () => {
      dragging = false;
      document.removeEventListener('mousemove', onMove);
      try {
        const r = hud.getBoundingClientRect();
        localStorage.setItem(POS_KEY, JSON.stringify({ left: r.left, top: r.top }));
      } catch (e) {}
    };
    header.addEventListener('mousedown', onDown);
  };

  // ---- SPA route detection ----
  const setupRouteWatcher = () => {
    let pending;
    const onRoute = () => {
      // Two-stage: short delay to let SPA swap DOM, longer delay to catch slow rerenders
      clearTimeout(pending);
      pending = setTimeout(() => run(true), 250);
      setTimeout(() => run(true), 1200);
    };

    // 1. <title> changes — most reliable signal in Medicus (title updates per patient)
    const titleEl = document.querySelector('title');
    if (titleEl) {
      new MutationObserver(onRoute).observe(titleEl, { childList: true, characterData: true, subtree: true });
    }

    // 2. History API
    const wrap = (k) => {
      const orig = history[k];
      if (!orig) return;
      history[k] = function (...args) {
        const r = orig.apply(this, args);
        onRoute();
        return r;
      };
    };
    wrap('pushState');
    wrap('replaceState');
    window.addEventListener('popstate', onRoute);
    window.addEventListener('hashchange', onRoute);

    // 3. URL change via body mutations (catch SPA frameworks that bypass history.X)
    let lastUrl = location.href;
    new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        onRoute();
      }
    }).observe(document.body, { childList: true, subtree: true });
  };

  // Wait for the page to populate (Medicus likely renders async)
  const waitFor = (testFn, cb, timeout = 8000) => {
    const start = Date.now();
    const tick = () => {
      if (testFn()) return cb();
      if (Date.now() - start > timeout) return cb();
      requestAnimationFrame(tick);
    };
    tick();
  };

  // Per-page wait predicate
  const pageReady = () => {
    const t = pageType();
    // Generic fallback: patient banner present means the page has finished its
    // initial render and we can attach the HUD even if we don't recognise the
    // specific card layout (labs, prescriptions, miscellaneous tasks etc.)
    const hasPatientBanner = !!document.querySelector(
      '[class*="patient-banner"], [class*="patient-header"], [data-cy*="patient-banner"]'
    );
    if (t === 'record') {
      return !!(findCardByTitle('Registers') || findCardByTitle('Active Problems') || hasPatientBanner);
    }
    if (t === 'detail') {
      // Try the known cards first; fall back to any clinical-context card
      // (Active Problems / Current Medication shows up on lab result detail,
      // task detail, prescription detail) or the patient banner.
      return !!(findCardByTitle('Task Details')
             || findCardByTitle('Task Overview')
             || findCardByTitle('Document Details')
             || findCardByTitle('Active Problems')
             || findCardByTitle('Initial Request')
             || findCardByTitle('Current Medication')
             || findCardByTitle('Investigation results')
             || findCardByTitle('Results')
             || findCardByTitle('Result')
             || findCardByTitle('Prescription')
             || findCardByTitle('Request details')
             || hasPatientBanner);
    }
    if (t === 'queue') return !!document.querySelector('.ag-row');
    return true; // unknown page type — bail quickly
  };

  // Install the document-context interceptor EARLY — the document XHRs fire
  // during SPA navigation INTO the document, which happens before runDetail
  // (which waits for pageReady). Installing it here, at content-script init,
  // ensures the wrapper is in place before any document is opened. Cheap and
  // idempotent via the page-world window.__chDocIntercepted guard.
  injectDocContextInterceptor();

  // Load config first, then start. Config drives rule matching.
  loadConfig().then(() => {
    waitFor(pageReady, () => {
      run(true);
      setupRouteWatcher();
    });
    watchConfig(() => {
      // Config changed — wipe + redo queue chips, then re-render the HUD
      if (pageType() === 'queue') refreshQueueChips();
      run(true);
    });
  }).catch(e => console.error('[TriageLens] init failed', e));

  // Expose for manual re-trigger (demo / testing / SPA edge cases)
  window.__clinHudRun = () => run(true);

})();
