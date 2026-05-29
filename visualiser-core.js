'use strict';

// ══ DISPLAY PREFERENCES ════════════════════════════════════════════════════
(function applyDisplayPrefs() {
  function apply(p) {
    p = p || {};
    document.documentElement.setAttribute('data-theme', p.theme || 'light');
    document.documentElement.setAttribute('data-size', p.size || 'medium');
    document.documentElement.setAttribute('data-colorblind', String(!!p.colorblind));
  }
  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.local.get('suite.display', r => apply(r['suite.display'] || {}));
    chrome.storage.onChanged.addListener(c => { if (c['suite.display']) apply(c['suite.display'].newValue || {}); });
  }
})();

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

// Colour-blind-safe single-hue (Blues) ramp for the contacts calendar heatmap.
// Index 0 = fewest, index 4 = most. Zero-count cells use the page background.
const HEAT_BLUES = ['#eef3f9','#cfe0f0','#91bce0','#4a8fcf','#005eb8'];

// Reference Change Values — fractional change between successive results that
// is clinically significant. Source: published RCVs (PMC10197470 et al).
// Match by lower-cased substring on the analyte name. Longest key wins.
const RCV_TABLE = {
  'sodium': 0.013, 'potassium': 0.05, 'chloride': 0.025, 'bicarbonate': 0.10,
  'urea': 0.16, 'creatinine': 0.14, 'egfr': 0.14,
  'calcium': 0.04, 'phosphate': 0.13, 'magnesium': 0.07,
  'albumin': 0.045, 'total protein': 0.04, 'bilirubin': 0.35,
  'alt': 0.35, 'ast': 0.20, 'alkaline phosphatase': 0.10, 'alp': 0.10, 'ggt': 0.30,
  'haemoglobin': 0.08, 'hgb': 0.08, ' hb ': 0.08,
  'white cell count': 0.20, 'wbc': 0.20, 'platelet': 0.15,
  'mcv': 0.025, 'mch': 0.025,
  'hba1c': 0.12, 'glucose': 0.15,
  'tsh': 0.45, 'free t4': 0.10, 't4': 0.10,
  'total cholesterol': 0.13, 'cholesterol': 0.13, 'hdl': 0.13, 'ldl': 0.20, 'triglyceride': 0.30,
  'ferritin': 0.30, 'crp': 0.40, 'b12': 0.20, 'folate': 0.30, 'vitamin d': 0.30,
  'psa': 0.30,
};

// Clinical zones — staged reference bands drawn behind the trend chart.
// Each zone: { from, to, colour, label }. Order: any (rendered all-overlapping).
// Source: KDIGO 2024 (eGFR), NICE NG28 / QOF (HbA1c), NICE NG136 (BP).
const CLINICAL_ZONES = {
  egfr: [
    { from: 90, to: 250, colour: 'rgba(0,127,59,0.10)',   label: 'G1 (≥90)' },
    { from: 60, to: 90,  colour: 'rgba(120,194,72,0.12)', label: 'G2 (60–89)' },
    { from: 45, to: 60,  colour: 'rgba(255,235,59,0.18)', label: 'G3a (45–59)' },
    { from: 30, to: 45,  colour: 'rgba(244,119,56,0.20)', label: 'G3b (30–44)' },
    { from: 15, to: 30,  colour: 'rgba(212,53,28,0.22)',  label: 'G4 (15–29)' },
    { from: 0,  to: 15,  colour: 'rgba(95,17,9,0.28)',    label: 'G5 (<15)' },
  ],
  hba1c: [
    { from: 0,  to: 42,  colour: 'rgba(0,127,59,0.10)',   label: 'Normal (<42)' },
    { from: 42, to: 48,  colour: 'rgba(255,235,59,0.15)', label: 'Pre-diabetes (42–47)' },
    { from: 48, to: 58,  colour: 'rgba(120,194,72,0.18)', label: 'On-target (48–57)' },
    { from: 58, to: 75,  colour: 'rgba(244,119,56,0.18)', label: 'Suboptimal (58–74)' },
    { from: 75, to: 250, colour: 'rgba(212,53,28,0.22)',  label: 'Poor control (≥75)' },
  ],
  'systolic blood pressure': [
    { from: 0,   to: 120, colour: 'rgba(0,127,59,0.10)',   label: 'Optimal' },
    { from: 120, to: 140, colour: 'rgba(255,235,59,0.10)', label: 'Pre-HTN' },
    { from: 140, to: 160, colour: 'rgba(244,119,56,0.15)', label: 'Stage 1 HTN' },
    { from: 160, to: 300, colour: 'rgba(212,53,28,0.18)',  label: 'Stage 2 HTN' },
  ],
};

const PRACTITIONER_PALETTE = [
  '#005eb8','#41b3e0','#f47738','#007f3b','#d4351c','#912b88',
  '#330072','#8a1538','#00a499','#cd5c5c','#4c6272','#ae7e1c',
];

const QOF_REGISTERS = [
  { id:'hf',    label:'Heart Failure',          terms:['heart failure'],            reviewMonths:12 },
  { id:'af',    label:'Atrial Fibrillation',     terms:['atrial fibrillation','persistent atrial','paroxysmal atrial'], reviewMonths:12 },
  { id:'htn',   label:'Hypertension',            terms:['hypertension','raised blood pressure'],                       reviewMonths:12 },
  { id:'dm',    label:'Diabetes',                terms:['type 2 diabetes','type 1 diabetes','diabetes mellitus'],      reviewMonths:12 },
  { id:'ckd',   label:'CKD',                     terms:['chronic kidney disease','ckd stage'],                          reviewMonths:12 },
  { id:'copd',  label:'COPD',                    terms:['chronic obstructive','copd'],                                  reviewMonths:12 },
  { id:'asthma',label:'Asthma',                  terms:['asthma'],                                                       reviewMonths:12 },
  { id:'dep',   label:'Depression',              terms:['depressive','low mood','depression'],                          reviewMonths:12 },
  { id:'dem',   label:'Dementia',                terms:['dementia','alzheimer'],                                         reviewMonths:12 },
  { id:'cancer',label:'Cancer / Malignancy',     terms:['cancer','malignancy','carcinoma','tumour','lymphoma','leukaemia'], reviewMonths:6 },
  { id:'thyroid',label:'Hypothyroidism',         terms:['hypothyroid','goitre','goiter','thyroid'],                      reviewMonths:12 },
  { id:'ld',    label:'Learning Disability',     terms:['learning disab'],                                              reviewMonths:12 },
  { id:'mh',    label:'Serious Mental Illness',  terms:['schizophrenia','bipolar','psychosis'],                         reviewMonths:12 },
  { id:'epilepsy',label:'Epilepsy',              terms:['epilepsy','epileptic'],                                        reviewMonths:12 },
  { id:'stroke',label:'Stroke / TIA',            terms:['stroke','transient ischaem','tia','cerebrovascular'],          reviewMonths:12 },
  { id:'chd',   label:'Coronary Heart Disease',  terms:['coronary heart','ischaemic heart','angina','myocardial infarction','heart disease'], reviewMonths:12 },
  { id:'af_stroke',label:'AF (stroke risk)',     terms:['cardioversion'],                                              reviewMonths:12 },
  { id:'pal',   label:'Palliative Care',         terms:['palliative','end of life','hospice'],                          reviewMonths:3 },
];

// Electronic Frailty Index (eFI). Clegg 2016 — 36 deficits accumulated from
// the problem list. Score = count / 36. Cut-points: <0.12 fit; 0.13–0.24 mild;
// 0.25–0.36 moderate; >0.36 severe.
const EFI_DEFICITS = [
  { id:'anaemia',    label:'Anaemia',                    terms:['anaemia','anemia'] },
  { id:'arthritis',  label:'Arthritis',                  terms:['osteoarthritis','rheumatoid arthritis','arthritis'] },
  { id:'af',         label:'Atrial fibrillation',        terms:['atrial fibrillation'] },
  { id:'cva',        label:'Cerebrovascular disease',    terms:['stroke','transient ischaem','tia','cerebrovascular'] },
  { id:'ckd',        label:'Chronic kidney disease',     terms:['chronic kidney','ckd stage'] },
  { id:'diabetes',   label:'Diabetes',                   terms:['diabetes mellitus','type 2 diabetes','type 1 diabetes'] },
  { id:'dizziness',  label:'Dizziness',                  terms:['dizziness','vertigo','giddiness'] },
  { id:'dyspnoea',   label:'Dyspnoea',                   terms:['dyspnoea','breathlessness','shortness of breath'] },
  { id:'falls',      label:'Falls',                      terms:['fall ','falls','fell','fallen'] },
  { id:'foot',       label:'Foot problems',              terms:['foot problem','plantar','bunion','onychomycosis','corn '] },
  { id:'fracture',   label:'Fragility fracture',         terms:['fragility fracture','fractured neck of femur','fractured wrist','colles','pubic ramus fracture','vertebral fracture'] },
  { id:'hearing',    label:'Hearing impairment',         terms:['hearing loss','deafness','hearing impair','presbycusis'] },
  { id:'hf',         label:'Heart failure',              terms:['heart failure'] },
  { id:'valve',      label:'Heart valve disease',        terms:['aortic stenosis','mitral regurg','aortic regurg','valvular','valve disease'] },
  { id:'htn',        label:'Hypertension',               terms:['hypertension','raised blood pressure'] },
  { id:'hypotension',label:'Hypotension / syncope',      terms:['hypotension','postural','syncope','collapse'] },
  { id:'ihd',        label:'Ischaemic heart disease',    terms:['ischaemic heart','coronary','angina','myocardial infarction'] },
  { id:'memory',     label:'Memory / cognitive problems',terms:['memory','cognitive impair','dementia','alzheimer','confusion'] },
  { id:'mobility',   label:'Mobility / transfer probs',  terms:['mobility','immobility','transfer problem','gait','walking diff'] },
  { id:'osteo',      label:'Osteoporosis',               terms:['osteoporosis','osteopenia'] },
  { id:'parkinson',  label:'Parkinsonism / tremor',      terms:['parkinson','tremor','essential tremor'] },
  { id:'ulcer',      label:'Peptic ulcer',               terms:['peptic ulcer','gastric ulcer','duodenal ulcer'] },
  { id:'pvd',        label:'Peripheral vascular disease',terms:['peripheral vascular','peripheral arterial','intermittent claudication'] },
  { id:'polypharm',  label:'Polypharmacy (≥5)',          terms:[] }, // computed separately
  { id:'pressure',   label:'Pressure ulcer',             terms:['pressure ulcer','pressure sore','decubitus'] },
  { id:'care',       label:'Requirement for care',       terms:['care home','nursing home','requires care','carer','social care'] },
  { id:'respiratory',label:'Respiratory disease',        terms:['copd','chronic obstructive','asthma','bronchiectasis','pulmonary fibrosis'] },
  { id:'skin',       label:'Skin ulcer',                 terms:['leg ulcer','venous ulcer','skin ulcer'] },
  { id:'sleep',      label:'Sleep disturbance',          terms:['insomnia','sleep disturb','sleep apnoea','obstructive sleep'] },
  { id:'social',     label:'Social vulnerability',       terms:['social isolation','lives alone','bereavement','homelessness','safeguarding'] },
  { id:'thyroid',    label:'Thyroid disease',            terms:['hypothyroid','hyperthyroid','goitre','thyroid'] },
  { id:'inc_urin',   label:'Urinary incontinence',       terms:['urinary incontinence','stress incontinence','urge incontinence'] },
  { id:'urin_sys',   label:'Urinary system disease',     terms:['benign prostatic','prostatic hyperplasia','recurrent urinary','overactive bladder','prostate'] },
  { id:'visual',     label:'Visual impairment',          terms:['cataract','macular','glaucoma','visual impair','blind '] },
  { id:'weight',     label:'Weight loss / anorexia',     terms:['weight loss','anorexia','cachexia','malnutrition'] },
  { id:'activity',   label:'Activity limitation',        terms:['activity limit','frailty','functional decline'] },
];

