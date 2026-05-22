'use strict';

// ══ PDF.JS WORKER ══════════════════════════════════════════════════════════
// Worker is shipped as a same-origin extension resource. Use chrome.runtime
// .getURL so pdf.js loads it as a real Worker (not the slow main-thread "fake
// worker" fallback). Falls back to a relative URL if chrome.runtime isn't
// available (e.g. when serving the file outside the extension during dev).
pdfjsLib.GlobalWorkerOptions.workerSrc =
  (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL)
    ? chrome.runtime.getURL('vendor/pdf.worker.min.js')
    : './vendor/pdf.worker.min.js';

// ══ CONSTANTS ══════════════════════════════════════════════════════════════

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const ENTRY_BUCKETS = {
  consultation: ['face to face','gp surgery','telephone','administration note','administration','accurx','docman','externally entered','witley surgery','telephone consultation'],
  communication: ['communication'],
  investigation: ['investigation results','investigation request'],
  document: ['document'],
  note: ['note'],
  recall: ['future action/recall'],
  referral: ['referral'],
};

const BUCKET_COLOUR = {
  consultation: '#005eb8',
  communication:'#41b3e0',
  investigation:'#f47738',
  document:     '#007f3b',
  note:         '#768692',
  recall:       '#912b88',
  referral:     '#d4351c',
};

const QOF_REGISTERS = [
  { id:'hf',    label:'Heart Failure',          terms:['heart failure'] },
  { id:'af',    label:'Atrial Fibrillation',     terms:['atrial fibrillation','persistent atrial','paroxysmal atrial'] },
  { id:'htn',   label:'Hypertension',            terms:['hypertension','raised blood pressure'] },
  { id:'dm',    label:'Diabetes',                terms:['type 2 diabetes','type 1 diabetes','diabetes mellitus'] },
  { id:'ckd',   label:'CKD',                     terms:['chronic kidney disease','ckd stage'] },
  { id:'copd',  label:'COPD',                    terms:['chronic obstructive','copd'] },
  { id:'asthma',label:'Asthma',                  terms:['asthma'] },
  { id:'dep',   label:'Depression',              terms:['depressive','low mood','depression'] },
  { id:'dem',   label:'Dementia',                terms:['dementia','alzheimer'] },
  { id:'cancer',label:'Cancer / Malignancy',     terms:['cancer','malignancy','carcinoma','tumour','lymphoma','leukaemia'] },
  { id:'thyroid',label:'Hypothyroidism',         terms:['hypothyroid','goitre','goiter','thyroid'] },
  { id:'ld',    label:'Learning Disability',     terms:['learning disab'] },
  { id:'mh',    label:'Serious Mental Illness',  terms:['schizophrenia','bipolar','psychosis'] },
  { id:'epilepsy',label:'Epilepsy',              terms:['epilepsy','epileptic'] },
  { id:'stroke',label:'Stroke / TIA',            terms:['stroke','transient ischaem','tia','cerebrovascular'] },
  { id:'chd',   label:'Coronary Heart Disease',  terms:['coronary heart','ischaemic heart','angina','myocardial infarction','heart disease'] },
  { id:'af_stroke',label:'AF (stroke risk)',     terms:['cardioversion'] },
  { id:'pal',   label:'Palliative Care',         terms:['palliative','end of life','hospice'] },
];

// ══ STATE ══════════════════════════════════════════════════════════════════

const _s = {
  demographics: null,
  activeProblems: [],
  pastProblems: [],
  entries: [],
  activeTab: 'snapshot',
  invChart: null,
  pastExpanded: false,
};

// ══ UTILS ══════════════════════════════════════════════════════════════════

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function parseDateStr(s) {
  if (!s) return null;
  const m = s.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (!m) {
    const m2 = s.match(/([A-Za-z]+)\s+(\d{4})/);
    if (m2) {
      const mi = MONTHS.findIndex(x => x.toLowerCase() === m2[1].toLowerCase().slice(0,3));
      if (mi >= 0) return new Date(+m2[2], mi, 1);
    }
    return null;
  }
  const mon = MONTHS.findIndex(x => x.toLowerCase() === m[2].toLowerCase().slice(0,3));
  if (mon < 0) return null;
  return new Date(+m[3], mon, +m[1]);
}

function daysBetween(a, b) {
  return Math.round((b - a) / 86400000);
}

function bucketForType(rawType) {
  const t = rawType.toLowerCase();
  for (const [bucket, terms] of Object.entries(ENTRY_BUCKETS)) {
    if (terms.some(term => t.includes(term))) return bucket;
  }
  return 'note';
}

function normaliseClinician(raw) {
  if (!raw) return null;
  let s = raw.replace(/\s+at\s+.+$/i,'').trim();
  s = s.replace(/^(Dr|Mr|Mrs|Miss|Ms|Prof|Mx|Master)\s+/i,'').trim();
  if (!s || /^[A-Z][A-Z\s]+$/.test(s)) return null; // all-caps = org name
  if (s.split(' ').length < 2 && s.length < 4) return null; // too short, likely abbrev
  // Filter out known non-human names
  if (/pcti|docman|unknown|witley surgery|milford surgery/i.test(s)) return null;
  return s;
}

// ══ PDF PARSING ═══════════════════════════════════════════════════════════

