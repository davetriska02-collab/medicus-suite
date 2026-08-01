// scripts/build-coder-demo.js — generates the Document Coder interactive demo
// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
//
// Run with: node scripts/build-coder-demo.js
// Output:   docs/plans/document-coder-demo.html (committed alongside)
//
// The demo inlines the REAL engine/letter-extract.js and engine/letter-delta.js
// verbatim (they attach window globals when module.exports is absent), so the
// page always exercises the shipped engines — regenerate after any engine
// change; test-coder-demo-fresh.js fails CI if the inlined copy drifts.
// Paste a letter + a problem list, see the pipeline's honest output. Dev/demo
// tool only: nothing here ships in the extension, and it embeds the same
// four-state honesty rules the product card will (no all-clear rendering).
// Use synthetic or fully anonymised text only — the page itself says so.

'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const extract = fs.readFileSync(path.join(root, 'engine', 'letter-extract.js'), 'utf8');
const delta = fs.readFileSync(path.join(root, 'engine', 'letter-delta.js'), 'utf8');

const SAMPLE_LETTER = `Anytown District General Hospital
Discharge summary

Diagnoses:
1. Community acquired pneumonia
2. AKI on CKD stage 3a - resolved
3. ?Pulmonary embolism - excluded on CTPA
4. Previous myocardial infarction (2019)
5. New atrial fibrillation, rate controlled on ward
6. CKD stage 3b (eGFR 42, deterioration from stage 3a)

Medications on discharge:
1. Apixaban 5 mg twice daily - started
2. Aspirin 75 mg once daily - stopped

We noted new atrial fibrillation on the post-operative ECG. For GP to arrange
anticoagulation review and repeat U&E in 2 weeks.`;