// Charlson Comorbidity Index — flat standard CCI weights, ONE category per
// condition (no diabetes/liver tier-splitting — kept simple and conservative).
// Detection is keyword substring on the problem-list text, mirroring the eFI
// table. Short/ambiguous terms are space-padded (' tia ', ' aids ') so they
// don't match inside unrelated words. Weights are the published CCI values.
const CHARLSON_WEIGHTS = [
  { id:'mi',          label:'Myocardial infarction',     weight:1, terms:['myocardial infarction','heart attack'] },
  { id:'chf',         label:'Heart failure',             weight:1, terms:['heart failure'] },
  { id:'pvd',         label:'Peripheral vascular disease',weight:1,terms:['peripheral vascular','peripheral arterial','intermittent claudication'] },
  { id:'cva',         label:'Cerebrovascular disease',   weight:1, terms:['stroke',' tia ','transient ischaem','cerebrovascular'] },
  { id:'dementia',    label:'Dementia',                  weight:1, terms:['dementia','alzheimer'] },
  { id:'copd',        label:'COPD',                      weight:1, terms:['copd','chronic obstructive','emphysema'] },
  { id:'rheumatic',   label:'Rheumatic disease',         weight:1, terms:['rheumatoid arthritis','systemic lupus','connective tissue'] },
  { id:'ulcer',       label:'Peptic ulcer disease',      weight:1, terms:['peptic ulcer','gastric ulcer','duodenal ulcer'] },
  { id:'liver_mild',  label:'Mild liver disease',        weight:1, terms:['chronic hepatitis','cirrhosis'] },
  { id:'diabetes',    label:'Diabetes',                  weight:1, terms:['diabetes mellitus','type 1 diabetes','type 2 diabetes','diabetic'] },
  { id:'hemiplegia',  label:'Hemiplegia / paraplegia',   weight:2, terms:['hemiplegia','paraplegia'] },
  { id:'renal',       label:'Renal disease',             weight:2, terms:['chronic kidney disease','ckd stage','end stage renal','dialysis'] },
  { id:'malignancy',  label:'Malignancy',                weight:2, terms:['cancer','malignancy','carcinoma','lymphoma','leukaemia'] },
  { id:'metastatic',  label:'Metastatic solid tumour',   weight:6, terms:['metastatic','metastases','secondary malignancy'] },
  { id:'aids',        label:'AIDS / HIV',                weight:6, terms:[' aids ','hiv'] },
];

// High-risk drugs (NICE / BNF / PINCER). For each: the names to detect, the
// monitoring tests required, and how often (days) those tests should occur.
const HIGH_RISK_DRUGS = [
  { id:'methotrexate', label:'Methotrexate',   terms:['methotrexate'],
    requires:['fbc','full blood count','u&e','urea & electrolytes','urea and electrolytes','liver function','lft'], interval:91 },
  { id:'azathioprine', label:'Azathioprine',   terms:['azathioprine'],
    requires:['fbc','full blood count','liver function','lft'], interval:91 },
  { id:'lithium',      label:'Lithium',         terms:['lithium'],
    requires:['lithium level','u&e','tsh','thyroid'], interval:91 },
  { id:'amiodarone',   label:'Amiodarone',      terms:['amiodarone'],
    requires:['tsh','thyroid','lft','liver function'], interval:183 },
  { id:'warfarin',     label:'Warfarin',        terms:['warfarin'],
    requires:['inr','u&e'], interval:42 },
  { id:'doac',         label:'DOAC',            terms:['rivaroxaban','apixaban','dabigatran','edoxaban'],
    requires:['u&e','urea','creatinine','egfr','fbc'], interval:365 },
  { id:'acei',         label:'ACEi / ARB',      terms:['ramipril','lisinopril','perindopril','enalapril','captopril','candesartan','losartan','irbesartan','valsartan','olmesartan'],
    requires:['u&e','urea','creatinine','egfr'], interval:365 },
  { id:'diuretic',     label:'Loop / thiazide diuretic', terms:['furosemide','frusemide','bumetanide','indapamide','bendroflumethiazide','chlortalidone'],
    requires:['u&e','urea','creatinine','egfr','sodium','potassium'], interval:365 },
  { id:'nsaid_long',   label:'Long-term NSAID', terms:['ibuprofen','naproxen','diclofenac','celecoxib','etoricoxib','meloxicam'],
    requires:['u&e','urea','creatinine','egfr'], interval:365 },
  { id:'statin',       label:'Statin',          terms:['atorvastatin','simvastatin','rosuvastatin','pravastatin','fluvastatin'],
    requires:['lft','liver function','cholesterol'], interval:365 },
  { id:'digoxin',      label:'Digoxin',         terms:['digoxin'],
    requires:['u&e','urea','potassium','creatinine'], interval:365 },
  { id:'thyroxine',    label:'Levothyroxine',   terms:['levothyroxine','liothyronine'],
    requires:['tsh','thyroid'], interval:365 },
  { id:'metformin',    label:'Metformin',       terms:['metformin'],
    requires:['u&e','egfr','creatinine'], interval:365 },
  { id:'opioid_str',   label:'Strong opioid',   terms:['morphine','oxycodone','fentanyl patch','buprenorphine','tapentadol'],
    requires:[], interval:0 },
  { id:'beta_block',   label:'Beta-blocker',    terms:['atenolol','bisoprolol','propranolol','metoprolol','carvedilol','sotalol','nebivolol','labetalol'],
    requires:[], interval:0 },
  { id:'ppi',          label:'PPI',             terms:['omeprazole','lansoprazole','pantoprazole','esomeprazole','rabeprazole'],
    requires:[], interval:0 },
  { id:'antipsych',    label:'Antipsychotic',   terms:['olanzapine','risperidone','quetiapine','aripiprazole','haloperidol','clozapine','chlorpromazine'],
    requires:['fbc','full blood count','u&e','lft','glucose','hba1c','cholesterol'], interval:183 },
];

// PINCER-style drug-disease and monitoring-overdue rules. Run after both the
// drug list and the problem list are known.
function computePINCER(allProblems, drugs, entries) {
  const flags = [];
  const has = t => allProblems.some(p => p.name.toLowerCase().includes(t));
  const drugFor = id => drugs.find(d => d.id === id);
  const drugByName = name => drugs.find(d => d.label.toLowerCase().includes(name));

  if (drugFor('nsaid_long') && has('chronic kidney')) {
    flags.push({ severity:'high', rule:'NSAID prescribed with CKD',
      detail:'Long-term NSAID in chronic kidney disease — risk of further GFR decline. Review need and consider alternative.' });
  }
  if (drugFor('nsaid_long') && has('heart failure')) {
    flags.push({ severity:'high', rule:'NSAID with heart failure',
      detail:'NSAID can precipitate decompensation in heart failure. Avoid or use lowest effective dose for shortest duration.' });
  }
  if (drugFor('nsaid_long') && (drugFor('warfarin') || drugFor('doac'))) {
    flags.push({ severity:'high', rule:'NSAID with oral anticoagulant',
      detail:'Increased GI bleeding risk. Consider gastro-protection (PPI) and review need.' });
  }
  if (drugFor('beta_block') && has('asthma')) {
    flags.push({ severity:'high', rule:'Beta-blocker with asthma',
      detail:'Beta-blockers (especially non-selective) may precipitate bronchospasm — review indication, prefer cardioselective if essential.' });
  }
  // Aspirin / antiplatelet (low-dose) + warfarin / DOAC without PPI
  // Coverage: detect aspirin via NSAID terms is imperfect; skip aspirin-specific
  // rules without a dedicated antiplatelet detector.

  // PPI long-term — not a flag, but worth checking. (Skip — too low signal.)

  for (const d of drugs) {
    if (d.overdue && d.lastSeen) {
      flags.push({ severity:'med', rule:`${d.label} monitoring overdue`,
        detail:`Last ${d.requires.slice(0,2).join(' / ') || 'check'}: ${d.lastMonitoring ? d.lastMonitoring.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : 'never recorded'}. Recommended interval: ${Math.round(d.interval/30)} months.` });
    }
  }
  // ACEi without recent U&E AND has CKD = serious
  const acei = drugFor('acei');
  if (acei && acei.overdue && has('chronic kidney')) {
    flags.push({ severity:'high', rule:'ACEi/ARB + CKD — U&E overdue',
      detail:'Annual U&E monitoring is essential in CKD on ACEi/ARB.' });
  }
  return flags;
}

// ══ STATE ══════════════════════════════════════════════════════════════════