function reconstructLines(items) {
  if (!items || !items.length) return [];
  const lineMap = {};
  for (const item of items) {
    if (!item.str || !item.str.trim() || !item.transform) continue;
    const y = Math.round(item.transform[5] / 2) * 2;
    if (!lineMap[y]) lineMap[y] = [];
    lineMap[y].push({ x: item.transform[4], str: item.str });
  }
  return Object.keys(lineMap).map(Number).sort((a,b)=>b-a).map(y => {
    const parts = lineMap[y].sort((a,b)=>a.x-b.x);
    return parts.map(p=>p.str).join(' ').replace(/\s+/g,' ').trim();
  }).filter(Boolean);
}

const PAGE_HEADER_RE = /^(Miss|Mrs|Mr|Ms|Dr|Master|Mx)\s+\S+.+NHS:\s*[\d\s]+/i;
const PAGE_FOOTER_RE = /^\S.+Surgery\s*•.+\d+\s+of\s+\d+/i;
const ENTRY_HDR_RE   = /^(.+?)\s*[•]\s*(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})/i;
const DEMO_RE        = /^(Miss|Mrs|Mr|Ms|Dr|Master|Mx)\s+(\S+)\s+(\S+)\s*[•–—−�]+\s*(\d{1,2}\s+\w+\s+\d{4})\s*\((\d+)y\)/i;

