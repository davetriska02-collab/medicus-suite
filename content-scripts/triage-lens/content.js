// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
/* Triage Lens - content script
 * v0.1.0
 * Runs entirely client-side. Scrapes the existing Care Record DOM,
 * computes triage-relevant signals, and renders an overlay HUD.
 * No network calls. No persistence beyond chrome.storage (not used in v0.1).
 */
(() => {
  'use strict';

  const VERSION = '0.6.0';
  // Debug logging is off by default; flip it on at runtime from the page console
  // with: localStorage.setItem('ch-debug','1') then reload. (Content script and
  // page share localStorage on the same origin.) Lets us trace the queue
  // result-triage pipeline live without shipping a special build.
  const DEBUG = (() => {
    try { return typeof localStorage !== 'undefined' && localStorage.getItem('ch-debug') === '1'; }
    catch (e) { return false; }
  })();
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
  max-width: 22ch;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ch-chip-red    { background: #fbe6e7; color: #b8262e; border-color: rgba(184,38,46,0.25); }
.ch-chip-amber  { background: #fdf3e1; color: #b45309; border-color: rgba(184,119,26,0.25); }
.ch-chip-green  { background: #e8f4ec; color: #2f8a4a; border-color: rgba(47,138,74,0.25); }
.ch-chip-info   { background: #e7eef7; color: #2a4d7a; border-color: rgba(42,77,122,0.20); }
/* Meta/process chips (under-prioritised, unmatched): outline, not filled — */
/* keeps clinical fills reserved for actual result severity. */
.ch-q-result .ch-chip-meta { background: transparent; }

/* Clinical result chips (filled, not meta): small leading triangle marker so   */
/* filled+glyph vs outline+no-glyph is distinguishable beyond colour alone.     */
.ch-q-result .ch-chip:not(.ch-chip-meta):not(.ch-chip-info)::before {
  content: "▲ ";
  font-size: 9px;
  font-style: normal;
}

/* ---- Queue result legend ---- */
/* Injected once at the top of the Investigation Results queue. Deliberately     */
/* quiet — informs without competing with the red/amber clinical chips.          */
.ch-q-legend {
  display: block;
  background: #f1f5f9;
  color: #475569;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 11px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  line-height: 1.3;
  max-width: 360px;
  position: fixed;
  top: 56px;
  right: 16px;
  z-index: 99990;
  pointer-events: none;
}

/* ---- Queue row chips ---- */
.ch-queue-chips,
.ch-q-result {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-right: 6px;
  vertical-align: middle;
}
.ch-queue-chips .ch-chip,
.ch-q-result .ch-chip {
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

  const EMBEDDED_DEFAULTS = `{"version":9,"rules":[{"id":"mh-crisis","enabled":true,"label":"MH crisis","kind":"red","patterns":["suicid\\\\w*","self.?harm\\\\w*","kill myself","kill him\\\\w*self","kill her\\\\w*self","end my life","end it all","want to die","wanting to die","don.?t want to be here","don.?t want to live","no longer want to live","not want to live","harm myself","hurt myself","hurting myself","take my (own )?life","taking my (own )?life","overdos\\\\w*","took too many (pills|tablets|medication)","taken too many (pills|tablets|medication)","swallowed too many","cutting myself","hang\\\\w* myself","jump\\\\w* off","throw myself (off|under|in front)","feel like (i want to )?die","feeling suicid\\\\w*","active suicid\\\\w*","passive suicid\\\\w*","life not worth","not worth living","can.?t go on","cannot go on","crisis (team|line|referral)","mental health crisis","psychiatric emergency","(postpartum|puerperal) psychosis","thoughts of (harming|hurting) (my |the )?baby","thoughts of (harming|hurting) (my |the )?(children|kids)","want to (hurt|harm) (my |the )?baby"],"regex":true,"fields":["request","banner"],"pages":["queue","detail","record"],"bumpsTile":"safeguarding","builtin":true,"actions":[{"type":"link","label":"Samaritans","url":"https://www.samaritans.org/"},{"type":"link","label":"NHS 111 mental health","url":"https://111.nhs.uk/"},{"type":"snippet","label":"Risk assessment","text":"MH risk assessment:\\n- Current intent / plan / means:\\n- Recent triggers:\\n- Protective factors:\\n- Past attempts / hospital admissions:\\n- Substance use:\\n- MH services involvement:\\n- Capacity:\\n\\nAction:\\n- Same-day F2F vs phone vs crisis team\\n- Safety plan documented\\n- Safeguarding referral if children in household\\n- Follow-up timeframe agreed"},{"type":"note","label":"Safeguarding check","text":"Always consider:\\n\\u2022 Children / dependents in household \\u2192 safeguarding referral threshold\\n\\u2022 Mental Capacity Assessment\\n\\u2022 Document risk assessment in full\\n\\u2022 Crisis team contact readily available\\n\\u2022 Clear follow-up plan with named clinician"}]},{"id":"safeguarding","enabled":true,"label":"Safeguarding","kind":"red","patterns":["safeguarding","abuse","abused","abusing","neglect","neglected","domestic violence","domestic abuse","coercive control","coercive behaviour","controlling partner","controlling relationship","controlling behaviour","hit me","hits me","hitting me","punch","kicked me","kicks me","slap","strangl","afraid at home","scared at home","scared of my partner","scared of my husband","scared of my wife","scared of my boyfriend","scared of my girlfriend","frightened at home","frightened of my partner","fear at home","unsafe at home","not safe at home","partner hurts me","partner hits me","husband hits me","husband hurts me","my partner beats me","being beaten","physical abuse","emotional abuse","psychological abuse","sexual abuse","sexual assault","assaulted","rape","financial abuse","forced marriage","female genital mutilation","fgm","child abuse","child neglect","child at risk","at risk child","exploitation","traffick","modern slavery","honour","forced into","threatened me","threatening me","threats at home","violence at home","hurt at home"],"regex":false,"fields":["request","banner","problems"],"pages":["queue","detail","record"],"bumpsTile":"safeguarding","builtin":true,"actions":[{"type":"link","label":"Local safeguarding (replace URL)","url":"https://www.gov.uk/government/publications/safeguarding-adults"},{"type":"note","label":"Documentation","text":"Safeguarding considerations:\\n\\u2022 Notify practice safeguarding lead\\n\\u2022 MARAC / DASH risk assessment if DV suspected\\n\\u2022 Code in record (Safeguarding adult / child concern)\\n\\u2022 Document concerns verbatim\\n\\u2022 Information sharing per local policy\\n\\u2022 Children in household \\u2014 separate referral if at risk"}]},{"id":"chest-pain","enabled":true,"label":"Chest pain","kind":"red","patterns":["chest pain","chest tightness","tight chest","tightness in my chest","tightness in chest","crushing","central chest","pain in my chest","pain in the chest","chest pressure","pressure on my chest","pressure in my chest","pressure in chest","heaviness in my chest","heavy chest","chest heaviness","chest discomfort","discomfort in my chest","chest ache","aching chest","ache in my chest","chest squeezing","squeezing chest","squeezing in my chest","heart pain","pain in my heart","angina","heart attack","cardiac","chest burning","burning in my chest","burning chest","chest tightening","tightening in my chest","substernal","retrosternal","radiation to my arm","radiating to my arm","pain down my arm","pain in my left arm","jaw pain with chest","pain in my jaw and chest","chest and arm pain","chest and jaw pain","myocardial","nstemi","stemi","jaw pain and arm","jaw pain with arm","jaw pain and shoulder","jaw pain with shoulder","neck pain and arm","neck pain with arm","neck pain and shoulder","neck pain with shoulder","pain in my left arm and sweat","pain in my left arm with sweat","pain in my left arm and nausea","pain in my left arm with nausea","pain in my right arm and sweat","pain in my right arm with sweat","pain in my left shoulder and sweat","pain in my left shoulder with sweat","indigestion and arm pain","indigestion with arm pain","heartburn and arm pain","heartburn with arm pain","indigestion and jaw pain","indigestion with jaw pain","heartburn and jaw pain","heartburn with jaw pain","indigestion and sweating","indigestion with sweating","heartburn and sweating","heartburn with sweating"],"regex":false,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"Acute pathway","text":"If acute / ongoing pain \\u2192 999.\\n\\nIf resolved:\\n\\u2022 Onset, duration, character, radiation, exertion-related?\\n\\u2022 Cardiac risk factors: age, smoker, FH, DM, lipids, BP, prior CVD\\n\\u2022 Associated: SOB, sweating, N&V, syncope\\n\\u2022 Differential: ACS, PE, dissection, pericarditis, GORD, MSK, anxiety\\n\\nThresholds:\\n\\u2022 HEART score for risk stratification\\n\\u2022 Same-day clinical assessment if any concerning features"},{"type":"snippet","label":"HEART score template","text":"HEART score:\\n- History (suspicious 0/1/2):\\n- ECG (normal / non-spec / abnormal 0/1/2):\\n- Age (<45 / 45-64 / >65 = 0/1/2):\\n- Risk factors (count: 0 / 1-2 / 3+ or known CVD = 0/1/2):\\n- Troponin (norm / 1-3x / >3x ULN = 0/1/2):\\n\\nTotal: __\\n0-3 = low risk \\u00b7 4-6 = moderate \\u00b7 7-10 = high"}]},{"id":"cauda-equina","enabled":true,"label":"Cauda equina","kind":"red","patterns":["saddle.?(numb\\\\w*|anaesthe\\\\w*|anesthe\\\\w*|paresthe\\\\w*|parasthe\\\\w*|sensation)","bladder retention","urinary retention","bowel incontinence","perineal numb\\\\w*","perineal anaesthe\\\\w*","perineal anesthe\\\\w*","perineal paresthe\\\\w*","can.?t feel (when I |to |myself )?(wee|urinate|pee|pass urine|empty my bladder)","can.?t empty my bladder","unable to empty (my )?bladder","loss of bladder control","lost bladder control","can.?t feel (my )?(bottom|bum|groin|genitals|between my legs|down below|perineum)","numb (bum|bottom|groin|genitals|perineum|between my legs|between the legs|down below|in my groin|around my back passage|around my anus|around my back\\\\w*)","numbness (in my )?(bum|bottom|groin|genitals|perineum|between (my |the )?legs|down below|around my back passage|saddle area)","tingling (in my )?(bum|bottom|groin|genitals|perineum|between (my |the )?legs|saddle area)","loss of sensation (in my )?(bum|bottom|groin|genitals|perineum|between (my |the )?legs|saddle area|down below)","reduced sensation (in my )?(bum|bottom|groin|genitals|perineum|between (my |the )?legs|saddle area)","no sensation (in my )?(bum|bottom|groin|genitals|perineum|between (my |the )?legs|saddle area)","back passage numb\\\\w*","anal numb\\\\w*","perianal numb\\\\w*","cauda equina","bowel and bladder","bladder and bowel","can.?t pass urine","unable to urinate","unable to pass urine","not passed urine (for|in)","haven.?t (been able to )?wee\\\\w* (for|in)","can.?t wee","retention of urine","faecal incontinence","fecal incontinence","losing control of (my )?bowels","lost control of (my )?bowels","loss of bowel control","leaking (from|stool|bowel)","back pain with (bladder|bowel|numb\\\\w*|incontinence|retention)","leg weakness with (bladder|bowel|numb\\\\w*|incontinence|retention)","sciatica (and|with) (bladder|bowel|incontinence|numb\\\\w*|retention)","lost all (feeling|sensation) down (there|below)","can.?t feel (myself |when I )?(pee|wee|go to the toilet)"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"Emergency MRI","text":"Suspected cauda equina = same-day emergency MRI.\\n\\nRed flags (any):\\n\\u2022 Bilateral sciatica\\n\\u2022 Saddle anaesthesia / paraesthesia\\n\\u2022 Bladder dysfunction (retention / overflow)\\n\\u2022 Bowel incontinence / loss of anal tone\\n\\u2022 Sexual dysfunction\\n\\nAction:\\n\\u2022 Discuss with on-call neurosurgery / spinal team\\n\\u2022 Direct ED referral if no urgent MRI access\\n\\u2022 Document neuro exam including PR if appropriate"}]},{"id":"thunderclap","enabled":true,"label":"Thunderclap headache","kind":"red","patterns":["worst headache","worst head pain","started instantly","thunderclap","sudden severe headache","sudden onset headache","worst headache of my life","worst headache i have ever","worst headache ever","never had a headache like","headache like a thunderclap","headache came on suddenly","headache came on instantly","headache came on out of nowhere","headache hit me suddenly","headache out of nowhere","headache hit like","headache started suddenly","sudden headache","instantaneous headache","explosive headache","headache like an explosion","bang in my head","worst pain of my life in my head","head pain worst ever","severe sudden head","head felt like it exploded","head like it was going to explode","subarachnoid","brain haemorrhage","brain hemorrhage","bleed in the brain","bleed on the brain","worst pain ever in my head","10 out of 10 headache","10/10 headache","headache ten out of ten","sudden headache and stiff neck","sudden headache with stiff neck","sudden severe headache and stiff neck","sudden severe headache with stiff neck","sudden headache and sore neck","sudden headache with sore neck","sudden headache and painful neck","sudden headache with painful neck","worst headache and neck pain","worst headache with neck pain"],"regex":false,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"SAH pathway","text":"Thunderclap headache \\u2192 consider SAH.\\n\\n\\u2022 Maximum intensity within seconds-minutes\\n\\u2022 Same-day CT head (CT >95% sensitive within 6h)\\n\\u2022 If CT negative & onset <6h, may exclude\\n\\u2022 If onset >6h or symptoms ongoing, LP at 12h\\n\\nOther differentials: cervical artery dissection, RCVS, pituitary apoplexy, venous sinus thrombosis.\\n\\nAction: same-day ED referral."}]},{"id":"gi-bleed","enabled":true,"label":"GI bleed","kind":"red","patterns":["melaena\\\\w*","melena\\\\w*","malaena\\\\w*","haematemesis\\\\w*","hematemesis\\\\w*","vomiting blood","vomited blood","vomit\\\\w* blood","threw up blood","throwing up blood","coffee.?ground\\\\w*","fresh blood per rectum","haematochezia\\\\w*","hematochezia\\\\w*","blood in (my )?(stool|stools|poo|poop|faeces|feces|bowel movement|motion|toilet)","blood (from|in|out of) (my )?(back passage|bottom|anus|rectum|bum)","passing blood (from|per|in|out of|rectum|back passage|bottom|anus|bum|stool|poo|bowel)","rectal bleeding","rectal bleed\\\\w*","bleeding (from|per) rectum","bleeding from (my )?(back passage|bottom|anus|bum)","bright red blood (from|in|per|out of)","dark (red )?blood (in|from|per|out of) (my )?(stool|poo|back passage|bottom|bowel)","black (tarry |and tarry )?(stool|stools|poo|poop|faeces|feces|bowel|motion)","black and tarry","tarry (stool|stools|poo|poop|faeces|feces|bowel|motion)","tar.?like (stool|stools|poo|poop|faeces|feces)","dark stool\\\\w*","dark poo\\\\w*","very dark poo","blood when I wipe","blood on toilet paper","blood in (the )?toilet (bowl|pan|water)?","blood (after|when) (going to the )?toilet","pr bleed\\\\w*","upper gi bleed\\\\w*","lower gi bleed\\\\w*","gastrointestinal bleed\\\\w*","gi bleed\\\\w*","haemorrhage\\\\w* (from|in|into) (bowel|gut|stomach|oesophagus|esophagus|intestine)","hemorrhage\\\\w* (from|in|into) (bowel|gut|stomach|esophagus|intestine)","blood (in|from) (my )?vomit","bloody vomit","bloody stool\\\\w*","bloody diarrhoea","bloody diarrhea"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"Acute pathway","text":"Suspected upper / lower GI bleed.\\n\\n\\u2022 Haemodynamics: HR, BP, lying/standing\\n\\u2022 Anticoagulants / antiplatelets / NSAIDs\\n\\u2022 Liver disease / known varices\\n\\u2022 Glasgow-Blatchford for upper GI bleed\\n\\nAction:\\n\\u2022 Acute / unstable \\u2192 999\\n\\u2022 Stable + suspicious \\u2192 same-day medical admission\\n\\u2022 Painless rectal bleeding > 50y \\u2192 2WW colorectal"},{"type":"snippet","label":"Glasgow-Blatchford template","text":"Glasgow-Blatchford:\\n- Urea (mmol/L):\\n- Hb (g/L):\\n- Systolic BP:\\n- Pulse \\u2265100:\\n- Melaena:\\n- Syncope:\\n- Hepatic disease:\\n- Cardiac failure:\\n\\nScore: __\\n0 = consider outpatient \\u00b7 \\u22651 = admit"}]},{"id":"methotrexate","enabled":true,"label":"Methotrexate","kind":"amber","patterns":["methotrexate\\\\w*","methtrexate\\\\w*","methotrexat\\\\b","Maxtrex\\\\w*","Metoject\\\\w*","Nordimet\\\\w*","Jylamvo\\\\w*","\\\\bMTX\\\\b"],"regex":true,"fields":["meds","request","problems"],"pages":["detail","record"],"bumpsTile":"meds","builtin":true,"actions":[{"type":"note","label":"DMARD monitoring","text":"Methotrexate monitoring (NICE / BSR):\\n\\n\\u2022 FBC + U&E + LFT every 12 weeks (or 4-weekly if dose change / new abnormalities)\\n\\u2022 Annual chest X-ray if respiratory symptoms\\n\\u2022 Pneumococcal + annual flu vaccine\\n\\u2022 Folic acid 5mg weekly (\\u226524h after MTX)\\n\\nWarnings:\\n\\u2022 Teratogenic \\u2014 6mo washout F, 3mo M before conception\\n\\u2022 Hepatotoxic \\u2014 alcohol limits\\n\\u2022 Pulmonary toxicity \\u2014 investigate any new SOB / dry cough\\n\\u2022 Drug interactions \\u2014 esp. trimethoprim, NSAIDs (caution)"},{"type":"snippet","label":"Bloods reminder","text":"Methotrexate monitoring bloods:\\n- FBC + film:\\n- U&E:\\n- LFTs:\\n- Date of last MTX dose:\\n- Current dose:\\n- Folic acid:\\n- Symptoms? (SOB, mouth ulcers, infection):\\n\\nNext review due:"}]},{"id":"lithium","enabled":true,"label":"Lithium","kind":"amber","patterns":["lithium\\\\w*","Priadel\\\\w*","Camcolit\\\\w*","Liskonum\\\\w*","Li-Liquid\\\\w*","Li Liquid\\\\w*"],"regex":true,"fields":["meds","request","problems"],"pages":["detail","record"],"bumpsTile":"meds","builtin":true,"actions":[{"type":"note","label":"Lithium monitoring","text":"Lithium monitoring (NICE):\\n\\n\\u2022 Level 12h post-dose, 3-monthly (more often if dose change, illness, drug interaction)\\n\\u2022 U&E + TFT + Ca every 6 months\\n\\u2022 Target range typically 0.6-0.8 mmol/L (0.4-1.0 acceptable)\\n\\u2022 Toxicity above 1.5 mmol/L\\n\\nCommon traps:\\n\\u2022 Dehydration / D&V \\u2192 toxicity\\n\\u2022 NSAIDs, ACEi, thiazides \\u2191 levels\\n\\u2022 Pregnancy considerations \\u2014 specialist advice\\n\\u2022 Hypothyroidism long-term"}]},{"id":"anticoag","enabled":true,"label":"Anticoagulant","kind":"amber","patterns":["warfarin\\\\w*","apixaban\\\\w*","rivaroxaban\\\\w*","edoxaban\\\\w*","dabigatran\\\\w*","acenocoumarol\\\\w*","phenindione\\\\w*","Eliquis\\\\w*","Xarelto\\\\w*","Lixiana\\\\w*","Pradaxa\\\\w*","Coumadin\\\\w*","Marevan\\\\w*","Sinthrome\\\\w*","\\\\bDOAC\\\\b","\\\\bNOAC\\\\b","blood thinners?\\\\b","blood[- ]?thinning tablets?\\\\b","anticoagulant\\\\w*"],"regex":true,"fields":["meds"],"pages":["detail","record"],"bumpsTile":"meds","builtin":true,"actions":[{"type":"note","label":"Anticoag review","text":"Annual anticoagulant review:\\n\\n\\u2022 Indication still valid?\\n\\u2022 Renal function \\u2014 dose adjustment for DOACs\\n\\u2022 Bleeding risk reassessment (HAS-BLED, ORBIT)\\n\\u2022 CHA\\u2082DS\\u2082-VASc for AF (consider stopping if low risk)\\n\\u2022 Patient knows what to do if a dose is missed\\n\\u2022 Has Yellow Book / DOAC alert card\\n\\u2022 Interacting meds review (esp. NSAIDs, antibiotics, antifungals)\\n\\u2022 Bleeding episodes \\u2014 frequency, severity, source\\n\\u2022 Falls risk if elderly"}]},{"id":"uti","enabled":true,"label":"UTI","kind":"amber","patterns":["\\\\bUTI\\\\b","urinary tract inf\\\\w*","burning (when |while )?(passing (water|urine)|pe?e?ing|i (pe?e?|wee)|to (pee|wee))\\\\w*","stinging (when |while )?(passing (water|urine)|pe?e?ing|i (pe?e?|wee)|to (pee|wee))\\\\w*","dysuria\\\\w*","cystitis\\\\w*","water inf\\\\w*","bladder inf\\\\w*","need to (wee|pee|urinate) (all the time|constantly|frequently|a lot)\\\\w*","cloudy (urine|wee|pee)\\\\w*","smelly (urine|wee|pee)\\\\w*","pain (passing|when passing) (water|urine)\\\\w*","frequent urination\\\\w*","urine inf\\\\w*","can.?t (pee|pass water)","unable to (wee|pee|pass water)","nothing comes? out (when I try to )?(wee|pee)","struggling to pass (urine|water)"],"regex":true,"fields":["request","problems"],"pages":["queue","detail","record"],"bumpsTile":null,"builtin":true,"actions":[{"type":"link","label":"NICE CKS UTI (women)","url":"https://cks.nice.org.uk/topics/urinary-tract-infection-lower-women/"},{"type":"link","label":"NICE CKS UTI (men)","url":"https://cks.nice.org.uk/topics/urinary-tract-infection-lower-men/"},{"type":"snippet","label":"UTI history & exam","text":"UTI history:\\n- Dysuria / frequency / urgency:\\n- Suprapubic pain / loin pain:\\n- Duration of symptoms:\\n- Fever / rigors / vomiting:\\n- Vaginal discharge:\\n- Sexually active / new partner:\\n- Pregnancy possible:\\n- Catheter / structural abnormality:\\n- Recent abx / hospitalisation:\\n- Recurrence (\\u22653 in 12mo or \\u22652 in 6mo):\\n- Diabetes / immunosuppression:\\n\\nO/E:\\n- Vitals (sepsis screen):\\n- Abdominal exam:\\n- Loin tenderness:\\n- (Dipstick: not for \\u226565y or catheterised):\\n\\nPlan:\\n- 1st line: nitrofurantoin or trimethoprim per local sensitivity\\n- 2nd line: pivmecillinam / fosfomycin\\n- Pyelonephritis features \\u2192 admit / IV abx"},{"type":"link","label":"NHS Pharmacy First","url":"https://www.nhs.uk/nhs-services/pharmacies/pharmacy-first/"},{"type":"snippet","label":"Pharmacy First referral (UTI)","text":"Consider Pharmacy First \\u2014 uncomplicated lower UTI, women aged 16\\u201364, not pregnant. If eligible, signpost to community pharmacy.\\n\\nNot suitable / safety-net: pregnant, male, <16 or >64, recurrent UTI, catheter, immunosuppressed, suspected pyelonephritis (fever, loin/back pain, rigors, vomiting), visible haematuria, or not improving in 48h."}]},{"id":"epiglottitis","enabled":true,"label":"Epiglottitis","kind":"red","patterns":["epiglottit\\\\w*","(drooling|can.?t swallow (my )?(own )?(saliva|spit))","(muffled|hot.?potato) voice"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"Airway emergency","text":"Suspected adult epiglottitis / supraglottitis \\u2192 999 / same-day ED.\\n\\nRed flags (any): drooling or unable to swallow saliva, muffled \\u201chot potato\\u201d voice, stridor, sitting forward to breathe, severe sore throat with a normal-looking oropharynx, rapid deterioration.\\n\\nAction:\\n\\u2022 Do NOT attempt to examine the throat or use a tongue depressor \\u2014 risk of precipitating airway obstruction\\n\\u2022 Keep the patient sitting upright; do not lie flat\\n\\u2022 999 transfer / immediate ENT-anaesthetics involvement\\n\\u2022 Differential: quinsy, deep neck-space infection, anaphylaxis"}]},{"id":"sore-throat","enabled":true,"label":"Sore throat","kind":"amber","patterns":["sore throat\\\\w*","tonsillitis\\\\w*","throat pain\\\\w*","pharyngitis\\\\w*","painful throat\\\\w*","throat is sore\\\\w*","hurts to swallow\\\\w*","strep throat\\\\w*","quinsy\\\\w*","peritonsillar\\\\w*","tonsils (are |is )?(sore|swollen|infected|inflamed|painful)\\\\w*","swollen tonsils?\\\\w*","throat infection\\\\w*"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"link","label":"NICE CKS sore throat","url":"https://cks.nice.org.uk/topics/sore-throat-acute/"},{"type":"snippet","label":"FeverPAIN scoring","text":"FeverPAIN score (1 point each):\\n- Fever in last 24h:\\n- Purulence (tonsils):\\n- Attended within 3 days of onset:\\n- Inflamed tonsils (severe):\\n- No cough or coryza:\\n\\nTotal: __\\n0-1: 13-18% strep \\u2014 no abx, self-care\\n2-3: 34-40% strep \\u2014 delayed abx (3d) or no abx\\n4-5: 62-65% strep \\u2014 immediate abx\\n\\nAbx of choice: phenoxymethylpenicillin 500mg QDS 5-10d (clarithromycin if pen-allergic)"},{"type":"link","label":"NHS Pharmacy First","url":"https://www.nhs.uk/nhs-services/pharmacies/pharmacy-first/"},{"type":"snippet","label":"Pharmacy First referral (sore throat)","text":"Consider Pharmacy First \\u2014 acute sore throat, age 5+. Pharmacist applies FeverPAIN.\\n\\nSafety-net / urgent: difficulty breathing, difficulty swallowing saliva, drooling, muffled \\u201chot potato\\u201d voice, stridor, neck stiffness, systemically very unwell, or immunosuppressed \\u2192 same-day assessment (?quinsy / epiglottitis)."}]},{"id":"otitis","enabled":true,"label":"Otitis media","kind":"amber","patterns":["otitis\\\\w*","earache\\\\w*","ear[- ]?ache\\\\w*","ear inf\\\\w*","ear pain\\\\w*","ear (is |are )?(really |very |so |getting |bit |a bit )?(hurting|sore|painful|infected|aching)\\\\w*","my ear (is |are )?(really |very |so |getting |bit |a bit )?(sore|hurting|painful|aching)\\\\w*","sore ear\\\\w*","painful ear\\\\w*","pain in (my |the |her |his )?ear\\\\w*","\\\\bAOM\\\\b","\\\\bOME\\\\b","glue ear\\\\w*","ear discharge\\\\w*","discharge from (the |my |her |his )?ear\\\\w*","blocked ear\\\\w*","muffled hearing (in|from) (the |my )?(ear|right ear|left ear)\\\\w*"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"link","label":"NICE CKS OM","url":"https://cks.nice.org.uk/topics/otitis-media-acute/"},{"type":"snippet","label":"OM history & exam","text":"Otitis media history:\\n- Onset / duration:\\n- Fever / unwell:\\n- Otalgia laterality:\\n- Discharge / hearing loss:\\n- Recent URTI:\\n- Recurrent OM (\\u22653 in 6mo or \\u22654/yr):\\n- Eardrum perforation history:\\n- Grommets:\\n\\nO/E:\\n- TM appearance: bulging / erythematous / dull / perforated / effusion\\n- Mastoid tenderness:\\n- General \\u2014 temp, fluid intake:\\n\\nPlan:\\n- Most resolve in 3 days, paracetamol / ibuprofen\\n- Abx if: <2y bilateral, perforation + discharge, systemically unwell, deteriorating\\n- Amoxicillin 5-7d (clarithromycin if pen-allergic)\\n- Safety net: persistent fever 3-4d, mastoid swelling, hearing loss >2-4w"},{"type":"link","label":"NHS Pharmacy First","url":"https://www.nhs.uk/nhs-services/pharmacies/pharmacy-first/"},{"type":"snippet","label":"Pharmacy First referral (otitis media)","text":"Consider Pharmacy First \\u2014 acute otitis media, age 1\\u201317. If eligible, signpost to community pharmacy.\\n\\nNot suitable / safety-net: <1y or >17y, systemically very unwell, immunosuppressed, suspected mastoiditis (swelling/redness behind the ear), or symptoms not improving after 3 days."}]},{"id":"sinusitis","enabled":true,"label":"Sinusitis","kind":"amber","patterns":["sinusit\\\\w*","sinus infection","sinus pain","sinus pressure","blocked sinus\\\\w*","facial pain","facial pressure","pressure (in|around|behind) (my )?(face|cheek|cheeks|eyes)","pain (over|around) (my )?(cheek|cheeks|sinuses)","post.?nasal drip"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"link","label":"NHS Pharmacy First","url":"https://www.nhs.uk/nhs-services/pharmacies/pharmacy-first/"},{"type":"snippet","label":"Pharmacy First referral (sinusitis)","text":"Consider Pharmacy First \\u2014 acute sinusitis, age 12+. If eligible, signpost to community pharmacy.\\n\\nSafety-net / urgent: symptoms >10 days, swelling or redness around the eye, double vision, severe frontal headache, photophobia, neck stiffness, or systemically very unwell."}]},{"id":"insect-bite","enabled":true,"label":"Insect bite","kind":"amber","patterns":["insect bite\\\\w*","insect sting\\\\w*","bug bite\\\\w*","spider bite\\\\w*","mosquito bite\\\\w*","infected bite\\\\w*","infected sting\\\\w*","bite (that('?s| is| has)? )?(gone )?(red|infected|swollen|hot|spreading)","sting (that('?s| is| has)? )?(gone )?(red|infected|swollen|hot|spreading)","bitten by (an? )?(insect|mosquito|spider|midge|wasp|bee)\\\\w*","tick bite\\\\w*","bitten by a tick","(bull.?s.?eye|circular|ring.?shaped) rash","lyme disease"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"link","label":"NHS Pharmacy First","url":"https://www.nhs.uk/nhs-services/pharmacies/pharmacy-first/"},{"type":"snippet","label":"Pharmacy First referral (infected insect bite)","text":"Consider Pharmacy First \\u2014 infected insect bite, age 1+. If eligible, signpost to community pharmacy.\\n\\nSafety-net / urgent: rapidly spreading redness, fever or systemic illness, suspected cellulitis, bite near the eye, or breathing difficulty / facial swelling suggesting anaphylaxis \\u2192 emergency."}]},{"id":"impetigo","enabled":true,"label":"Impetigo","kind":"amber","patterns":["impetigo\\\\w*","school sores?","golden crust\\\\w*","honey.?colou?red crust\\\\w*","weeping sore\\\\w*","crusty (sore|sores|rash|spot|spots) (on|around) (the |my )?(face|nose|mouth|chin|lip|lips)","infected (sore|sores) (on|around) (my |the )?(face|nose|mouth)"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"link","label":"NHS Pharmacy First","url":"https://www.nhs.uk/nhs-services/pharmacies/pharmacy-first/"},{"type":"snippet","label":"Pharmacy First referral (impetigo)","text":"Consider Pharmacy First \\u2014 impetigo, age 1+ (non-bullous, localised). If eligible, signpost to community pharmacy.\\n\\nNot suitable / refer: bullous impetigo, widespread or recurrent, systemically unwell, immunosuppressed, or not improving with treatment."}]},{"id":"shingles","enabled":true,"label":"Shingles","kind":"amber","patterns":["shingles","herpes zoster","\\\\bzoster\\\\b","shingle rash","blistering rash","band of blister\\\\w*","painful rash (on )?one side","rash (on )?one side of (my )?(face|body|chest|back|torso)","burning pain (on |down )?(one side|the left|the right)( of my (chest|back|body|face))?"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"link","label":"NHS Pharmacy First","url":"https://www.nhs.uk/nhs-services/pharmacies/pharmacy-first/"},{"type":"snippet","label":"Pharmacy First referral (shingles)","text":"Consider Pharmacy First \\u2014 shingles, age 18+. Antiviral most effective within 72h of rash onset.\\n\\nUrgent / not suitable for PF: eye involvement or rash on the tip of the nose (Hutchinson\\u2019s sign \\u2014 ?ophthalmic zoster), immunocompromised, pregnant, severe / widespread / disseminated rash, or signs of complications."}]},{"id":"back-pain","enabled":true,"label":"Back pain","kind":"amber","patterns":["back pain","lower back","lumbar pain","sciatica","backache","bad back","sore back","back hurt","pain in my back","aching back","back ache","slipped disc","trapped nerve","lumbago","sciatic","pain down my leg","leg pain from my back","back spasm","spine pain","spinal pain","lumbar","coccyx","sacral pain","sacroiliac","degenerative disc","herniated disc","prolapsed disc","disc bulge","facet joint"],"regex":false,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"link","label":"NICE LBP & sciatica","url":"https://www.nice.org.uk/guidance/ng59"},{"type":"snippet","label":"Back pain assessment","text":"Back pain \\u2014 red flags (refer urgently):\\n- Cauda equina (saddle anaesthesia, bladder/bowel)\\n- Significant trauma\\n- Age <20 or >55 new onset\\n- Progressive neurological deficit\\n- Fever / weight loss / night pain (cancer/infection)\\n- IVDU / immunosuppression\\n- History of malignancy\\n- Severe progressive limb weakness\\n\\nYellow flags (psychosocial):\\n- Belief pain is harmful\\n- Avoidance behaviour\\n- Low mood / withdrawal\\n- Job dissatisfaction\\n- Compensation/legal issues\\n\\nManagement (no red flags):\\n- Stay active, return to normal activities\\n- Analgesia: NSAIDs first-line (with PPI cover if indicated)\\n- Avoid opioids and gabapentinoids for non-specific LBP\\n- Refer to physio / MSK if not improving in 4-6 weeks"}]},{"id":"cough-resp","enabled":true,"label":"Cough/SOB","kind":"amber","patterns":["cough\\\\w*","shortness of breath","short of breath","breathless\\\\w*","wheez\\\\w*","chest infection\\\\w*","phlegm","\\\\bSOB\\\\b","\\\\bCOPD\\\\b","can't catch my breath","cannot catch my breath","cant catch my breath","struggling to breath\\\\w*","difficulty breath\\\\w*","hard to breath\\\\w*","chesty cough\\\\w*","mucus","sputum","tight chest","chest tightness from breath\\\\w*","bronchit\\\\w*","COPD flare\\\\w*","asthma attack\\\\w*","asthma flare\\\\w*","asthma\\\\b","haemoptysis","hemoptysis","coughing up blood","bringing up phlegm","bringing up mucus","winded","out of breath","puffed out","puffed\\\\b","respiratory infection","chest congestion","congested chest","rattly chest","productive cough\\\\w*","dry cough\\\\w*","persistent cough\\\\w*","tickly cough\\\\w*","night cough\\\\w*","asthma (getting|got|much) worse","asthma (not controlled|playing up)","(using|needing) (my )?(blue inhaler|reliever|salbutamol|ventolin) (more|more often|all the time|every (few )?hours)","(blue inhaler|reliever|inhaler) (not lasting|not working|not helping|isn.?t helping)","(waking|woken) (at|in the) night (with )?(wheez\\\\w*|cough\\\\w*|breathless\\\\w*|tight chest)","peak flow (dropping|down|low|worse)"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"Resp red flags","text":"Cough / breathlessness \\u2014 concerning features:\\n\\u2022 Haemoptysis\\n\\u2022 Weight loss / night sweats\\n\\u2022 Smoker / ex-smoker, esp. age >40\\n\\u2022 Persistent cough >3 weeks\\n\\u2022 Hoarseness >3 weeks\\n\\u2022 Acute onset breathlessness (PE / pneumothorax)\\n\\u2022 Tachypnoea, hypoxia, accessory muscle use\\n\\u2022 Single-lobe / focal signs\\n\\u2022 Failure to respond to abx\\n\\nThresholds:\\n\\u2022 Same-day F2F if any red flag, hypoxia, or systemic unwellness\\n\\u2022 2WW chest if haemoptysis + age >40, or persistent cough + smoker"},{"type":"snippet","label":"Resp assessment","text":"Respiratory presentation:\\n- Onset / duration:\\n- Cough: dry / productive (colour, consistency):\\n- Haemoptysis:\\n- Breathlessness \\u2014 exertional / rest, MRC grade:\\n- Wheeze:\\n- Fever, night sweats, weight loss:\\n- Chest pain \\u2014 pleuritic / cardiac:\\n- PE risk: travel, immobility, surgery, OCP, malignancy, leg swelling:\\n- Smoking pack-years:\\n- Asthma / COPD:\\n\\nO/E:\\n- Vitals: HR, BP, RR, sats, temp:\\n- WOB / accessory muscles:\\n- Chest exam:\\n- PEFR (if asthma):\\n\\nPlan:"},{"type":"note","label":"Asthma control (RCP3Q)","text":"RCP 3 Questions (any \\u201cyes\\u201d = poor control \\u2192 review):\\n1. Recent sleep disturbance from asthma?\\n2. Usual daytime symptoms (cough/wheeze/tight chest)?\\n3. Interference with usual activity?\\n\\nReliever use \\u22653\\u00d7/week or any night waking = uncontrolled \\u2192 inhaler technique + adherence + step-up review.\\n\\nACUTE SEVERE (same-day): PEF 33\\u201350% best, can\\u2019t complete sentences, RR \\u226525, HR \\u2265110.\\nLIFE-THREATENING (999): PEF <33%, silent chest, cyanosis, exhaustion, SpO\\u2082 <92%.\\nAfter any attack: steroid course completed? Follow-up within 48h."}]},{"id":"skin-2ww","enabled":true,"label":"Skin lesion","kind":"amber","patterns":["mole\\\\w*","skin lesion\\\\w*","skin change\\\\w*","changing mole\\\\w*","dark spot\\\\w*","growing lesion\\\\w*","non.?healing","ulcerat\\\\w*","new mole\\\\w*","mole has changed","mole that has changed","irregular mole\\\\w*","bleeding mole\\\\w*","itchy mole\\\\w*","spot that won.?t heal","sore that won.?t heal","wound that won.?t heal","won.?t heal","wont heal","not healing","hasn.?t healed","isn.?t healing","lump on \\\\w*(skin|back|arm|leg|face|neck|scalp|chest|shoulder)","skin growth\\\\w*","pigmented lesion\\\\w*","pigmented spot\\\\w*","melanoma\\\\w*","changing freckle\\\\w*","freckle that has changed","scab that won.?t heal","crusty lesion\\\\w*","crusty spot\\\\w*","suspicious mole\\\\w*","abnormal mole\\\\w*","pearly lump\\\\w*","basal cell\\\\w*","squamous cell\\\\w*","actinic keratosis","solar keratosis","rodent ulcer\\\\w*","lump on skin","skin lump\\\\w*","new lesion\\\\w*","spreading lesion\\\\w*","oozing lesion\\\\w*","bleeding lesion\\\\w*","lesion that bleeds","lesion that ooze\\\\w*"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"link","label":"NICE 2WW skin","url":"https://www.nice.org.uk/guidance/ng12/chapter/Recommendations-organised-by-site-of-cancer#skin-cancers"},{"type":"snippet","label":"7-point checklist","text":"Weighted 7-point checklist for pigmented lesion (refer 2WW if score \\u22653 OR any major):\\n\\nMajor (2 points each):\\n- Change in size:\\n- Irregular shape:\\n- Irregular colour:\\n\\nMinor (1 point each):\\n- Largest diameter \\u22657mm:\\n- Inflammation:\\n- Oozing / bleeding:\\n- Change in sensation (itch):\\n\\nTotal: __\\n\\nLesion description:\\n- Site:\\n- Diameter:\\n- Colour:\\n- Border:\\n- Evolution (timeline):\\n- Symptoms:\\n- ABCDE: Asymmetry / Border / Colour / Diameter / Evolving:\\n\\nPhoto on record? Y/N"}]},{"id":"mh-general","enabled":true,"label":"Mental health","kind":"amber","patterns":["anxi\\\\w*","depress\\\\w*","low mood","panic attack\\\\w*","stress\\\\w*","insomnia","mental health","mental wellbeing","therapy","counselling","counseling","feeling down","feel\\\\w* low","feel\\\\w* depressed","feel\\\\w* anxious","feeling hopeless","feeling worthless","feeling overwhelm\\\\w*","overwhelm\\\\w*","tearful","crying all the time","can't sleep","cannot sleep","cant sleep","not sleeping","struggling to sleep","sleep problem\\\\w*","sleep difficult\\\\w*","no motivation","lack of motivation","lost interest","no interest in","can't cope","cannot cope","cant cope","struggling mentally","struggling emotionally","worried all the time","nervous all the time","nervous wreck","constant worry\\\\w*","low self[- ]?esteem","\\\\bCBT\\\\b","talking therapy","talking therapies","\\\\bIAPT\\\\b","NHS talking therapies","mood problem\\\\w*","mood issue\\\\w*","burnt out","burnout","burn out","emotionally exhausted","mental breakdown","nervous breakdown","phobia\\\\w*","OCD\\\\b","PTSD\\\\b","post.?traumatic","intrusive thought\\\\w*","low energy","no energy","mood swings","anger problem\\\\w*"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"link","label":"PHQ-9","url":"https://patient.info/doctor/patient-health-questionnaire-phq-9"},{"type":"link","label":"GAD-7","url":"https://patient.info/doctor/generalised-anxiety-disorder-assessment-gad-7"},{"type":"link","label":"Local IAPT / Talking Therapies (replace)","url":"https://www.nhs.uk/mental-health/talking-therapies-medicine-treatments/talking-therapies-and-counselling/nhs-talking-therapies/"},{"type":"snippet","label":"MH consultation","text":"MH presentation:\\n- Onset / duration / triggers:\\n- Symptoms (mood, anhedonia, sleep, appetite, energy, concentration):\\n- Anxiety symptoms / panic:\\n- Functional impact (work, relationships, self-care):\\n- Risk: thoughts of self-harm / suicide / harm to others:\\n- Substance use:\\n- Past MH history / family history:\\n- Social context: housing, finances, support network:\\n- Recent losses / life events:\\n- PHQ-9: __ / GAD-7: __\\n\\nPlan:\\n- Self-help / IAPT / counselling\\n- SSRI if moderate-severe (caution under 25 \\u2014 review 2 weekly):\\n- Safety net + follow-up:"}]},{"id":"post-discharge","enabled":true,"label":"Post-discharge","kind":"amber","patterns":["discharged","just home from hospital","out of hospital","recently in hospital","discharge summary","came out of hospital","got home from hospital","back from hospital","left hospital","after my hospital stay","following my admission","post-op","after my operation","after my surgery","discharged from ward","TTO","TTA"],"regex":false,"fields":["request","docs"],"pages":["queue","detail","record"],"bumpsTile":"openLoops","builtin":true,"actions":[{"type":"note","label":"Post-discharge checklist","text":"After hospital discharge \\u2014 review:\\n\\n\\u2022 Medication reconciliation (new / changed / stopped)\\n\\u2022 Follow-up appointments booked?\\n\\u2022 Outstanding investigations / results pending?\\n\\u2022 Self-monitoring / safety-net advice given?\\n\\u2022 District nurse / community support arranged?\\n\\u2022 Social: home situation, carer, equipment\\n\\u2022 Code recent admission in record\\n\\u2022 Update problem list and registers (e.g. HF, COPD, AF post-MI)\\n\\u2022 Consider proactive care plan if frail / multimorbid"},{"type":"snippet","label":"Post-discharge review","text":"Post-discharge review:\\n\\nAdmission:\\n- Dates:\\n- Diagnoses:\\n- Procedures:\\n- Discharge medications (new/changed):\\n- Follow-up planned:\\n\\nReview today:\\n- Recovery progress:\\n- Symptoms \\u2014 concerning / improving:\\n- Pain control:\\n- Mobility / ADLs:\\n- Med compliance / side effects:\\n- Outstanding actions chased:\\n- Safety net advice:"}]},{"id":"repeat-meds","enabled":true,"label":"Repeat meds","kind":"info","patterns":["repeat prescription","repeat medication","repeat script","repeat meds","ran out","run out of","running out","out of my (?!mind|depth|comfort|control|league|way|system|element|own|head|life|hands|hair|sight|reach|price|budget)\\\\w+","reorder","re-order","refill","top.?up","more of my","need more of my","need my tablets","need my inhaler","need my medication","need a prescription","need my prescription","prescription request","order my medication","order my meds","medication review"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"snippet","label":"SMR template","text":"Structured Medication Review (SMR):\\n\\nPatient understanding:\\n- Knows why each med is prescribed:\\n- Adherence / compliance:\\n- Side effects experienced:\\n- Self-monitoring (BP, BG, peak flow):\\n\\nFor each medication:\\n- Indication still valid?\\n- Dose appropriate (renal/hepatic adjustment)?\\n- Duplications / interactions / cascades?\\n- Anticholinergic burden / falls risk?\\n- Recent monitoring done?\\n\\nDeprescribe candidates:\\n- PPI > 8 weeks without indication\\n- Long-term benzo / Z-drug\\n- Statin in extreme frailty / limited life expectancy\\n- Anti-hypertensives if postural hypotension\\n- Aspirin without clear secondary prevention indication\\n\\nAgreed plan:"}]},{"id":"fit-note","enabled":true,"label":"Fit note","kind":"info","patterns":["fit note","fitnote","sick note","sicknote","med[- ]?3","fitness for work","off work","note for work","doctors note","doctor's note","statement of fitness","unfit for work","time off work","signed off","sign me off","sick certificate"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"link","label":"GOV.UK Med3 guidance","url":"https://www.gov.uk/government/publications/fit-note-guidance-for-healthcare-professionals"},{"type":"snippet","label":"Fit note template","text":"Med3 considerations:\\n\\n- Diagnosis (the condition affecting work):\\n- Functional limitations (what can / can't do):\\n- Duration: <3mo (any duration) / >3mo (max 3mo):\\n- 'Not fit' or 'May be fit' (consider phased return / amended duties / altered hours / workplace adaptations):\\n- Assessment date and end date:\\n- Comments / advice to employer:\\n\\nFor mental health:\\n- Avoid jargon \\u2014 concrete functional language\\n- Consider OH referral / IAPT signposting\\n\\nFor MSK:\\n- Active management plan\\n- Avoid bed rest > 1-2 days"}]},{"id":"menopause","enabled":true,"label":"Menopause/HRT","kind":"info","patterns":["menopaus","menopausal","perimenopaus","peri-menopausal","hot flush","hot flushes","hot flash","hot flashes","night sweat","HRT","hormone replacement","hormone replacement therapy","HRT patch","oestrogen","estrogen","oestrogen gel","vaginal dryness","Evorel","Oestrogel","Sandrena","Utrogestan","Elleste","Femoston","Tibolone","patches for menopause"],"regex":false,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"link","label":"NICE menopause (NG23)","url":"https://www.nice.org.uk/guidance/ng23"},{"type":"link","label":"British Menopause Society","url":"https://thebms.org.uk/"},{"type":"snippet","label":"HRT consultation","text":"Menopause / HRT consultation:\\n\\nSymptoms:\\n- Vasomotor (flushes, sweats, night sweats):\\n- Mood, sleep, cognition:\\n- GU: vaginal dryness, dyspareunia, urinary:\\n- Joint / muscle pain:\\n- Libido:\\n- Functional impact:\\n\\nHistory:\\n- LMP / cycle changes:\\n- Contraception still needed?\\n- Migraine with aura?\\n- VTE / clotting history (personal / family):\\n- Breast / endometrial / ovarian cancer history:\\n- BMI / smoking / alcohol:\\n- Cardiovascular risk:\\n- Liver disease:\\n- Current meds:\\n\\nDiscussion:\\n- Risk / benefit balance\\n- Options: sequential vs continuous combined; oestrogen-only if hysterectomy; transdermal preferred if VTE / migraine / hepatic / >60\\n- Vaginal oestrogen for GU symptoms (no extra systemic risk)\\n- Testosterone for low libido (off-label)\\n- Lifestyle, CBT for vasomotor\\n\\nPlan / review timeframe:"}]},{"id":"stroke-tia","enabled":true,"label":"Stroke/TIA","kind":"red","patterns":["face (is |was |has been |keeps )?droop\\\\w*","facial droop\\\\w*","drooping face","one side of (my )?face (is )?(numb|droop\\\\w*|drop\\\\w*|sag\\\\w*|weak)","mouth (is )?droop\\\\w*","smile (is|has gone) (lopsided|uneven|crooked)","can.?t smile","arm (drift|has gone (numb|weak|dead))","one arm (numb\\\\w*|weak\\\\w*|won.?t move|gone)","can.?t (lift|feel|move) (my )?arm","sudden (arm|leg|face) (weakness|numbness)","slurr\\\\w* (speech|words)","speech (is )?(slurred|unclear|jumbled|muddled)","can.?t (speak|get my words out)","sudden\\\\w* difficulty (speaking|talking)","stroke","TIA","transient ischaemic attack","mini.?stroke","funny turn (down|on) one side","went (numb|weak) down one side","sudden (loss of )?vision in one eye","can.?t (get (my )?words out|speak properly)","(lost|losing) (the ability|my ability) to (speak|talk)","both (my )?arms? (have )?(suddenly )?(gone )?(weak|numb|heavy)"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"FAST pathway","text":"Suspected stroke (FAST: Face droop / Arm weakness / Speech / Time) with symptoms NOW or within hours \\u2192 999. Thrombolysis & thrombectomy are time-critical.\\n\\nResolved deficit (?TIA): high early stroke risk \\u2014 aspirin 300mg (unless contraindicated) + specialist TIA-clinic assessment within 24h (NICE NG128). Do NOT \\u201cwait and see\\u201d.\\n\\nMimics (hypo, migraine aura, Bell\\u2019s palsy) \\u2014 treat as stroke until assessed."},{"type":"link","label":"NICE NG128 (stroke & TIA)","url":"https://www.nice.org.uk/guidance/ng128"}]},{"id":"sepsis","enabled":true,"label":"Sepsis?","kind":"red","patterns":["sepsis","septic\\\\w*","(septicaemi|septicemi)\\\\w*","fever (and|with) (confus\\\\w*|drowsy|drowsiness|delirious|hard to wake|can.?t stay awake|unresponsive)","fever (and|with) (mottled|blotchy|grey|pale) skin","mottled skin","high (fever|temperature) (and|with) (rigors|violent shaking|uncontrollable shaking)","shaking (uncontrollably|violently) with (a )?(fever|temperature)","rigors","fever (and|with) (very fast|racing|pounding) (heart|pulse)","fever (and|with) (fast|rapid) breathing","fever (and|with) (not passing|no) urine","flu.?like (and|with) (collaps\\\\w*|can.?t get up|can.?t stand)","felt (the )?worst (i.?ve|i have) ever (felt|been) (and|with) (fever|temperature)","non.?blanching rash","(fever|temperature|burning up) (and|with) feel\\\\w* (absolutely )?(terrible|dreadful|awful)","(hot and cold|cold and hot) (sweats|shivers|all over)","(shaking|shivering) uncontrollably"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"Sepsis screen","text":"Could this be sepsis? (NICE NG51 risk stratification.)\\n\\nHigh-risk features \\u2192 999 / immediate F2F:\\n\\u2022 New altered mental state / hard to rouse\\n\\u2022 Mottled, ashen or cyanosed skin; non-blanching rash\\n\\u2022 RR \\u226525, new O\\u2082 requirement\\n\\u2022 HR \\u2265130, SBP \\u226490\\n\\u2022 Not passed urine in 18h\\n\\u2022 Rigors / uncontrollable shaking with fever\\n\\nRemember NEUTROPENIC sepsis: chemotherapy in last 6 weeks + fever = emergency admission, no delays."},{"type":"link","label":"NICE NG51 (sepsis)","url":"https://www.nice.org.uk/guidance/ng51"}]},{"id":"anaphylaxis","enabled":true,"label":"Anaphylaxis?","kind":"red","patterns":["anaphyla\\\\w*","severe allergic reaction","allergic (reaction )?(getting|got) (worse|much worse) (quickly|fast)","(swelling|swollen) (of (my )?)?(throat|tongue|lips|mouth|face)","throat (is )?(closing|tight\\\\w*|swelling)","(can.?t|hard to|struggling to) (breathe|swallow) (after|since) (eating|the sting|the injection|antibiotic\\\\w*|penicillin)","stridor","wheez\\\\w* (after eating|after the sting|with swelling)","hives (and|with) (swelling|breathing|face|throat)","widespread (hives|urticaria|welts) (and|with) (swelling|breathing|face)","lips (have )?(swollen|swelled) up","face (has )?(swollen|puffed) up (suddenly|fast|quickly)","went (pale|clammy|floppy) after (eating|the sting|injection)","reaction (after|to) (a |the )?(bee|wasp) sting","reaction (after|to) (eating )?(nuts|peanut\\\\w*|shellfish)"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"Anaphylaxis pathway","text":"Airway/breathing/circulation involvement with an allergic trigger = anaphylaxis.\\n\\n\\u2022 999 immediately\\n\\u2022 IM adrenaline 1:1000, 500 micrograms (adult) anterolateral thigh; repeat after 5 min if no improvement\\n\\u2022 Lie flat, raise legs (sit up only if breathing difficulty); do NOT stand the patient up\\n\\u2022 After emergency treatment: ensure 2 adrenaline auto-injectors carried + specialist allergy-clinic referral\\n\\nRash/itch alone without airway, breathing or circulation features is not anaphylaxis \\u2014 antihistamine + safety-net."},{"type":"link","label":"Resus Council UK anaphylaxis","url":"https://www.resus.org.uk/library/additional-guidance/guidance-anaphylaxis"}]},{"id":"meningitis","enabled":true,"label":"Meningitis?","kind":"red","patterns":["meningitis","meningococ\\\\w*","non.?blanch\\\\w* rash","rash (that )?(doesn.?t|does not|won.?t|will not) (fade|blanch|go) (when |if )?(pressed|i press|under (a |the )?glass)","glass test","tumbler test","petechia\\\\w*","petechial rash","purple (spots|rash|blotches)","spots that (don.?t|won.?t) fade","fever (and|with) (neck stiffness|stiff neck)","(stiff neck|neck stiffness) (and|with) (fever|rash|headache|light)","can.?t (bend|move) (my )?neck forward","fever (and|with) (photophobia|light hurt\\\\w*|bright light)","light (hurts|is hurting) (my )?eyes","severe headache (and|with) (fever|neck stiffness|rash|vomiting)","fever (and|with) (rash|confus\\\\w*|drowsy|very sleepy)","bruis\\\\w*.?like rash (with|and) fever","(fever|temperature) (and|with) (a )?(purple|non.?blanching|blotchy) (rash|spots)","(rash|spots) (that )?(doesn.?t|don.?t|won.?t) (fade|go away|disappear) (under|with) (a )?glass"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"Meningitis / meningococcal","text":"Fever + any of: non-blanching/petechial rash, neck stiffness, photophobia, new confusion or drowsiness \\u2192 999 (NICE NG240, 2024).\\n\\n\\u2022 Non-blanching rash + fever = meningococcal sepsis until proven otherwise (may occur WITHOUT meningitis)\\n\\u2022 Give IM/IV benzylpenicillin (or ceftriaxone) pre-hospital ONLY if transfer will be delayed \\u2014 never delay transfer to give it\\n\\u2022 Glass/tumbler test is the patient-facing check for blanching"},{"type":"link","label":"NICE NG240 (meningitis & meningococcal)","url":"https://www.nice.org.uk/guidance/ng240"}]},{"id":"aaa","enabled":true,"label":"AAA/dissection?","kind":"red","patterns":["aortic aneurysm","AAA","aortic dissection","sudden (severe )?tearing (pain )?(in (my )?)?(back|tummy|abdomen|chest)","tearing (sensation|pain) (in (my )?)?(back|abdomen|chest)","(ripping|tearing|splitting) pain (in (my )?)?(back|abdomen|chest)","felt (something|a) (tear|rip) (inside|in my (back|tummy|chest))","sudden severe (back|abdominal|tummy) pain (and|with) (faint\\\\w*|collaps\\\\w*|pale|sweat\\\\w*|clammy|dizzy)","(back|abdominal) pain (radiating|going|spreading) (down|into) (both )?(legs|groin)","pulsating (lump|mass) in (my )?(tummy|abdomen|belly)"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"Vascular emergency","text":"Sudden tearing/ripping back, abdominal or chest pain \\u00b1 collapse, pallor, sweating, or a pulsatile abdominal mass = ruptured AAA / aortic dissection until proven otherwise.\\n\\n\\u2022 999 \\u2014 do not bring to surgery for assessment\\n\\u2022 Highest suspicion: older men, smokers, hypertension, known aneurysm/FH\\n\\u2022 Mimics renal colic in the elderly \\u2014 first presentation of \\u201crenal colic\\u201d over 60 should raise AAA"}]},{"id":"testicular-torsion","enabled":true,"label":"Testicular torsion?","kind":"red","patterns":["testicular torsion","torsion of (the )?(testicle|testis)","sudden (severe )?pain in (my )?(testicle|testis|ball|balls|scrotum)","(testicle|testis|ball|scrotum) (pain|swelling) (came on )?(suddenly|out of nowhere)","(severe|sudden|acute|unbearable) (testicular|scrotal) pain","woke up with (testicular|scrotal|groin) pain","(testicle|testis) (is )?(swollen|riding high|hard|tender) (and |with )?(pain|painful|vomiting|sick)","sudden severe groin pain (and|with) (swelling|vomiting|nausea)","boy (with|has) (testicular|scrotal|groin) pain"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"Surgical emergency","text":"Sudden severe unilateral testicular pain \\u00b1 nausea/vomiting = torsion until proven otherwise \\u2014 the salvage window is ~6 hours.\\n\\n\\u2022 Same-day urology / ED NOW \\u2014 do not arrange routine review or wait for swelling to settle\\n\\u2022 Most common 12\\u201325y but any age\\n\\u2022 Do not rely on ultrasound availability to decide \\u2014 clinical suspicion is enough for referral"},{"type":"link","label":"NICE CKS scrotal pain & swelling","url":"https://cks.nice.org.uk/topics/scrotal-pain-swelling/"}]},{"id":"pe-dvt","enabled":true,"label":"PE/DVT?","kind":"red","patterns":["pulmonary embolism","PE","DVT","deep vein thrombosis","blood clot in (my )?(leg|lung\\\\w*|calf)","one (leg|calf) (swollen|bigger|hot|red|hard)","(calf|leg) (swelling|swollen) (and|with) (pain|hot|red|warm|hard|tender)","(calf|leg) (pain|tender\\\\w*) (and|with) (swelling|swollen|hot|red|warm)","sudden(ly)? (short of breath|breathless\\\\w*|out of breath)","pleuritic chest pain","chest pain (when|worse) (i )?breath\\\\w* in","pain (when|on) breathing in (and|with) (breathless\\\\w*|leg)","breathless\\\\w* (and|with) (leg (swelling|pain)|chest pain)","(recent|after) (surgery|operation|long flight|long.?haul) (and|with) (leg (swelling|pain)|breathless\\\\w*)","(leg|foot|arm|hand) (gone|turned|is) (cold|white|pale|mottled|blue) (and |with )?(numb|painful|can.?t move)","no pulse in (my )?(leg|foot|arm)"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"VTE / limb-ischaemia pathway","text":"Suspected PE: acute breathlessness \\u00b1 pleuritic pain \\u00b1 haemoptysis. Haemodynamic compromise or hypoxia \\u2192 999; otherwise same-day assessment (Wells \\u2192 D-dimer / CTPA) per NICE NG158.\\n\\nSuspected DVT: unilateral leg swelling/heat/tenderness \\u2192 same-day Wells scoring + proximal leg ultrasound pathway. Do not massage the leg.\\n\\nCOLD, PALE, PULSELESS limb (6 P\\u2019s) = acute limb ischaemia \\u2192 999 / vascular surgery \\u2014 hours matter."},{"type":"snippet","label":"Wells score (DVT)","text":"Wells DVT (1 point each unless stated):\\n- Active cancer:\\n- Paralysis / recent plaster immobilisation:\\n- Bed >3d or major surgery <12wk:\\n- Tenderness along deep venous system:\\n- Entire leg swollen:\\n- Calf >3cm larger than other side:\\n- Pitting oedema (symptomatic leg):\\n- Collateral superficial veins:\\n- Previous DVT:\\n- Alternative diagnosis at least as likely: -2\\n\\n\\u22652 DVT likely \\u2192 USS within 4h (or anticoagulate + USS within 24h)\\n\\u22641 DVT unlikely \\u2192 D-dimer"},{"type":"link","label":"NICE NG158 (VTE diagnosis)","url":"https://www.nice.org.uk/guidance/ng158"}]},{"id":"acute-severe-abdomen","enabled":true,"label":"Acute abdomen?","kind":"red","patterns":["rigid (abdomen|tummy|belly)","board.?like (abdomen|tummy|belly)","(abdomen|tummy|belly) (is )?(rigid|hard as a board)","worst (ever|of my life) (stomach|tummy|belly|abdominal) pain","excruciating (abdominal|tummy|belly|stomach) pain","(can.?t|won.?t) (move|straighten up) (because of|with) (the )?(tummy|stomach|abdominal) pain","peritonitis","perforat\\\\w* (bowel|ulcer|appendix|stomach)","(acute )?pancreatitis","severe (epigastric|upper (tummy|abdominal)) pain (radiating|going) (through|to) (my )?back","appendicitis","sudden severe (tummy|abdominal|belly) pain (and|with) (vomiting|fever|can.?t move)","guarding (and|with) rebound"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"Surgical abdomen","text":"Peritonitic features (rigid/board-like abdomen, rebound, guarding, pain on movement/coughing, lying still) \\u2192 same-day surgical assessment / 999 if shocked.\\n\\nConsider: perforation, pancreatitis, ischaemic bowel (pain out of proportion), appendicitis, ruptured ectopic.\\n\\nWomen of reproductive age with acute lower abdominal pain: ALWAYS pregnancy test (?ectopic)."}]},{"id":"fever-infant","enabled":true,"label":"Fever <3m","kind":"red","patterns":["(baby|newborn|infant) (has|with|has got|running) (a |high )?(fever|temperature)","(baby|newborn|infant) (is )?(burning up|really hot|very hot|boiling)","(baby|newborn)(.?s)? temperature (of |is )?(3[8-9]|4\\\\d|over 38)","temperature (won.?t|will not) come down","under (3|three) months (old )?(and|with) (a )?(fever|temperature|hot)","\\\\d+ (week|month) old (with|and|has) (a )?(fever|temperature)","newborn (is |feels )?(hot|feverish)","(baby|infant) (fever|temperature) (and|with) (not feeding|poor feeding|floppy|drowsy|lethargic)"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"NICE traffic light","text":"Temperature \\u226538\\u00b0C in an infant UNDER 3 MONTHS is a RED traffic-light feature (NICE NG143) \\u2192 same-day paediatric assessment (usually ED), regardless of how well the baby looks.\\n\\n3\\u20136 months \\u226539\\u00b0C = amber minimum.\\n\\nAny age + fever with: drowsy/floppy, poor feeding, non-blanching rash, grunting/recession, reduced wet nappies \\u2192 escalate same-day."},{"type":"link","label":"NICE NG143 (fever under 5s)","url":"https://www.nice.org.uk/guidance/ng143"}]},{"id":"resp-distress-child","enabled":true,"label":"Child breathing difficulty","kind":"red","patterns":["(drawing|sucking) (breath )?in (funny|hard)","(ribs|tummy|chest) (are |is |keep |keeps )?(going|sucking|pulling) in (when|as|with) (he |she |they |baby |every )?breath\\\\w*","recession (when|while) breathing","retractions","(nostrils|nose) flaring","grunting (when |while )?breath\\\\w*","baby (is )?grunting","stridor\\\\w*","(barky|barking|seal.?like) cough","croup","bronchiolitis","(blue|grey|dusky) (lips|face|tongue|around (the |his |her )?mouth)","cyanos\\\\w*","breathing (really|very) (fast|hard|quickly)","(can.?t|struggling to) (catch (his|her|their) breath|breathe at all|breathe properly)","working (really )?hard to breathe"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"Paediatric respiratory distress","text":"Signs of increased work of breathing in a child \\u2014 recession (ribs/tummy sucking in), grunting, nasal flaring, stridor at rest, cyanosis/blue lips, too breathless to feed or talk \\u2192 same-day assessment; 999 if stridor at rest, cyanosis, exhaustion or drowsiness.\\n\\nCroup: barky cough + stridor \\u2014 oral dexamethasone if more than mild.\\nBronchiolitis (<2y): escalate if feeding <50% of normal, apnoeas, marked recession, sats concern."},{"type":"link","label":"NICE NG143 (fever under 5s)","url":"https://www.nice.org.uk/guidance/ng143"}]},{"id":"seizure","enabled":true,"label":"Seizure","kind":"red","patterns":["febrile (convulsion|seizure)\\\\w*","(had|having) a (fit|seizure|convulsion)","(fit|seizure|convulsion) (with|during|from) (a )?(fever|temperature)","first (ever )?(fit|seizure|convulsion)","(shaking|jerking) (uncontrollably|all over) (with|and) (fever|temperature|eyes rolled)","eyes (rolled|rolling) back (and|with) (shaking|jerking|stiff)","(fitting|seizing|convulsing) (now|for|lasting) (\\\\d+ )?(minutes|seconds)","tonic.?clonic","limbs (jerking|stiffened|went stiff)","won.?t (come round|wake up) after (a |the )?(fit|seizure)","seizure","convulsion\\\\w*"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"Seizure pathway","text":"\\u2022 Seizure ongoing >5 min, repeated seizures, or not recovering consciousness \\u2192 999 (status epilepticus)\\n\\u2022 FIRST-ever seizure (any age) \\u2192 same-day assessment + urgent first-fit clinic referral; advise not to drive (DVLA)\\n\\u2022 Febrile convulsion (6m\\u20135y): usually benign if simple (<15 min, generalised, full recovery) but first episode warrants same-day review and exclusion of meningitis/serious infection\\n\\u2022 Known epilepsy with typical self-terminated seizure \\u2192 prompt review, check triggers/adherence"},{"type":"link","label":"NICE CKS febrile seizure","url":"https://cks.nice.org.uk/topics/febrile-seizure/"}]},{"id":"ectopic-miscarriage","enabled":true,"label":"Pregnancy bleeding/pain","kind":"red","patterns":["ectopic( pregnancy)?","miscarr\\\\w*","(pregnan\\\\w*|expecting) (and|with) (bleed\\\\w*|spotting|blood|cramp\\\\w*|pain)","bleed\\\\w* (and|while|when) (pregnan\\\\w*|expecting)","(spotting|bleeding|blood) in (early )?pregnancy","(pregnan\\\\w*|expecting) (and|with) (one.?sided|shoulder.?tip|shoulder) pain","(severe|bad) (cramp\\\\w*|period.?like pain|tummy pain) (and|while) pregnan\\\\w*","losing (the |my )?(baby|pregnancy)","positive (pregnancy )?test (and|with) (bleed\\\\w*|pain|cramp\\\\w*)","collaps\\\\w* (and|while|when) pregnan\\\\w*"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"Early pregnancy pathway","text":"Pain and/or bleeding in (possible) pregnancy \\u2192 same-day Early Pregnancy Unit assessment.\\n\\n\\u2022 Ectopic can present with PAIN BEFORE any bleeding \\u2014 one-sided pain, shoulder-tip pain, dizziness/collapse in early pregnancy = ruptured ectopic until proven otherwise \\u2192 999\\n\\u2022 Always pregnancy-test women of reproductive age with abdominal pain\\n\\u2022 Anti-D consideration for surgical management of miscarriage"},{"type":"link","label":"NICE NG126 (ectopic & miscarriage)","url":"https://www.nice.org.uk/guidance/ng126"}]},{"id":"reduced-fetal-movements","enabled":true,"label":"Reduced fetal movements","kind":"red","patterns":["baby (not|isn.?t|stopped) (moving|kicking)( as much| much| at all)?","baby (is )?(quieter|less active|still|not as active)( than usual)?","(fewer|less|reduced|decreased) (baby |fetal |foetal )?(movements|kicks)","(no|hardly any|barely any) (kicks|movements)","(haven.?t|not) felt (the )?baby (move|kick)","movements (have )?(slowed (down|right down)|reduced|dropped off|stopped)","(worried|concerned) (baby|movements) (not moving|reduced|quiet)","not as much movement"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"RFM pathway (RCOG GTG57)","text":"Any maternal perception of reduced fetal movements (after ~24 weeks) \\u2192 signpost DIRECTLY to maternity triage / day assessment unit NOW for CTG \\u00b1 ultrasound.\\n\\n\\u2022 Do NOT book a GP appointment or advise \\u201cwait and count kicks\\u201d\\n\\u2022 Never reassure by phone without fetal assessment\\n\\u2022 Repeat episodes still warrant assessment every time"},{"type":"link","label":"RCOG GTG57 (reduced fetal movements)","url":"https://www.rcog.org.uk/guidance/browse-all-guidance/green-top-guidelines/reduced-fetal-movements-green-top-guideline-no-57/"}]},{"id":"pre-eclampsia","enabled":true,"label":"Pre-eclampsia?","kind":"red","patterns":["pre.?eclampsia","(pregnan\\\\w*|expecting) (and|with) (a |really |very )?(severe|bad|terrible|awful|pounding) headache","(severe|bad) headache (and|while|when) pregnan\\\\w*","(blurred|blurry) vision (and|while|when) pregnan\\\\w*","(seeing )?(flashing lights|spots|stars) (and|while|when) pregnan\\\\w*","(pregnan\\\\w*|expecting) (and|with) (visual|vision) (changes|disturbance)","(pain|hurting) (under|below) (my )?ribs (and|while|when) pregnan\\\\w*","(upper (tummy|abdominal)|epigastric) pain (and|while|when) pregnan\\\\w*","(sudden|severe) swelling (of (my )?)?(face|hands) (and|while|when) pregnan\\\\w*","(pregnan\\\\w*|expecting) (and|with) (headache (and|with) (vision|swelling)|swelling (and|with) headache)"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"Pre-eclampsia pathway","text":"Pregnancy (especially >20 weeks) + severe/persistent headache, visual disturbance, epigastric/RUQ pain, or sudden swelling of face/hands \\u2192 same-day maternity assessment for BP + urine protein.\\n\\n\\u2022 Can progress rapidly to eclampsia/HELLP\\n\\u2022 Seizure, severe hypertension or reduced consciousness \\u2192 999\\n\\u2022 Direct to maternity triage, not a routine GP slot"},{"type":"link","label":"NICE NG133 (hypertension in pregnancy)","url":"https://www.nice.org.uk/guidance/ng133"}]},{"id":"sudden-vision-loss","enabled":true,"label":"Sudden visual loss","kind":"red","patterns":["sudden (loss of )?(vision|sight)","(lost|losing) (my )?(vision|sight) (suddenly|in one eye|in my (left|right) eye)","curtain (coming|coming down|over) (my |one )?(eye|vision)","(shadow|curtain) (across|over) (my )?vision","new floaters","(shower of|sudden|lots of new) (floaters|flashes|flashing lights)","(flashes|flashing lights) (and|with) (new )?floaters","cobwebs (in|across) (my )?vision","sudden (blurred|blurry) vision in one eye","(giant cell arteritis|GCA)","(temporal|scalp) (pain|tenderness) (and|with) (jaw|vision|headache)","jaw (pain|ache\\\\w*|claudication) (when|while|on) (chewing|eating)","amaurosis","retinal detach\\\\w*","black (spot|patch) (in|across) (my )?vision"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"Sight-threatening pathway","text":"\\u2022 Sudden painless loss of vision in one eye \\u2192 same-day emergency ophthalmology (?CRAO/CRVO/retinal detachment/vitreous haemorrhage)\\n\\u2022 Curtain/shadow over vision, or flashes + NEW floaters \\u2192 same-day (?retinal detachment/tear)\\n\\u2022 GCA: age >50 + new headache, scalp tenderness, jaw claudication \\u00b1 visual symptoms \\u2192 SAME-DAY high-dose steroid + urgent ophthalmology/rheumatology + ESR/CRP \\u2014 the second eye is at risk\\n\\u2022 Painful red eye + visual loss \\u2192 ?acute angle-closure \\u2192 emergency"},{"type":"link","label":"NICE CKS giant cell arteritis","url":"https://cks.nice.org.uk/topics/giant-cell-arteritis/"}]},{"id":"septic-arthritis","enabled":true,"label":"Hot swollen joint","kind":"red","patterns":["(hot|red.?hot) (and )?swollen joint","(swollen|huge) (and |very )?(hot|red) (knee|hip|shoulder|elbow|wrist|ankle|joint)","(knee|hip|shoulder|ankle|wrist|elbow|joint) (is )?(red.?hot|red and (hot|swollen)|hot and swollen)","joint (swelled|swelled up|swollen) (overnight|suddenly|very quickly)","(can.?t|unable to) (move|bend|weight bear on) (my )?(knee|hip|shoulder|joint) (and|with) (hot|swollen|red|fever)","acutely (swollen|hot|painful) joint","(hot|swollen) joint (and|with) (fever|feeling unwell|temperature)","septic arthritis"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"Septic arthritis pathway","text":"An acutely hot, swollen, very painful joint (especially single joint \\u00b1 fever) = septic arthritis until proven otherwise.\\n\\n\\u2022 Same-day orthopaedics / ED for joint aspiration BEFORE antibiotics\\n\\u2022 An untreated septic joint is destroyed within days\\n\\u2022 Prosthetic joint, immunosuppression, recent injection = even lower threshold\\n\\u2022 Do not assume gout if febrile or systemically unwell"}]},{"id":"psychosis","enabled":true,"label":"Psychosis?","kind":"red","patterns":["hearing voices","voices (in my head|telling me|commenting)","(seeing|hearing) (things|stuff) (that aren.?t|not) (there|real)","hallucinat\\\\w*","visual hallucination\\\\w*","delusion\\\\w*","(psychosis|psychotic)","first episode psychosis","(people|they|the government|neighbours) (are )?(out to get|spying on|poisoning|watching) me","thoughts (being )?(put|inserted) (in|into) my (head|mind)","my (mind|thoughts) (are )?being controlled","paranoid (and|with) (voices|hallucinat\\\\w*|not safe|they.?re after me)"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":"safeguarding","builtin":true,"actions":[{"type":"note","label":"First-episode psychosis","text":"Hallucinations, delusions, thought disorder or marked paranoia \\u2192 urgent referral to Early Intervention in Psychosis (EIP) \\u2014 NICE: assessment started within 2 weeks; same-day crisis-team input if risk.\\n\\n\\u2022 Command hallucinations / risk to self or others \\u2192 crisis pathway now\\n\\u2022 Exclude organic causes (delirium, substances) \\u2014 acute confusion in the elderly is delirium, not psychosis\\n\\u2022 POSTPARTUM PSYCHOSIS = psychiatric emergency \\u2192 same-day perinatal MH / crisis team"},{"type":"link","label":"NICE CKS psychosis","url":"https://cks.nice.org.uk/topics/psychosis-schizophrenia/"}]},{"id":"haematuria-2ww","enabled":true,"label":"Blood in urine","kind":"amber","patterns":["blood in (my )?(urine|wee|pee)","blood when (i )?(wee|pee|pass (water|urine))","ha?ematuria\\\\w*","(red|pink|cola.?colou?red|rusty) (urine|wee|pee)","(urine|wee|pee) (is|looks|has gone) (red|pink|bloody|like blood)","passing (blood|red water|bloody (water|urine))","visible blood (in|when passing) (urine|wee|pee)","bleeding when (i )?(wee|pee|urinat\\\\w*)","blood clots in (my )?(urine|wee)"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"2WW pathway","text":"NICE NG12: visible haematuria aged \\u226545 (unexplained, or persisting/recurring after UTI treatment) \\u2192 2WW urology. Aged \\u226560 with unexplained non-visible haematuria + dysuria or raised WCC \\u2192 2WW.\\n\\nUnder the age cutoffs: still assess (UTI, stones, anticoagulants) and safety-net \\u2014 haematuria is never normal.\\n\\nExclude/treat UTI but do not let an infection label close the loop without confirming resolution."},{"type":"link","label":"NICE NG12 urological cancers","url":"https://www.nice.org.uk/guidance/ng12/chapter/Recommendations-organised-by-site-of-cancer#urological-cancers"}]},{"id":"postmenopausal-bleeding","enabled":true,"label":"Post-menopausal bleeding","kind":"amber","patterns":["post.?menopausal bleed\\\\w*","bleeding (after|since) (the |my )?menopause","(vaginal )?bleed\\\\w* (after|since) (my )?periods (stopped|ended|finished)","spotting (after|since) (the )?menopause","(haven.?t|not) had a period (for|in) (\\\\w+ )?(years|months) (and|but) (now )?(i.?m |i am )?(bleed\\\\w*|spotting|blood)","brown discharge (after|since) menopause","bleeding (and|but) (i.?m|i am) post.?menopausal"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"2WW pathway","text":"NICE NG12: post-menopausal bleeding (\\u226512 months after last period) in women \\u226555 \\u2192 2WW gynaecology (transvaginal USS endometrial assessment); strongly consider for younger post-menopausal women too.\\n\\n\\u2022 Includes spotting, staining and blood-streaked discharge\\n\\u2022 HRT breakthrough bleeding still needs assessment if unscheduled/persistent"},{"type":"link","label":"NICE NG12 gynaecological cancers","url":"https://www.nice.org.uk/guidance/ng12/chapter/Recommendations-organised-by-site-of-cancer#gynaecological-cancers"}]},{"id":"breast-changes-2ww","enabled":true,"label":"Breast lump/change","kind":"amber","patterns":["(lump|hard lump|thickening) (in|on) (my )?(breast|boob|boobs)","breast lump\\\\w*","boob lump\\\\w*","one breast (bigger|larger|different|changed)","breast (has |is )?(changed|dimpl\\\\w*|pucker\\\\w*)","(skin )?(dimpl\\\\w*|pucker\\\\w*|orange.?peel) (on|in) (my )?(breast|boob)","nipple (discharge|bleed\\\\w*|inver\\\\w*|retract\\\\w*|pulled in)","(scaly|crusty|eczema|rash) (on )?(my )?(nipple|areola)","inverted nipple"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"2WW pathway","text":"NICE NG12 breast referral:\\n\\u2022 Aged \\u226530 with an unexplained breast lump \\u2192 2WW\\n\\u2022 Aged \\u226550 with nipple discharge, retraction or other concerning unilateral nipple change \\u2192 2WW\\n\\u2022 Skin changes suggestive of cancer (dimpling, peau d\\u2019orange, nipple eczema) or axillary lump \\u2192 refer\\n\\u2022 Under 30 with a lump: non-urgent referral/assessment, lower threshold if FH\\n\\nIf the story is feeding-related (mastitis), treat \\u2014 but a lump persisting after mastitis resolves needs 2WW."},{"type":"link","label":"NICE NG12 breast cancer","url":"https://www.nice.org.uk/guidance/ng12/chapter/Recommendations-organised-by-site-of-cancer#breast-cancer"}]},{"id":"dysphagia-2ww","enabled":true,"label":"Swallowing difficulty","kind":"amber","patterns":["food (gets |is |keeps |keeps getting |getting )?(sticking|stuck) (in (my )?)?(throat|chest|food pipe|gullet|oesophagus)","something stuck (in my throat|when i swallow)","difficulty swallowing (food|solids|getting worse|for weeks)","swallowing (is )?(getting (worse|harder)|harder)","can.?t swallow (food|solids|properly)","food (won.?t |doesn.?t )?go down","odynophagia","dysphagia\\\\w*","hoarse\\\\w* (for|lasting|more than) (\\\\d+ )?(week|month)\\\\w*","(persistent|chronic) hoarse\\\\w*","voice (has been )?(hoarse|rough|gone) for (weeks|ages|a month)"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"2WW pathway","text":"NICE NG12:\\n\\u2022 Dysphagia (food sticking, progressive difficulty swallowing) at ANY age \\u2192 2WW upper-GI endoscopy\\n\\u2022 Persistent hoarseness >3 weeks (especially >45y or smoker) \\u2192 2WW ENT + consider CXR\\n\\nAcute painful swallow with sore throat/tonsillitis is different \\u2014 see sore-throat rule. Difficulty swallowing SALIVA / drooling \\u2192 same-day (?epiglottitis/quinsy)."},{"type":"link","label":"NICE NG12 upper GI cancers","url":"https://www.nice.org.uk/guidance/ng12/chapter/Recommendations-organised-by-site-of-cancer#upper-gastrointestinal-tract-cancers"}]},{"id":"dka-hhs","enabled":true,"label":"DKA / HHS","kind":"red","patterns":["diabetic ketoacidosis","DKA","HHS","hyperosmolar","ketones (high|raised|in my (blood|urine|wee))","fruity (smelling )?breath","acetone breath","diabetes (and|with) (vomiting|can.?t keep (fluids|anything) down|confus\\\\w*)","(high|raised) ketones (and|with) (vomiting|unwell|drowsy|breathless)"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"Diabetic emergency","text":"Suspected DKA or HHS \\u2192 same-day / 999.\\n\\n\\u2022 DKA (type 1): vomiting, abdominal pain, raised ketones, deep/fast (Kussmaul) breathing, fruity breath, drowsiness\\n\\u2022 HHS (elderly type 2): very high glucose + marked dehydration + confusion, usually without significant ketones\\n\\nAction:\\n\\u2022 Check capillary glucose AND ketones now if able\\n\\u2022 Capillary ketones \\u22653.0 mmol/L (or urine ketones ++), or vomiting and unable to keep fluids down \\u2192 emergency admission\\n\\u2022 NEVER omit insulin - arrange immediate transfer"}]},{"id":"diabetes","enabled":true,"label":"Diabetes problem","kind":"amber","patterns":["(hyperglycaemi|hyperglycemi)\\\\w*","(hypoglycaemi|hypoglycemi)\\\\w*","hypo","blood sugars? (too high|very high|sky high|dangerously high|too low|very low|in the \\\\d+s)","blood sugars? (won.?t come down|keep dropping|all over the place)","(keep having|frequent|lots of) hypos","sick day rules","insulin (not working|isn.?t working|won.?t bring (it|sugars) down)","diabetes (out of control|not controlled|poorly controlled)"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"Escalation thresholds","text":"RED FLAGS \\u2192 same-day / 999:\\n\\u2022 ?DKA (esp. type 1): vomiting, abdominal pain, ketones, deep/fast breathing, fruity breath, drowsiness\\n\\u2022 ?HHS (esp. elderly type 2): very high glucose + dehydration + confusion\\n\\u2022 Severe hypo (needed help / unconscious / seizure) \\u2192 999; IM glucagon if available\\n\\u2022 Vomiting and cannot keep fluids down \\u2192 same-day\\n\\nSick-day rules: NEVER stop insulin; check glucose & ketones 2\\u20134-hourly; keep drinking; ketones rising or persistent vomiting \\u2192 urgent review.\\n\\nRoutine \\u201csugars running high\\u201d without red flags \\u2192 prompt clinical review/titration, not emergency."},{"type":"link","label":"NICE CKS diabetes","url":"https://cks.nice.org.uk/topics/diabetes-type-2/"}]},{"id":"dehydration-child","enabled":true,"label":"Child dehydration?","kind":"amber","patterns":["(no|hasn.?t had a|dry) (wet )?nappy (for|in) (\\\\d+ )?(hours|day)","hasn.?t (wee.?d|passed urine) (for|in) (\\\\d+ )?(hours|day)","(baby|she|he) (won.?t|not) (drink|feed|take (a |the )?(bottle|breast|milk|feed))","not feeding (and|with) (lethargic|drowsy|floppy|sunken)","dry (mouth|lips|tongue) (and|with) (not (drinking|feeding)|lethargic|drowsy)","sunken (eyes|fontanelle|soft spot)","fontanelle (sunken|bulging)","no (wet )?nappies","not (making|producing) tears","floppy (and|with) (not (drinking|feeding)|lethargic)"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"Dehydration assessment","text":"Concerning: \\u226550% fewer wet nappies, no tears, dry mouth, sunken eyes/fontanelle, lethargy, not tolerating fluids \\u2192 same-day assessment.\\n\\nRED (\\u2192 999/ED): mottled, cold extremities, cap refill >2s, very drowsy/floppy, no urine >12\\u201324h, persistent bilious vomiting.\\n\\nMild D&V tolerating ORS \\u2192 small frequent fluids + strict safety-net. Bulging fontanelle = different emergency (?meningitis)."}]},{"id":"vomiting-baby","enabled":true,"label":"Infant vomiting","kind":"amber","patterns":["projectile vomit\\\\w*","bringing (everything|every feed) (back )?up","vomiting (every|after every) feed","won.?t keep (a |any )?(feed|milk|bottle) down","(green|bilious|bile.?stained) vomit\\\\w*","vomiting (green|bile)","keeps being sick (and|with) (not feeding|lethargic|drowsy)","can.?t keep (anything|fluids|milk) down","baby (sick|vomiting) (and|with) (lethargic|floppy|drowsy|swollen tummy)"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"Infant vomiting red flags","text":"\\u2022 GREEN/BILIOUS vomiting in an infant = intestinal obstruction (?malrotation/volvulus) until proven otherwise \\u2192 SAME-DAY surgical/ED \\u2014 this is an emergency\\n\\u2022 Projectile vomiting in a 2\\u20138-week-old, hungry after, weight faltering \\u2192 ?pyloric stenosis \\u2192 same-day referral\\n\\u2022 Vomiting + drowsy/floppy/bulging fontanelle \\u2192 ?meningitis/raised ICP \\u2192 emergency\\n\\u2022 Effortless small possets in a well, gaining baby = reflux \\u2014 reassure + safety-net"}]},{"id":"head-injury","enabled":true,"label":"Head injury","kind":"amber","patterns":["(hit|bumped|banged|knocked|whacked) (my |his |her |their |the )?head","head (injury|trauma)","fell (and|then) (hit|banged|knocked) (my|his|her|their|the) head","(bang|blow|knock) (on|to) the head","concuss\\\\w*","(lost consciousness|knocked out|passed out|blacked out) (after|when|from) (the |a )?(fall|hit|blow)","knocked (out|unconscious)","(vomit\\\\w*|drowsy|confus\\\\w*|sleepy|not right) (after|since) (hitting|banging) (my |his |her )?head","clear fluid (from|leaking from) (my |his |her )?(ear|nose)","won.?t (wake up|stay awake) after (hitting|banging|the bang on) (his |her |their )?head","on (blood thinners|warfarin|apixaban|rivaroxaban|edoxaban|dabigatran|anticoagulant\\\\w*) (and|after) (hit\\\\w*|bang\\\\w*|fell)"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"NG232 CT criteria","text":"CT head WITHIN 1 HOUR (\\u2192 ED now) if any: GCS <13 initially or <15 at 2h; suspected open/depressed or basal skull fracture (CSF leak, panda eyes, Battle\\u2019s sign); post-traumatic seizure; focal neurology; >1 episode of vomiting.\\n\\nON ANTICOAGULANT (warfarin/DOAC) or with bleeding disorder: CT within 8h after ANY head injury, even if entirely well \\u2014 send to ED.\\n\\nLOC or amnesia + (age \\u226565 / dangerous mechanism / clotting issue) \\u2192 CT within 8h.\\n\\nChildren: lower threshold; <1y with any bruise/swelling on head \\u2192 assess; consider NAI if mechanism inconsistent."},{"type":"link","label":"NICE NG232 (head injury)","url":"https://www.nice.org.uk/guidance/ng232"}]},{"id":"acute-limp-child","enabled":true,"label":"Limping child","kind":"amber","patterns":["(child|toddler|boy|girl|son|daughter|he|she) (is )?limping","limping (and|with) (fever|temperature|hot|swollen|won.?t walk)","won.?t (put weight on|walk on|stand on) (his|her|their|the) (leg|foot|knee|hip)","refusing to (walk|weight bear|stand)","not (weight.?bearing|bearing weight)","woke up limping","(hot|swollen|red) (knee|hip|ankle|leg) (and|with) (limp\\\\w*|fever|won.?t walk)","sudden (onset )?limp"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"Limping child pathway","text":"Limp + fever or systemically unwell = septic arthritis/osteomyelitis until proven otherwise \\u2192 same-day paediatric/ortho assessment (bloods + imaging).\\n\\n\\u2022 Non-weight-bearing at any age \\u2192 same-day (fracture, septic hip)\\n\\u2022 Child <3y with a limp \\u2192 same-day assessment (and consider NAI)\\n\\u2022 Adolescent with hip/knee pain + limp \\u2192 ?SUFE \\u2192 urgent\\n\\u2022 Transient synovitis is a diagnosis of exclusion"},{"type":"link","label":"NICE CKS acute childhood limp","url":"https://cks.nice.org.uk/topics/acute-childhood-limp/"}]},{"id":"neonatal-jaundice","enabled":true,"label":"Newborn jaundice","kind":"amber","patterns":["(baby|newborn) (is|looks|has gone|going) (very |really )?yellow","jaundice\\\\w* (in (my |the )?)?(baby|newborn)","(baby|newborn).?s? (skin|eyes|sclera) (are |is |look\\\\w* )?yellow","bilirubin","jaundice (within|in the first) (24 hours|first day|day one)","(yellow|jaundice\\\\w*) (and|with) (poor feeding|not feeding|drowsy|lethargic|sleepy)","still (yellow|jaundiced) at (2|3|two|three) weeks"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"Neonatal jaundice (NG98)","text":"\\u2022 Jaundice in the FIRST 24 HOURS of life = always pathological \\u2192 same-day urgent serum bilirubin + paediatric assessment\\n\\u2022 Visible jaundice any time in first 2 weeks \\u2192 measure bilirubin (transcutaneous/serum) and plot on treatment-threshold chart \\u2014 do not estimate by eye\\n\\u2022 Jaundice + poor feeding/drowsy \\u2192 urgent same-day\\n\\u2022 Prolonged jaundice (>14 days term, >21 days preterm) \\u2192 prolonged-jaundice screen incl. CONJUGATED bilirubin (?biliary atresia \\u2014 pale stools/dark urine)"},{"type":"link","label":"NICE NG98 (neonatal jaundice)","url":"https://www.nice.org.uk/guidance/ng98"}]},{"id":"adult-jaundice","enabled":true,"label":"Jaundice (adult)","kind":"amber","patterns":["(skin|eyes) (have |has |are |is )?(gone|turned|turning|going) yellow","yellow (skin|eyes|tinge)","whites of (my |the )?eyes (are |look )?yellow","jaundice\\\\w*","(i|he|she) (look|am|is|seem)\\\\w* yellow","(dark urine|pale stools?) (and|with) (yellow|itch\\\\w*|jaundice)","itch\\\\w* (all over )?(and|with) (yellow|dark urine|pale stools?)"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"Adult jaundice pathway","text":"New jaundice in an adult \\u2192 same-day bloods (LFTs, FBC, U&E, INR) and urgent assessment.\\n\\n\\u2022 PAINLESS jaundice (esp. >40y, weight loss, dark urine/pale stools) is a pancreatic-cancer red flag \\u2192 NICE NG12 urgent CT/2WW pathway\\n\\u2022 Jaundice + fever/RUQ pain \\u2192 ?cholangitis \\u2192 same-day admission\\n\\u2022 Jaundice + confusion/bruising \\u2192 ?acute liver failure \\u2192 emergency\\n\\u2022 Check paracetamol overdose, alcohol, new drugs (incl. herbal)"},{"type":"link","label":"NICE NG12 pancreatic cancer","url":"https://www.nice.org.uk/guidance/ng12/chapter/Recommendations-organised-by-site-of-cancer#pancreatic-cancer"}]},{"id":"testicular-lump","enabled":true,"label":"Testicular lump","kind":"amber","patterns":["(lump|swelling|mass) (in|on) (my )?(testicle|testis|ball|balls|scrotum)","testicular lump","(testicle|testis|ball) (feels|is) (hard|bigger|enlarged|different|heavy)","(found|felt|noticed) a lump (in|on) (my )?(testicle|testis|ball|scrotum)","swollen (testicle|testis)","(heaviness|dragging) (in (my )?)?(scrotum|testicle|balls)"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"2WW pathway","text":"NICE NG12: non-painful enlargement or change in shape/texture of the testis \\u2192 2WW urology (any age \\u2014 peak 15\\u201340y). Consider direct-access ultrasound if unsure whether mass is testicular.\\n\\nSUDDEN SEVERE testicular PAIN = torsion \\u2192 emergency (separate red rule).\\nYoung men under-present \\u2014 take written mentions seriously."},{"type":"link","label":"NICE NG12 testicular cancer","url":"https://www.nice.org.uk/guidance/ng12/chapter/Recommendations-organised-by-site-of-cancer#urological-cancers"}]},{"id":"vzv-pregnancy","enabled":true,"label":"Chickenpox/shingles in pregnancy","kind":"amber","patterns":["pregnan\\\\w*.{0,50}(chickenpox|chicken pox|varicella|shingles)","(chickenpox|chicken pox|varicella|shingles).{0,50}pregnan\\\\w*","expecting.{0,40}(chickenpox|chicken pox|varicella|shingles)"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"VZV in pregnancy","text":"Chickenpox CONTACT in pregnancy: same-day advice \\u2014 check varicella history/immunity (IgG if uncertain); if non-immune and significant contact, post-exposure prophylaxis (antivirals/VZIG per current UKHSA guidance) is TIME-CRITICAL \\u2192 discuss with obstetrics/virology today.\\n\\nChickenpox RASH in pregnancy: same-day clinical discussion \\u2014 oral aciclovir if \\u226520 weeks and within 24h of rash; severe disease/respiratory symptoms \\u2192 admission. Risks: fetal varicella syndrome (<28wk), neonatal varicella (around delivery), maternal pneumonitis."},{"type":"link","label":"RCOG chickenpox in pregnancy (GTG13)","url":"https://www.rcog.org.uk/guidance/browse-all-guidance/green-top-guidelines/chickenpox-in-pregnancy-green-top-guideline-no-13/"}]},{"id":"emergency-contraception","enabled":true,"label":"Emergency contraception","kind":"amber","patterns":["morning after pill","emergency contracept\\\\w*","emergency (pill|coil|contraceptive)","need contraception (quickly|urgently|today|asap)","unprotected sex","condom (broke|split|came off|failed)","missed (my |a |several )?(contraceptive )?pills?","forgot (to take )?(my )?pill","(took|taken) (my )?pill (late|too late)","(levonorgestrel|ulipristal|ellaone)","plan b","copper coil (for|as) emergency"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"EC time windows","text":"Time-critical \\u2014 deal with today:\\n\\u2022 Copper IUD: most effective, up to 5 days (120h) after UPSI (or up to 5 days after earliest ovulation) \\u2014 also ongoing contraception\\n\\u2022 Ulipristal (ellaOne): up to 120h\\n\\u2022 Levonorgestrel: up to 72h (less effective later; double dose if BMI/weight criteria per FSRH)\\n\\nCommunity pharmacy can supply oral EC free via Pharmacy First. Safeguard: under-16s (Fraser), coercion/assault \\u2192 follow safeguarding pathway. Offer STI screen + ongoing contraception; pregnancy test if next period late."},{"type":"link","label":"NHS Pharmacy First","url":"https://www.nhs.uk/nhs-services/pharmacies/pharmacy-first/"},{"type":"link","label":"NICE CKS emergency contraception","url":"https://cks.nice.org.uk/topics/contraception-emergency/"}]},{"id":"mastitis","enabled":true,"label":"Mastitis/breastfeeding","kind":"amber","patterns":["mastitis","breast (infection|abscess)","infected breast","breastfeed\\\\w*.{0,40}(pain\\\\w*|sore|red|hot|fever\\\\w*|lump\\\\w*|flu.?like|burning)","(painful|sore|red|hot|hard|engorged) breast (while|when|and) (feeding|breastfeeding|nursing)","(breast engorgement|engorged breasts?)","(blocked|plugged|clogged) (milk )?duct","cracked nipple (and|with) (pain|red|fever)","(red|hot|hard) (patch|area|wedge|lump) (on|in) (my )?breast (and|with) (fever|feeding|flu)","flu.?like (and|with) (breast|breastfeeding)"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"Mastitis pathway","text":"Lactational mastitis: continue feeding/expressing (milk drainage is the treatment), analgesia (paracetamol/ibuprofen safe), warm compress before feeds.\\n\\nAntibiotics (flucloxacillin 10\\u201314d; erythromycin if pen-allergic) if: systemically unwell, nipple fissure infection, or not improving after 12\\u201324h of effective milk removal.\\n\\n\\u2022 Fluctuant mass \\u2192 ?abscess \\u2192 same-day referral for USS \\u00b1 drainage\\n\\u2022 A discrete lump or skin change persisting AFTER mastitis resolves \\u2192 breast 2WW (inflammatory cancer mimics mastitis)\\n\\u2022 Sepsis features \\u2192 admit"},{"type":"link","label":"NICE CKS mastitis","url":"https://cks.nice.org.uk/topics/mastitis-breast-abscess/"}]},{"id":"heavy-period","enabled":true,"label":"Heavy menstrual bleeding","kind":"amber","patterns":["heavy periods?","(very|really|extremely) heavy (menstrual )?bleed\\\\w*","soaking through (pads|tampons|sanitary)","changing (my )?(pad|tampon) every (hour|half hour|30 min\\\\w*)","flooding (through|at night|during my period)","period (flooding|won.?t stop)","(large|big) (blood )?clots (in|during|with) (my )?(period|bleed\\\\w*)","bleeding (for|going on) (more than|over) (a week|7 days|two weeks)","menorrhagia","heavy menstrual bleeding","bleeding through (my )?clothes","period (is )?(much |a lot )?heavier than usual"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"HMB pathway (NG88)","text":"\\u2022 Check FBC (\\u00b1 ferritin) \\u2014 anaemia is common\\n\\u2022 First-line: LNG-IUS; or tranexamic acid \\u00b1 NSAID, or hormonal options\\n\\u2022 Red flags out: intermenstrual/postcoital bleeding, post-menopausal bleeding (\\u2192 2WW), pressure symptoms/mass (?fibroids \\u2192 USS)\\n\\u2022 Acute flooding + dizziness/syncope or Hb concern \\u2192 same-day review\\n\\u2022 Persistent IMB or treatment failure \\u2192 gynae referral"},{"type":"link","label":"NICE NG88 (heavy menstrual bleeding)","url":"https://www.nice.org.uk/guidance/ng88"}]},{"id":"postpartum-complications","enabled":true,"label":"Postpartum bleeding/infection","kind":"amber","patterns":["(heavy |postpartum |postnatal )?bleeding (after|since) (giving birth|the birth|delivery|having (my )?baby)","postpartum (bleed\\\\w*|haemorrhage|hemorrhage)","lochia (heavy|heavier|smelly|foul|increasing)","(fever|temperature|unwell|shivery) (after|since) (giving birth|the birth|delivery)","(c.?section|caesarean|cesarean) (wound|scar) (infect\\\\w*|red|oozing|opening|leaking)","stitches (infected|opened|smelly|oozing)","(foul|smelly|offensive) (smelling )?discharge (after|since) (giving birth|the birth|birth|delivery|having (my )?baby)","retained placenta","endometritis","unwell (a )?(few days|week|fortnight) after (giving birth|having (my )?baby)"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"Postpartum red flags","text":"Postpartum women deteriorate FAST \\u2014 low threshold for same-day review/admission.\\n\\n\\u2022 Secondary PPH (heavy/increasing bleeding >24h\\u201312wk post-delivery) \\u2192 same-day; clots/offensive lochia \\u2192 ?retained products/endometritis\\n\\u2022 Fever + foul lochia + uterine tenderness = endometritis \\u2192 same-day, often admission for IV antibiotics\\n\\u2022 Wound infection: spreading erythema/systemic features \\u2192 same-day\\n\\u2022 Always consider sepsis (MBRRACE: genital-tract sepsis remains a leading cause of maternal death)"}]},{"id":"acute-red-eye","enabled":true,"label":"Painful red eye","kind":"amber","patterns":["(painful|sore) red eye","red (and )?(painful|sore) eye","red eye (and|with) (pain|blurred vision|vision (loss|change)|light hurt\\\\w*|photophobia|haz\\\\w*|halo\\\\w*)","eye (is )?red (and|with) (painful|losing vision|can.?t see|light sensitive)","(photophobia|light hurt\\\\w*|can.?t tolerate light) (and|with) (red|painful) eye","contact lens\\\\w* (and|with) (red|painful|sore) eye","keratitis","(uveitis|iritis)","corneal (pain|ulcer|abrasion)","eye pain (and|with) (vision (loss|change|blur\\\\w*)|halo\\\\w*|redness)","(something|chemical|bleach) (splashed|went) in (my )?eye"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"Red eye red flags","text":"Same-day ophthalmology if red eye PLUS any: pain (not just gritty), photophobia, reduced vision, haloes (?acute angle-closure), fixed/irregular pupil, CONTACT-LENS wearer (?microbial keratitis \\u2014 lens out, same-day), herpetic vesicles, hypopyon, trauma.\\n\\nChemical injury: irrigate copiously NOW, then emergency referral.\\n\\nBland red eye, no pain/vision change = likely conjunctivitis \\u2192 self-care/pharmacy + safety-net."},{"type":"link","label":"NICE CKS red eye","url":"https://cks.nice.org.uk/topics/red-eye/"}]},{"id":"sudden-hearing-loss","enabled":true,"label":"Sudden hearing loss","kind":"amber","patterns":["sudden (hearing loss|loss of hearing|deaf\\\\w*)","(lost|losing) (my )?hearing (in (my |the )?one ear|in my (left|right) ear|overnight|suddenly)","woke up (deaf|and (can.?t|couldn.?t) hear)","gone deaf in one ear","ear (went|has gone) dead","(can.?t hear|hearing.?s gone) (in one ear|suddenly|overnight)","sensorineural","hearing (disappeared|vanished) (overnight|suddenly)"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"SSNHL \\u2014 urgent","text":"Sudden (\\u226472h) unexplained hearing loss in one or both ears, not explained by wax/effusion on otoscopy, = sudden sensorineural hearing loss \\u2192 URGENT same-day/24h ENT referral for audiometry + oral steroids \\u2014 the treatment window is days, outcomes worsen with delay.\\n\\nDo NOT routine-refer. Tuning fork (Weber lateralises AWAY from affected ear in SNHL) helps distinguish from conductive causes.\\n\\nWith vertigo/neurology \\u2192 consider stroke pathway."}]},{"id":"epistaxis","enabled":true,"label":"Nosebleed (significant)","kind":"amber","patterns":["nose ?bleed\\\\w* (that )?(won.?t|will not) stop","(can.?t|unable to) stop (my |the )?nose ?bleed\\\\w*","(heavy|prolonged|continuous|torrential) nose ?bleed\\\\w*","nose ?bleed\\\\w* (for|lasting|going on) (\\\\d+ )?(hour|hours|30 min\\\\w*)","nose (won.?t|will not) stop bleeding","epistaxis","bleeding (heavily )?from (my )?nose (and|that) won.?t stop","nose ?bleed\\\\w* (and|on) (blood thinners|warfarin|apixaban|rivaroxaban|anticoagulant\\\\w*)","(keep getting|recurrent|repeated) nose ?bleed\\\\w*"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"Epistaxis pathway","text":"First aid: sit forward, pinch the SOFT part of the nose firmly 10\\u201315 min continuously, ice to bridge, spit don\\u2019t swallow.\\n\\n\\u2022 Not controlled after 2 \\u00d7 15 min pressure \\u2192 ED (cautery/packing)\\n\\u2022 On anticoagulant/antiplatelet + heavy or recurrent bleeding \\u2192 same-day review (check INR if warfarin) \\u2014 low threshold for ED\\n\\u2022 Posterior bleed (blood down throat both sides), haemodynamic symptoms \\u2192 999/ED\\n\\u2022 Recurrent unilateral epistaxis + blocked nose in an adult \\u2192 consider ENT referral (rare: tumour)"}]},{"id":"gout","enabled":true,"label":"Gout flare?","kind":"amber","patterns":["gout( flare| attack)?","big toe (joint )?(pain|swollen|swelling|red.?hot|agony|on fire)","(red|hot|swollen) big toe","toe (is )?(red and swollen|hot and swollen)","acute (toe|midfoot|ankle) (pain|swelling) (came on )?(overnight|suddenly)","toph(us|i)","gouty"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"Gout (NG219)","text":"Acute flare: NSAID (with PPI) OR colchicine 500mcg bd\\u2013qds (cap dose; caution renal impairment/statins) OR short oral prednisolone \\u2014 treat fast, any of the three.\\n\\n\\u2022 Do NOT stop allopurinol/febuxostat during a flare\\n\\u2022 After the flare settles: offer urate-lowering therapy (treat-to-target serum urate <360 micromol/L; <300 if tophi/recurrent), start low + flare prophylaxis cover\\n\\u2022 Hot swollen joint + fever/unwell \\u2192 treat as SEPTIC arthritis, not gout\\n\\u2022 Check U&E, consider CV risk/diuretic review"},{"type":"link","label":"NICE NG219 (gout)","url":"https://www.nice.org.uk/guidance/ng219"}]},{"id":"cellulitis","enabled":true,"label":"Cellulitis?","kind":"amber","patterns":["cellulitis","spreading (redness|red area|infection)","(redness|red area|red patch).{0,30}(spreading|getting bigger|getting worse|tracking)","red streak\\\\w*","lymphangitis","(leg|arm|skin|wound|foot|hand) infection (and|with) (red|hot|swollen|spreading|fever)","infected wound (and|with) (spreading|red|hot|fever)","(hot|warm) (red|swollen) (and )?spreading","(leg|arm) (is )?(red, hot and swollen|hot, red and swollen)"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"Cellulitis pathway","text":"Mark the border and date it. Uncomplicated: oral flucloxacillin (clarithromycin/doxycycline if pen-allergic), elevate, review 48h.\\n\\nAdmit / same-day ED if: systemic sepsis features, rapidly spreading, facial/periorbital (?orbital cellulitis \\u2014 emergency), severe pain out of proportion (?necrotising \\u2014 999), immunosuppressed, failed orals.\\n\\nUnilateral red swollen leg: consider DVT (often confused) and chronic venous eczema (usually bilateral, itchy, not febrile \\u2014 doesn\\u2019t need antibiotics)."},{"type":"link","label":"NICE CKS cellulitis","url":"https://cks.nice.org.uk/topics/cellulitis-acute/"}]},{"id":"medication-side-effect","enabled":true,"label":"Medication side effect","kind":"amber","patterns":["side.?effects?","adverse (reaction|effect)","reaction to (my )?(medication|tablets|pills|new (tablet|medication|med))","(medication|tablets?|pills?) (is |are )?(making me|giving me) (unwell|sick|dizzy|a rash|nausea|itchy)","(rash|nausea|dizziness|diarrhoea|swelling) (from|since starting) (my )?(medication|tablets|new (tablet|medication|med))","can.?t tolerate (my )?(medication|tablets|new (tablet|medication|med))","since starting (the|my|this) new (tablet\\\\w*|medication|med\\\\w*|inhaler)"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"ADR triage","text":"Prescriber review needed \\u2014 check timing vs drug start, dose, interactions (BNF).\\n\\nSERIOUS \\u2014 same-day/emergency:\\n\\u2022 ACEi angioedema (lip/tongue swelling) \\u2192 emergency\\n\\u2022 New rash on allopurinol / lamotrigine / carbamazepine / penicillins \\u2192 ?SJS/DRESS \\u2192 stop + urgent review (mucosal involvement/blistering = emergency)\\n\\u2022 Muscle pain + dark urine on statin \\u2192 ?rhabdo \\u2192 same-day CK\\n\\u2022 Bleeding on anticoagulant \\u2192 same-day\\n\\nReport serious/unexpected reactions via MHRA Yellow Card."},{"type":"link","label":"MHRA Yellow Card","url":"https://yellowcard.mhra.gov.uk/"}]},{"id":"delirium","enabled":true,"label":"Acute confusion","kind":"amber","patterns":["(suddenly|acutely|overnight|out of the blue) confused","acute confusion","confus\\\\w* (and|with) (fever|not (himself|herself|themselves)|drowsy|hallucinating)","confused since (yesterday|this morning|last night)","(mum|dad|nan|gran|grandad|mother|father|husband|wife) (is|has been|has got|seems) (suddenly |very |really )?(confused|muddled|not making sense)","not (himself|herself|themselves) (and|with) confus\\\\w*","(rambling|incoherent|talking nonsense|not making sense) (suddenly|since|today|overnight)","doesn.?t know (what day|where (he|she|they) (is|are)|who (i am|people are))","(delirium|delirious)","woke up confused","hallucinating (and|with) (confused|fever|unwell)"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"Delirium screen","text":"ACUTE change in cognition/attention = delirium until proven otherwise \\u2014 in an older person this is a same-day assessment (4AT screen).\\n\\nHunt the cause: infection (UTI/chest), urinary retention, constipation, dehydration, hypoxia, drugs (opioids, anticholinergics, benzos \\u2014 recent changes), alcohol withdrawal, electrolytes/glucose, pain, stroke.\\n\\nFluctuating course + inattention distinguishes from dementia (chronic \\u2192 memory-loss rule). Both can coexist \\u2014 acute-on-chronic change still needs same-day review."},{"type":"link","label":"NICE CKS delirium","url":"https://cks.nice.org.uk/topics/delirium/"}]},{"id":"alcohol-misuse","enabled":true,"label":"Alcohol concern","kind":"amber","patterns":["drinking too much","(drink|drinking|alcohol) problem\\\\w*","alcoholi(c|sm)","(worried|concerned) about (my |his |her )?drinking","help (to |with )?(stop|stopping|cut down|cutting down|control\\\\w*) (my )?drinking","can.?t (stop|control) (my )?drinking","alcohol (dependence|dependent|withdrawal|detox)","shakes (when|from|if) (i )?(stop|don.?t|haven.?t) (been )?drink\\\\w*","(detox|withdraw\\\\w*) (from|off) alcohol","drinking (every day|every morning|in the morning|first thing)","relapsed? (on |with )?(drinking|alcohol)"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"Alcohol pathway","text":"\\u2022 Screen with AUDIT-C / full AUDIT\\n\\u2022 DEPENDENT drinkers must NOT stop abruptly \\u2014 withdrawal seizures and delirium tremens can kill; arrange planned/supported detox\\n\\u2022 Already withdrawing (tremor, sweating, agitation, hallucinations, seizure) \\u2192 same-day; severe \\u2192 admission\\n\\u2022 Oral thiamine (Wernicke prophylaxis); refer local community alcohol service\\n\\u2022 Safeguarding: children/dependants at home; DVLA if relevant"},{"type":"link","label":"NICE CKS alcohol problem drinking","url":"https://cks.nice.org.uk/topics/alcohol-problem-drinking/"}]},{"id":"eating-disorder","enabled":true,"label":"Eating disorder?","kind":"amber","patterns":["(anorexi|bulimi)\\\\w*","eating disorder\\\\w*","(making|make) myself (sick|throw up|vomit)","purg\\\\w* (after eating|food|meals)","vomiting (after|straight after) (every )?(meal\\\\w*|eating)","laxative\\\\w* (abuse|misuse|to lose weight)","restrict\\\\w* (my )?(food|eating|calories)","afraid (of food|to eat|of (gaining|putting on) weight)","(losing|lost) weight (very |really )?(fast|quickly|rapidly)","binge\\\\w* (and|then) (purg\\\\w*|vomit\\\\w*|making myself sick)","(ARFID|binge eating disorder)"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"MEED risk assessment","text":"Eating disorders kill \\u2014 assess medical risk (RCPsych MEED), do not rely on appearance or BMI alone (bulimia/ARFID often normal weight).\\n\\nCheck: rate of weight loss, BMI/%mBMI, HR (bradycardia <50), postural BP drop, core temp, SUSS test (sit-up/squat-stand), ECG (QTc), U&E (K+!), phosphate, glucose.\\n\\n\\u2022 Physiological compromise \\u2192 same-day medical admission (refeeding risk \\u2014 admit, don\\u2019t \\u201cfeed up at home\\u201d)\\n\\u2022 Under-18 \\u2192 urgent referral to community eating-disorder service/CAMHS-ED (NICE NG69: do not delay for weight thresholds)"},{"type":"link","label":"NICE NG69 (eating disorders)","url":"https://www.nice.org.uk/guidance/ng69"},{"type":"link","label":"BEAT (support)","url":"https://www.beateatingdisorders.org.uk/"}]},{"id":"postnatal-mh","enabled":true,"label":"Perinatal mental health","kind":"amber","patterns":["(postnatal|post.?partum) depression","PND","(struggling|not coping|can.?t cope) (after|since) (having )?(the |my )?baby","(struggling|low|depressed|anxious|tearful) since (giving birth|the baby|baby was born)","bonding (problem\\\\w*|difficult\\\\w*|issues) (with )?(the |my )?baby","not bonding with (the |my )?baby","intrusive thoughts (about|of) (the |my )?baby","baby blues","perinatal (mental health|anxiety|depression)"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":"safeguarding","builtin":true,"actions":[{"type":"note","label":"Perinatal MH pathway","text":"\\u2022 Ask directly about thoughts of self-harm and of harming the baby; intrusive \\u201cwhat if\\u201d thoughts WITH distress and no intent are common in perinatal OCD \\u2014 distinguish from psychotic ideation\\n\\u2022 Postpartum PSYCHOSIS (rapid onset days\\u2013weeks post-birth: confusion, mania, delusions about the baby) = psychiatric emergency \\u2192 same-day perinatal/crisis team\\n\\u2022 Refer perinatal mental-health team (priority access); EPDS/PHQ-9 useful\\n\\u2022 Baby blues (day 3\\u201310, mild, self-limiting) \\u2014 safety-net; persistent >2wk = treat as PND\\n\\u2022 Safeguarding: consider infant + other children"},{"type":"link","label":"NICE CKS postnatal depression","url":"https://cks.nice.org.uk/topics/depression-antenatal-postnatal/"}]},{"id":"dental","enabled":true,"label":"Dental","kind":"info","patterns":["(toothache|tooth ache\\\\w*)","dental (pain|abscess)","pain in (my )?(tooth|teeth)","(broken|chipped|cracked) tooth","abscess (on|in) (my )?(tooth|gum)","infected tooth","(swollen|painful|bleeding) gums?","wisdom tooth","(filling|crown|cap) (came out|fell out)","lost a (filling|crown)","need (a |an emergency )?dentist"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"Dental signposting","text":"GPs cannot provide NHS dental treatment and should not routinely prescribe for dental infection \\u2014 the treatment is dental (drainage/extraction).\\n\\nSignpost: own dentist (urgent slot) or NHS 111 for urgent dental access if no dentist.\\n\\nESCALATE (\\u2192 ED): facial swelling spreading to eye or neck, trismus, difficulty swallowing/breathing, systemically unwell (?Ludwig\\u2019s angina / spreading odontogenic infection)."},{"type":"link","label":"NHS find a dentist","url":"https://www.nhs.uk/service-search/find-a-dentist"}]},{"id":"blood-test-result","enabled":true,"label":"Results query","kind":"info","patterns":["(blood|test) results?","bloods? (back|results)","(have|got|chasing|waiting for|when will i get|any news on|where are) (my )?(blood |test )?results","results (back|come back|came back)","what (do|does) my (results|bloods) (say|show|mean)"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"Admin routing","text":"Results-status query \\u2014 admin/clerical, not a clinical queue item.\\n\\n1. Check if result is filed \\u2192 if normal & actioned, reception/portal can relay\\n2. If abnormal/unactioned \\u2192 route to the requesting clinician\\n3. If pending \\u2192 give expected turnaround\\n4. Signpost NHS App / online record for future self-serve"}]},{"id":"referral-chase","enabled":true,"label":"Referral chase","kind":"info","patterns":["chas(e|ing) (my |up )?(referral|appointment)","(where.?s|where is|any news on|status of|update on) (my )?referral","(haven.?t|not) heard (anything )?(about|from|back from) (the |my )?(hospital|consultant|clinic|specialist|referral)","(still )?waiting (for|on|to hear about) (my |a |the )?(hospital|specialist|consultant|clinic) (appointment|letter|call|date)","referral (status|gone through|been sent|been done)","has my referral (gone|been sent)"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"Admin routing","text":"Referral-status query \\u2014 route to admin team, not the clinical queue.\\n\\n1. Check referral was sent + e-RS status\\n2. If 2WW referral and no appointment within expected window \\u2192 escalate to secretary/2WW chase actively (this one IS time-critical)\\n3. Routine: signpost NHS App appointment tracking / hospital booking line\\n4. New symptoms or deterioration while waiting \\u2192 clinical review, consider expediting letter"}]},{"id":"medical-report-letter","enabled":true,"label":"Letter/report request","kind":"info","patterns":["(need|requesting|request|asking for|can i (have|get)) (a )?(letter|medical letter|gp letter|doctor.?s letter|support\\\\w* letter|evidence letter)","letter (for|to) (my )?(insurance|employer|work|mortgage|landlord|housing|solicitor|court|university|college|school|airline|visa|travel|DWP|PIP)","medical report","fitness to (fly|travel) (letter|certificate)","to whom it may concern","(insurance|solicitor.?s?|capability) report"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"Admin routing","text":"Letter/report request \\u2014 admin workflow, not the clinical queue (fit notes have their own rule).\\n\\n\\u2022 Non-NHS work: practice may charge (per BMA guidance) \\u2014 admin to advise fee + timescale before clinician writes\\n\\u2022 Factual extracts can often be handled via SAR/online record instead of a bespoke letter\\n\\u2022 Route to designated letters clinician/secretary with clear purpose stated"}]},{"id":"travel-vaccination","enabled":true,"label":"Travel health","kind":"info","patterns":["travel (vaccin\\\\w*|jabs?|injections?)","travel (clinic|health|advice)","(going|travelling|traveling|flying) abroad","(yellow fever|typhoid|rabies|hepatitis a|hepatitis b|cholera|japanese encephalitis) (vaccin\\\\w*|jab)","malaria (tablets?|prophylaxis|prevention|pills)","fit (to|for) (fly|travel)","(vaccin\\\\w*|jabs?) (for|before) (my )?(holiday|trip|travels)"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"Travel health routing","text":"Planned preventive care \\u2192 practice nurse travel clinic or private travel clinic, ideally 6\\u20138 weeks before departure (some courses need time; late presentation still worth assessing).\\n\\n\\u2022 Risk-assess via fitfortravel/NaTHNaC by destination\\n\\u2022 Only some vaccines are NHS-funded (typhoid, hep A, cholera, polio-containing booster); yellow fever/rabies/JE = private/registered centre\\n\\u2022 Malaria prophylaxis: private prescription\\n\\u2022 Returning traveller with FEVER = clinical, not admin (?malaria \\u2014 same-day)"},{"type":"link","label":"Fit for Travel (NHS)","url":"https://www.fitfortravel.nhs.uk/"}]},{"id":"weight-loss-injection","enabled":true,"label":"Weight-loss medication request","kind":"info","patterns":["(wegovy|mounjaro|saxenda|ozempic|rybelsus)","(semaglutide|tirzepatide|liraglutide)","weight.?loss (injection\\\\w*|jabs?|pen|medication|drug)","GLP.?1","(skinny|fat|weight.?loss) (jab|pen)","injections? (for|to) (lose|losing) weight"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"GLP-1 weight-management requests","text":"Rapidly growing request type \\u2014 route to a planned appointment, not urgent queue.\\n\\n\\u2022 NICE: semaglutide (Wegovy, TA875) via specialist weight management; tirzepatide (Mounjaro, TA1026) with phased primary-care rollout from 2025 under strict eligibility (BMI + comorbidity tiers) \\u2014 CHECK CURRENT LOCAL COMMISSIONING before promising anything\\n\\u2022 Ozempic is licensed for T2DM, not weight loss \\u2014 do not prescribe off-label for weight\\n\\u2022 Many patients buy privately online: ask, document, counsel (side effects, gallstones, pancreatitis, pregnancy avoidance)\\n\\u2022 Screen for eating disorder before supporting weight-loss medication"}]},{"id":"end-of-life-admin","enabled":true,"label":"ACP/DNACPR admin","kind":"info","patterns":["(DNACPR|DNAR|DNR)","do not (attempt )?resuscitat\\\\w*","respect form","advance (directive|decision|statement|care plan)","(lasting )?power of attorney","LPA","living will","organ donation","treatment escalation plan","TEP"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"ACP routing","text":"Advance-care-planning / DNACPR / LPA request \\u2014 sensitive but planned work: book with the patient\\u2019s usual GP (or palliative lead), allow a double slot; not for the urgent queue.\\n\\n\\u2022 DNACPR/ReSPECT: clinical decision made WITH patient/family \\u2014 document and share (incl. out-of-hours/ambulance visibility)\\n\\u2022 LPA forms are completed via OPG \\u2014 GP only needed if asked to act as certificate provider (may carry a fee)\\n\\u2022 If the text suggests the patient is actively dying or in symptom crisis \\u2192 that is urgent clinical work, not admin"},{"type":"link","label":"Resus Council ReSPECT","url":"https://www.resus.org.uk/respect"}]},{"id":"memory-loss","enabled":true,"label":"Memory concern","kind":"info","patterns":["memory (loss|problems?|concerns?)","(losing|lost) (my|his|her) memory","forget\\\\w* (things|names|words|appointments|conversations)","(dementia|alzheimer\\\\w*)","cognitive decline","memory (getting worse|going|deteriorat\\\\w*)","worried about (my |his |her |mum.?s |dad.?s )?memory","memory (clinic|assessment|test)","(mum|dad|nan|gran|grandad).?s? memory (is )?(getting worse|going|terrible|bad)","keeps (getting lost|forgetting|repeating)"],"regex":true,"fields":["request"],"pages":["queue","detail"],"bumpsTile":null,"builtin":true,"actions":[{"type":"note","label":"Memory pathway","text":"Gradual memory decline \\u2192 routine (not urgent) workup: collateral history, cognitive test (GPCOG/6-CIT), dementia bloods (FBC, U&E, LFT, TFT, B12/folate, calcium, glucose \\u00b1 HbA1c), depression screen, medication review (anticholinergic burden) \\u2192 memory clinic referral.\\n\\n\\u2022 ACUTE/fluctuating confusion = delirium \\u2192 same-day (separate rule)\\n\\u2022 Rapid progression over weeks, young onset, neurology \\u2192 urgent referral\\n\\u2022 Driving: advise DVLA notification where diagnosis made"},{"type":"link","label":"NICE CKS dementia","url":"https://cks.nice.org.uk/topics/dementia/"}]}],"thresholds":{"polypharmacyRed":15,"polypharmacyAmber":10,"bpAgeMonthsLtc":9,"bpAgeMonthsNoLtc":24,"weightAgeMonths":24,"frailtyHitsRed":3,"frailtyHitsAmber":1,"lastContactMonths":12,"recentDischargeRed":14,"recentDischargeAmber":90,"anticholinergicAmber":3,"qofOverdueRed":2,"recentReferralDays":60,"taskAgeAmber":3,"taskAgeRed":7,"elderAge":80,"childAge":16},"prefs":{"showAgeChip":true,"showFootStats":true,"showRequestSnippet":true,"snippetMaxChars":240,"showBuiltInTiles":true},"systemChips":{"queue.child":{"enabled":true,"label":"Child ({age})","kind":"amber","actions":[]},"queue.elder":{"enabled":true,"label":"Elder ({age})","kind":"amber","actions":[]},"queue.taskAgeAmber":{"enabled":true,"label":"{days}d","kind":"amber","actions":[]},"queue.taskAgeRed":{"enabled":true,"label":"{days}d","kind":"red","actions":[]},"queue.priority":{"enabled":true,"label":"{priority}","kind":"red","actions":[]},"detail.statusAwaiting":{"enabled":true,"label":"{status}","kind":"amber","actions":[]},"detail.statusReplyReceived":{"enabled":true,"label":"{status}","kind":"red","actions":[]},"detail.statusClosed":{"enabled":true,"label":"{status}","kind":"green","actions":[]},"detail.statusOther":{"enabled":true,"label":"{status}","kind":"info","actions":[]},"detail.priority":{"enabled":true,"label":"{priority}","kind":"red","actions":[]},"detail.daysOpenInfo":{"enabled":true,"label":"{days}d open","kind":"info","actions":[]},"detail.daysOpenAmber":{"enabled":true,"label":"{days}d open","kind":"amber","actions":[]},"detail.daysOpenRed":{"enabled":true,"label":"{days}d open","kind":"red","actions":[]},"detail.today":{"enabled":true,"label":"today","kind":"info","actions":[]},"detail.proxy":{"enabled":true,"label":"via {relationship}","kind":"info","actions":[]},"detail.attachments":{"enabled":true,"label":"{count} attach","kind":"info","actions":[]},"record.age":{"enabled":true,"label":"{age}y","kind":"info","actions":[]},"record.palliative":{"enabled":true,"label":"Palliative","kind":"red","actions":[]},"record.riskToSelf":{"enabled":true,"label":"Risk to self","kind":"red","actions":[]},"record.frailtyRed":{"enabled":true,"label":"Frailty x{count}","kind":"red","actions":[]},"record.frailtyAmber":{"enabled":true,"label":"Frailty x{count}","kind":"amber","actions":[]},"record.recentAdmissionRed":{"enabled":true,"label":"Admit {days}d","kind":"red","actions":[]},"record.recentAdmissionAmber":{"enabled":true,"label":"Admit {days}d","kind":"amber","actions":[]},"record.polypharmacyRed":{"enabled":true,"label":"Meds x{count}","kind":"red","actions":[]},"record.polypharmacyAmber":{"enabled":true,"label":"Meds x{count}","kind":"amber","actions":[]},"record.monitoringDueRed":{"enabled":true,"label":"Monitoring due x{count}","kind":"red","actions":[]},"record.monitoringDueAmber":{"enabled":true,"label":"Monitoring x{count}","kind":"amber","actions":[]},"detail.monitoringDueRed":{"enabled":true,"label":"Monitoring due x{count}","kind":"red","actions":[]},"detail.monitoringDueAmber":{"enabled":true,"label":"Monitoring x{count}","kind":"amber","actions":[]},"detail.docType":{"enabled":true,"label":"{docType}","kind":"info","actions":[]},"detail.docSpecialty":{"enabled":true,"label":"{specialty}","kind":"info","actions":[]},"queue.monitoringDueRed":{"enabled":false,"label":"Monitoring \\u00d7{count}","kind":"red","actions":[]},"queue.monitoringDueAmber":{"enabled":false,"label":"Monitoring {count}","kind":"amber","actions":[]},"queue.resultUrgent":{"enabled":true,"label":"{name}","kind":"red","actions":[]},"queue.resultAbnormal":{"enabled":true,"label":"{count} abnormal","kind":"amber","actions":[]},"queue.resultRuleUrgent":{"enabled":true,"label":"{name} \\u2014 {rule}","kind":"red","actions":[]},"queue.resultRuleAbnormal":{"enabled":true,"label":"{name} \\u2014 {rule}","kind":"amber","actions":[]},"queue.resultMisprioritised":{"enabled":true,"label":"Under-prioritised","kind":"red","actions":[]},"queue.resultUnmatched":{"enabled":true,"label":"Unmatched patient","kind":"amber","actions":[]},"queue.resultReview":{"enabled":true,"label":"Needs review","kind":"amber","actions":[]},"queue.resultReviewRule":{"enabled":true,"label":"{rule}","kind":"amber","actions":[]},"queue.resultNoGrowth":{"enabled":true,"label":"No growth","kind":"info","actions":[]},"record.stoppStart":{"enabled":true,"label":"Rx review \\u00d7{count}","kind":"amber","actions":[]},"record.riskScores":{"enabled":true,"label":"Risk tools","kind":"info","actions":[{"type":"link","label":"QRISK3 (CVD 10-yr)","url":"https://qrisk.org/"},{"type":"link","label":"QCancer","url":"https://qcancer.org/"},{"type":"link","label":"eFI \\u2014 electronic frailty index (NHSE)","url":"https://www.england.nhs.uk/ourwork/clinical-policy/older-people/frailty/efi/"},{"type":"note","label":"How to use","text":"Signpost only \\u2014 Medicus does not compute these scores.\\n\\nOpen the calculator and enter the inputs from the record:\\n\\u2022 QRISK3: age, sex, ethnicity, smoking, systolic BP, total cholesterol:HDL ratio, BMI, comorbidities\\n\\u2022 QCancer: age, sex, symptoms, comorbidities\\n\\u2022 eFI: coded frailty deficits\\n\\nAlways verify against the patient record."}]}},"resultRules":[{"id":"msu-culture","kind":"text","enabled":true,"builtin":true,"label":"Needs review","normalLabel":"No growth","analyte":{"match":["msu","urine culture","mid-stream urine","mid stream urine","m,c&s","mc&s","culture & sensitivity","culture and sensitivity"]},"normalText":["no growth","no bacterial growth","no significant growth","no organisms isolated","no organism isolated","no growth after"]},{"id":"base-bowel-screening-nonresponder","kind":"text","enabled":true,"builtin":true,"label":"Bowel screening: no response","analyte":{"match":["bcs:fob","bcs fob","bowel cancer screening","faecal occult blood"]},"abnormalText":["no response to bowel cancer screening","no response to bowel screening","non-response to bowel cancer screening","bowel cancer screening programme non-responder","bowel cancer screening non-responder","non-responder","non responder"]},{"id":"base-low-haemoglobin","kind":"threshold","enabled":true,"builtin":true,"label":"Critical low haemoglobin (red <100 g/L)","analyte":{"match":["haemoglobin","hemoglobin"],"exclude":["a1c","glycated","glycosylated"]},"comparator":"below","red":100,"unit":"g/L"},{"id":"base-high-potassium","kind":"threshold","enabled":true,"builtin":true,"label":"Critical high potassium (red \\u22656.5 mmol/L)","analyte":{"match":["potassium"],"exclude":["urine","urinary"]},"comparator":"above","red":6.5,"unit":"mmol/L"},{"id":"base-low-sodium","kind":"threshold","enabled":true,"builtin":true,"label":"Critical low sodium (red \\u2264120 mmol/L)","analyte":{"match":["sodium"],"exclude":["urine","urinary","valproate"]},"comparator":"below","red":120,"unit":"mmol/L"},{"id":"base-low-egfr","kind":"threshold","enabled":true,"builtin":true,"label":"Critical low eGFR (red <15 mL/min/1.73m\\u00b2)","analyte":{"match":["gfr"]},"comparator":"below","red":15,"unit":"mL/min/1.73m\\u00b2"},{"id":"base-low-platelets","kind":"threshold","enabled":true,"builtin":true,"label":"Critical low platelets (red <30 \\u00d710\\u2079/L)","analyte":{"match":["platelet"],"exclude":["mean platelet","volume","ratio","large"]},"comparator":"below","red":30,"unit":"\\u00d710\\u2079/L"},{"id":"base-low-neutrophils","kind":"threshold","enabled":true,"builtin":true,"label":"Critical low neutrophils (red <0.5 \\u00d710\\u2079/L)","analyte":{"match":["neutrophil"],"exclude":["%","percent","ratio"]},"comparator":"below","red":0.5,"unit":"\\u00d710\\u2079/L"},{"id":"base-high-inr","kind":"threshold","enabled":true,"builtin":true,"label":"High INR (red \\u22658)","analyte":{"match":["inr","international normalised ratio","international normalized ratio"]},"comparator":"above","red":8,"unit":"ratio"},{"id":"base-hba1c-prediabetes","kind":"threshold","enabled":true,"builtin":true,"label":"Prediabetes range \\u2014 not on record (HbA1c 42\\u201347)","analyte":{"match":["hba1c","haemoglobin a1c","glycated haemoglobin","glycosylated haemoglobin"]},"comparator":"above","amber":42,"unit":"mmol/mol","suppressIfProblem":{"match":["prediabetes","pre-diabetes","pre-diabetic","impaired glucose","impaired fasting","non-diabetic hyperglycaemia","non-diabetic hyperglycemia","diabetes","diabetic","t1dm","t2dm","diabetes mellitus","type 1 diabetes","type 2 diabetes"],"exclude":["family history","diabetes insipidus","gestational"]}},{"id":"base-hba1c-diabetes","kind":"threshold","enabled":true,"builtin":true,"label":"Possible diabetes \\u2014 not on register (HbA1c \\u226548)","analyte":{"match":["hba1c","haemoglobin a1c","glycated haemoglobin","glycosylated haemoglobin"]},"comparator":"above","red":48,"unit":"mmol/mol","suppressIfProblem":{"match":["diabetes","diabetic","t1dm","t2dm","diabetes mellitus","type 1 diabetes","type 2 diabetes","type i diabetes","type ii diabetes","insulin dependent diabetes","non insulin dependent diabetes"],"exclude":["family history","non-diabetic","pre-diabetic","prediabetes","pre-diabetes","impaired glucose","impaired fasting","diabetes insipidus","gestational"]}}]}`;

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
      } catch (e) {
        // A dropped pattern is a silent clinical gap — log it so a bad pattern
        // is visible, not invisible. The options editor (validateTriageRule)
        // blocks invalid regex at author time; this catches anything that
        // reaches runtime regardless (legacy imports, builtin regressions).
        console.warn(`[Sentinel] rule "${rule.label || rule.id}" pattern ${JSON.stringify(s)} failed to compile and was skipped: ${e.message}`);
      }
    }
    if (!compiled.length) {
      console.warn(`[Sentinel] rule "${rule.label || rule.id}" has no usable patterns after compilation — rule will never fire`);
      return null;
    }
    return { ...rule, _compiled: compiled };
  };

  const recompileRules = () => {
    COMPILED_RULES = (CONFIG?.rules || []).map(compileRule).filter(Boolean);
  };

  // Non-destructive defaults migration. A stored config completely shadows the
  // shipped defaults, so without this users would never receive newly shipped
  // builtin rules (only fresh installs / destructive resets would). When the
  // shipped defaults version is newer than the stored config's, append any
  // builtin rules the user doesn't have (by id), plus missing threshold /
  // pref / systemChip keys. User customisations are never overwritten, and
  // builtins the user deliberately deleted (tracked in removedBuiltins by the
  // options page) are not resurrected. Returns the merged config, or null if
  // nothing to do.
  const mergeShippedDefaults = (cfg) => {
    const shipped = fallbackConfig();
    if (!cfg || !Array.isArray(cfg.rules)) return null;
    if ((cfg.version || 0) >= (shipped.version || 0)) return null;
    const out = { ...cfg, rules: [...cfg.rules] };
    const have = new Set(out.rules.map(r => r && r.id));
    const removed = new Set(out.removedBuiltins || []);
    for (const r of shipped.rules || []) {
      if (r.builtin && !have.has(r.id) && !removed.has(r.id)) out.rules.push(r);
    }
    out.thresholds = { ...(shipped.thresholds || {}), ...(cfg.thresholds || {}) };
    out.prefs = { ...(shipped.prefs || {}), ...(cfg.prefs || {}) };
    out.systemChips = { ...(shipped.systemChips || {}), ...(cfg.systemChips || {}) };
    // Result rules: preserve the user's authored rules and edits, but append any
    // builtin result rules they don't already have by id (so existing users receive
    // newly shipped builtins like the MSU/culture rule), unless deliberately removed.
    out.resultRules = [...(Array.isArray(cfg.resultRules) ? cfg.resultRules : [])];
    const haveRR = new Set(out.resultRules.map(r => r && r.id));
    for (const r of shipped.resultRules || []) {
      if (r.builtin && !haveRR.has(r.id) && !removed.has(r.id)) out.resultRules.push(r);
    }
    out.version = shipped.version;
    return out;
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
        const merged = mergeShippedDefaults(CONFIG);
        if (merged) {
          CONFIG = merged;
          chrome.storage.local.set({ 'triagelens.config': CONFIG }).catch(() => {});
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

  // Memoise the rendered chip HTML per (id, vars). getSystemChip + renderChipHtml
  // are pure for a given config snapshot, so the queue result-triage hot path
  // (re-injecting the same chips across many rows / re-renders) skips the repeated
  // string-building. The memo is cleared whenever config changes (see watchConfig).
  const _chipHtmlMemo = new Map();
  const renderSystemChipHtmlMemo = (id, vars) => {
    const key = id + '|' + JSON.stringify(vars || {});
    let html = _chipHtmlMemo.get(key);
    if (html === undefined) {
      const chip = getSystemChip(id, vars);
      if (!chip) { _chipHtmlMemo.set(key, null); return null; }
      html = renderChipHtml(chip);
      _chipHtmlMemo.set(key, html);
    }
    return html;
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
  // Curly quotes/apostrophes from pasted clinical letters would otherwise defeat
  // patterns written with a straight apostrophe (e.g. "can't cope"); normalise
  // them to ASCII so matching is robust regardless of the source punctuation.
  const normQuotes = (s) => String(s)
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"');

  const getText = (el) => {
    if (!el) return '';
    if (typeof el.innerText === 'string' && el.innerText.length) return normQuotes(el.innerText);
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
    return normQuotes(out.join('').replace(/[ \t]+/g, ' ').replace(/\n[ \t]+/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n').trim());
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

  // STOPP/START-style deterministic prescribing-safety flags. Pure function over
  // a list of medication name strings + patient age; returns tile/chip items.
  // Detection is name-based (no dm+d / ATC class data available), so it sticks to
  // well-established, low-false-positive combinations and is worded as a review
  // prompt — decision support, verify against the record.
  function evaluatePrescribingFlags(meds, age) {
    const NSAIDS = /ibuprofen|naproxen|diclofenac|celecoxib|etoricoxib|meloxicam|piroxicam|tenoxicam|indometh?acin|sulindac|ketoprofen|dexketoprofen|tiaprofenic|mefenamic|tolfenamic|fenoprofen|aceclofenac|nabumetone|etodolac|flurbiprofen/i;
    const TOPICAL = /gel|cream|ointment|topical|patch|spray|eye ?drop|ear ?drop|foam/i;
    const ANTICOAG = /warfarin|apixaban|rivaroxaban|edoxaban|dabigatran|acenocoumarol|phenindione|enoxaparin|dalteparin|tinzaparin|heparin/i;
    const ANTIPLATELET = /aspirin|clopidogrel|ticagrelor|prasugrel|dipyridamole/i;
    const ACEI_ARB = /ramipril|lisinopril|perindopril|enalapril|captopril|trandolapril|fosinopril|quinapril|imidapril|cilazapril|losartan|candesartan|valsartan|irbesartan|olmesartan|telmisartan|azilsartan|eprosartan/i;
    const DIURETIC = /furosemide|frusemide|bumetanide|torasemide|bendroflumethiazide|indapamide|hydrochlorothiazide|chlortalidone|chlorthalidone|metolazone/i;
    const BENZO_Z = /diazepam|lorazepam|temazepam|nitrazepam|oxazepam|chlordiazepoxide|clonazepam|alprazolam|zopiclone|zolpidem|zaleplon/i;
    const GASTRO = /omeprazole|lansoprazole|esomeprazole|pantoprazole|rabeprazole|famotidine|cimetidine|nizatidine|ranitidine/i;

    const list = (meds || []).map(m => String(m || ''));
    const has = (re) => list.some(m => re.test(m));
    const systemicNSAID = list.some(m => NSAIDS.test(m) && !TOPICAL.test(m));
    const items = [];

    if (systemicNSAID && has(ANTICOAG)) {
      items.push({ severity: 'amber', text: 'NSAID + anticoagulant', detail: 'STOPP — major GI bleed risk; review need / gastroprotection' });
    } else if (systemicNSAID && has(ANTIPLATELET)) {
      items.push({ severity: 'amber', text: 'NSAID + antiplatelet', detail: 'STOPP — bleed risk; review need / gastroprotection' });
    }
    if (systemicNSAID && has(ACEI_ARB) && has(DIURETIC)) {
      items.push({ severity: 'amber', text: 'Triple whammy (NSAID + ACEi/ARB + diuretic)', detail: 'AKI risk (PINCER / STOPP) — review' });
    }
    if (age != null && age >= 80 && has(BENZO_Z)) {
      items.push({ severity: 'amber', text: 'Benzodiazepine/Z-drug in age ≥80', detail: 'STOPP — falls & sedation risk; consider deprescribing' });
    }
    // KD-32 — PINCER #1: NSAID in age ≥65 without gastroprotection
    // Fail-closed: age must be known (age != null) and ≥65.
    if (systemicNSAID && age != null && age >= 65 && !has(GASTRO)) {
      items.push({ severity: 'amber', text: 'NSAID in age ≥65 without gastroprotection', detail: 'PINCER #1 — GI bleed risk; consider PPI cover / review NSAID need' });
    }
    return items;
  }

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
    // Risk-tool signpost (deterministic links only — Medicus does not compute scores).
    if (d.banner.age != null && d.banner.age >= 25) pushSys('record.riskScores', { age: d.banner.age });
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

    // STOPP/START-style prescribing flags (NSAID+anticoag, triple whammy, benzo in elderly)
    const rxFlags = evaluatePrescribingFlags(allMeds, d.banner.age);
    rxFlags.forEach(f => {
      sig.meds.level = bumpLevel(sig.meds.level, f.severity);
      sig.meds.items.push(f);
    });
    if (rxFlags.length) pushSys('record.stoppStart', { count: rxFlags.length });

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
  const RULE_CHIP_SEVERITY = { red: 0, amber: 1, green: 2, info: 3 };
  const applyRules = (sig, page, fieldsData) => {
    const matched = matchRules(page, fieldsData);
    // Red chips must never trail amber/info ones: order by severity (stable
    // sort preserves config order within the same severity).
    matched.sort((a, b) =>
      (RULE_CHIP_SEVERITY[a.kind] ?? 9) - (RULE_CHIP_SEVERITY[b.kind] ?? 9));
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
    // Substantiated-overdue (we have dated bloods and they're late) and missing
    // (no recognised monitoring test on record at all) are surfaced together.
    // no_data on a high-risk drug is clinically a red flag — but we must word it
    // honestly ("no recent FBC/…") and never imply an overdue value we can't see.
    const ACTION = ['overdue', 'stale', 'due_soon'];
    const due = chips.filter(c => c && c.type === 'drug-monitoring' &&
      (ACTION.includes(c.status) || c.status === 'no_data'));
    if (due.length === 0) return null;

    // Build an honest detail line for a no_data chip: name the specific tests
    // that have no value on record (not a blanket "no bloods", since a drug like
    // leflunomide also wants BP/weight which a practice may simply not code).
    const missingDetail = (c) => {
      const missing = (c.tests || [])
        .filter(t => t && t.status === 'no_data')
        .map(t => t.name)
        .filter(Boolean);
      if (!missing.length) return 'no monitoring on record';
      return 'no recent ' + missing.join(', ');
    };

    const items = due.map(c => ({
      // Engine emits `drugName`; tolerate `displayName` for forward-compat.
      name: c.displayName || c.drugName || c.label || 'Medication',
      status: c.status,
      // Human detail: for no_data, name the missing tests; otherwise use the
      // engine's readable summary (tolerate a flat `detail` field too).
      detail: c.status === 'no_data'
        ? missingDetail(c)
        : (c.detail || (c.evidence && c.evidence.summary) || c.status)
    }));
    // Red when anything is substantiated-overdue/severely-overdue, OR when a
    // high-risk drug has no recognised monitoring at all (no_data). Amber only
    // when the sole finding is due-soon.
    const level = due.some(c => c.status === 'overdue' || c.status === 'stale' || c.status === 'no_data')
      ? 'red' : 'amber';
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

  const _HTML_ESC = { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' };
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => _HTML_ESC[c]);

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
    return `<span class="ch-chip ch-chip-${escapeHtml(chip.kind)}${cursorClass}"${ruleAttr} title="${escapeHtml(chip.text)}">${escapeHtml(chip.text)}${chevron}</span>`;
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
          window.open(chrome.runtime.getURL('options/options.html'), '_blank');
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
    log('detail rendered', { data, signals, taskDetails, initialReq, docInfo });
  };

  // ---- Queue "absence is not a verdict" legend ----
  // Injected once when on the Investigation Results queue; removed on navigation
  // away.  Guard ID prevents duplicate insertion across SPA re-renders.
  const _QUEUE_LEGEND_ID = 'ch-q-legend-note';

  const injectQueueLegend = () => {
    if (document.getElementById(_QUEUE_LEGEND_ID)) return;
    const el = document.createElement('div');
    el.id = _QUEUE_LEGEND_ID;
    el.className = 'ch-q-legend';
    el.textContent =
      'Triage Lens flags urgent / abnormal results. A row with no flag has not been assessed as normal — open and review every result.';
    document.body.appendChild(el);
  };

  const removeQueueLegend = () => {
    const el = document.getElementById(_QUEUE_LEGEND_ID);
    if (el) el.remove();
  };

  const runQueue = () => {
    teardownQueueObserver();
    hideHud();
    // Clear row-to-UUID mapping so stale UUIDs from a previous queue never
    // inject chips onto wrong rows in the new queue before the fresh
    // ch-task-list-data event arrives. Prune cache entries older than 2×TTL.
    _queueRowUuids.clear();
    // Arm the leading-edge first result-triage pass for this queue entry: the next
    // bridge task-list event fires the pass immediately instead of via the 150ms debounce.
    _firstResultPassPending = true;
    const pruneTs = Date.now() - 2 * _MON_CACHE_TTL;
    for (const [uuid, entry] of _queueMonCache) {
      if (entry.ts && entry.ts < pruneTs) _queueMonCache.delete(uuid);
    }
    injectQueueLegend();
    decorateQueueRows();
    setupQueueObserver();
    scheduleQueueMonitoring();
    scheduleQueueResultTriage();
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
  // The task-list fetch/XHR interception runs in the MAIN world (page-world.js);
  // it re-dispatches 'ch-task-list-data' to the listener below.
  //
  // SECURITY: 'ch-task-list-data' is a window CustomEvent that crosses the
  // MAIN-world / isolated-world boundary. Any script on the Medicus page —
  // including XSS payloads — can forge these events. The bridged data is
  // therefore UNTRUSTED and is validated and capped below before use.
  // It is ONLY used to trigger re-fetches from the authenticated Medicus API;
  // row UUIDs are never rendered into the DOM or trusted as authoritative data.

  // rowIndex → taskUuid for the current queue load. runQueue clears this on every
  // queue (re)entry, which keeps the FETCH path from chasing a previous queue's tasks.
  const _queueRowUuids = new Map();
  // Durable mirror, written ONLY by the bridge task-list event (never cleared by
  // runQueue). Used to RE-INJECT cached result chips after the SPA's re-renders —
  // runQueue's churn keeps emptying _queueRowUuids, and that emptying is exactly what
  // made the chips flash-and-vanish. The bridge owns this map's whole lifecycle.
  const _durableRowMap = new Map();
  // taskUuid → { taskTypeSlug, result, ts } — session-level cache with TTL
  const _queueMonCache = new Map();
  const _MON_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  let _queueMonRunning = false;
  let _queueMonGeneration = 0; // incremented on each new data arrival

  // taskUuid → { overviewURL, priorityDisplay, unmatched, sev, ts } — result-triage cache
  const _queueResultCache = new Map();
  const _RESULT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  let _queueResultRunning = false;
  let _queueResultGeneration = 0;
  // Leading-edge gate: the FIRST result-triage pass per queue entry fires immediately
  // from the bridge handler (skipping the 150ms debounce) so time-to-first-chip drops
  // ~150ms and the fetch overlaps the grid's first paint. Set true in runQueue (where
  // _queueRowUuids is cleared), cleared the first time the bridge fires the pass.
  let _firstResultPassPending = false;

  // Rate-limit constants for ch-task-list-data: max events acted on per window,
  // and the reset period. Defends against a forged-event flood fanning out into
  // unbounded authenticated API calls.
  const _BRIDGE_MAX_EVENTS_PER_WINDOW = 10;
  const _BRIDGE_WINDOW_MS = 5000;
  let _bridgeEventCount = 0;
  let _bridgeWindowTimer = null;

  // UUID shape: 8-4-4-4-12 hex, case-insensitive
  const _BRIDGE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  // taskTypeSlug: alphanumeric + underscores/hyphens, reasonable length
  const _BRIDGE_SLUG_RE = /^[a-zA-Z0-9_-]{1,80}$/;
  // overviewURL: relative path only — /tasks/data/<slug>/overview/<uuid>
  const _OVERVIEW_URL_RE = /^\/tasks\/data\/[A-Za-z0-9_-]+\/overview\/[0-9a-f-]+$/;
  // Maximum rows processed from a single event (cap to prevent fan-out DoS)
  const _BRIDGE_MAX_ROWS = 500;

  // Debounce timer for scheduleQueueMonitoring to coalesce rapid event bursts.
  let _bridgeMonDebounceTimer = null;
  const _BRIDGE_DEBOUNCE_MS = 150;
  // Debounce timer for scheduleQueueResultTriage
  let _bridgeResultDebounceTimer = null;

  window.addEventListener('ch-task-list-data', (e) => {
    // --- Rate-limit: count events in a rolling window ---
    _bridgeEventCount++;
    if (!_bridgeWindowTimer) {
      _bridgeWindowTimer = setTimeout(() => {
        _bridgeEventCount = 0;
        _bridgeWindowTimer = null;
      }, _BRIDGE_WINDOW_MS);
    }
    if (_bridgeEventCount > _BRIDGE_MAX_EVENTS_PER_WINDOW) {
      log('ch-task-list-data: rate limit exceeded, ignoring event');
      return;
    }

    // --- Type/shape validation (bridged data is UNTRUSTED) ---
    const { rows, taskTypeSlug } = e.detail || {};
    if (!Array.isArray(rows) || typeof taskTypeSlug !== 'string') return;
    if (!_BRIDGE_SLUG_RE.test(taskTypeSlug)) return;
    if (pageType() !== 'queue') return;

    _queueRowUuids.clear();
    _durableRowMap.clear();
    // Cap rows processed and validate each entry's shape before acting on it
    const cappedRows = rows.length > _BRIDGE_MAX_ROWS ? rows.slice(0, _BRIDGE_MAX_ROWS) : rows;
    for (const row of cappedRows) {
      if (!row || typeof row !== 'object') continue;
      const { rowIndex, taskUuid } = row;
      // rowIndex must be a non-negative integer
      if (typeof rowIndex !== 'number' || !Number.isFinite(rowIndex) || rowIndex < 0 || (rowIndex | 0) !== rowIndex) continue;
      // taskUuid must be a plausible UUID string
      if (typeof taskUuid !== 'string' || !_BRIDGE_UUID_RE.test(taskUuid)) continue;
      _queueRowUuids.set(rowIndex, taskUuid);
      _durableRowMap.set(rowIndex, taskUuid);
      if (!_queueMonCache.has(taskUuid)) _queueMonCache.set(taskUuid, { taskTypeSlug });

      // Validate and cache result-triage fields (UNTRUSTED — strict rules)
      const rawOverview = row.overviewURL;
      const rawPriority = row.priorityDisplay;
      const rawUnmatched = row.unmatched;
      const overviewURL = (typeof rawOverview === 'string' && _OVERVIEW_URL_RE.test(rawOverview))
        ? rawOverview : '';
      const priorityDisplay = String(rawPriority != null ? rawPriority : '').slice(0, 40);
      const unmatched = !!rawUnmatched;
      // Only store/update entry if we don't have a fresh sev already
      const existing = _queueResultCache.get(taskUuid);
      if (!existing) {
        _queueResultCache.set(taskUuid, { overviewURL, priorityDisplay, unmatched });
      } else {
        // Update metadata but keep cached sev if still fresh
        existing.overviewURL = overviewURL;
        existing.priorityDisplay = priorityDisplay;
        existing.unmatched = unmatched;
      }
    }

    // Debounce the monitoring trigger to coalesce event bursts into a single pass
    clearTimeout(_bridgeMonDebounceTimer);
    _bridgeMonDebounceTimer = setTimeout(scheduleQueueMonitoring, _BRIDGE_DEBOUNCE_MS);
    // Result triage trigger. _queueRowUuids/_durableRowMap are already populated by the
    // synchronous loop above, so the leading-edge FIRST pass per queue entry can fire
    // immediately (skipping the 150ms debounce) to overlap the grid's first paint. The
    // _queueResultRunning latch + the post-Promise.all generation re-run coalesce this
    // leading call with any trailing debounced one (the trailing one early-returns while
    // the first runs, then re-runs once), so it cannot double-fetch. Subsequent events
    // for this queue entry use the debounce as before.
    if (_firstResultPassPending) {
      _firstResultPassPending = false;
      clearTimeout(_bridgeResultDebounceTimer);
      scheduleQueueResultTriage();
    } else {
      clearTimeout(_bridgeResultDebounceTimer);
      _bridgeResultDebounceTimer = setTimeout(scheduleQueueResultTriage, _BRIDGE_DEBOUNCE_MS);
    }
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
    const host = queueChipHost(row, '.ch-q-mon');
    if (!host) return;
    const span = document.createElement('span');
    span.className = host.inPreview ? 'ch-q-mon' : 'ch-q-mon ch-q-mon-inline';
    span.innerHTML = renderChipHtml(chip);
    // Always prepend (see injectResultChip — appended nodes are reconciled away).
    host.target.insertBefore(span, host.target.firstChild);
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

  // ---- Queue result-triage chips ----
  // Mirror of the monitoring pipeline but for Investigation Results tasks.
  // Uses the engine globals: SentinelApiClient, SentinelNormalisers, SentinelResultSeverity.

  // Pure chip-selection helper — exported for unit testing via regex extraction.
  // Returns an array of { id, vars } for the chips to show for a given severity result.
  function selectResultChips(sev) {
    if (!sev) return [];
    const chips = [];
    // The salient result's rule label (set when a user/base rule RAISED severity above
    // the lab flag) — lets us show an attributable chip instead of a generic one.
    const ruleLabel = sev.top && sev.top.ruleLabel ? sev.top.ruleLabel : null;
    const topName = sev.top ? sev.top.name : '';
    // Clinical severity chips (urgent/abnormal) — highest priority, shown first
    if (sev.level === 'red' && sev.urgentCount > 0) {
      if (ruleLabel) {
        chips.push({ id: 'queue.resultRuleUrgent', vars: { name: topName, rule: ruleLabel } });
      } else {
        chips.push({ id: 'queue.resultUrgent', vars: { name: topName, count: sev.urgentCount } });
      }
    } else if (sev.level === 'amber') {
      if (ruleLabel) {
        chips.push({ id: 'queue.resultRuleAbnormal', vars: { name: topName, rule: ruleLabel } });
      } else {
        chips.push({ id: 'queue.resultAbnormal', vars: { count: sev.abnormalCount } });
      }
    }
    // Text-rule review chips — after clinical severity, before meta process chips.
    // A specifically-labelled text rule (e.g. bowel screening non-responder) shows its own
    // label via the attributable chip; the generic "Needs review" covers cultures (whose
    // rule label is itself "Needs review").
    if (sev.reviewCount > 0) {
      const reviewLabel = sev.reviewTop && sev.reviewTop.label ? String(sev.reviewTop.label) : '';
      if (reviewLabel && reviewLabel !== 'Needs review') {
        chips.push({ id: 'queue.resultReviewRule', vars: { rule: reviewLabel } });
      } else {
        chips.push({ id: 'queue.resultReview', vars: { count: sev.reviewCount } });
      }
    }
    if (sev.noGrowthCount > 0) chips.push({ id: 'queue.resultNoGrowth', vars: { count: sev.noGrowthCount } });
    // Meta/process chips (outline, not filled) — last
    if (sev.misprioritised) chips.push({ id: 'queue.resultMisprioritised', vars: {}, meta: true });
    if (sev.unmatched) chips.push({ id: 'queue.resultUnmatched', vars: {}, meta: true });
    return chips;
  }

  const computeQueueRowResult = async (taskUuid) => {
    const urgentCfg  = findSystemChip('queue.resultUrgent');
    const abnormalCfg = findSystemChip('queue.resultAbnormal');
    const ruleUrgentCfg = findSystemChip('queue.resultRuleUrgent');
    const ruleAbnormalCfg = findSystemChip('queue.resultRuleAbnormal');
    const misPriCfg  = findSystemChip('queue.resultMisprioritised');
    const unmatchCfg = findSystemChip('queue.resultUnmatched');
    const anyEnabled = [urgentCfg, abnormalCfg, ruleUrgentCfg, ruleAbnormalCfg, misPriCfg, unmatchCfg]
      .some(c => c && c.enabled !== false);
    if (!anyEnabled) return null;
    const API  = window.SentinelApiClient;
    const NORM = window.SentinelNormalisers;
    const SEV  = window.SentinelResultSeverity;
    if (!API || !NORM || !SEV) { log('queue-result: globals not loaded', taskUuid); return null; }
    const ctx = API.detectMedicusContext(location.href);
    if (!ctx) { log('queue-result: no medicus context'); return null; }
    const entry = _queueResultCache.get(taskUuid);
    if (!entry || !entry.overviewURL) { log('queue-result: no overviewURL', taskUuid); return null; }
    let raw;
    try { raw = await API.fetchInvestigationReport(ctx.apiBase, entry.overviewURL); }
    catch (e) { log('queue-result: fetchInvestigationReport threw', e.message); return null; }
    const report = NORM.normaliseInvestigationReport(raw);
    const resultRules = (CONFIG && Array.isArray(CONFIG.resultRules))
      ? CONFIG.resultRules.filter(r => r && r.enabled !== false)
      : [];

    // Patient-record suppression (e.g. "possible new diabetes" rules): fetch the
    // problem list ONLY when a suppressIfProblem rule's analyte is actually present
    // in this report — most reports (FBC, U&E) never trigger this extra fetch.
    let problems = [];
    try {
      const suppressRules = resultRules.filter(
        r => r && r.suppressIfProblem && r.analyte && Array.isArray(r.analyte.match)
      );
      if (suppressRules.length && report.patientUuid && Array.isArray(report.results)) {
        const names = report.results.map(r => String((r && r.name) || '').toLowerCase());
        const relevant = suppressRules.some(r =>
          r.analyte.match.some(
            m => typeof m === 'string' && m && names.some(n => n.includes(m.toLowerCase()))
          )
        );
        if (relevant) {
          const apiResults = await API.fetchAll(ctx.apiBase, report.patientUuid);
          const normalised = NORM.normaliseAll(apiResults, {
            url: location.href, title: '', view: null,
            patientUuid: report.patientUuid, resolutionSource: 'queue-result-suppress'
          });
          problems = Array.isArray(normalised.problems) ? normalised.problems : [];
        }
      }
    } catch (e) { log('queue-result: problem fetch failed', e.message); }

    const sev = SEV.evaluateReportSeverity(report, {
      priorityDisplay: entry.priorityDisplay,
      resultRules,
      problems
    });
    log('queue-result: sev for', taskUuid, '=', sev && sev.level, '(rules=' + resultRules.length + ')');
    return sev;
  };

  const injectResultChip = (rowIndex, sev) => {
    if (!sev) return;
    const row = document.querySelector(`.ag-row[row-index="${rowIndex}"]:not(.ag-full-width-row)`);
    if (!row) return;
    const chipDefs = selectResultChips(sev);
    if (!chipDefs.length) return;
    const built = chipDefs
      .map((d) => ({ html: renderSystemChipHtmlMemo(d.id, d.vars), meta: !!d.meta }))
      .filter((b) => b.html);
    if (!built.length) return;
    const host = queueChipHost(row, '.ch-q-result');
    if (!host) return;
    const span = document.createElement('span');
    span.className = host.inPreview ? 'ch-q-result' : 'ch-q-result ch-q-result-inline';
    span.setAttribute('role', 'note');
    span.innerHTML = built.map((b) => b.html).join('');
    // Always PREPEND. Appending to the end of the (Vue-managed) patient-name cell
    // gets reconciled away by Medicus's renderer on its next re-render; prepending
    // before the cell's own content survives. The name stays visible via the CSS
    // width-cap on .ch-q-result-inline, not by position.
    host.target.insertBefore(span, host.target.firstChild);
    log('queue-result: chip injected', rowIndex, 'inPreview=' + host.inPreview);
    const rendered = span.querySelectorAll('.ch-chip');
    built.forEach((b, i) => { if (b.meta && rendered[i]) rendered[i].classList.add('ch-chip-meta'); });
  };

  // Re-inject result chips straight from the per-task cache, keyed by each row's own
  // `row-id` (the task UUID) read from the DOM — exactly how the durable age/decoration
  // chips work. This does NOT depend on the bridge-provided `_queueRowUuids` map (which
  // the Medicus SPA churn keeps clearing to 0), so chips survive every re-render.
  // injectResultChip de-dupes, and a wipe immediately precedes this call, so it's a
  // clean, synchronous restore with no visible gap.
  const reinjectCachedResultChips = () => {
    let n = 0;
    // Iterate only the ON-SCREEN rows (AG-Grid virtualises — only a handful of the
    // N rows exist in the DOM at any time), not the whole _durableRowMap, so the
    // sweep cost scales with what's visible rather than the full snapshot. Each
    // visible row is STILL keyed via _durableRowMap.get(rowIndex) → taskUuid →
    // _queueResultCache sev (survives the runQueue churn that empties
    // _queueRowUuids), still honours _RESULT_CACHE_TTL + null/undefined skip, and
    // injectResultChip de-dupes so this stays idempotent across re-renders.
    const scope = queueScope();
    scope.querySelectorAll('.ag-row[row-index]:not(.ag-full-width-row)').forEach((row) => {
      const ri = row.getAttribute('row-index');
      if (ri == null) return;
      const rowIndex = Number(ri);
      const taskUuid = _durableRowMap.get(rowIndex);
      if (!taskUuid) return;
      const entry = _queueResultCache.get(taskUuid);
      if (!entry || entry.sev === undefined || entry.sev === null) return;
      if (!entry.ts || (Date.now() - entry.ts) > _RESULT_CACHE_TTL) return;
      injectResultChip(rowIndex, entry.sev);
      n++;
    });
    if (n) log('queue-result: re-injected ' + n + ' cached chip(s) from durable map (visible rows)');
  };

  // Rolling rate-limit for result fetches: max 90 fetches per 60s window.
  let _resultFetchCount = 0;
  let _resultFetchWindowTimer = null;
  const _RESULT_FETCH_MAX = 90;
  // Soft threshold (80% of budget): below it we run at the fast inter-fetch delay;
  // above it we ease the delay up to throttle as we approach the hard cap.
  const _RESULT_FETCH_SOFT = Math.floor(_RESULT_FETCH_MAX * 0.8);
  const _RESULT_FETCH_WINDOW_MS = 60000;
  // Short retry window for a failed (null) result fetch, so a transient error or a
  // flaky HIGH result re-surfaces soon instead of being cached blank for the full TTL.
  const _RESULT_RETRY_MS = 20000;

  const scheduleQueueResultTriage = async () => {
    const gen = ++_queueResultGeneration;
    if (_queueResultRunning) return;
    _queueResultRunning = true;
    log('queue-result: triage start, rows=' + _queueRowUuids.size + ', gen=' + gen);

    // Fetch ordering: on-screen rows first (so the ~dozen visible rows tag in a
    // couple of seconds), then High/Urgent/Immediate priority as the
    // within-partition tiebreak. AG-Grid virtualises, so the on-screen set is the
    // small subset of rows currently in the DOM. Comparator is stable: equal keys
    // keep their original _queueRowUuids insertion order.
    const onScreen = new Set();
    queueScope().querySelectorAll('.ag-row[row-index]:not(.ag-full-width-row)').forEach((row) => {
      const ri = row.getAttribute('row-index');
      if (ri != null) onScreen.add(Number(ri));
    });
    const sorted = [..._queueRowUuids.entries()].sort(([ia, ua], [ib, ub]) => {
      const aVis = onScreen.has(ia);
      const bVis = onScreen.has(ib);
      if (aVis !== bVis) return (bVis ? 1 : 0) - (aVis ? 1 : 0);
      const aHigh = /high|urgent|immediate/i.test((_queueResultCache.get(ua) || {}).priorityDisplay || '');
      const bHigh = /high|urgent|immediate/i.test((_queueResultCache.get(ub) || {}).priorityDisplay || '');
      return (bHigh ? 1 : 0) - (aHigh ? 1 : 0);
    });

    const CONCURRENCY = 5;
    let idx = 0;
    let aborted = false;

    const worker = async () => {
      while (idx < sorted.length) {
        // Do NOT abort on a generation change. The SPA churn bumps the generation
        // constantly, which used to starve this pass — only the first few of N rows
        // got tagged before every restart. Run the whole snapshot; if a genuinely new
        // generation was requested, the tail below re-runs once we've finished.
        if (pageType() !== 'queue') { aborted = true; break; }
        const [rowIndex, taskUuid] = sorted[idx++];
        // Rolling fetch budget
        if (!_resultFetchWindowTimer) {
          _resultFetchWindowTimer = setTimeout(() => {
            _resultFetchCount = 0;
            _resultFetchWindowTimer = null;
          }, _RESULT_FETCH_WINDOW_MS);
        }
        const entry = _queueResultCache.get(taskUuid);
        const fresh = entry && entry.sev !== undefined && entry.ts && (Date.now() - entry.ts) <= _RESULT_CACHE_TTL;
        if (fresh) {
          injectResultChip(rowIndex, entry.sev);
        } else {
          if (_resultFetchCount >= _RESULT_FETCH_MAX) continue; // skip, don't throw
          _resultFetchCount++;
          const sev = await computeQueueRowResult(taskUuid);
          if (_queueResultCache.has(taskUuid)) {
            const e2 = _queueResultCache.get(taskUuid);
            e2.sev = sev;
            // A failed fetch (null — transient error / flaky HIGH result) gets only a
            // SHORT retry window so it re-surfaces on a later pass; a real result keeps
            // the full TTL. Without this a one-off error blanked the row for 5 minutes.
            e2.ts = sev === null ? Date.now() - _RESULT_CACHE_TTL + _RESULT_RETRY_MS : Date.now();
          }
          injectResultChip(rowIndex, sev);
          // Budget-aware inter-fetch delay (only on actual fetches, not cache hits):
          // ON-SCREEN rows get ZERO delay — the ~12 visible rows are well under the
          // 90/60s budget and the browser's ~6-connection-per-host ceiling, so firing
          // them with no inter-fetch sleep is safe and removes ~300ms of pure sleep from
          // the perceived time-to-tag. OFF-SCREEN rows keep the throttle: fast 100ms base
          // while we're under the soft threshold; once we cross it, ease linearly from
          // 100ms up to 1000ms across the last 20% of the budget so the tail backs off as
          // it approaches the hard cap rather than slamming into it. The budget cap +
          // 60s rolling reset (not the delay) remain the rate-limit protection.
          const over = Math.max(0, _resultFetchCount - _RESULT_FETCH_SOFT);
          const delay = onScreen.has(rowIndex)
            ? 0
            : 100 + Math.round((over / (_RESULT_FETCH_MAX - _RESULT_FETCH_SOFT || 1)) * 900);
          if (delay > 0) await new Promise(res => setTimeout(res, delay));
        }
      }
    };

    try {
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    } finally {
      // Always release the latch — if a worker throws, leaving this set would
      // permanently block every future result-triage pass for the session.
      _queueResultRunning = false;
    }
    if (_queueResultGeneration !== gen) scheduleQueueResultTriage();
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

  // Where to host a row's injected chips, and whether to prepend or append.
  // Detail/preview-row layouts: prepend into the roomy preview row (as designed).
  // Flat single-line queues (no detail row): fall back to the patient-name cell
  // and APPEND — after the name + Medicus badges — so long result chips never push
  // the patient name out of the fixed-width cell. Returns null if no host or a chip
  // (matching `marker`) is already present.
  const queueChipHost = (row, marker) => {
    const previewRow = findQueuePreviewRow(row);
    const target = previewRow
      ? (previewRow.querySelector('.h-full.w-full') || previewRow.firstElementChild || previewRow)
      : row.querySelector('[col-id="patientName"]');
    if (!target || (marker && target.querySelector(marker))) return null;
    return { target, inPreview: !!previewRow };
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

  // Restrict per-frame queue DOM sweeps to the live AG-Grid container when we have
  // one attached; fall back to `document` so behaviour is identical when the
  // container isn't (yet) tracked. Used by the wipe/re-decorate/re-inject hot paths.
  const queueScope = () => (queueObservedContainer && document.contains(queueObservedContainer)) ? queueObservedContainer : document;

  // Fully tear down the queue observer and forget the container reference.
  // Called whenever we navigate AWAY from the queue so that the next visit
  // to the queue page always rebuilds against the current (possibly fresh) DOM.
  const teardownQueueObserver = () => {
    if (queueObserver) { queueObserver.disconnect(); queueObserver = null; }
    queueObservedContainer = null;
    queueRafScheduled = false;
    removeQueueLegend();
  };

  const refreshQueueChips = () => {
    log('queue: refreshQueueChips, rows=' + _queueRowUuids.size);
    if (queueObserver) queueObserver.disconnect();
    queueScope().querySelectorAll('.ch-queue-chips, .ch-q-mon, .ch-q-result').forEach(s => s.remove());
    queueScope().querySelectorAll('.ag-row').forEach(r => { delete r.dataset[QUEUE_DECORATED_KEY]; });
    decorateQueueRows();
    // Restore result chips synchronously from the per-task cache via each row's row-id.
    // DOM-driven (like the age chips) so they survive re-renders even when the
    // bridge-provided row->task map is transiently empty (the SPA keeps clearing it).
    reinjectCachedResultChips();
    // Re-arm the SAME observer (cheap) after the self-write disconnect above, so we
    // don't leave it disconnected — only rebuild from scratch if the container is
    // actually gone (SPA tore down AG-Grid). Do NOT null out queueObservedContainer
    // first: that would force a needless full rebuild on every grid mutation.
    if (queueObserver && queueObservedContainer && document.contains(queueObservedContainer)) {
      queueObserver.observe(queueObservedContainer, { childList: true, subtree: true });
    } else {
      setupQueueObserver();
    }
    // Result-chip DISPLAY is handled synchronously by reinjectCachedResultChips above.
    // Do NOT kick a fetch pass from here: refreshQueueChips fires on every grid mutation,
    // so doing so re-started/aborted the fetch worker and starved it (only the first few
    // of N rows ever got tagged). Fetching is driven by the bridge task-list event +
    // runQueue; this call only re-displays what's already cached.
    if (_queueRowUuids.size > 0) scheduleQueueMonitoring();
  };

  // True when EVERY element node added/removed in this mutation batch is one of our own
  // injected chips. The async injectors (injectResultChip / injectQueueMonitoringChip) run
  // while the observer is LIVE during the fetch pass, so each injected chip is a childList
  // mutation that would otherwise schedule another refreshQueueChips — tagging ~12 visible
  // rows spawned ~12 spurious refresh cycles. Ignoring these batches removes that
  // self-trigger; genuine grid mutations (rows added/removed by AG-Grid) still schedule a
  // refresh. An empty/text-only batch returns true (nothing relevant changed → skip).
  const _isOwnChipMutation = (mutations) => {
    for (const m of mutations) {
      for (const nodes of [m.addedNodes, m.removedNodes]) {
        for (const n of nodes) {
          if (n.nodeType !== 1) continue; // ignore text nodes
          const cl = n.classList;
          if (!cl) return false;
          if (!(cl.contains('ch-q-result') || cl.contains('ch-q-mon') || cl.contains('ch-queue-chips') || cl.contains('ch-chip'))) return false;
        }
      }
    }
    return true; // every element node added/removed was one of ours
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
    queueObserver = new MutationObserver((mutations) => {
      // Ignore batches that are entirely our own async chip injections — they would
      // otherwise self-trigger a refresh per chip during the tag burst. Genuine grid
      // mutations still fall through to the coalesced rAF refresh below.
      if (_isOwnChipMutation(mutations)) return;
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

    const onMove = (e) => {
      if (!dragging) return;
      const left = Math.max(0, Math.min(window.innerWidth - 60, sl + (e.clientX - sx)));
      const top  = Math.max(0, Math.min(window.innerHeight - 40, st + (e.clientY - sy)));
      hud.style.left = left + 'px';
      hud.style.top = top + 'px';
      hud.style.right = 'auto';
    };
    // End the drag and tear down every transient listener. Also fires on window
    // blur so a drag interrupted by an alt-tab (mouseup never delivered) can't
    // leave a live mousemove handler clamped to the HUD.
    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', endDrag);
      window.removeEventListener('blur', endDrag);
      try {
        const r = hud.getBoundingClientRect();
        localStorage.setItem(POS_KEY, JSON.stringify({ left: r.left, top: r.top }));
      } catch (e) {}
    };
    const onDown = (e) => {
      if (e.target.closest('button')) return;
      const rect = hud.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY;
      sl = rect.left; st = rect.top;
      dragging = true;
      e.preventDefault();
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', endDrag);
      window.addEventListener('blur', endDrag);
    };
    header.addEventListener('mousedown', onDown);
  };

  // ---- SPA route detection ----
  const setupRouteWatcher = () => {
    let pending, pendingSlow;
    const onRoute = () => {
      // Two-stage: short delay to let SPA swap DOM, longer delay to catch slow
      // rerenders. BOTH timers are stored and cleared on each route change —
      // previously the 1200ms timer was fire-and-forget, so rapid SPA navigation
      // (journal-search churn, queue scrolling) stacked an uncancellable run(true)
      // per change, each triggering a full 4-endpoint fetch cascade.
      clearTimeout(pending);
      clearTimeout(pendingSlow);
      pending = setTimeout(() => run(true), 250);
      pendingSlow = setTimeout(() => run(true), 1200);
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

  // Load config first, then start. Config drives rule matching.
  loadConfig().then(() => {
    waitFor(pageReady, () => {
      run(true);
      setupRouteWatcher();
    });
    watchConfig(() => {
      // Config changed — invalidate cached result severities so edited/enabled
      // result rules are recomputed on the next pass (not re-injected stale),
      // then wipe + redo queue chips and re-render the HUD.
      for (const entry of _queueResultCache.values()) { entry.sev = undefined; entry.ts = 0; }
      // The memoised chip HTML is config-derived too — drop it so edited labels/
      // kinds re-render rather than serving the stale cached string.
      _chipHtmlMemo.clear();
      if (pageType() === 'queue') refreshQueueChips();
      run(true);
    });
  }).catch(e => console.error('[TriageLens] init failed', e));

  // Expose for manual re-trigger (demo / testing / SPA edge cases)
  window.__clinHudRun = () => run(true);

})();