const _s = {
  demographics: null,
  activeProblems: [],
  pastProblems: [],
  entries: [],
  activeTab: 'snapshot',
  invChart: null,
  pastExpanded: false,
  // Global filter state. dateFrom/dateTo gate which entries reach any tab.
  // clinician spotlights one practitioner across views. problem cross-filters
  // by linked-problems text and highlights entries that mention it.
  filter: {
    dateFrom: null,         // Date | null
    dateTo:   null,         // Date | null
    preset:   'all',        // 'all' | '5y' | '3y' | '1y' | 'custom'
    clinician: null,        // string | null
    problem:   null,        // string | null
  },
  // Investigations tab UI state (persist across re-renders within the tab)
  invUI: { sortKey:'analyte', sortDir:'asc', filterText:'', onlyAbn:false },
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

// Find the RCV for an analyte by longest-substring match (so "Plasma sodium"
// matches "sodium", "MCH" matches "mch" not "mcv"). Returns null if none.
function rcvFor(analyteName) {
  const n = ' ' + analyteName.toLowerCase() + ' ';
  const keys = Object.keys(RCV_TABLE).sort((a,b) => b.length - a.length);
  for (const k of keys) {
    if (n.includes(k)) return RCV_TABLE[k];
  }
  return null;
}

// Find clinical zones for an analyte (eGFR, HbA1c, systolic BP, ...).
function zonesFor(analyteName) {
  const n = analyteName.toLowerCase();
  const keys = Object.keys(CLINICAL_ZONES).sort((a,b) => b.length - a.length);
  for (const k of keys) {
    if (n.includes(k)) return CLINICAL_ZONES[k];
  }
  return null;
}

// Δ-from-prior badge. Doubles the arrow and goes red when the change
// exceeds the literature RCV for this analyte.
function deltaArrow(prev, curr, name) {
  if (!prev || prev.value == null || isNaN(prev.value) || isNaN(curr.value)) return '';
  const absChange = curr.value - prev.value;
  if (!isFinite(absChange) || absChange === 0) return '<span style="color:#b1b4b6;font-size:11px">—</span>';
  const pct = prev.value !== 0 ? absChange / Math.abs(prev.value) : 0;
  const rcv = rcvFor(name);
  const sig = rcv != null && Math.abs(pct) >= rcv;
  const arrow = absChange > 0 ? '↑' : '↓';
  const glyph = sig ? arrow + arrow : arrow;
  const colour = sig ? '#d4351c' : '#768692';
  const pctStr = Math.abs(pct * 100).toFixed(0);
  const sign = absChange > 0 ? '+' : '−';
  const title = `Previous: ${prev.value} ${prev.unit||''}\nDelta: ${sign}${Math.abs(absChange).toFixed(2)} (${sign}${pctStr}%)${sig ? ' — exceeds RCV' : ''}`;
  return `<span style="color:${colour};font-weight:${sig?700:400};font-size:11px" title="${esc(title)}">${glyph} ${pctStr}%</span>`;
}

// Inline SVG sparkline of an analyte's series. Reference range (if any) is
// painted as a translucent green band; the last point is dotted in red if
// outside reference, blue otherwise.
function renderSparkline(points, refLow, refHigh) {
  if (!points || points.length < 2) return '<span style="color:#b1b4b6;font-size:11px">—</span>';
  const w = 70, h = 20, pad = 2;
  const vals = points.map(p => p.value).filter(v => !isNaN(v));
  if (!vals.length) return '<span style="color:#b1b4b6;font-size:11px">—</span>';
  let min = Math.min(...vals), max = Math.max(...vals);
  if (refLow != null && !isNaN(refLow)) min = Math.min(min, refLow);
  if (refHigh != null && !isNaN(refHigh)) max = Math.max(max, refHigh);
  const range = (max - min) || 1;
  const xStep = (w - pad*2) / Math.max(points.length - 1, 1);
  const xs = points.map((_, i) => pad + i * xStep);
  const ys = points.map(p => h - pad - ((p.value - min) / range) * (h - pad*2));
  const polyline = xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  let dotColour = '#005eb8';
  if (last.low != null && last.value < last.low) dotColour = '#d4351c';
  else if (last.high != null && last.value > last.high) dotColour = '#d4351c';
  let band = '';
  if (refLow != null && refHigh != null && !isNaN(refLow) && !isNaN(refHigh)) {
    const yLow  = h - pad - ((refLow  - min) / range) * (h - pad*2);
    const yHigh = h - pad - ((refHigh - min) / range) * (h - pad*2);
    const yTop = Math.min(yLow, yHigh), bandH = Math.abs(yHigh - yLow);
    band = `<rect x="0" y="${yTop.toFixed(1)}" width="${w}" height="${bandH.toFixed(1)}" fill="#007f3b" opacity="0.10"/>`;
  }
  return `<svg width="${w}" height="${h}" style="display:inline-block;vertical-align:middle">
    ${band}<polyline points="${polyline}" stroke="#005eb8" stroke-width="1.4" fill="none"/>
    <circle cx="${xs[xs.length-1].toFixed(1)}" cy="${ys[ys.length-1].toFixed(1)}" r="2.2" fill="${dotColour}"/>
  </svg>`;
}

// Assign each practitioner a stable colour from the palette.
function practitionerColourMap(practitioners) {
  const m = {};
  practitioners.forEach((p, i) => { m[p] = PRACTITIONER_PALETTE[i % PRACTITIONER_PALETTE.length]; });
  return m;
}

// Date min/max across all entries (used by the filter brush).
function entriesDateExtent(entries) {
  const dates = entries.map(e => e.date).filter(Boolean);
  if (!dates.length) return [new Date(), new Date()];
  return [new Date(Math.min(...dates)), new Date(Math.max(...dates))];
}

// Apply the global filter state to the master entry list. Date range gates
// hard (entries outside are excluded). Clinician filters when set. Problem
// filter does NOT exclude — it's a highlight, applied later by the renderers.
function filteredEntries() {
  return _s.entries.filter(e => {
    if (_s.filter.dateFrom && e.date && e.date < _s.filter.dateFrom) return false;
    if (_s.filter.dateTo   && e.date && e.date > _s.filter.dateTo)   return false;
    if (_s.filter.clinician && e.practitioner !== _s.filter.clinician) return false;
    return true;
  });
}

// True if this entry should be visually highlighted because the active
// problem filter mentions text matching one of its linked problems or its
// code/type. Used by the swim-lane and the "what's new" card.
function isProblemHighlighted(e) {
  if (!_s.filter.problem) return false;
  const needle = _s.filter.problem.toLowerCase();
  if (e.linkedProblems.some(lp => lp.toLowerCase().includes(needle))) return true;
  if (e.code && e.code.toLowerCase().includes(needle)) return true;
  return false;
}

// "What's new since last consultation": find the most recent face-to-face
// consultation and return everything dated strictly after it. If today is the
// last consultation, fall back to the previous one so the panel still tells a
// story.
function computeWhatsNew(entries) {
  const consults = entries
    .filter(e => e.bucket === 'consultation' && e.date)
    .sort((a,b) => b.date - a.date);
  if (!consults.length) return null;
  let pivot = consults[0];
  let items = entries.filter(e => e.date && e.date > pivot.date);
  if (items.length === 0 && consults.length >= 2) {
    pivot = consults[1];
    items = entries.filter(e => e.date && e.date > pivot.date);
  }
  return { pivot, items: items.sort((a,b) => b.date - a.date) };
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

// For each QOF register that this patient is on, find the date of the most
// recent entry linked to that problem (any bucket — consult, lab, recall).
// "Overdue" = no entry within reg.reviewMonths months.
function enrichRegistersWithReview(registers, entries) {
  const today = new Date();
  return registers.map(reg => {
    const matchTerms = reg.terms;
    const linked = entries.filter(e => {
      const hay = (
        (e.linkedProblems||[]).join(' ') + ' ' +
        (e.code||'') + ' ' +
        (e.body||[]).slice(0,4).join(' ')
      ).toLowerCase();
      return matchTerms.some(t => hay.includes(t));
    }).filter(e => e.date);
    linked.sort((a,b) => b.date - a.date);
    const last = linked[0];
    const monthsSince = last ? Math.round((today - last.date) / (30.4*86400000)) : null;
    const overdue = !last || monthsSince > reg.reviewMonths;
    return { ...reg, lastReview: last, monthsSinceReview: monthsSince, overdue, linkedCount: linked.length };
  });
}

// eFI — Electronic Frailty Index. Counts how many of the 36 Clegg deficits
// are present in the problem list. Polypharmacy is computed separately from
// the drug list (≥5 active high-risk-or-otherwise drugs).
function computeEFI(activeProblems, pastProblems, drugs) {
  const all = [...activeProblems, ...pastProblems];
  const ticked = [];
  for (const d of EFI_DEFICITS) {
    if (d.id === 'polypharm') {
      if (drugs && drugs.length >= 5) ticked.push({ ...d, evidence:`${drugs.length} drugs detected` });
      continue;
    }
    const match = all.find(p => d.terms.some(t => p.name.toLowerCase().includes(t)));
    if (match) ticked.push({ ...d, evidence: match.name });
  }
  const score = ticked.length / EFI_DEFICITS.length;
  let category, colour;
  if (score > 0.36)      { category = 'Severe frailty';   colour = '#d4351c'; }
  else if (score >= 0.25){ category = 'Moderate frailty'; colour = '#f47738'; }
  else if (score > 0.12) { category = 'Mild frailty';     colour = '#ffeb3b'; }
  else                   { category = 'Fit';              colour = '#007f3b'; }
  return { ticked, total: EFI_DEFICITS.length, score, category, colour };
}

// Find a drug in the entry body / code text. The same drug name can recur
// across many entries (every prescription issue) — we collapse to last-seen
// and check whether the required monitoring tests have happened within
// `interval` days of today.
function computeDrugMonitoring(entries) {
  const today = new Date();
  const results = [];
  // Pre-filter to entries that have body text we can scan
  const scanEntries = entries.filter(e => e.date);
  // Build the list of all investigation results (used to check monitoring).
  const invEntries = scanEntries.filter(e => e.bucket === 'investigation');

  for (const d of HIGH_RISK_DRUGS) {
    const drugRe = new RegExp('\\b(' + d.terms.map(t => t.replace(/[.*+?^${}()|[\\]\\\\]/g,'\\$&')).join('|') + ')\\b', 'i');
    const drugEntries = scanEntries.filter(e => {
      const hay = (e.code||'') + ' ' + (e.body||[]).join(' ');
      return drugRe.test(hay);
    });
    if (!drugEntries.length) continue;
    drugEntries.sort((a,b) => b.date - a.date);
    const lastSeen = drugEntries[0].date;
    // Drug "active" if seen in the last 18 months (typical repeat-cycle).
    const daysSinceLastSeen = Math.round((today - lastSeen) / 86400000);
    const active = daysSinceLastSeen <= 540;
    // Find last monitoring test that matches any of d.requires.
    let lastMon = null;
    if (d.requires.length) {
      const monMatches = invEntries.filter(e => {
        const hay = (e.results||[]).map(r =>
          r.panel.toLowerCase() + ' ' + r.items.map(i => i.name.toLowerCase()).join(' ')
        ).join(' ');
        return d.requires.some(req => hay.includes(req));
      });
      monMatches.sort((a,b) => b.date - a.date);
      lastMon = monMatches[0]?.date || null;
    }
    const daysSinceMon = lastMon ? Math.round((today - lastMon) / 86400000) : null;
    const overdue = active && d.interval > 0 && (daysSinceMon == null || daysSinceMon > d.interval);
    results.push({
      ...d,
      active,
      lastSeen,
      occurrences: drugEntries.length,
      lastMonitoring: lastMon,
      daysSinceMonitoring: daysSinceMon,
      overdue,
    });
  }
  // Active drugs first, then overdue, then by name.
  return results.sort((a,b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
}

// Charlson Comorbidity Index from the coded problem list (active + past).
// Keyword substring matching, with a negation guard to skip family-history /
// "no evidence" / risk-only mentions. One interaction: a metastatic match
// suppresses the lower-weight malignancy contribution (count 6, not 8). Age is
// added by the standard decade banding (50→1 … 80+→4). Display-only; no
// mortality mapping. Flags missing age rather than inventing it.
const NEG_RE = /family history|fh of|no evidence|negative|screen|excluded|risk of|at risk/i;

function computeCharlson(active, past, ageStr) {
  const all = [...(active||[]), ...(past||[])];
  const items = [];
  const matchedIds = new Set();
  for (const cat of CHARLSON_WEIGHTS) {
    const hit = all.find(p => {
      const name = (p && p.name) || '';
      if (NEG_RE.test(name)) return false;
      const low = name.toLowerCase();
      return cat.terms.some(t => low.includes(t));
    });
    if (hit) {
      matchedIds.add(cat.id);
      items.push({ id: cat.id, label: cat.label, weight: cat.weight, evidence: hit.name });
    }
  }
  // Interaction: metastatic solid tumour subsumes the malignancy(2) tier.
  let scored = items;
  if (matchedIds.has('metastatic')) {
    scored = items.filter(it => it.id !== 'malignancy');
  }
  const comorbidityScore = scored.reduce((a, it) => a + (it.weight || 0), 0);
  const age = parseInt(ageStr, 10);
  const ageKnown = Number.isFinite(age);
  const ageScore = ageKnown && age >= 50 ? Math.min(Math.floor((age - 40) / 10), 4) : 0;
  return {
    items: scored.map(it => ({ label: it.label, weight: it.weight, evidence: it.evidence })),
    comorbidityScore,
    ageScore,
    total: comorbidityScore + ageScore,
    ageKnown,
  };
}

// Per-condition tracked analyte + target, keyed by QOF_REGISTERS id. Only the
// conditions that carry a single trackable bloods/observation analyte are here;
// every other register is already shown by the review-status grid in Recalls.
const CONDITION_METRICS = {
  dm:  { analyteTerms:['hba1c'],                    target:{ label:'≤58 mmol/mol', good:v=>v<=58 } },
  htn: { analyteTerms:['systolic blood pressure'],  target:{ label:'<140 systolic', good:v=>v<140 } },
  ckd: { analyteTerms:['egfr'],                     target:{ label:'monitor trend', good:null } },
};

// For each register with a CONDITION_METRICS entry, pick the matching analyte
// series (substring + LONGEST-match so 'systolic blood pressure' wins over a
// looser match), drop null-dated points, and report the latest value + target.
function computeConditionSummaries(registersWithReview, analytes) {
  const out = [];
  const keys = Object.keys(analytes || {});
  for (const reg of (registersWithReview || [])) {
    const metric = CONDITION_METRICS[reg.id];
    if (!metric) continue;
    const matches = keys.filter(k => metric.analyteTerms.some(t => k.toLowerCase().includes(t)));
    const key = matches.sort((a, b) => b.length - a.length)[0];
    let points = ((key && analytes[key]) || []).filter(p => p.date instanceof Date && !isNaN(p.date));
    const latest = points.length ? points[points.length - 1] : null;
    const onTarget = (latest && metric.target.good) ? metric.target.good(Number(latest.value)) : null;
    out.push({
      reg,
      key: key || null,
      latest,
      points,
      target: metric.target,
      onTarget,
      overdue: reg.overdue,
      monthsSinceReview: reg.monthsSinceReview,
    });
  }
  return out;
}

// Review-due badge for a register (extracted from buildRecalls so the Recalls
// grid and the condition cards stay in lockstep). Returns { cls, text }.
function reviewBadge(reg) {
  if (!reg || !reg.lastReview) return { cls:'badge-red', text:'No review recorded' };
  if (reg.overdue) return { cls:'badge-amber', text:`${reg.monthsSinceReview}m ago` };
  return { cls:'badge-green', text:`${reg.monthsSinceReview}m ago` };
}

// ══ FILTER BAR ═════════════════════════════════════════════════════════════

function buildFilterBarSelects() {
  // Clinician select — full list of practitioners with their consult counts.
  const cliSel = document.getElementById('fb-clinician');
  const allClinicians = computeClinicians(_s.entries);
  cliSel.innerHTML = '<option value="">All clinicians</option>' +
    allClinicians.map(c => `<option value="${esc(c.name)}">${esc(c.name)} (${c.total})</option>`).join('');

  // Problem select — active first, then past.
  const probSel = document.getElementById('fb-problem');
  const ap = _s.activeProblems.slice().sort((a,b)=>a.name.localeCompare(b.name));
  const pp = _s.pastProblems.slice().sort((a,b)=>a.name.localeCompare(b.name));
  let probOpts = '<option value="">All problems</option>';
  if (ap.length) {
    probOpts += '<optgroup label="Active problems">';
    for (const p of ap) probOpts += `<option value="${esc(p.name)}">${esc(p.name)}</option>`;
    probOpts += '</optgroup>';
  }
  if (pp.length) {
    probOpts += '<optgroup label="Past problems">';
    for (const p of pp) probOpts += `<option value="${esc(p.name)}">${esc(p.name)}</option>`;
    probOpts += '</optgroup>';
  }
  probSel.innerHTML = probOpts;
}

function buildFilterBarBrush() {
  const svg = d3.select('#fb-brush');
  svg.selectAll('*').remove();
  const W = +svg.attr('width'), H = +svg.attr('height');
  const margin = { left: 6, right: 6, top: 4, bottom: 14 };
  const innerW = W - margin.left - margin.right;
  const innerH = H - margin.top - margin.bottom;

  const [d0, d1] = entriesDateExtent(_s.entries);
  const x = d3.scaleTime().domain([d0, d1]).range([0, innerW]);

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
  g.append('rect').attr('class','fb-track').attr('width',innerW).attr('height',innerH)
    .attr('fill','#e8edf0').attr('rx',3);
  // tick years
  const yearTicks = x.ticks(d3.timeYear.every(Math.max(1, Math.ceil((d1.getFullYear()-d0.getFullYear())/6))));
  const tickG = g.append('g').attr('class','fb-ticks');
  tickG.selectAll('text').data(yearTicks).enter().append('text')
    .attr('x', d => x(d)).attr('y', innerH + 11).attr('text-anchor','middle')
    .text(d => d.getFullYear());
  tickG.selectAll('line').data(yearTicks).enter().append('line')
    .attr('x1', d => x(d)).attr('x2', d => x(d))
    .attr('y1', 0).attr('y2', innerH).attr('stroke','#cfd6da').attr('stroke-width',0.5);

  const brush = d3.brushX().extent([[0,0],[innerW,innerH]])
    .on('end', (event) => {
      if (_s._fbSuppressEnd) return;          // programmatic move from applyPreset
      if (!event.selection) {
        _s.filter.dateFrom = null; _s.filter.dateTo = null; _s.filter.preset = 'all';
      } else {
        const [a,b] = event.selection.map(x.invert);
        _s.filter.dateFrom = a; _s.filter.dateTo = b; _s.filter.preset = 'custom';
      }
      document.querySelectorAll('.fb-preset').forEach(b => b.classList.toggle('active', b.dataset.preset === _s.filter.preset));
      rebuildAll();
    });

  const brushG = g.append('g').attr('class','fb-brush');
  brushG.call(brush);
  // Stash for preset buttons to update programmatically.
  _s._fbBrush = { brush, brushG, x, innerW };
}

function applyPreset(preset) {
  const now = new Date();
  let from = null, to = null;
  if (preset === 'all') { from = null; to = null; }
  else {
    to = now;
    const years = preset === '5y' ? 5 : preset === '3y' ? 3 : 1;
    from = new Date(now.getTime()); from.setFullYear(from.getFullYear() - years);
  }
  _s.filter.dateFrom = from;
  _s.filter.dateTo   = to;
  _s.filter.preset   = preset;
  document.querySelectorAll('.fb-preset').forEach(b => b.classList.toggle('active', b.dataset.preset === preset));
  // Visually move the brush — suppress the 'end' event so we don't double-fire.
  const fb = _s._fbBrush;
  if (fb) {
    _s._fbSuppressEnd = true;
    try {
      if (preset === 'all') fb.brushG.call(fb.brush.move, null);
      else                  fb.brushG.call(fb.brush.move, [fb.x(from), fb.x(to)]);
    } finally {
      _s._fbSuppressEnd = false;
    }
  }
  rebuildAll();
}

function wireFilterBar() {
  document.querySelectorAll('.fb-preset').forEach(b => {
    b.addEventListener('click', () => applyPreset(b.dataset.preset));
  });
  document.getElementById('fb-clinician').addEventListener('change', e => {
    _s.filter.clinician = e.target.value || null;
    rebuildAll();
  });
  document.getElementById('fb-problem').addEventListener('change', e => {
    _s.filter.problem = e.target.value || null;
    rebuildAll();
  });
  document.getElementById('fb-clear').addEventListener('click', () => {
    _s.filter = { dateFrom:null, dateTo:null, preset:'all', clinician:null, problem:null };
    document.getElementById('fb-clinician').value = '';
    document.getElementById('fb-problem').value = '';
    document.querySelectorAll('.fb-preset').forEach(b => b.classList.toggle('active', b.dataset.preset === 'all'));
    const fb = _s._fbBrush;
    if (fb) {
      _s._fbSuppressEnd = true;
      try { fb.brushG.call(fb.brush.move, null); }
      finally { _s._fbSuppressEnd = false; }
    }
    rebuildAll();
  });
}

// ══ BUILD APP ═══════════════════════════════════════════════════════════════

function buildApp() {
  const d = _s.demographics;
  const entries = _s.entries;

  // Reset filter state to "all" on each fresh load.
  _s.filter = { dateFrom:null, dateTo:null, preset:'all', clinician:null, problem:null };
  _s.invUI = { sortKey:'analyte', sortDir:'asc', filterText:'', onlyAbn:false };

  // Patient banner
  document.getElementById('pb-name').textContent = (d.title ? d.title+' ' : '') + d.name;
  document.getElementById('pb-age').textContent = d.age ? d.age + 'y' : '';
  document.getElementById('pb-nhs').textContent = d.nhs ? 'NHS ' + d.nhs : '';
  const lastEntry = entries.filter(e=>e.date).sort((a,b)=>b.date-a.date)[0];
  if (lastEntry) {
    const dr = lastEntry.practitioner ? ` — ${lastEntry.practitioner}` : '';
    document.getElementById('pb-last').textContent = 'Last: ' + lastEntry.dateStr + dr;
  }

  // Populate filter-bar selects from the full record.
  buildFilterBarSelects();
  buildFilterBarBrush();
  wireFilterBar();

  rebuildAll();

  // Show app
  document.getElementById('drop-zone').style.display = 'none';
  const app = document.getElementById('app');
  app.style.display = 'flex';
}

// Recompute analytics under the current filter and re-render every tab.
// Called on first load and whenever a filter changes.
function rebuildAll() {
  const d = _s.demographics;
  const entries = filteredEntries();
  const clinicians = computeClinicians(entries);
  const contactableEntries = entries.filter(e => e.bucket === 'consultation');
  const upc  = computeUPC(clinicians, entries.length);
  const bice = computeBice(clinicians, entries.length);
  const timeline   = computeTimeline(entries);
  const invData    = computeInvestigations(entries);
  const recalls    = computeRecalls(entries);
  const registers  = computeRegisters(_s.activeProblems, _s.pastProblems);
  const registersWithReview = enrichRegistersWithReview(registers, _s.entries);
  const drugs      = computeDrugMonitoring(_s.entries);  // drugs use FULL record
  const efi        = computeEFI(_s.activeProblems, _s.pastProblems, drugs);
  const pincer     = computePINCER([..._s.activeProblems, ..._s.pastProblems], drugs, _s.entries);
  const charlson   = computeCharlson(_s.activeProblems, _s.pastProblems, _s.demographics?.age);
  const conditionSummaries = computeConditionSummaries(registersWithReview, invData.analytes);

  buildSnapshot(d, entries, recalls, efi, pincer, drugs, charlson, registersWithReview);
  buildContinuity(clinicians, entries, upc, bice, contactableEntries);
  buildTimeline(entries);
  buildInvestigations(invData);
  buildMedications(drugs, pincer);
  buildRecalls(recalls, registersWithReview, conditionSummaries);
  buildLetters(entries);

  // Filter-bar summary
  const sum = document.getElementById('fb-summary');
  if (sum) {
    const total = _s.entries.length;
    const shown = entries.length;
    const bits = [];
    bits.push(`${shown.toLocaleString()} of ${total.toLocaleString()} entries`);
    if (_s.filter.clinician)  bits.push(`clinician: ${_s.filter.clinician}`);
    if (_s.filter.problem)    bits.push(`problem: ${_s.filter.problem}`);
    sum.textContent = bits.join(' · ');
  }
}

// ══ TAB: SNAPSHOT ══════════════════════════════════════════════════════════

function buildSnapshot(d, entries, recalls, efi, pincer, drugs, charlson, registersWithReview) {
  const ap = _s.activeProblems, pp = _s.pastProblems;
  const now = new Date();
  const last12m = entries.filter(e => e.date && (now - e.date) < 365*864e5).length;
  const oldest = entries.filter(e=>e.date).sort((a,b)=>a.date-b.date)[0];
  const lastEntry = entries.filter(e=>e.date).sort((a,b)=>b.date-a.date)[0];
  const openRecalls = recalls.open;
  const activeProblemFilter = _s.filter.problem;

  // eFI gauge — semicircle from 0 to 0.50 (anything ≥ 0.36 is "severe").
  const efiPct = Math.min(efi.score / 0.50, 1);  // 0..1 of arc
  const efiCirc = 113;  // ~ 2*π*18 (we use r=36)
  const efiOffset = efiCirc * (1 - efiPct);
  const efiHtml = `<div class="card">
    <div class="card-title">Electronic Frailty Index (eFI)</div>
    <div class="efi-card">
      <svg class="efi-gauge" viewBox="0 0 80 80">
        <circle class="efi-gauge-bg" cx="40" cy="40" r="32"/>
        <circle class="efi-gauge-fg" cx="40" cy="40" r="32" stroke="${efi.colour}"
          stroke-dasharray="${(2*Math.PI*32).toFixed(1)}" stroke-dashoffset="${((2*Math.PI*32)*(1-efiPct)).toFixed(1)}"
          transform="rotate(-90 40 40)"/>
        <text class="efi-num" x="40" y="40" style="fill:${efi.colour}">${efi.score.toFixed(2)}</text>
      </svg>
      <div class="efi-detail">
        <div class="efi-cat-label" style="color:${efi.colour}">${efi.category}</div>
        <div class="efi-meta">
          <strong>${efi.ticked.length}</strong> of ${efi.total} deficits present.<br>
          ${efi.ticked.slice(0,4).map(t=>esc(t.label)).join(' · ')}${efi.ticked.length>4 ? ` · +${efi.ticked.length-4} more`:''}
        </div>
      </div>
    </div>
  </div>`;

  // Comorbidity card — multimorbidity (LTC register count) + Charlson index.
  // Display-only, keyword-derived, flags missing age. Sits beside the eFI gauge.
  const ltcCount = (registersWithReview || []).length;
  const ch = charlson || { items:[], comorbidityScore:0, ageScore:0, total:0, ageKnown:false };
  const chItems = ch.items || [];
  const ageMeta = ch.ageKnown
    ? `incl. age +${ch.ageScore}`
    : `<span style="color:var(--nhs-red)">age unknown — not age-adjusted</span>`;
  const condText = chItems.length
    ? chItems.slice(0,4).map(it => esc(it.label)).join(' · ') + (chItems.length > 4 ? ` · +${chItems.length-4} more` : '')
    : 'No CCI-weighted conditions coded';
  const comorbidityHtml = `<div class="card">
    <div class="card-title">Comorbidity</div>
    <div class="grid-2" style="gap:10px">
      <div style="text-align:center">
        <div class="stat-num" style="font-variant-numeric:tabular-nums">${ltcCount}</div>
        <div class="stat-lbl">LTC registers</div>
      </div>
      <div style="text-align:center">
        <div class="stat-num" style="font-variant-numeric:tabular-nums">${ch.total}</div>
        <div class="stat-lbl">Charlson index</div>
      </div>
    </div>
    <div class="efi-meta" style="margin-top:10px">${ageMeta}</div>
    <div class="efi-meta" style="margin-top:4px">${condText}</div>
    <div style="font-size:10px;color:#768692;margin-top:6px">Indicative, from coded problems — verify against record.</div>
  </div>`;

  // Monitoring-due card — overdue high-risk-drug monitoring. Never invents a
  // last-monitoring date: shows "No record" in red when none is held.
  const dueDrugs = (drugs||[]).filter(x => x.active && x.overdue);
  let monitoringHtml = '';
  if (dueDrugs.length) {
    const fmtMon = d => d ? d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : null;
    const rows = dueDrugs.map(x => {
      const req = (x.requires||[]).slice(0,2).join(', ') || 'No specific monitoring';
      const lastStr = x.lastMonitoring == null
        ? `<span style="color:var(--nhs-red);font-weight:600">No record</span>`
        : `${esc(fmtMon(x.lastMonitoring))}${x.daysSinceMonitoring != null ? ` <span class="drug-meta" style="font-variant-numeric:tabular-nums">(${x.daysSinceMonitoring}d ago)</span>` : ''}`;
      return `<div class="drug-row overdue">
        <span class="drug-name">${esc(x.label)}</span>
        <span class="drug-meta">${esc(req)}</span>
        <span>${lastStr}</span>
        <span style="font-variant-numeric:tabular-nums">every ${Math.round((x.interval||0)/30)}m</span>
        <span><span class="badge badge-red">Overdue</span></span>
      </div>`;
    }).join('');
    monitoringHtml = `<div class="card" style="border-left:4px solid var(--nhs-red)">
      <div class="card-title" style="color:var(--nhs-red)">Monitoring due (${dueDrugs.length})</div>
      ${rows}
      <div style="font-size:10px;color:#768692;margin-top:6px">See Medications tab for full monitoring detail.</div>
    </div>`;
  } else if ((drugs||[]).some(x => x.active && x.interval > 0)) {
    monitoringHtml = `<div class="card" style="border-left:4px solid var(--nhs-green)">
      <div class="card-title">Monitoring due</div>
      <div style="font-size:12px;color:#4c6272">All monitoring up to date.</div>
    </div>`;
  }

  // PINCER red-flag card. Always renders so its absence is informative.
  let pincerHtml;
  if (pincer && pincer.length) {
    const items = pincer.slice(0, 8).map(f => `
      <div class="pincer-item ${esc(f.severity)}">
        <span style="color:${f.severity==='high'?'#d4351c':f.severity==='med'?'#f47738':'#768692'};font-weight:700">⚠</span>
        <div style="flex:1">
          <div class="pincer-rule">${esc(f.rule)}</div>
          <div class="pincer-detail">${esc(f.detail)}</div>
        </div>
      </div>`).join('');
    pincerHtml = `<div class="card pincer-card">
      <div class="card-title" style="color:var(--nhs-red)">⚠ Prescribing &amp; monitoring flags (${pincer.length})</div>
      <div class="pincer-list">${items}</div>
      ${pincer.length > 8 ? `<div style="font-size:11px;color:#768692;margin-top:6px">+ ${pincer.length-8} more — see Medications tab.</div>` : ''}
    </div>`;
  } else {
    pincerHtml = `<div class="card" style="border-left:4px solid var(--nhs-green)">
      <div class="card-title">Prescribing &amp; monitoring</div>
      <div style="font-size:12px;color:#4c6272">No PINCER-style flags detected from the visible record.</div>
    </div>`;
  }

  const whatsNew = computeWhatsNew(entries);
  let whatsNewHtml = '';
  if (whatsNew && whatsNew.items.length) {
    const pivotStr = whatsNew.pivot.date.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
    const pivotWho = whatsNew.pivot.practitioner ? ' — ' + esc(whatsNew.pivot.practitioner) : '';
    // Group items by bucket for a tidy summary
    const grouped = {};
    for (const it of whatsNew.items) {
      const b = it.bucket;
      if (!grouped[b]) grouped[b] = [];
      grouped[b].push(it);
    }
    let rows = '';
    for (const it of whatsNew.items.slice(0, 12)) {
      const dt = it.date.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
      // Flag abnormals in investigation entries
      let abn = '';
      if (it.bucket === 'investigation' && it.results) {
        const flags = [];
        for (const r of it.results) for (const item of r.items) {
          const v = parseFloat(item.value);
          if (!isNaN(v) && item.low != null && v < parseFloat(item.low)) flags.push(`${item.name} low`);
          else if (!isNaN(v) && item.high != null && v > parseFloat(item.high)) flags.push(`${item.name} high`);
        }
        if (flags.length) abn = ` <span class="badge badge-red">${flags.length} abnormal</span>`;
      }
      const title = it.code || it.type;
      const who = it.practitioner ? ' · ' + esc(it.practitioner) : '';
      rows += `<tr>
        <td style="white-space:nowrap;width:90px;font-size:12px">${dt}</td>
        <td><span class="badge badge-grey" style="background:${BUCKET_COLOUR[it.bucket]}20;color:${BUCKET_COLOUR[it.bucket]}">${esc(it.bucket)}</span></td>
        <td style="font-size:13px">${esc(title)}${abn}<span style="color:#768692">${who}</span></td>
      </tr>`;
    }
    const moreNote = whatsNew.items.length > 12 ? `<div style="font-size:11px;color:#768692;margin-top:6px">+ ${whatsNew.items.length - 12} more event(s) since last consultation.</div>` : '';
    const summaryChips = Object.entries(grouped).map(([b, arr]) =>
      `<span class="badge badge-grey" style="background:${BUCKET_COLOUR[b]}20;color:${BUCKET_COLOUR[b]};margin-right:6px">${arr.length} ${esc(b)}</span>`).join('');
    whatsNewHtml = `<div class="card" style="border-left:4px solid var(--nhs-blue)">
      <div class="card-title">What's new since last consultation</div>
      <div style="font-size:12px;color:#4c6272;margin-bottom:8px">
        Last consultation: <strong>${pivotStr}</strong>${pivotWho}.
        ${whatsNew.items.length} event(s) since.
      </div>
      <div style="margin-bottom:8px">${summaryChips}</div>
      <table class="data-table"><tbody>${rows}</tbody></table>
      ${moreNote}
    </div>`;
  }

  let html = `
  <div class="grid-4" style="margin-bottom:14px">
    <div class="stat-tile"><div class="stat-num">${entries.length}</div><div class="stat-lbl">Total entries (filtered)</div></div>
    <div class="stat-tile"><div class="stat-num">${last12m}</div><div class="stat-lbl">Last 12 months</div></div>
    <div class="stat-tile"><div class="stat-num">${ap.length}</div><div class="stat-lbl">Active problems</div></div>
    <div class="stat-tile"><div class="stat-num">${openRecalls.length}</div><div class="stat-lbl">Open recalls</div></div>
  </div>

  <div class="grid-3" style="margin-bottom:14px">
    ${efiHtml}
    ${comorbidityHtml}
    ${pincerHtml}
  </div>

  ${monitoringHtml}

  ${whatsNewHtml}

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
        <div class="card-title">Active Problems <span style="font-weight:400;color:#768692">(${ap.length})</span> <span style="font-weight:400;color:#b1b4b6;font-size:10px">— click to spotlight</span></div>
        <ul class="prob-list">`;

  const sortedAP = [...ap].sort((a,b)=>(b.date||0)-(a.date||0));
  for (const p of sortedAP) {
    const isActive = activeProblemFilter === p.name;
    html += `<li class="prob-item clickable ${isActive?'problem-active':''}" data-problem="${esc(p.name)}">
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
      const isActive = activeProblemFilter === p.name;
      html += `<li class="prob-item prob-past clickable ${isActive?'problem-active':''}" data-problem="${esc(p.name)}">
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
    rebuildAll();
    switchTab('snapshot');
  });

  // Click a problem to spotlight it across all views (toggles off if same).
  document.querySelectorAll('#tab-snapshot .prob-item.clickable').forEach(li => {
    li.addEventListener('click', () => {
      const name = li.dataset.problem;
      _s.filter.problem = (_s.filter.problem === name) ? null : name;
      const sel = document.getElementById('fb-problem');
      if (sel) sel.value = _s.filter.problem || '';
      rebuildAll();
    });
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
  const cliFilter = _s.filter.clinician;

  let bars = '';
  for (const c of top) {
    const pct = total ? Math.round(c.total / maxVal * 100) : 0;
    const share = total ? Math.round(c.total / total * 100) : 0;
    const isActive = cliFilter === c.name;
    bars += `<div class="bar-row" data-clinician="${esc(c.name)}" style="cursor:pointer;padding:2px 0;border-radius:3px;${isActive?'background:#fff3cd':''}">
      <span class="bar-label" title="Click to filter — ${esc(c.name)}">${esc(c.name)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;${isActive?'background:var(--nhs-orange)':''}"></div></div>
      <span class="bar-val">${c.total} <span style="color:#b1b4b6">(${share}%)</span></span>
    </div>`;
  }

  let tableRows = '';
  for (const c of clinicians.slice(0,30)) {
    const share = total ? Math.round(c.total / total * 100) : 0;
    const dominant = Object.entries(c.byBucket).sort((a,b)=>b[1]-a[1])[0];
    const isActive = cliFilter === c.name;
    tableRows += `<tr data-clinician="${esc(c.name)}" style="cursor:pointer;${isActive?'background:#fff3cd!important':''}">
      <td>${esc(c.name)}</td>
      <td style="text-align:center">${c.total}</td>
      <td style="text-align:center">${share}%</td>
      <td>${dominant ? `<span class="badge badge-grey" style="background:${BUCKET_COLOUR[dominant[0]]}20;color:${BUCKET_COLOUR[dominant[0]]}">${esc(dominant[0])}</span>` : '—'}</td>
      <td>${c.lastDate ? c.lastDate.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : '—'}</td>
    </tr>`;
  }

  // ── Practitioner ribbon: cells coloured by clinician (left = older), with
  //    a gap-strip beneath showing days since previous consult (capped 90d).
  //    Cell width is bigger when fewer consults are showing so it stays
  //    readable when the date filter zooms in.
  const consults = entries
    .filter(e => e.bucket === 'consultation' && e.practitioner && e.date)
    .sort((a,b) => a.date - b.date);
  let ribbonHtml = '';
  if (consults.length >= 1) {
    const practitioners = [...new Set(_s.entries.filter(e=>e.practitioner).map(e => e.practitioner))];
    const cmap = practitionerColourMap(practitioners);
    const cellWidth = Math.max(6, Math.min(28, Math.floor(900 / Math.max(consults.length, 1))));
    const maxGap = 180;
    let cells = '', gaps = '';
    let prev = null;
    for (const c of consults) {
      const gap = prev ? daysBetween(prev, c.date) : 0;
      const dateStr = c.date.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
      const tip = `${dateStr} — ${c.practitioner}${prev ? ` (${gap}d since previous)` : ''}`;
      cells += `<div title="${esc(tip)}" style="background:${cmap[c.practitioner]};width:${cellWidth}px;height:22px;flex-shrink:0;border-right:1px solid #fff"></div>`;
      const gh = Math.min(gap, maxGap) / maxGap * 28;
      gaps  += `<div title="${gap}d gap" style="background:#b1b4b6;width:${cellWidth}px;height:${gh.toFixed(1)}px;flex-shrink:0;border-right:1px solid #fff;margin-top:auto"></div>`;
      prev = c.date;
    }
    // Legend uses the practitioners visible in the filtered consults to stay relevant
    const visiblePract = [...new Set(consults.map(c => c.practitioner))];
    const legendHtml = visiblePract.slice(0, 24).map(p =>
      `<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;color:#4c6272;margin:0 10px 4px 0;cursor:pointer" data-clinician="${esc(p)}">
        <span style="width:11px;height:11px;background:${cmap[p]};border-radius:2px;display:inline-block"></span>${esc(p)}
      </span>`).join('');
    const moreNote = visiblePract.length > 24 ? `<span style="font-size:11px;color:#768692">+${visiblePract.length-24} more</span>` : '';
    ribbonHtml = `<div class="card">
      <div class="card-title">Practitioner ribbon — ${consults.length} consultation${consults.length===1?'':'s'}</div>
      <div style="display:flex;overflow-x:auto;border-radius:3px">${cells}</div>
      <div style="display:flex;overflow-x:auto;align-items:flex-end;height:30px;margin-top:2px;border-bottom:1px solid #f0f0f0;padding-bottom:2px">${gaps}</div>
      <div style="font-size:10px;color:#768692;margin-top:6px">Top: clinician (older ← → newer). Bottom: days since previous consult (taller = bigger gap, capped 180d). Click a legend swatch to filter to that clinician.</div>
      <div style="margin-top:10px;display:flex;flex-wrap:wrap" id="ribbon-legend">${legendHtml} ${moreNote}</div>
    </div>`;
  } else {
    ribbonHtml = `<div class="card"><div class="card-title">Practitioner ribbon</div>
      <div style="font-size:13px;color:#768692">No consultations in selected range${cliFilter?' for clinician '+esc(cliFilter):''}.</div></div>`;
  }

  const filterNote = (cliFilter || _s.filter.preset !== 'all')
    ? `<div style="font-size:11px;color:var(--text2);margin-bottom:10px;background:#fff3cd;border:1px solid #ffe082;border-radius:4px;padding:6px 10px">
        Showing filtered view: ${cliFilter ? `clinician = <strong>${esc(cliFilter)}</strong>` : ''}${cliFilter && _s.filter.preset!=='all' ? ' · ' : ''}${_s.filter.preset !== 'all' ? `range = <strong>${esc(_s.filter.preset==='custom'?'custom':_s.filter.preset)}</strong>` : ''}.
        Clear filters via the bar above.
      </div>` : '';

  const html = `
  ${filterNote}
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
  ${ribbonHtml}
  <div class="card">
    <div class="card-title">Contacts by clinician (top 15 of ${clinicians.length}) <span style="font-weight:400;color:#b1b4b6;font-size:10px">— click to filter</span></div>
    <div class="bar-chart" id="cli-bars">${bars}</div>
  </div>
  <div class="card">
    <div class="card-title">Clinician detail (top 30)</div>
    <table class="data-table">
      <thead><tr><th>Clinician</th><th style="text-align:center">Entries</th><th style="text-align:center">Share</th><th>Dominant type</th><th>Last contact</th></tr></thead>
      <tbody id="cli-table-body">${tableRows}</tbody>
    </table>
  </div>`;

  document.getElementById('tab-continuity').innerHTML = html;

  // Wire clinician click-to-filter (toggles).
  const handler = (el) => {
    const name = el.dataset.clinician;
    if (!name) return;
    _s.filter.clinician = (_s.filter.clinician === name) ? null : name;
    const sel = document.getElementById('fb-clinician');
    if (sel) sel.value = _s.filter.clinician || '';
    rebuildAll();
  };
  document.querySelectorAll('#cli-bars .bar-row').forEach(el => el.addEventListener('click', () => handler(el)));
  document.querySelectorAll('#cli-table-body tr').forEach(el => el.addEventListener('click', () => handler(el)));
  document.querySelectorAll('#ribbon-legend [data-clinician]').forEach(el => el.addEventListener('click', () => handler(el)));
}

// ══ TAB: TIMELINE (D3 SWIM-LANE) ═══════════════════════════════════════════

function buildTimeline(entries) {
  // Legend + filter note
  const legendItems = Object.entries(BUCKET_COLOUR).map(([b,c])=>
    `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#4c6272;margin-right:14px">
      <span style="width:10px;height:10px;border-radius:2px;background:${c};display:inline-block"></span>${b}
    </span>`).join('');

  // Single aggregation for both the year-volume bar and the calendar heatmap.
  const tl = computeTimeline(entries);
  const years = Object.keys(tl.byYear).sort();
  const maxYr = Math.max(...years.map(y => tl.byYear[y].total), 1);
  let yearBars = '';
  for (const y of years) {
    const v = tl.byYear[y].total;
    const pct = Math.round(v / maxYr * 100);
    yearBars += `<div style="display:flex;flex-direction:column;align-items:center;gap:2px">
      <div style="font-size:10px;color:#768692">${v}</div>
      <div style="width:24px;height:${pct}px;background:var(--nhs-blue);border-radius:2px 2px 0 0"></div>
      <div style="font-size:10px;color:#4c6272">${y}</div>
    </div>`;
  }

  document.getElementById('tab-timeline').innerHTML = `
  <div class="card">
    <div class="card-title">Swim-lane — every event placed on its timeline</div>
    <div style="margin-bottom:8px">${legendItems}</div>
    <div class="swimlane-wrap">
      <svg id="swimlane-svg" class="swimlane-svg"></svg>
      <div class="swimlane-tooltip" id="swim-tip"></div>
    </div>
    <div style="font-size:10px;color:#768692;margin-top:6px">Hover an event for detail; click to lock the tooltip. Highlighted entries match the active problem filter.</div>
  </div>
  <div class="card">
    <div class="card-title">Volume by year</div>
    <div style="display:flex;align-items:flex-end;gap:6px;height:140px;overflow-x:auto;padding-bottom:6px">${yearBars}</div>
  </div>
  ${renderContactsHeatmap(tl)}`;

  renderSwimLane(entries);
}

// Calendar heatmap of dated CONSULTATION contacts (year rows × month columns).
// Colour-blind-safe single-hue Blues; zero-count cells are a neutral pale cell
// distinct from "1 contact". Uses computeTimeline's month keys verbatim
// (`${year}-${m}`, 0-indexed, no padding). Returns a card HTML string.
function renderContactsHeatmap(tl) {
  const bym = (tl && tl.byYearMonth) || {};
  const consultAt = (y, m) => bym[`${y}-${m}`]?.byBucket?.consultation || 0;

  const cellKeys = Object.values(bym);
  let total = 0;
  for (const c of cellKeys) total += (c.byBucket?.consultation || 0);
  if (!total) {
    return `<div class="card">
      <div class="card-title">Contacts calendar — consultations by month</div>
      <div style="font-size:13px;color:#768692">No dated contacts in the current selection.</div>
    </div>`;
  }

  const yearsPresent = cellKeys.map(c => c.year);
  const minYear = Math.min(...yearsPresent);
  const maxYear = Math.max(...yearsPresent);

  // Max consultation count across all cells, for quantisation.
  let max = 0;
  for (let y = minYear; y <= maxYear; y++) {
    for (let m = 0; m < 12; m++) max = Math.max(max, consultAt(y, m));
  }
  max = max || 1;

  const colourFor = v => {
    if (v === 0) return 'var(--nhs-pale)';
    const idx = Math.min(Math.ceil(v / max * 5) - 1, 4);
    return HEAT_BLUES[idx];
  };

  // Header row: empty corner + month labels.
  let header = `<div class="hm-label"></div>`;
  for (let m = 0; m < 12; m++) header += `<div class="hm-label">${MONTHS[m]}</div>`;

  let rows = '';
  for (let y = minYear; y <= maxYear; y++) {
    rows += `<div class="hm-label">${y}</div>`;
    for (let m = 0; m < 12; m++) {
      const v = consultAt(y, m);
      const title = `${MONTHS[m]} ${y} — ${v} contact${v !== 1 ? 's' : ''}`;
      const border = v === 0 ? 'border:1px solid var(--border)' : '';
      rows += `<div class="hm-cell" title="${esc(title)}" style="background:${colourFor(v)};${border}"></div>`;
    }
  }

  const legendSwatches = HEAT_BLUES.map(c =>
    `<span style="width:14px;height:14px;border-radius:3px;background:${c};display:inline-block"></span>`).join('');

  return `<div class="card">
    <div class="card-title">Contacts calendar — consultations by month</div>
    <div class="heatmap" style="grid-template-columns:44px repeat(12,1fr)">
      ${header}
      ${rows}
    </div>
    <div class="hm-legend">
      <span>fewer</span>${legendSwatches}<span>more</span>
      <span style="margin-left:10px;color:#768692;font-variant-numeric:tabular-nums">peak ${max}/month</span>
    </div>
  </div>`;
}

function renderSwimLane(entries) {
  const dated = entries.filter(e => e.date);
  const svgEl = document.getElementById('swimlane-svg');
  const tipEl = document.getElementById('swim-tip');
  if (!svgEl) return;

  // Bucket lanes — in display order. Skip lanes with no events so the chart
  // doesn't render empty rows.
  const order = ['consultation','communication','investigation','document','note','recall','referral'];
  const presentLanes = order.filter(l => dated.some(e => e.bucket === l));
  if (!presentLanes.length || !dated.length) {
    svgEl.innerHTML = `<text x="20" y="40" font-size="12" fill="#768692">No events in the current selection.</text>`;
    svgEl.setAttribute('viewBox', '0 0 600 60');
    return;
  }

  const wrap = svgEl.parentElement;
  const wrapW = wrap.getBoundingClientRect().width || 800;
  const margin = { top: 14, right: 24, bottom: 36, left: 110 };
  const laneH = 46;
  const innerW = wrapW - margin.left - margin.right;
  const innerH = presentLanes.length * laneH;
  const W = wrapW;
  const H = margin.top + innerH + margin.bottom;

  svgEl.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svgEl.setAttribute('preserveAspectRatio','xMinYMin meet');
  svgEl.style.height = H + 'px';

  const svg = d3.select(svgEl);
  svg.selectAll('*').remove();

  const t0 = d3.min(dated, e => e.date);
  const t1 = d3.max(dated, e => e.date);
  // pad a touch so the first/last dot aren't on the edge; if t0==t1 (single
  // event) use a 30-day window so the dot has somewhere to sit.
  const pad = Math.max((t1 - t0) * 0.02, 86400000 * 15);
  const x = d3.scaleTime().domain([new Date(+t0 - pad), new Date(+t1 + pad)]).range([0, innerW]);

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  // Lane backgrounds (alternating)
  presentLanes.forEach((l, i) => {
    g.append('rect').attr('class', i % 2 ? 'lane-bg alt' : 'lane-bg')
      .attr('x', 0).attr('y', i*laneH).attr('width', innerW).attr('height', laneH);
    g.append('text').attr('class','lane-label')
      .attr('x', -8).attr('y', i*laneH + laneH/2 + 4).attr('text-anchor','end').text(l);
  });

  // x-axis
  const xAxis = d3.axisBottom(x).ticks(Math.min(10, Math.max(3, Math.round(innerW/100)))).tickSizeOuter(0);
  g.append('g').attr('class','axis').attr('transform', `translate(0,${innerH})`).call(xAxis);

  // Problem highlight
  const problem = _s.filter.problem;
  const problemActive = !!problem;

  // Events
  const eventG = g.append('g').attr('class','events');
  const r = 4;
  eventG.selectAll('circle').data(dated).enter().append('circle')
    .attr('class', d => {
      const highlighted = problemActive && isProblemHighlighted(d);
      if (problemActive && !highlighted) return 'event dimmed';
      return 'event' + (highlighted ? ' highlighted' : '');
    })
    .attr('cx', d => x(d.date))
    .attr('cy', d => presentLanes.indexOf(d.bucket) * laneH + laneH/2)
    .attr('r', d => problemActive && isProblemHighlighted(d) ? r + 1.5 : r)
    .attr('fill', d => BUCKET_COLOUR[d.bucket] || '#999')
    .on('mouseenter', (event, d) => {
      const wrect = wrap.getBoundingClientRect();
      const cx = event.clientX - wrect.left;
      const cy = event.clientY - wrect.top;
      const dt = d.date.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
      const lines = [
        `<strong>${esc(dt)}</strong> · ${esc(d.bucket)}`,
        d.type ? esc(d.type) : '',
        d.practitioner ? esc(d.practitioner) : '',
        d.code ? esc(d.code) : '',
        d.linkedProblems && d.linkedProblems.length ? `<em>Linked:</em> ${esc(d.linkedProblems.slice(0,2).join(' · '))}` : '',
      ].filter(Boolean);
      tipEl.innerHTML = lines.join('<br>');
      tipEl.style.left = (cx + 8) + 'px';
      tipEl.style.top  = (cy - 8) + 'px';
      tipEl.classList.add('visible');
    })
    .on('mouseleave', () => tipEl.classList.remove('visible'))
    .on('click', (event, d) => {
      // Click highlights this entry's linked problem (first one) as a quick path.
      if (d.linkedProblems && d.linkedProblems.length) {
        const p = d.linkedProblems[0];
        _s.filter.problem = _s.filter.problem === p ? null : p;
        const sel = document.getElementById('fb-problem');
        if (sel) sel.value = _s.filter.problem || '';
        rebuildAll();
      }
    });
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

  const ui = _s.invUI;
  const html = `
  <div class="grid-2">
    <div class="card">
      <div class="card-title">Test panels (${panelList.length})</div>
      <table class="data-table"><thead><tr><th>Panel</th><th>Count</th><th>Last requested</th></tr></thead>
      <tbody>${panelRows || '<tr><td colspan="3" style="color:#768692">No investigations in range</td></tr>'}</tbody></table>
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
    <div class="card-title">Latest values <span id="inv-count" style="font-weight:400;color:#768692"></span></div>
    <div class="inv-toolbar">
      <input type="text" id="inv-search" placeholder="Filter analyte name…" value="${esc(ui.filterText)}">
      <label><input type="checkbox" id="inv-only-abn" ${ui.onlyAbn?'checked':''}> Only abnormal</label>
      <span style="font-size:10px;color:#768692">Click a column header to sort.</span>
    </div>
    <table class="data-table" id="inv-latest-table">
      <thead><tr>
        <th class="sortable-th" data-sk="analyte">Analyte <span class="sort-glyph"></span></th>
        <th class="sortable-th" data-sk="value">Value <span class="sort-glyph"></span></th>
        <th>Reference</th>
        <th class="sortable-th" data-sk="flag">Flag <span class="sort-glyph"></span></th>
        <th class="sortable-th" data-sk="delta">Δ vs prior <span class="sort-glyph"></span></th>
        <th>Trend</th>
        <th class="sortable-th" data-sk="date">Date <span class="sort-glyph"></span></th>
      </tr></thead>
      <tbody id="inv-latest-body"></tbody>
    </table>
    <div style="font-size:10px;color:#768692;margin-top:6px">Δ doubles and turns red when the change exceeds the analyte's published Reference Change Value (RCV).</div>
  </div>`;

  document.getElementById('tab-investigations').innerHTML = html;

  renderInvLatestTable(analytes);

  document.getElementById('analyte-select')?.addEventListener('change', e => {
    renderAnalyteTrend(analytes, e.target.value);
  });
  document.getElementById('inv-search').addEventListener('input', e => {
    _s.invUI.filterText = e.target.value;
    renderInvLatestTable(analytes);
  });
  document.getElementById('inv-only-abn').addEventListener('change', e => {
    _s.invUI.onlyAbn = e.target.checked;
    renderInvLatestTable(analytes);
  });
  document.querySelectorAll('.sortable-th').forEach(th => {
    th.addEventListener('click', () => {
      const sk = th.dataset.sk;
      if (_s.invUI.sortKey === sk) {
        _s.invUI.sortDir = _s.invUI.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        _s.invUI.sortKey = sk;
        _s.invUI.sortDir = sk === 'date' || sk === 'delta' ? 'desc' : 'asc';
      }
      renderInvLatestTable(analytes);
    });
  });
}

// Render-just-the-body — keeps the input focused while user types.
function renderInvLatestTable(analytes) {
  const ui = _s.invUI;
  // Build a row record per analyte (only those with data).
  const recs = [];
  for (const an of Object.keys(analytes)) {
    const pts = analytes[an];
    if (!pts.length) continue;
    const last = pts[pts.length-1];
    const prev = pts.length >= 2 ? pts[pts.length-2] : null;
    const refLow  = last.low  != null ? parseFloat(last.low)  : null;
    const refHigh = last.high != null ? parseFloat(last.high) : null;
    let flagKey = 'normal';
    if (refLow != null && last.value < refLow) flagKey = 'low';
    else if (refHigh != null && last.value > refHigh) flagKey = 'high';
    else if (refLow == null && refHigh == null) flagKey = 'unknown';
    // Delta vs prior (used for sort)
    let deltaPct = null;
    if (prev && prev.value != null && !isNaN(prev.value) && !isNaN(last.value)) {
      if (prev.value !== 0) deltaPct = Math.abs((last.value - prev.value) / Math.abs(prev.value));
    }
    recs.push({ analyte: an, last, prev, pts, refLow, refHigh, flagKey, deltaPct });
  }

  // Filter
  const needle = (ui.filterText||'').trim().toLowerCase();
  let filtered = recs.filter(r => !needle || r.analyte.toLowerCase().includes(needle));
  if (ui.onlyAbn) filtered = filtered.filter(r => r.flagKey === 'low' || r.flagKey === 'high');

  // Sort
  const dir = ui.sortDir === 'asc' ? 1 : -1;
  filtered.sort((a,b) => {
    const k = ui.sortKey;
    if (k === 'analyte') return a.analyte.localeCompare(b.analyte) * dir;
    if (k === 'value')   return ((a.last.value||0) - (b.last.value||0)) * dir;
    if (k === 'flag')    {
      const order = { high:3, low:2, normal:1, unknown:0 };
      return ((order[a.flagKey]||0) - (order[b.flagKey]||0)) * dir;
    }
    if (k === 'delta')   return ((a.deltaPct||0) - (b.deltaPct||0)) * dir;
    if (k === 'date')    return ((a.last.date?+a.last.date:0) - (b.last.date?+b.last.date:0)) * dir;
    return 0;
  });

  // Render rows
  const body = document.getElementById('inv-latest-body');
  const counter = document.getElementById('inv-count');
  if (counter) counter.textContent = `(${filtered.length} of ${recs.length})`;
  let rows = '';
  for (const r of filtered) {
    const last = r.last;
    let flag = '';
    if (r.flagKey === 'low')  flag = `<span class="badge badge-red">Low</span>`;
    else if (r.flagKey === 'high') flag = `<span class="badge badge-red">High</span>`;
    else if (r.flagKey === 'normal') flag = `<span class="badge badge-green">Normal</span>`;
    const ref = (r.refLow != null && r.refHigh != null) ? `${r.refLow} – ${r.refHigh}` : '—';
    const spark = renderSparkline(r.pts, r.refLow, r.refHigh);
    const delta = deltaArrow(r.prev, last, r.analyte);
    rows += `<tr style="cursor:pointer" data-analyte="${esc(r.analyte)}">
      <td>${esc(r.analyte)}</td>
      <td>${last.value} ${esc(last.unit||'')}</td>
      <td>${ref}</td>
      <td>${flag}</td>
      <td>${delta}</td>
      <td>${spark}</td>
      <td>${last.date ? last.date.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : '—'}</td>
    </tr>`;
  }
  if (!rows) rows = '<tr><td colspan="7" style="text-align:center;color:#768692;padding:20px">No analytes match the filter.</td></tr>';
  body.innerHTML = rows;

  // Click a row to open that analyte in the trend chart above.
  body.querySelectorAll('tr[data-analyte]').forEach(tr => {
    tr.addEventListener('click', () => {
      const an = tr.dataset.analyte;
      const sel = document.getElementById('analyte-select');
      if (sel) { sel.value = an; renderAnalyteTrend(analytes, an); }
      // Scroll the chart into view
      document.getElementById('inv-chart-wrap')?.scrollIntoView({ behavior:'smooth', block:'nearest' });
    });
  });

  // Sort glyphs
  document.querySelectorAll('.sortable-th').forEach(th => {
    const sk = th.dataset.sk;
    const g = th.querySelector('.sort-glyph');
    if (!g) return;
    g.textContent = (_s.invUI.sortKey === sk) ? (_s.invUI.sortDir === 'asc' ? '▲' : '▼') : '';
  });
}

function renderAnalyteTrend(analytes, name) {
  if (_s.invChart) { _s.invChart.destroy(); _s.invChart = null; }
  const canvas = document.getElementById('inv-chart');
  if (!canvas || !name || !analytes[name]) return;
  const pts = analytes[name];
  const labels = pts.map(p => p.date ? p.date.toLocaleDateString('en-GB',{month:'short',year:'numeric'}) : '?');
  const vals   = pts.map(p => p.value);
  const low    = pts[0]?.low  != null ? parseFloat(pts[0].low)  : null;
  const high   = pts[0]?.high != null ? parseFloat(pts[0].high) : null;

  const zones = zonesFor(name);

  // Custom plugin: draws clinical zone bands (or a single reference band) as
  // filled rects behind the line, before the datasets are drawn.
  const zoneBandsPlugin = {
    id: 'zoneBands',
    beforeDatasetsDraw(chart) {
      const { ctx, chartArea: { left, right }, scales: { y: ys } } = chart;
      ctx.save();
      if (zones && zones.length) {
        for (const z of zones) {
          const yTop = ys.getPixelForValue(z.to);
          const yBot = ys.getPixelForValue(z.from);
          ctx.fillStyle = z.colour;
          ctx.fillRect(left, yTop, right - left, yBot - yTop);
        }
      } else if (low != null && high != null && !isNaN(low) && !isNaN(high)) {
        const yTop = ys.getPixelForValue(high);
        const yBot = ys.getPixelForValue(low);
        ctx.fillStyle = 'rgba(0,127,59,0.08)';
        ctx.fillRect(left, yTop, right - left, yBot - yTop);
      }
      ctx.restore();
    }
  };

  // Y-axis must include the reference range (so abnormals visually escape it,
  // per the labs-research anti-pattern note).
  const vMin = Math.min(...vals, low ?? Infinity);
  const vMax = Math.max(...vals, high ?? -Infinity);
  const padding = (vMax - vMin) * 0.1 || 1;

  _s.invChart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: name, data: vals, borderColor:'#005eb8', backgroundColor:'rgba(0,94,184,.08)', borderWidth:2, pointRadius:4, tension:.2,
          pointBackgroundColor: pts.map(p => {
            if (p.low != null && p.value < parseFloat(p.low)) return '#d4351c';
            if (p.high != null && p.value > parseFloat(p.high)) return '#d4351c';
            return '#005eb8';
          })
        },
        ...((!zones && low  != null) ? [{ label:'Lower ref', data:pts.map(()=>low),  borderColor:'#d4351c', borderWidth:1, borderDash:[4,4], pointRadius:0, fill:false }] : []),
        ...((!zones && high != null) ? [{ label:'Upper ref', data:pts.map(()=>high), borderColor:'#d4351c', borderWidth:1, borderDash:[4,4], pointRadius:0, fill:false }] : []),
      ]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{
        legend:{ labels:{ font:{size:11}, boxWidth:12 } },
        tooltip:{ callbacks:{
          afterLabel: (ctx) => {
            if (!zones) return '';
            const v = ctx.parsed.y;
            const z = zones.find(z => v >= z.from && v < z.to);
            return z ? `Zone: ${z.label}` : '';
          }
        }}
      },
      scales:{
        x:{ ticks:{ font:{size:11} }, grid:{ display:false } },
        y:{ ticks:{ font:{size:11} }, beginAtZero:false,
            suggestedMin: vMin - padding, suggestedMax: vMax + padding }
      }
    },
    plugins: [zoneBandsPlugin]
  });
}