function parseAll(pageTexts) {
  const allLines = [];
  for (const lines of pageTexts) {
    for (const line of lines) {
      if (PAGE_HEADER_RE.test(line) || PAGE_FOOTER_RE.test(line)) continue;
      allLines.push(line);
    }
  }

  const demographics = { name:'', title:'', dob:'', age:'', nhs:'', address:'', phone:'', email:'', gender:'', eps:'' };
  const activeProblems = [], pastProblems = [];
  const entries = [];

  let i = 0;

  // ── Demographics ──
  while (i < allLines.length) {
    const l = allLines[i];
    if (l === 'Administrative & Contact Details') { i++; break; }
    i++;
  }
  while (i < allLines.length) {
    const l = allLines[i];
    if (l === 'Problems') { i++; break; }
    const dm = DEMO_RE.exec(l);
    if (dm) {
      demographics.title = dm[1];
      demographics.name  = dm[2] + ' ' + dm[3];
      demographics.dob   = dm[4];
      demographics.age   = dm[5];
    }
    if (/^NHS number:\s*(.+)/.test(l)) demographics.nhs = l.replace(/^NHS number:\s*/i,'').trim();
    if (/^Gender:\s*(.+)/i.test(l))  demographics.gender = l.replace(/^Gender:\s*/i,'').trim();
    if (/^Email address:/i.test(l))  demographics.email = l.replace(/^Email address:\s*/i,'').trim();
    if (/^Mobile phone/i.test(l))    demographics.phone = l.replace(/^Mobile phone[^:]*:\s*/i,'').trim();
    if (/^Home phone/i.test(l) && !demographics.phone) demographics.phone = l.replace(/^Home phone[^:]*:\s*/i,'').trim();
    if (/^EPS pharmacy:/i.test(l))   demographics.eps   = l.replace(/^EPS pharmacy:\s*/i,'').trim();
    if (/^Official name:/i.test(l))  demographics.name  = l.replace(/^Official name:\s*/i,'').trim();
    i++;
  }

  // ── Problems ──
  let inActive = false, inPast = false;
  while (i < allLines.length) {
    const l = allLines[i];
    if (ENTRY_HDR_RE.test(l)) break;
    if (l === 'Active Problems') { inActive = true; inPast = false; i++; continue; }
    if (l === 'Past Problems')   { inPast = true; inActive = false; i++; continue; }
    if (inActive || inPast) {
      // "Condition - Major/Minor - Mon YYYY" or "Condition - Major - May 2023"
      const pm = l.match(/^(.+?)\s*[-–]\s*(Major|Minor)\s*[-–]\s*(.+)$/i);
      if (pm) {
        const prob = { name: pm[1].trim(), severity: pm[2].toLowerCase(), dateStr: pm[3].trim(), date: parseDateStr(pm[3]) };
        if (inActive) activeProblems.push(prob);
        else           pastProblems.push(prob);
      }
    }
    i++;
  }

  // ── Entries ──
  let entryId = 0;
  while (i < allLines.length) {
    const l = allLines[i];
    const hdr = ENTRY_HDR_RE.exec(l);
    if (!hdr) { i++; continue; }

    const rawType = hdr[1].trim();
    const dateStr = `${hdr[3]} ${hdr[4]} ${hdr[5]}`;
    const date    = parseDateStr(dateStr);
    const bucket  = bucketForType(rawType);

    const body = [];
    i++;
    while (i < allLines.length && !ENTRY_HDR_RE.test(allLines[i])) {
      body.push(allLines[i]);
      i++;
    }

    // Extract fields from body
    let practitioner = null, org = null, code = null, consultType = null;
    let status = null, plannedDate = null, cancellationReason = null;
    const linkedProblems = [];
    const results = []; // for investigations: { panel, items:[{name,value,unit,low,high}] }
    let currentPanel = null;

    for (const bl of body) {
      if (/^Start date:/i.test(bl)) {
        const pm = bl.match(/Practitioner:\s*([^•]+)/i);
        if (pm) practitioner = normaliseClinician(pm[1].trim());
        const om = bl.match(/Organisation:\s*([^•]+)/i);
        if (om) org = om[1].trim();
        const cm = bl.match(/Consultation type:\s*([^•]+)/i);
        if (cm) consultType = cm[1].trim();
      }
      if (/^Record (date|author):/i.test(bl)) {
        const am = bl.match(/Record author:\s*([^•]+)/i);
        if (am) practitioner = practitioner || normaliseClinician(am[1].trim());
      }
      if (/^Code:/i.test(bl)) code = bl.replace(/^Code:\s*/i,'').trim();
      if (/^Linked problems?:/i.test(bl)) linkedProblems.push(bl.replace(/^Linked problems?:\s*/i,'').trim());
      if (/^Status:/i.test(bl)) status = bl.replace(/^Status:\s*/i,'').trim().split(/\s*•/)[0].trim();
      if (/^Planned date:/i.test(bl)) plannedDate = bl.replace(/^Planned date:\s*/i,'').trim().split(/\s*•/)[0].trim();
      if (/^Cancellation reason:/i.test(bl)) cancellationReason = bl.replace(/^Cancellation reason:\s*/i,'').trim();
      if (/^Requested by:/i.test(bl)) {
        const rm = bl.match(/Requested by:\s*([^•]+)/i);
        if (rm) practitioner = practitioner || normaliseClinician(rm[1].trim());
      }
      if (/^Filed by:/i.test(bl)) {
        const fm = bl.match(/Filed by:\s*([^•]+)/i);
        if (fm) practitioner = practitioner || normaliseClinician(fm[1].trim());
      }
      if (/^Author:/i.test(bl)) {
        const am = bl.match(/Author:\s*([^•]+)/i);
        if (am) practitioner = practitioner || normaliseClinician(am[1].trim());
      }
      // Investigation results parsing
      if (/\s+BLOOD$|\s+PROFILE$|FBC$|LFT$|BONE PROFILE$|BLOOD FILM$|U-S |Ultrasound|Serum |HbA1c|TSH|cholesterol|troponin/i.test(bl)) {
        currentPanel = bl.trim();
        results.push({ panel: currentPanel, items: [] });
      }
      const rr = bl.match(/^\s*[•]\s*([^:]+):\s*([\d.]+)\s*([^\s(]+(?:\s*10[⁶⁹¹²]?[^\s(]*)?)\s*\(?([\d.]+)?\s*[–\-]?\s*([\d.]+)?\)?/);
      if (rr && results.length > 0) {
        const current = results[results.length-1];
        current.items.push({ name:rr[1].trim(), value:rr[2], unit:rr[3]||'', low:rr[4]||null, high:rr[5]||null });
      }
    }

    entries.push({ id:entryId++, type:rawType, bucket, date, dateStr, practitioner, org, consultType, code, linkedProblems, status, plannedDate, cancellationReason, results, body });
  }

  return { demographics, activeProblems, pastProblems, entries };
}

// ══ PDF LOAD ═══════════════════════════════════════════════════════════════

async function loadPDF(file) {
  console.log('[Visualiser] loadPDF start —', file.name, file.size, 'bytes');
  setProgress(true, 2, 'Loading PDF…');
  const _stage = { s: 'loading PDF' };
  try {
    _stage.s = 'reading file';
    const ab = await file.arrayBuffer();
    console.log('[Visualiser] read', ab.byteLength, 'bytes');
    _stage.s = 'extracting text';
    const pdf = await pdfjsLib.getDocument({ data: ab, isEvalSupported: false }).promise;
    const total = pdf.numPages;
    console.log('[Visualiser] PDF opened,', total, 'pages');
    const pageTexts = [];
    for (let p = 1; p <= total; p++) {
      setProgress(true, 5 + (p/total)*60, `Extracting page ${p} of ${total}…`);
      const page = await pdf.getPage(p);
      const tc   = await page.getTextContent();
      pageTexts.push(reconstructLines(tc.items));
      await delay(0);
    }
    setProgress(true, 70, 'Parsing entries…');
    await delay(10);
    _stage.s = 'parsing entries';
    const result = parseAll(pageTexts);
    console.log('[Visualiser] parsed:', result.entries.length, 'entries,',
      result.activeProblems.length, 'active problems,',
      result.pastProblems.length, 'past problems');
    _s.demographics   = result.demographics;
    _s.activeProblems = result.activeProblems;
    _s.pastProblems   = result.pastProblems;
    _s.entries        = result.entries;
    setProgress(true, 90, 'Building views…');
    await delay(20);
    _stage.s = 'building views';
    buildApp();
    setProgress(false, 100, 'Done');
    console.log('[Visualiser] done');
  } catch(err) {
    setProgress(false, 0, '');
    console.error('[Visualiser] failed at stage:', _stage.s, err);
    alert(`Error ${_stage.s}:\n\n${err?.message || String(err)}\n\nPlease report this if using a genuine Medicus EPR export.`);
  }
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function setProgress(show, pct, text) {
  const ov = document.getElementById('progress-overlay');
  if (!show) { ov.classList.remove('visible'); return; }
  ov.classList.add('visible');
  document.getElementById('prog-bar').style.width = pct + '%';
  document.getElementById('prog-text').textContent = text;
}

// ══ ANALYTICS ══════════════════════════════════════════════════════════════

function computeClinicians(entries) {
  const map = {};
  for (const e of entries) {
    if (!e.practitioner) continue;
    const k = e.practitioner;
    if (!map[k]) map[k] = { name:k, total:0, byBucket:{}, lastDate:null };
    map[k].total++;
    map[k].byBucket[e.bucket] = (map[k].byBucket[e.bucket]||0)+1;
    if (!map[k].lastDate || (e.date && e.date > map[k].lastDate)) map[k].lastDate = e.date;
  }
  return Object.values(map).sort((a,b)=>b.total-a.total);
}

function computeUPC(clinicians, total) {
  if (!total || !clinicians.length) return 0;
  return Math.round(clinicians[0].total / total * 100);
}

function computeBice(clinicians, total) {
  if (!total || clinicians.length < 2) return computeUPC(clinicians, total);
  const sum = clinicians.reduce((a,c)=>a + (c.total/total)**2, 0);
  return Math.round(sum * 100);
}

function computeTimeline(entries) {
  const byYearMonth = {};
  const byYear = {};
  for (const e of entries) {
    if (!e.date) continue;
    const y = e.date.getFullYear();
    const m = e.date.getMonth();
    const yk = String(y);
    const ymk = `${y}-${m}`;
    if (!byYearMonth[ymk]) byYearMonth[ymk] = { year:y, month:m, total:0, byBucket:{} };
    byYearMonth[ymk].total++;
    byYearMonth[ymk].byBucket[e.bucket] = (byYearMonth[ymk].byBucket[e.bucket]||0)+1;
    if (!byYear[yk]) byYear[yk] = { year:y, total:0, byBucket:{} };
    byYear[yk].total++;
    byYear[yk].byBucket[e.bucket] = (byYear[yk].byBucket[e.bucket]||0)+1;
  }
  return { byYearMonth, byYear };
}

function computeInvestigations(entries) {
  const analytes = {};
  const panels = {};
  for (const e of entries) {
    if (e.bucket !== 'investigation') continue;
    for (const r of e.results) {
      const pk = r.panel.toUpperCase();
      if (!panels[pk]) panels[pk] = { name:r.panel, count:0, lastDate:null };
      panels[pk].count++;
      if (!panels[pk].lastDate || (e.date && e.date > panels[pk].lastDate)) panels[pk].lastDate = e.date;
      for (const item of r.items) {
        const ak = item.name.trim();
        if (!analytes[ak]) analytes[ak] = [];
        analytes[ak].push({ date:e.date, value:parseFloat(item.value), unit:item.unit, low:item.low?parseFloat(item.low):null, high:item.high?parseFloat(item.high):null });
      }
    }
  }
  for (const arr of Object.values(analytes)) arr.sort((a,b)=>a.date-b.date);
  return { analytes, panels };
}

function computeRecalls(entries) {
  const open=[], cancelled=[], completed=[];
  const today = new Date();
  for (const e of entries) {
    if (e.bucket !== 'recall') continue;
    const st = (e.status||'').toLowerCase();
    const pd = parseDateStr(e.plannedDate);
    const days = pd ? daysBetween(today, pd) : null;
    const item = { code:e.code||e.body[0]||'Unknown', plannedDate:e.plannedDate, date:pd, days, cancellationReason:e.cancellationReason };
    if (st.includes('incomplete')) open.push(item);
    else if (st.includes('cancel')) cancelled.push(item);
    else completed.push(item);
  }
  open.sort((a,b)=>(a.days??9999)-(b.days??9999));
  return { open, cancelled, completed };
}

function computeRegisters(activeProblems, pastProblems) {
  const all = [...activeProblems, ...pastProblems];
  const matched = [];
  for (const reg of QOF_REGISTERS) {
    const conds = all.filter(p => reg.terms.some(t => p.name.toLowerCase().includes(t)));
    if (conds.length) matched.push({ ...reg, conditions: conds });
  }
  return matched;
}

// ══ BUILD APP ═══════════════════════════════════════════════════════════════

function buildApp() {
  const d = _s.demographics;
  const entries = _s.entries;

  // Patient banner
  document.getElementById('pb-name').textContent = (d.title ? d.title+' ' : '') + d.name;
  document.getElementById('pb-age').textContent = d.age ? d.age + 'y' : '';
  document.getElementById('pb-nhs').textContent = d.nhs ? 'NHS ' + d.nhs : '';
  const lastEntry = entries.filter(e=>e.date).sort((a,b)=>b.date-a.date)[0];
  if (lastEntry) {
    const dr = lastEntry.practitioner ? ` — ${lastEntry.practitioner}` : '';
    document.getElementById('pb-last').textContent = 'Last: ' + lastEntry.dateStr + dr;
  }

  // Pre-compute analytics
  const clinicians = computeClinicians(entries);
  const contactableEntries = entries.filter(e => e.bucket === 'consultation');
  const upc = computeUPC(clinicians, entries.length);
  const bice = computeBice(clinicians, entries.length);
  const timeline = computeTimeline(entries);
  const invData = computeInvestigations(entries);
  const recalls = computeRecalls(entries);
  const registers = computeRegisters(_s.activeProblems, _s.pastProblems);

  buildSnapshot(d, entries, recalls);
  buildContinuity(clinicians, entries, upc, bice, contactableEntries);
  buildTimeline(timeline, entries);
  buildInvestigations(invData);
  buildRecalls(recalls, registers);
  buildLetters(entries);

  // Show app
  document.getElementById('drop-zone').style.display = 'none';
  const app = document.getElementById('app');
  app.style.display = 'flex';
}

// ══ TAB: SNAPSHOT ══════════════════════════════════════════════════════════

function buildSnapshot(d, entries, recalls) {
  const ap = _s.activeProblems, pp = _s.pastProblems;
  const now = new Date();
  const last12m = entries.filter(e => e.date && (now - e.date) < 365*864e5).length;
  const oldest = entries.filter(e=>e.date).sort((a,b)=>a.date-b.date)[0];
  const lastEntry = entries.filter(e=>e.date).sort((a,b)=>b.date-a.date)[0];
  const openRecalls = recalls.open;

  let html = `
  <div class="grid-4" style="margin-bottom:14px">
    <div class="stat-tile"><div class="stat-num">${entries.length}</div><div class="stat-lbl">Total entries</div></div>
    <div class="stat-tile"><div class="stat-num">${last12m}</div><div class="stat-lbl">Last 12 months</div></div>
    <div class="stat-tile"><div class="stat-num">${ap.length}</div><div class="stat-lbl">Active problems</div></div>
    <div class="stat-tile"><div class="stat-num">${openRecalls.length}</div><div class="stat-lbl">Open recalls</div></div>
  </div>

  <div class="grid-2">
    <div>
      <div class="card">
        <div class="card-title">Patient Details</div>
        ${demoRow('DOB', d.dob + (d.age ? ' (' + d.age + 'y)' : ''))}
        ${demoRow('Gender', d.gender)}
        ${demoRow('NHS', d.nhs)}
        ${demoRow('Phone', d.phone)}
        ${demoRow('Email', d.email)}
        ${demoRow('EPS Pharmacy', d.eps)}
        ${oldest ? demoRow('First record', oldest.dateStr) : ''}
        ${lastEntry ? demoRow('Last contact', lastEntry.dateStr + (lastEntry.practitioner ? ' — ' + esc(lastEntry.practitioner) : '')) : ''}
      </div>
    </div>
    <div>
      <div class="card">
        <div class="card-title">Active Problems <span style="font-weight:400;color:#768692">(${ap.length})</span></div>
        <ul class="prob-list">`;

  const sortedAP = [...ap].sort((a,b)=>(b.date||0)-(a.date||0));
  for (const p of sortedAP) {
    html += `<li class="prob-item">
      <span class="prob-dot ${esc(p.severity)}"></span>
      <span class="prob-name">${esc(p.name)}</span>
      <span class="prob-date">${esc(p.dateStr)}</span>
    </li>`;
  }
  html += `</ul></div>`;

  if (pp.length) {
    html += `<div class="card" style="margin-top:0">
      <div class="card-title">Past Problems <span style="font-weight:400;color:#768692">(${pp.length})</span></div>
      <button class="collapsible-toggle" id="past-toggle">${_s.pastExpanded ? 'Hide' : 'Show '+pp.length+' past problems'}</button>
      <ul class="prob-list" id="past-list" style="display:${_s.pastExpanded?'flex':'none'}">`;
    for (const p of pp) {
      html += `<li class="prob-item prob-past">
        <span class="prob-dot ${esc(p.severity)}"></span>
        <span class="prob-name">${esc(p.name)}</span>
        <span class="prob-date">${esc(p.dateStr)}</span>
      </li>`;
    }
    html += `</ul></div>`;
  }
  html += `</div></div>`;

  if (openRecalls.length) {
    html += `<div class="card"><div class="card-title">Open Recalls</div>
      <table class="data-table"><thead><tr><th>Recall code</th><th>Planned date</th><th>Status</th></tr></thead><tbody>`;
    for (const r of openRecalls) {
      const badge = r.days === null ? `<span class="badge badge-grey">Date unknown</span>` :
        r.days < 0  ? `<span class="badge badge-red">Overdue ${-r.days}d</span>` :
        r.days < 30 ? `<span class="badge badge-amber">Due in ${r.days}d</span>` :
                      `<span class="badge badge-green">Due in ${r.days}d</span>`;
      html += `<tr><td>${esc(r.code)}</td><td>${esc(r.plannedDate||'—')}</td><td>${badge}</td></tr>`;
    }
    html += `</tbody></table></div>`;
  }

  document.getElementById('tab-snapshot').innerHTML = html;

  document.getElementById('past-toggle')?.addEventListener('click', () => {
    _s.pastExpanded = !_s.pastExpanded;
    buildSnapshot(d, entries, recalls);
    switchTab('snapshot');
  });
}

function demoRow(label, val) {
  if (!val) return '';
  return `<div style="display:flex;gap:8px;padding:4px 0;border-bottom:1px solid #f0f0f0;font-size:13px">
    <span style="width:110px;flex-shrink:0;color:#768692;font-size:11px;padding-top:2px">${esc(label)}</span>
    <span>${esc(val)}</span>
  </div>`;
}

// ══ TAB: CONTINUITY ════════════════════════════════════════════════════════

function buildContinuity(clinicians, entries, upc, bice, contactableEntries) {
  const total = entries.filter(e=>e.practitioner).length;
  const top = clinicians.slice(0, 15);
  const maxVal = top[0]?.total || 1;

  let bars = '';
  for (const c of top) {
    const pct = Math.round(c.total / maxVal * 100);
    const share = Math.round(c.total / total * 100);
    bars += `<div class="bar-row">
      <span class="bar-label" title="${esc(c.name)}">${esc(c.name)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
      <span class="bar-val">${c.total} <span style="color:#b1b4b6">(${share}%)</span></span>
    </div>`;
  }

  let tableRows = '';
  for (const c of clinicians.slice(0,20)) {
    const share = Math.round(c.total / total * 100);
    const dominant = Object.entries(c.byBucket).sort((a,b)=>b[1]-a[1])[0];
    tableRows += `<tr>
      <td>${esc(c.name)}</td>
      <td style="text-align:center">${c.total}</td>
      <td style="text-align:center">${share}%</td>
      <td>${dominant ? `<span class="badge badge-grey" style="background:${BUCKET_COLOUR[dominant[0]]}20;color:${BUCKET_COLOUR[dominant[0]]}">${esc(dominant[0])}</span>` : '—'}</td>
      <td>${c.lastDate ? c.lastDate.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : '—'}</td>
    </tr>`;
  }

  const html = `
  <div class="grid-2" style="margin-bottom:14px">
    <div class="card idx-card">
      <div class="idx-pct">${upc}%</div>
      <div class="idx-lbl">Usual Provider of Care (UPC)<br>% contacts with most-frequent clinician</div>
    </div>
    <div class="card idx-card">
      <div class="idx-pct">${bice}%</div>
      <div class="idx-lbl">Bice-Boxerman Index<br>Concentration of care across all clinicians</div>
    </div>
  </div>
  <div class="card">
    <div class="card-title">Contacts by clinician (top 15 of ${clinicians.length})</div>
    <div class="bar-chart">${bars}</div>
  </div>
  <div class="card">
    <div class="card-title">Clinician detail</div>
    <table class="data-table">
      <thead><tr><th>Clinician</th><th>Entries</th><th>Share</th><th>Dominant type</th><th>Last contact</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
  </div>`;

  document.getElementById('tab-continuity').innerHTML = html;
}

// ══ TAB: TIMELINE ══════════════════════════════════════════════════════════

function buildTimeline(timeline, entries) {
  const years = Object.keys(timeline.byYear).sort();
  const maxYr = Math.max(...Object.values(timeline.byYear).map(y=>y.total), 1);

  // Stacked bar by year
  let yearBars = '';
  for (const y of years) {
    const yd = timeline.byYear[y];
    const barH = Math.round(yd.total / maxYr * 120);
    let segs = '';
    let cumPct = 0;
    for (const [b, cnt] of Object.entries(yd.byBucket)) {
      const pct = cnt / yd.total * 100;
      segs += `<div title="${b}: ${cnt}" style="height:${pct}%;background:${BUCKET_COLOUR[b]||'#ccc'};min-height:1px"></div>`;
    }
    yearBars += `<div style="display:flex;flex-direction:column;align-items:center;gap:4px">
      <div style="font-size:10px;color:#768692">${yd.total}</div>
      <div style="width:28px;height:${barH}px;display:flex;flex-direction:column-reverse;border-radius:3px 3px 0 0;overflow:hidden">${segs}</div>
      <div style="font-size:11px;color:#4c6272;transform:rotate(-45deg);transform-origin:top center;margin-top:8px">${y}</div>
    </div>`;
  }

  // Heatmap (last 5 years × 12 months)
  const now = new Date();
  const hmYears = [];
  for (let y = now.getFullYear()-4; y <= now.getFullYear(); y++) hmYears.push(y);
  const hmMaxVal = Math.max(...hmYears.flatMap(y => MONTHS.map((_,m)=>(timeline.byYearMonth[`${y}-${m}`]?.total||0))),1);

  let hmGrid = `<div style="display:grid;grid-template-columns:40px repeat(12,1fr);gap:3px;align-items:center;margin-top:10px">`;
  hmGrid += `<div></div>` + MONTHS.map(m=>`<div class="hm-label">${m}</div>`).join('');
  for (const y of hmYears) {
    hmGrid += `<div style="font-size:11px;color:#768692;text-align:right;padding-right:6px">${y}</div>`;
    for (let m = 0; m < 12; m++) {
      const cell = timeline.byYearMonth[`${y}-${m}`];
      const val  = cell?.total || 0;
      const intensity = val ? Math.max(0.12, val / hmMaxVal) : 0;
      const bg   = val ? `rgba(0,94,184,${intensity.toFixed(2)})` : '#f0f4f5';
      const tip  = val ? `${MONTHS[m]} ${y}: ${val} entries` : `${MONTHS[m]} ${y}: none`;
      hmGrid += `<div class="hm-cell" style="background:${bg};height:18px;border-radius:2px" title="${tip}"></div>`;
    }
  }
  hmGrid += '</div>';

  // Legend
  const legendItems = Object.entries(BUCKET_COLOUR).map(([b,c])=>
    `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#4c6272;margin-right:10px">
      <span style="width:10px;height:10px;border-radius:2px;background:${c};display:inline-block"></span>${b}
    </span>`).join('');

  const html = `
  <div class="card">
    <div class="card-title">Contacts by year</div>
    <div style="display:flex;align-items:flex-end;gap:8px;height:160px;overflow-x:auto;padding-bottom:30px">${yearBars}</div>
    <div style="margin-top:8px">${legendItems}</div>
  </div>
  <div class="card">
    <div class="card-title">Monthly heatmap (last 5 years)</div>
    ${hmGrid}
  </div>`;

  document.getElementById('tab-timeline').innerHTML = html;
}

// ══ TAB: INVESTIGATIONS ════════════════════════════════════════════════════

function buildInvestigations(invData) {
  const { analytes, panels } = invData;
  const panelList = Object.values(panels).sort((a,b)=>b.count-a.count);
  const analyteNames = Object.keys(analytes).sort();

  let panelRows = panelList.map(p=>
    `<tr><td>${esc(p.name)}</td><td style="text-align:center">${p.count}</td>
     <td>${p.lastDate ? p.lastDate.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : '—'}</td></tr>`
  ).join('');

  const selectOpts = analyteNames.map(a=>`<option value="${esc(a)}">${esc(a)}</option>`).join('');

  let latestRows = '';
  for (const an of analyteNames.slice(0,30)) {
    const pts = analytes[an];
    if (!pts.length) continue;
    const last = pts[pts.length-1];
    let flag = '';
    if (last.low !== null && last.value < last.low) flag = `<span class="badge badge-red">Low</span>`;
    else if (last.high !== null && last.value > last.high) flag = `<span class="badge badge-red">High</span>`;
    else if (last.low !== null) flag = `<span class="badge badge-green">Normal</span>`;
    const ref = (last.low !== null && last.high !== null) ? `${last.low} – ${last.high}` : '—';
    latestRows += `<tr>
      <td>${esc(an)}</td>
      <td>${last.value} ${esc(last.unit)}</td>
      <td>${ref}</td>
      <td>${flag}</td>
      <td>${last.date ? last.date.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : '—'}</td>
    </tr>`;
  }

  const html = `
  <div class="grid-2">
    <div class="card">
      <div class="card-title">Test panels (${panelList.length})</div>
      <table class="data-table"><thead><tr><th>Panel</th><th>Count</th><th>Last requested</th></tr></thead>
      <tbody>${panelRows}</tbody></table>
    </div>
    <div class="card">
      <div class="card-title">Analyte trend</div>
      <select id="analyte-select" style="width:100%;padding:6px;border:1px solid var(--border);border-radius:var(--r);font-size:13px;margin-bottom:8px">
        <option value="">— Select analyte —</option>${selectOpts}
      </select>
      <div id="inv-chart-wrap"><canvas id="inv-chart"></canvas></div>
    </div>
  </div>
  <div class="card">
    <div class="card-title">Latest values</div>
    <table class="data-table"><thead><tr><th>Analyte</th><th>Value</th><th>Reference</th><th>Flag</th><th>Date</th></tr></thead>
    <tbody>${latestRows}</tbody></table>
  </div>`;

  document.getElementById('tab-investigations').innerHTML = html;

  document.getElementById('analyte-select')?.addEventListener('change', e => {
    renderAnalyteTrend(analytes, e.target.value);
  });
}

function renderAnalyteTrend(analytes, name) {
  if (_s.invChart) { _s.invChart.destroy(); _s.invChart = null; }
  const canvas = document.getElementById('inv-chart');
  if (!canvas || !name || !analytes[name]) return;
  const pts = analytes[name];
  const labels = pts.map(p => p.date ? p.date.toLocaleDateString('en-GB',{month:'short',year:'numeric'}) : '?');
  const vals   = pts.map(p => p.value);
  const low    = pts[0]?.low;
  const high   = pts[0]?.high;

  _s.invChart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: name, data: vals, borderColor:'#005eb8', backgroundColor:'rgba(0,94,184,.08)', borderWidth:2, pointRadius:4, tension:.2 },
        ...(low  !== null ? [{ label:'Lower ref', data:pts.map(()=>low),  borderColor:'#d4351c', borderWidth:1, borderDash:[4,4], pointRadius:0, fill:false }] : []),
        ...(high !== null ? [{ label:'Upper ref', data:pts.map(()=>high), borderColor:'#d4351c', borderWidth:1, borderDash:[4,4], pointRadius:0, fill:false }] : []),
      ]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ labels:{ font:{size:11}, boxWidth:12 } } },
      scales:{
        x:{ ticks:{ font:{size:11} }, grid:{ display:false } },
        y:{ ticks:{ font:{size:11} }, beginAtZero:false }
      }
    }
  });
}