const SAMPLE_PROBLEMS = `Chronic kidney disease stage 3a
Type 2 diabetes mellitus | active
Myocardial infarction | resolved
Hypertension`;

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Document Coder — live engine demo (generated ${new Date().toISOString().slice(0, 10)})</title>
<style>
:root{--bg:#f8fafc;--mid:#f1f5f9;--elev:#fff;--bd:#cbd5e1;--t1:#0f172a;--t2:#1e3a5f;--t3:#475569;--t4:#556377;
--red:#dc2626;--red-d:rgba(220,38,38,.08);--red-l:rgba(220,38,38,.3);--amb:#b45309;--amb-d:rgba(180,83,9,.09);--amb-l:rgba(180,83,9,.32);
--grn:#16a34a;--grn-d:rgba(22,163,74,.09);--grn-l:rgba(22,163,74,.3);--acc:#2563eb;--acc-d:rgba(37,99,235,.09);--acc-l:rgba(37,99,235,.3);
--mono:ui-monospace,Menlo,Consolas,monospace}
*{box-sizing:border-box;margin:0}
body{background:var(--bg);color:var(--t2);font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:20px}
h1{font-size:16px;color:var(--t1);margin-bottom:4px}
.warn{font-size:11px;color:var(--amb);background:var(--amb-d);border:1px solid var(--amb-l);border-radius:6px;padding:6px 10px;margin:8px 0 14px;max-width:900px}
.cols{display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start}
.in{width:430px}.out{width:430px}
label{font:600 10px var(--mono);text-transform:uppercase;letter-spacing:.06em;color:var(--t4);display:block;margin:10px 0 4px}
textarea{width:100%;background:var(--elev);border:1px solid var(--bd);border-radius:6px;color:var(--t1);font:12px/1.4 var(--mono);padding:8px}
button{font:600 10px var(--mono);text-transform:uppercase;background:var(--acc);color:#fff;border:none;border-radius:6px;padding:8px 16px;margin-top:10px;cursor:pointer}
.card{background:var(--elev);border:1px solid var(--bd);border-radius:8px;overflow:hidden;font-size:12px}
.st{display:inline-block;font:600 10px var(--mono);border-radius:4px;padding:2px 8px;border:1px solid;margin:10px 12px 4px}
.st.ok{color:var(--acc);background:var(--acc-d);border-color:var(--acc-l)}
.st.none{color:var(--amb);background:var(--amb-d);border-color:var(--amb-l)}
.st.fail{color:var(--red);background:var(--red-d);border-color:var(--red-l);font-size:12px}
.cov{font:500 10px var(--mono);color:var(--t3);padding:2px 12px 8px;border-bottom:1px solid var(--bd)}
.cov b{color:var(--amb)}
.sec{padding:8px 12px 2px}
.sec h3{font-size:11px;color:var(--t2);margin-bottom:6px}
.row{border:1px solid var(--bd);border-radius:6px;padding:6px 9px;margin-bottom:6px}
.row.new{border-color:var(--red-l);background:var(--red-d)}
.row.conflict{border-color:var(--amb-l);background:var(--amb-d)}
.row.act{border-color:var(--red-l);background:var(--red-d)}
.term{font-weight:600;color:var(--t1)}
.tag{font:600 9px var(--mono);border-radius:4px;padding:1px 6px;border:1px solid;float:right}
.tag.v-new{color:var(--red);background:var(--red-d);border-color:var(--red-l)}
.tag.v-match{color:var(--grn);background:var(--grn-d);border-color:var(--grn-l)}
.tag.v-conf{color:var(--amb);background:var(--amb-d);border-color:var(--amb-l)}
.tag.v-not{color:var(--t4);background:var(--mid);border-color:var(--bd)}
.src{font-size:11px;color:var(--t3);font-style:italic;margin-top:3px;padding-left:8px;border-left:2px solid var(--bd)}
.why{font:500 9px var(--mono);color:var(--t4);margin-top:3px}
.mno{color:var(--t3);text-decoration:line-through;text-decoration-thickness:1px}
.fine{font-size:10px;color:var(--t4);padding:8px 12px;border-top:1px solid var(--bd);background:var(--mid)}
</style></head><body>
<h1>Document Coder — live engine demo</h1>
<div class="warn"><b>Synthetic or fully anonymised text only.</b> Everything runs locally in this page (view source: the shipped engines are inlined verbatim). Generated by scripts/build-coder-demo.js — regenerate after engine changes.</div>
<div class="cols">
  <div class="in">
    <label>Letter text</label>
    <textarea id="letter" rows="20">${SAMPLE_LETTER}</textarea>
    <label>Coded problem list (one per line, optional "| status")</label>
    <textarea id="problems" rows="6">${SAMPLE_PROBLEMS}</textarea>
    <button onclick="run()">Run the engines</button>
  </div>
  <div class="out"><div id="card" class="card"></div></div>
</div>
<script>
${extract}
${delta}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function run(){
  const L=window.SuiteLetterExtract, D=window.SuiteLetterDelta;
  const text=document.getElementById('letter').value;
  const problems=document.getElementById('problems').value.split('\\n').map(l=>l.trim()).filter(Boolean)
    .map(l=>{const [d,s]=l.split('|').map(x=>x.trim());return {description:d,status:s||'active'}});
  const r=L.assessLetterText(text);
  let h='';
  if(r.state==='could-not-read'){
    h+='<div style="padding:16px;text-align:center"><span class="st fail">COULD NOT READ</span>'+
       '<p style="margin-top:8px"><b>This document could not be read'+(r.reason?' ('+esc(r.reason)+')':'')+'.</b> Nothing has been checked — full manual review required.</p></div>';
  } else {
    h+='<span class="st '+(r.state==='assessed'?'ok':'none')+'">'+(r.state==='assessed'?'ASSESSED':'NOTHING ANCHORED — not assessed')+'</span>';
    h+='<div class="cov">'+r.coverage.assessedLines+' of '+r.coverage.totalContentLines+' content lines in anchored sections · <b>'+r.coverage.unanchoredLines+' not assessed</b></div>';
    if(r.actions.length){h+='<div class="sec"><h3>Action flags (whole-text, escalate-only)</h3>';
      for(const a of r.actions){h+='<div class="row act"><span class="term">'+esc(a.kind)+'</span><div class="src">"'+esc(a.sourceLine)+'"</div><div class="why">trigger: '+esc(a.phrase)+' · line '+a.lineNo+'</div></div>'}h+='</div>'}
    const dl=D.computeDelta(r.candidates.filter(c=>c.offered),problems);
    const off=dl.filter(x=>x.verdict!=='probable-match'), match=dl.filter(x=>x.verdict==='probable-match');
    if(off.length){h+='<div class="sec"><h3>Offered candidates vs record</h3>';
      for(const x of off){const cls=x.verdict==='possibly-new'?'new':'conflict';
        const tag=x.verdict==='possibly-new'?'v-new':'v-conf';
        h+='<div class="row '+cls+'"><span class="tag '+tag+'">'+esc(x.verdict)+(x.conflict?' · '+esc(x.conflict.kind)+(x.conflict.letter?' '+esc(x.conflict.letter)+' vs '+esc(x.conflict.record):''):'')+'</span>'+
           '<span class="term">'+esc(x.candidate.term)+'</span>'+
           '<div class="src">"'+esc(x.candidate.sourceSentence)+'"</div>'+
           (x.matchedProblem?'<div class="why">record has: '+esc(x.matchedProblem.description)+' ('+esc(x.matchedProblem.status)+')</div>':'')+
           (x.nearestMiss?'<div class="why">nearest miss: '+esc(x.nearestMiss.description)+'</div>':'')+'</div>'}
      h+='</div>'}
    if(match.length){h+='<div class="sec"><h3>Probable matches — confirm, not skip</h3>';
      for(const x of match){h+='<div class="row"><span class="tag v-match">probable-match</span><span class="term">'+esc(x.candidate.term)+'</span><div class="why">record has: '+esc(x.matchedProblem.description)+'</div></div>'}h+='</div>'}
    const notOff=r.candidates.filter(c=>!c.offered);
    if(notOff.length){h+='<div class="sec"><h3>Mentioned — not offered for coding</h3>';
      for(const c of notOff){h+='<div class="row"><span class="tag v-not">'+esc(c.status)+'</span><span class="term mno">'+esc(c.term)+'</span><div class="why">trigger: '+esc(c.statusEvidence||'')+'</div></div>'}h+='</div>'}
    if(r.meds.length){h+='<div class="sec"><h3>Medication lines</h3>';
      for(const m of r.meds){h+='<div class="row"><span class="tag '+(m.change==='unparsed'?'v-new':'v-not')+'">'+esc(m.change)+'</span><span class="term">'+esc(m.name||'(name not extracted)')+'</span>'+(m.doseText?'<div class="why">'+esc(m.doseText)+'</div>':'')+'</div>'}h+='</div>'}
  }
  h+='<div class="fine">Suggestions only — nothing here means the letter is reconciled. Absence of a row asserts nothing.</div>';
  document.getElementById('card').innerHTML=h;
}
run();
</script></body></html>`;

const out = path.join(root, 'docs', 'plans', 'document-coder-demo.html');
fs.writeFileSync(out, html);
console.log(`written ${out} (${html.length} bytes; engines inlined verbatim)`);