// ══ TAB: MEDICATIONS & MONITORING ═════════════════════════════════════════

function buildMedications(drugs, pincer) {
  const active = drugs.filter(d => d.active);
  const inactive = drugs.filter(d => !d.active);
  const overdue = active.filter(d => d.overdue);

  const fmt = d => d ? d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : '—';

  const tile = (n, l, c) => `<div class="stat-tile"><div class="stat-num" style="color:${c||'var(--nhs-blue)'}">${n}</div><div class="stat-lbl">${esc(l)}</div></div>`;

  let activeRows = '';
  if (active.length) {
    for (const d of active) {
      const reqStr = d.requires.length ? d.requires.slice(0,3).join(' · ') : 'No specific monitoring';
      const monStr = d.requires.length === 0 ? '<span style="color:#b1b4b6">N/A</span>' :
        d.lastMonitoring ? fmt(d.lastMonitoring) + ` <span class="drug-meta">(${d.daysSinceMonitoring}d ago)</span>` :
        '<span style="color:var(--nhs-red);font-weight:600">No record</span>';
      const badge = d.requires.length === 0 ? `<span class="badge badge-grey">No monitor</span>` :
        d.overdue ? `<span class="badge badge-red">Overdue</span>` :
        `<span class="badge badge-green">On time</span>`;
      activeRows += `<div class="drug-row ${d.overdue?'overdue':''}">
        <div><div class="drug-name">${esc(d.label)}</div><div class="drug-meta">Last seen ${fmt(d.lastSeen)} · ${d.occurrences} mention${d.occurrences===1?'':'s'}</div></div>
        <div><div class="drug-meta">Requires</div>${esc(reqStr)}</div>
        <div><div class="drug-meta">Recommended interval</div>${d.interval ? Math.round(d.interval/30) + ' months' : '—'}</div>
        <div><div class="drug-meta">Last monitoring</div>${monStr}</div>
        <div style="text-align:right">${badge}</div>
      </div>`;
    }
  } else {
    activeRows = `<div style="padding:20px;text-align:center;color:#768692;font-size:13px">No active high-risk drugs detected in the visible record.</div>`;
  }

  let inactiveRows = '';
  for (const d of inactive) {
    inactiveRows += `<div class="drug-row" style="opacity:.7">
      <div><div class="drug-name">${esc(d.label)}</div><div class="drug-meta">Last seen ${fmt(d.lastSeen)}</div></div>
      <div><div class="drug-meta">Requires</div>${esc(d.requires.slice(0,3).join(' · ')||'No specific monitoring')}</div>
      <div><div class="drug-meta">Recommended interval</div>${d.interval ? Math.round(d.interval/30) + ' months' : '—'}</div>
      <div><div class="drug-meta">Last monitoring</div>${fmt(d.lastMonitoring)}</div>
      <div style="text-align:right"><span class="badge badge-grey">Inactive</span></div>
    </div>`;
  }

  let pincerHtml = '';
  if (pincer && pincer.length) {
    const items = pincer.map(f => `
      <div class="pincer-item ${esc(f.severity)}">
        <span style="color:${f.severity==='high'?'#d4351c':f.severity==='med'?'#f47738':'#768692'};font-weight:700">⚠</span>
        <div style="flex:1">
          <div class="pincer-rule">${esc(f.rule)}</div>
          <div class="pincer-detail">${esc(f.detail)}</div>
        </div>
      </div>`).join('');
    pincerHtml = `<div class="card pincer-card">
      <div class="card-title" style="color:var(--nhs-red)">⚠ Prescribing &amp; monitoring flags (${pincer.length})</div>
      <div class="pincer-list">${items}</div>
    </div>`;
  }

  const html = `
  <div class="grid-4" style="margin-bottom:14px">
    ${tile(drugs.length, 'Total drug families seen')}
    ${tile(active.length, 'Active (last 18m)')}
    ${tile(overdue.length, 'Monitoring overdue', overdue.length ? '#d4351c' : '#007f3b')}
    ${tile((pincer||[]).length, 'PINCER flags', (pincer||[]).length ? '#d4351c' : '#007f3b')}
  </div>

  ${pincerHtml}

  <div class="card">
    <div class="card-title">Active high-risk drugs <span style="font-weight:400;color:#768692">(${active.length})</span></div>
    <div class="drug-head">
      <div>Drug</div>
      <div>Requires</div>
      <div>Interval</div>
      <div>Last monitoring</div>
      <div style="text-align:right">Status</div>
    </div>
    ${activeRows}
  </div>

  ${inactive.length ? `<div class="card">
    <div class="card-title">Previously seen / inactive <span style="font-weight:400;color:#768692">(${inactive.length})</span></div>
    <div class="drug-head">
      <div>Drug</div>
      <div>Requires</div>
      <div>Interval</div>
      <div>Last monitoring</div>
      <div style="text-align:right">Status</div>
    </div>
    ${inactiveRows}
  </div>` : ''}

  <div class="card" style="background:#fff9e6;border-color:#ffe082">
    <div class="card-title">About this view</div>
    <div style="font-size:12px;color:var(--text2);line-height:1.5">
      Drugs are detected by scanning entry text for the drug name. The visualiser cannot tell whether a prescription is current, stopped, or one-off — "active" means the drug has been mentioned in the last 18 months. PINCER-style flags compare detected drugs against problem-list conditions and monitoring intervals from BNF / NICE. Use this as a screen, not a definitive medication review.
    </div>
  </div>`;

  document.getElementById('tab-medications').innerHTML = html;
}