// ══ TAB: REGISTERS & RECALLS ═══════════════════════════════════════════════

function buildRecalls(recalls, registers) {
  let regHtml = '';
  if (registers.length) {
    const regsGrid = registers.map(r=>`
      <div class="reg-card">
        <div class="reg-name">${esc(r.label)}</div>
        <div class="reg-conds">${r.conditions.map(c=>esc(c.name)).join(' · ')}</div>
      </div>`).join('');
    regHtml = `<div class="card"><div class="card-title">QOF register membership (${registers.length} registers)</div>
      <div class="grid-3">${regsGrid}</div></div>`;
  }

  let openRows = '';
  for (const r of recalls.open) {
    const badge = r.days === null ? `<span class="badge badge-grey">Date unknown</span>` :
      r.days < 0  ? `<span class="badge badge-red">Overdue ${-r.days}d</span>` :
      r.days < 30 ? `<span class="badge badge-amber">Due in ${r.days}d</span>` :
                    `<span class="badge badge-green">Due in ${r.days}d</span>`;
    openRows += `<tr><td>${esc(r.code)}</td><td>${esc(r.plannedDate||'—')}</td><td>${badge}</td></tr>`;
  }

  let cancelRows = '';
  for (const r of recalls.cancelled.slice(0,20)) {
    cancelRows += `<tr><td>${esc(r.code)}</td><td>${esc(r.plannedDate||'—')}</td><td><span class="badge badge-grey">${esc(r.cancellationReason||'Cancelled')}</span></td></tr>`;
  }

  const html = `
  ${regHtml}
  <div class="card">
    <div class="card-title">Open recalls (${recalls.open.length})</div>
    ${recalls.open.length ? `<table class="data-table"><thead><tr><th>Code</th><th>Planned date</th><th>Status</th></tr></thead><tbody>${openRows}</tbody></table>` : '<p style="font-size:13px;color:#768692">None recorded</p>'}
  </div>
  ${recalls.cancelled.length ? `<div class="card">
    <div class="card-title">Cancelled recalls (${recalls.cancelled.length})</div>
    <table class="data-table"><thead><tr><th>Code</th><th>Planned date</th><th>Reason</th></tr></thead><tbody>${cancelRows}</tbody></table>
  </div>` : ''}
  ${recalls.completed.length ? `<div class="card">
    <div class="card-title">Completed recalls (${recalls.completed.length})</div>
    <p style="font-size:13px;color:#768692">${recalls.completed.slice(0,5).map(r=>esc(r.code)).join(' · ')}${recalls.completed.length>5?` · +${recalls.completed.length-5} more`:''}</p>
  </div>` : ''}`;

  document.getElementById('tab-recalls').innerHTML = html;
}