// ══ TAB: REGISTERS & RECALLS ═══════════════════════════════════════════════

// Condition summary cards — latest tracked value, mini-trend, target, and
// review-due badge for each analyte-bearing register. "no recent value" when
// there is no dated point; never invents a value.
function renderConditionCards(summaries) {
  if (!summaries || !summaries.length) return '';
  const fmtD = d => d ? d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : '';
  const cards = summaries.map(s => {
    const reg = s.reg || {};
    const latest = s.latest;
    const valHtml = latest && !isNaN(Number(latest.value))
      ? `<div class="cond-value" style="font-variant-numeric:tabular-nums">${esc(String(latest.value))}${latest.unit ? ' <span style="font-size:12px;color:var(--text2)">'+esc(latest.unit)+'</span>' : ''}</div>
         <div style="font-size:11px;color:var(--text2);font-variant-numeric:tabular-nums">${esc(fmtD(latest.date))}</div>`
      : `<div class="cond-value" style="color:var(--text2);font-size:14px">no recent value</div>`;
    const spark = renderSparkline(s.points || [], null, null);
    let targetChip = '';
    if (s.onTarget !== null && s.onTarget !== undefined) {
      targetChip = s.onTarget
        ? `<span class="badge badge-green">on target</span>`
        : `<span class="badge badge-amber">off target</span>`;
    }
    const rb = reviewBadge(reg);
    return `<div class="cond-card">
      <div class="reg-name">${esc(reg.label || '')}</div>
      ${valHtml}
      <div style="margin:6px 0">${spark}</div>
      <div class="cond-target">Target: ${esc((s.target && s.target.label) || '—')} ${targetChip}</div>
      <div class="reg-review" style="margin-top:6px">
        <span class="reg-review-date">Review</span>
        <span class="badge ${rb.cls}">${esc(rb.text)}</span>
      </div>
    </div>`;
  }).join('');
  return `<div class="card">
    <div class="card-title">Condition summaries</div>
    <div class="cond-grid grid-3">${cards}</div>
    <div style="font-size:10px;color:#768692;margin-top:8px">Latest tracked value from coded results — verify against the full record.</div>
  </div>`;
}