// ══ TAB: LETTERS & DOCUMENTS ═══════════════════════════════════════════════

function buildLetters(entries) {
  const docs = entries.filter(e => e.bucket === 'document');
  const bySpec = {};
  for (const d of docs) {
    const m = d.body.join(' ').match(/Clinical specialty:\s*([^•\n]+)/i);
    const spec = m ? m[1].trim() : 'General';
    bySpec[spec] = (bySpec[spec]||0)+1;
  }
  const specList = Object.entries(bySpec).sort((a,b)=>b[1]-a[1]);
  const maxS = specList[0]?.[1] || 1;

  let specBars = specList.map(([s,n])=>`
    <div class="bar-row">
      <span class="bar-label" title="${esc(s)}">${esc(s)}</span>
      <div class="bar-track"><div class="bar-fill accent" style="width:${Math.round(n/maxS*100)}%"></div></div>
      <span class="bar-val">${n}</span>
    </div>`).join('');

  let docRows = '';
  const sorted = [...docs].sort((a,b)=>(b.date||0)-(a.date||0));
  for (const d of sorted) {
    const specM = d.body.join(' ').match(/Clinical specialty:\s*([^•\n]+)/i);
    const authM = d.body.join(' ').match(/Author:\s*([^•\n]+)/i);
    docRows += `<tr>
      <td>${d.date ? d.date.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : '—'}</td>
      <td>${esc(d.code||'—')}</td>
      <td>${specM ? esc(specM[1].trim()) : '—'}</td>
      <td>${authM ? esc(authM[1].trim()) : '—'}</td>
    </tr>`;
  }

  const html = `
  <div class="card">
    <div class="card-title">Documents by specialty (${docs.length} total)</div>
    <div class="bar-chart" style="max-width:600px">${specBars || '<p style="font-size:13px;color:#768692">No documents found</p>'}</div>
  </div>
  <div class="card">
    <div class="card-title">All letters &amp; documents</div>
    <table class="data-table">
      <thead><tr><th>Date</th><th>Code / type</th><th>Specialty</th><th>Author</th></tr></thead>
      <tbody>${docRows || '<tr><td colspan="4" style="color:#768692">None</td></tr>'}</tbody>
    </table>
  </div>`;

  document.getElementById('tab-letters').innerHTML = html;
}

// ══ TAB SWITCHING ══════════════════════════════════════════════════════════

function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active', b.dataset.tab===name));
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.toggle('active', p.id==='tab-'+name));
  _s.activeTab = name;
}

// ══ EVENT WIRING ═══════════════════════════════════════════════════════════

document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

document.getElementById('pb-change')?.addEventListener('click', () => {
  document.getElementById('app').style.display = 'none';
  document.getElementById('drop-zone').style.display = 'flex';
  if (_s.invChart) { _s.invChart.destroy(); _s.invChart = null; }
});

function setupDrop() {
  const zone = document.getElementById('drop-zone');
  const box  = document.getElementById('drop-box');
  const fi   = document.getElementById('file-input');

  fi.addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    console.log('[Visualiser] change event fired, file =', f && f.name);
    if (f) loadPDF(f);
  });

  zone.addEventListener('dragover', e => { e.preventDefault(); box.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => box.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    box.classList.remove('drag-over');
    const f = e.dataTransfer.files[0];
    console.log('[Visualiser] drop event fired, file =', f && f.name);
    if (f && f.name.toLowerCase().endsWith('.pdf')) loadPDF(f);
  });
}

setupDrop();
console.log('[Visualiser] ready');