function buildRecalls(recalls, registers, conditionSummaries) {
  const condHtml = renderConditionCards(conditionSummaries || []);

  let regHtml = '';
  if (registers.length) {
    // Sort overdue registers first.
    const ordered = [...registers].sort((a,b) => {
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      return (b.monthsSinceReview ?? -1) - (a.monthsSinceReview ?? -1);
    });
    const regsGrid = ordered.map(r=>{
      const rb = reviewBadge(r);
      const reviewLine = `<span class="badge ${rb.cls}">${esc(rb.text)}</span>`;
      const dateStr = r.lastReview ? r.lastReview.date.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : '—';
      return `<div class="reg-card" data-register="${esc(r.conditions[0]?.name||'')}" style="cursor:pointer;${r.overdue?'border-color:var(--nhs-orange);background:#fff9e6':''}">
        <div class="reg-name">${esc(r.label)}</div>
        <div class="reg-conds">${r.conditions.map(c=>esc(c.name)).join(' · ')}</div>
        <div class="reg-review">
          <span class="reg-review-date">Last review: ${esc(dateStr)}</span>
          ${reviewLine}
        </div>
        <div style="font-size:10px;color:#768692;margin-top:4px">Recommended every ${r.reviewMonths}m · ${r.linkedCount} linked entries</div>
      </div>`;
    }).join('');
    const overdueCount = registers.filter(r => r.overdue).length;
    regHtml = `<div class="card">
      <div class="card-title">QOF register membership (${registers.length} registers${overdueCount?` · ${overdueCount} overdue review`:''})</div>
      <div class="grid-3">${regsGrid}</div>
      <div style="font-size:10px;color:#768692;margin-top:8px">Click a register to spotlight its entries across all tabs.</div>
    </div>`;
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
  ${condHtml}
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

  // Click a register to spotlight its condition across other tabs.
  document.querySelectorAll('#tab-recalls .reg-card[data-register]').forEach(el => {
    el.addEventListener('click', () => {
      const name = el.dataset.register;
      if (!name) return;
      _s.filter.problem = (_s.filter.problem === name) ? null : name;
      const sel = document.getElementById('fb-problem');
      if (sel) sel.value = _s.filter.problem || '';
      rebuildAll();
    });
  });
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
  // Swim-lane needs a re-render with real width once its tab is visible.
  if (name === 'timeline' && _s.entries.length) {
    renderSwimLane(filteredEntries());
  }
}

// Throttled resize handler for the swim-lane.
let _resizeTimer = null;
window.addEventListener('resize', () => {
  if (_resizeTimer) clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(() => {
    if (_s.activeTab === 'timeline' && _s.entries.length) {
      renderSwimLane(filteredEntries());
    }
  }, 150);
});

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
