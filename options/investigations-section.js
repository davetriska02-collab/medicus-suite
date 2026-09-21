// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Investigations (Lab Result Catalogue) — OPTIONS section
//
// PHASE C2 of docs/plans/LAB-RESULT-CATALOGUE-DATA-MODEL-2026-09-19.md.
//
// The practice's view of the unified catalogue of investigations / results / labs: set the practice context, import the
// existing Outstanding-Request tests as UNREVIEWED entries, browse everything (built-in and practice), and review /
// approve the practice's additions. All logic lives in the pure modules (shared/lab-catalogue-*.js) and the IO helper
// (shared/io/labcatalogue-io.js); this file only renders and wires buttons.
//
// IMPORTANT: nothing the suite does today reads this catalogue yet (Outstanding Requests and Lab Filing still use their
// own rules). Approving an entry here records the decision for when they do. The page says so, on the page.
//
// Renders with DOM builders and textContent only — every string here can come from an imported backup or a shared file.
// Loaded as <script type="module"> from options.html; self-mounts into #invMount (mirrors labfiling-section.js).

'use strict';

const LC = typeof window !== 'undefined' ? window.LabCatalogue : null;
const OV = typeof window !== 'undefined' ? window.LabCatalogueOverlay : null;
const IMP = typeof window !== 'undefined' ? window.LabCatalogueImport : null;
const SC = typeof window !== 'undefined' ? window.LabCatalogueScan : null;

const REVIEWER = 'this computer';

// ── Lab Filing setup (Phase E) — practice ranges + autofiling enable, per result x lab x SNOMED code ───────────────────
let filingLabId = null;
function currentFilingLab() {
  const labs = S.merged.labs.filter((l) => labVisible(l.id));
  if (labs.some((l) => l.id === filingLabId)) return filingLabId;
  const ctx = (S.overlay.context && S.overlay.context.labs) || [];
  const pick = labs.find((l) => ctx.includes(l.id)) || labs[0];
  return pick ? pick.id : null;
}
const filingEntry = (resultId, labId, code) =>
  ((S.overlay.filing && S.overlay.filing.ranges) || []).find(
    (r) => r.result === resultId && r.lab === labId && r.code === code
  ) || null;
// how many of a test's results have autofiling switched on (any lab): { on, approved }
function filingStatus(inv) {
  const ids = new Set((inv.members || []).map((m) => m.result));
  let on = 0;
  let approved = 0;
  for (const r of (S.overlay.filing && S.overlay.filing.ranges) || []) {
    if (!ids.has(r.result) || !r.enabled) continue;
    on++;
    if (r.provenance && r.provenance.reviewed === true) approved++;
  }
  return { on, approved };
}
const LOCAL_KEYS = ['triagelens.config', 'config'];

let root = null;
const S = {
  loaded: false,
  error: null,
  overlay: null,
  builtin: null,
  merged: null,
  problems: [],
  filter: 'all', // all | builtin | practice | review
  kindFilter: '', // '' = every sample
  query: '',
  open: new Set(),
  editing: null, // investigation id, '__new', or null
  editState: null,
  toast: '',
  codeInfo: null, // { qofClusters, codes } — descriptions and QOF status of shipped SNOMED codes
  editingContext: false,
};

// ── tiny DOM helper ──────────────────────────────────────────────────────────────────────────────────
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  }
  return el;
}
const btn = (label, onclick, cls, title) =>
  h('button', { type: 'button', class: 'lf-btn' + (cls ? ' ' + cls : ''), onclick, title }, label);
const badge = (text, cls) => h('span', { class: 'lf-badge' + (cls ? ' ' + cls : '') }, text);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;

function flash(msg) {
  S.toast = msg;
  render();
  setTimeout(() => {
    if (S.toast === msg) {
      S.toast = '';
      render();
    }
  }, 4000);
}

// ── data ─────────────────────────────────────────────────────────────────────────────────────────────
async function load() {
  try {
    const eff = await labcatalogueLoadEffective({ includeUnreviewed: true });
    S.overlay = eff.overlay;
    S.builtin = eff.builtin;
    S.merged = eff.catalogue;
    S.problems = eff.problems || [];
    S.codeInfo = await labcatalogueLoadCodeInfo();
    S.error = null;
  } catch (e) {
    S.error = (e && e.message) || String(e);
  }
  S.loaded = true;
  render();
}

async function save(nextOverlay, message) {
  try {
    await labcatalogueSaveOverlay(nextOverlay);
    await load();
    if (message) flash(message);
  } catch (e) {
    S.error = 'Could not save: ' + ((e && e.message) || e);
    render();
  }
}

async function readOirTests() {
  const r = await chrome.storage.local.get(LOCAL_KEYS);
  const cfg = r['triagelens.config'] || r.config || {};
  return Array.isArray(cfg.oirTests) ? cfg.oirTests : [];
}

// ── derived view ─────────────────────────────────────────────────────────────────────────────────────
function describe(inv) {
  const inBuiltin = S.builtin.investigations.some((i) => i.id === inv.id);
  const ov = S.overlay.investigations.find((i) => i.id === inv.id) || null;
  const disabled = S.overlay.disabled.investigations.includes(inv.id);
  let status;
  let needsReview = false;
  if (inBuiltin && !ov) status = { text: 'Built-in', cls: '' };
  else if (inBuiltin) {
    needsReview = ov.provenance.reviewed !== true;
    const what = ov.override ? 'Built-in (edited)' : 'Built-in + additions';
    status = needsReview
      ? { text: what + ' — awaiting review', cls: 'lf-badge-warn' }
      : { text: what, cls: 'lf-badge-ok' };
  } else {
    needsReview = !ov || ov.provenance.reviewed !== true;
    const what = ov && ov.provenance.source === 'imported' && needsReview ? 'Imported' : 'Practice';
    status = needsReview
      ? { text: what + ' — awaiting review', cls: 'lf-badge-warn' }
      : { text: what, cls: 'lf-badge-ok' };
  }
  return { inv, inBuiltin, ov, disabled, status, needsReview };
}

function renderBanner() {
  return h(
    'div',
    { class: 'lf-notice' },
    h('div', { class: 'lf-notice-title', text: 'Not yet used by the suite' }),
    h('p', {
      text:
        'Outstanding Requests and Lab Filing still use their own rules. This catalogue is being built alongside them: ' +
        'importing, reviewing and approving entries here records your decisions for when those features start reading it. ' +
        'Nothing you do on this page changes how requests are ticked off or how results are filed today.',
    }),
    h('p', {
      text: 'Entries that arrive by import, backup or the shared practice profile are inactive until someone approves them on this computer.',
    })
  );
}

// ── search / filter ────────────────────────────────────────────────────────────────────────────────
// Searches the test's own names AND everything under it: result names, every wording (including a lab's own) and
// SNOMED codes. `via` says which result matched when the test's own names did not, so the card can show why it is there.
function resultsOf(inv) {
  const byId = new Map(S.merged.results.map((r) => [r.id, r]));
  return inv.members.map((m) => ({ m, r: byId.get(m.result) || null }));
}

function searchMatch(d, q) {
  if (!q) return { hit: true, via: null };
  const own = LC.norm(
    [d.inv.label, ...d.inv.requestAliases.map((a) => a.text), ...(d.inv.headingAliases || [])].join(' ')
  );
  if (own.includes(q)) return { hit: true, via: null };
  for (const lab of S.merged.labs)
    for (const g of lab.groupHeadings || [])
      if ((g.identifies || []).includes(d.inv.id) && LC.norm(g.text).includes(q)) return { hit: true, via: null };
  for (const { m, r } of resultsOf(d.inv)) {
    if (!r) continue;
    const hay = LC.norm(
      [
        r.label,
        ...r.aliases.map((a) => a.text),
        ...r.codes.map((c) => c.conceptId),
        ...r.codes.flatMap((c) => c.refsets || []),
      ].join(' ')
    );
    if (hay.includes(q)) return { hit: true, via: r.label, role: m.role };
  }
  return { hit: false, via: null };
}

function visibleInvestigations() {
  const q = LC.norm(S.query);
  const out = [];
  for (const d of S.merged.investigations.map(describe)) {
    if (S.filter === 'builtin' && !d.inBuiltin) continue;
    if (S.filter === 'practice' && d.inBuiltin && !d.ov) continue;
    if (S.filter === 'review' && !d.needsReview) continue;
    if (S.filter === 'autofiling' && !filingStatus(d.inv).on) continue;
    if (S.filter === 'noautofiling' && filingStatus(d.inv).on) continue;
    if (S.kindFilter && d.inv.kind !== S.kindFilter) continue;
    const m = searchMatch(d, q);
    if (!m.hit) continue;
    out.push({ ...d, via: m.via });
  }
  return out.sort((a, b) => a.inv.label.localeCompare(b.inv.label));
}

// ── "Your practice": free text OR pulldown, the same control for every field ───────────────────────────────
const KNOWN_ICBS = [{ value: 'NHS South West London', label: 'NHS South West London', code: '36L' }];
const KNOWN_BOROUGHS = ['Croydon', 'Kingston', 'Merton', 'Richmond', 'Sutton', 'Wandsworth'].map((b) => ({
  value: b,
  label: b,
}));
const KNOWN_SYSTEMS = [
  { value: 'tquest', label: 'tQuest' },
  { value: 'ice', label: 'ICE' },
];
const OTHER = '__other';

// A pulldown of known values with "Other…" that reveals a text box. get() returns the chosen / typed value.
function choiceField(opts) {
  const known = opts.options;
  const isKnown = (v) => known.some((o) => o.value === v);
  const sel = h(
    'select',
    { class: 'lf-input inv-sel', 'aria-label': opts.label },
    h('option', { value: '' }, opts.placeholder || 'Choose…'),
    known.map((o) => h('option', { value: o.value, selected: opts.value === o.value }, o.label)),
    h('option', { value: OTHER, selected: !!opts.value && !isKnown(opts.value) }, 'Other (type it in)…')
  );
  const txt = h('input', {
    class: 'lf-input inv-txt',
    type: 'text',
    maxlength: opts.maxlength || 100,
    placeholder: opts.otherPlaceholder || 'Type it in',
    value: opts.value && !isKnown(opts.value) ? opts.value : '',
    'aria-label': opts.label + ' (typed)',
  });
  const sync = () => {
    txt.style.display = sel.value === OTHER ? '' : 'none';
    if (sel.value === OTHER && opts.onOther) opts.onOther();
  };
  sel.addEventListener('change', () => {
    sync();
    if (opts.onChange) opts.onChange(sel.value);
  });
  sync();
  const el = h('span', { class: 'inv-choice' }, sel, txt);
  return { el, sel, txt, get: () => (sel.value === OTHER ? txt.value.trim() : sel.value) };
}

// Chips + an add control (pulldown of known values or "Other…"). values are the stored strings.
function chipField(opts) {
  let values = [...opts.values];
  const chips = h('span', { class: 'inv-chips' });
  const drawChips = () => {
    chips.textContent = '';
    values.forEach((v) =>
      chips.appendChild(
        h(
          'span',
          { class: 'inv-chip' },
          opts.labelFor(v),
          h('button', {
            type: 'button',
            class: 'inv-chip-x',
            'aria-label': 'Remove ' + opts.labelFor(v),
            title: 'Remove',
            onclick: () => {
              values = values.filter((x) => x !== v);
              drawChips();
            },
            text: '×',
          })
        )
      )
    );
  };
  const extra = opts.extraInputs ? opts.extraInputs() : null; // additional inputs shown only for "Other" (labs)
  const choice = choiceField({
    options: opts.options,
    label: opts.label,
    placeholder: opts.addPlaceholder || 'Add…',
    otherPlaceholder: opts.otherPlaceholder,
    maxlength: opts.maxlength,
    onOther: () => extra && (extra.style.display = ''),
    onChange: (v) => {
      if (extra) extra.style.display = v === OTHER ? '' : 'none';
      if (v && v !== OTHER) add();
    },
  });
  if (extra) {
    extra.style.display = 'none';
    choice.txt.classList.add('inv-hide'); // the typed boxes in "extra" replace the single text box
  }
  const add = async () => {
    let v;
    if (choice.sel.value === OTHER && opts.makeOther) {
      v = opts.makeOther();
    } else {
      v = choice.get();
    }
    if (!v) return;
    if (!values.includes(v)) values.push(v);
    choice.sel.value = '';
    choice.txt.value = '';
    choice.txt.style.display = 'none';
    if (extra) {
      extra.style.display = 'none';
      extra.querySelectorAll('input').forEach((i) => (i.value = ''));
    }
    drawChips();
  };
  drawChips();
  const addBtn = btn('Add', add, 'lf-btn-sm');
  const el = h('div', { class: 'inv-multi' }, chips, h('span', { class: 'inv-addrow' }, choice.el, extra, addBtn));
  return { el, get: () => values };
}

function contextIsEmpty(c) {
  return !c.icb && !c.borough && !c.labs.length && !c.orderingSystems.length;
}

// Some lab names already carry their code ("General Pathology (RJ700)"): don't print it twice.
function labLabel(l) {
  const org = l.identifiers.performerOrg;
  return l.name.includes(org) ? l.name : `${l.name} (${org})`;
}

function labName(id) {
  const l = S.merged.labs.find((x) => x.id === id);
  return l ? labLabel(l) : id;
}
const systemName = (v) => (KNOWN_SYSTEMS.find((s) => s.value === v) || { label: v }).label;

function renderContext() {
  const c = S.overlay.context;
  const card = h('div', { class: 'lf-card inv-card inv-practice' });
  if (!S.editingContext && !contextIsEmpty(c)) {
    const where =
      [c.icb + (c.icbCode ? ` (${c.icbCode})` : ''), c.borough].filter(Boolean).join(' · ') || 'Area not set';
    const labs = c.labs.length ? c.labs.map(labName).join(', ') : 'none set';
    const sys = c.orderingSystems.length ? c.orderingSystems.map(systemName).join(', ') : 'not set';
    card.appendChild(
      h(
        'div',
        { class: 'inv-practice-view' },
        h(
          'div',
          { class: 'inv-practice-lines' },
          h('div', {}, h('strong', { text: 'Your practice: ' }), where),
          h('div', { class: 'lf-v' }, `Labs: ${labs} · Ordering: ${sys}`)
        ),
        btn('Edit practice details', () => {
          S.editingContext = true;
          render();
        })
      )
    );
    return card;
  }

  const icbField = choiceField({
    options: KNOWN_ICBS,
    value: c.icb,
    label: 'ICB',
    placeholder: 'ICB…',
    otherPlaceholder: 'ICB name',
  });
  const boroughField = choiceField({
    options: KNOWN_BOROUGHS,
    value: c.borough,
    label: 'Borough',
    placeholder: 'Borough…',
    otherPlaceholder: 'Borough name',
  });
  const newLabs = new Map(); // id -> { name, org } for labs typed in this session
  const labName2 = h('input', {
    class: 'lf-input inv-txt',
    type: 'text',
    maxlength: 100,
    placeholder: 'Lab name',
    'aria-label': 'Lab name',
  });
  const labOrg = h('input', {
    class: 'lf-input inv-txt inv-org',
    type: 'text',
    maxlength: 80,
    placeholder: 'Lab code, e.g. RJ700',
    'aria-label': 'Performing organisation code',
  });
  const labsField = chipField({
    options: S.merged.labs.map((l) => ({ value: l.id, label: labLabel(l) })),
    values: c.labs,
    label: 'Labs',
    addPlaceholder: 'Add a lab…',
    labelFor: (id) => (newLabs.has(id) ? `${newLabs.get(id).name} (${newLabs.get(id).org})` : labName(id)),
    // "Other" for a lab needs its name and the organisation code its reports carry, so both boxes appear together.
    extraInputs: () => h('span', { class: 'inv-choice' }, labName2, labOrg),
    makeOther: () => {
      const name = labName2.value.trim();
      const org = labOrg.value.trim();
      if (!name || !org) {
        alert('Type both the lab name and its code (the "performer" shown on its reports).');
        return null;
      }
      let id = (
        name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '') || 'lab'
      ).slice(0, 48);
      const taken = new Set([...S.merged.labs.map((l) => l.id), ...newLabs.keys()]);
      let n = 2;
      const base = id;
      while (taken.has(id)) id = `${base}-${n++}`;
      newLabs.set(id, { name, org });
      return id;
    },
  });
  const sysField = chipField({
    options: KNOWN_SYSTEMS,
    values: c.orderingSystems,
    label: 'Ordering system',
    addPlaceholder: 'Add a system…',
    otherPlaceholder: 'System name',
    maxlength: 16,
    labelFor: systemName,
  });

  const cell = (label, control) =>
    h('div', { class: 'inv-cell' }, h('span', { class: 'inv-cell-label', text: label }), control);
  card.appendChild(
    h(
      'div',
      { class: 'inv-practice-form' },
      cell('ICB', icbField.el),
      cell('Borough', boroughField.el),
      cell('Labs you receive results from', labsField.el),
      cell('Ordering system', sysField.el)
    )
  );
  card.appendChild(
    h(
      'div',
      { class: 'inv-practice-actions' },
      h('span', { class: 'lf-help', text: 'The borough only suggests labs; it never turns anything on.' }),
      !contextIsEmpty(c)
        ? btn('Cancel', () => {
            S.editingContext = false;
            render();
          })
        : null,
      btn(
        'Save practice details',
        async () => {
          const icb = icbField.get();
          const known = KNOWN_ICBS.find((i) => i.value === icb);
          let next = S.overlay;
          for (const [id, l] of newLabs) {
            if (!labsField.get().includes(id)) continue;
            next = {
              ...next,
              labs: [
                ...next.labs,
                {
                  id,
                  name: l.name,
                  identifiers: { performerOrg: l.org },
                  groupHeadings: [],
                  provenance: { source: 'practice', reviewed: false, createdAt: new Date().toISOString().slice(0, 10) },
                },
              ],
            };
          }
          next = OV.setContext(next, {
            icb,
            icbCode: known ? known.code : icb === c.icb ? c.icbCode : '',
            borough: boroughField.get(),
            labs: labsField.get(),
            orderingSystems: sysField.get(),
          });
          S.editingContext = false;
          await save(next, 'Practice details saved.');
        },
        'lf-btn-primary'
      )
    )
  );
  return card;
}

// ── one investigation = one compact card ───────────────────────────────────────────────────────────────────
// Headings the labs use for this investigation (lab-neutral aliases + each lab's own group headings that identify it).
function headingChips(inv) {
  const out = [];
  for (const t of inv.headingAliases || []) out.push({ text: t, lab: '' });
  for (const lab of S.merged.labs)
    if (labVisible(lab.id))
      for (const g of lab.groupHeadings || [])
        if ((g.identifies || []).includes(inv.id))
          out.push({ text: g.text, lab: lab.identifiers.performerOrg || lab.name });
  return out;
}

// A code with its SNOMED text and whether it counts towards QOF (the code's own clusters, or the clusters the NHS PCD lists put
// its concept in — QOF status is derived from cluster membership, never typed in).
function codeInfoFor(c) {
  const info = S.codeInfo || { qofClusters: [], codes: {} };
  if (!info._qof) info._qof = new Set(info.qofClusters);
  const known = info.codes[c.conceptId];
  const clusters = [...new Set([...(c.refsets || []), ...(known ? known.c : [])])];
  const qof = clusters.filter((x) => info._qof.has(x));
  return { desc: c.description || (known && known.d) || '', qof: qof.length > 0, qofClusters: qof, clusters };
}
function codeLine(c) {
  const i = codeInfoFor(c);
  return h(
    'div',
    {
      class: 'inv-codeline' + (i.qof ? ' inv-code-qof' : ''),
      title: [
        c.conceptId,
        i.desc,
        c.unit ? 'unit: ' + c.unit : '',
        i.clusters.length ? 'clusters: ' + i.clusters.join(', ') : '',
        i.qof ? 'Counts towards QOF (' + i.qofClusters.join(', ') + ')' : '',
      ]
        .filter(Boolean)
        .join(String.fromCharCode(10)),
    },
    h('span', { class: 'inv-code-id', text: c.conceptId }),
    h('span', { class: 'inv-code-desc' + (i.desc ? '' : ' lf-muted'), text: i.desc || 'no description recorded' }),
    c.unit ? h('span', { class: 'inv-code-unit', text: c.unit }) : null,
    i.qof ? h('span', { class: 'inv-qof-tag', text: 'QOF' }) : null
  );
}
const QOF_LEGEND = 'Pale green = counts towards QOF (from the NHS PCD cluster lists).';

function resultRow(inv, { m, r }) {
  const codes = r ? r.codes : [];
  const labWords = r ? r.aliases.filter((a) => a.lab) : [];
  const otherWords = r ? r.aliases.filter((a) => !a.lab) : [];
  const tip = [
    r ? r.label : m.result,
    codes.length
      ? 'Codes: ' + codes.map((c) => c.conceptId + (c.unit ? ` (${c.unit})` : '')).join(', ')
      : 'No code yet (matched by name)',
    labWords.length ? 'Lab wording: ' + labWords.map((a) => a.text).join(' · ') : '',
    'Click to expand',
  ]
    .filter(Boolean)
    .join('\n');
  const full = h(
    'div',
    { class: 'inv-res-full' },
    labWords.length
      ? h(
          'div',
          {},
          h('span', { class: 'lf-k', text: 'Lab wording' }),
          labWords.map((a) => h('div', {}, `${labShort(a.lab)}: ${a.text}`))
        )
      : null,
    otherWords.length
      ? h('div', {}, h('span', { class: 'lf-k', text: 'Also called' }), otherWords.map((a) => a.text).join(' · '))
      : null,
    r
      ? btn(
          'Edit result',
          () => {
            const ed = renderResultEditor(r, (saved) => {
              if (!saved) ed.replaceWith(full);
            });
            full.replaceWith(ed);
          },
          'lf-btn-sm inv-edit-result'
        )
      : null
  );
  const row = h(
    'div',
    { class: 'inv-res', tabindex: '0', role: 'button', title: tip, 'aria-expanded': 'false' },
    h(
      'div',
      { class: 'inv-res-head' },
      h('span', { class: 'inv-res-name', text: r ? r.label : m.result }),
      h('span', { class: 'inv-tag', text: m.role + (m.anchor ? ' · any one' : '') }),
      labWords.length
        ? h('span', {
            class: 'inv-lab',
            text: `“${labWords[0].text}”${labWords.length > 1 ? ` +${labWords.length - 1}` : ''}`,
          })
        : null
    ),
    codes.length
      ? h('div', { class: 'inv-codelist' }, codes.map(codeLine))
      : h('div', { class: 'inv-tag inv-tag-warn inv-nocode', text: 'no code yet — matched by name only' }),
    full
  );
  const toggle = () => {
    const on = row.classList.toggle('open');
    row.setAttribute('aria-expanded', on ? 'true' : 'false');
  };
  row.addEventListener('click', (e) => {
    if (e.target.closest('.inv-res-full')) return;
    toggle();
  });
  row.addEventListener('keydown', (e) => {
    if (e.target === row && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      toggle();
    }
  });
  return row;
}

function labShort(labId) {
  const l = S.merged.labs.find((x) => x.id === labId);
  return l ? l.identifiers.performerOrg || l.name : labId;
}

// ── Editing (C3) ───────────────────────────────────────────────────────────────────────────────────────────
// Built-in tests can only be ADDED to (their own wording is shown locked). A practice test can be changed freely. Every
// save sends the entry back to "awaiting review" — an edit never keeps an old approval.
const SYSTEM_OPTIONS = [
  ['any', 'any system'],
  ['tquest', 'tQuest'],
  ['ice', 'ICE'],
];
// "Sample": what the test is done on. (Used for validation only — specimen tests need at least one result.)
const KIND_OPTIONS = [
  ['blood', 'Blood'],
  ['urine', 'Urine'],
  ['faeces', 'Faeces'],
  ['microbiology', 'Swab / culture'],
  ['imaging', 'Imaging'],
  ['procedure', 'Procedure'],
  ['other', 'Other'],
];
const kindLabel = (k) => (KIND_OPTIONS.find((o) => o[0] === k) || [k, k])[1];
const VALUE_OPTIONS = [
  ['mixed', 'Number or text'],
  ['numeric', 'Number'],
  ['text', 'Text'],
];
// What each result does for the test. core = the results the matcher looks for; shared = also belongs to another test (used to
// tell them apart, never needed); optional = may be there, never needed.
const ROLE_OPTIONS = [
  ['core', 'Core to the lab group'],
  ['shared', 'Shared with another test'],
  ['optional', 'May be present'],
];
const ENOUGH_ALONE =
  'Tick if this result on its own is enough to recognise the test. If nothing is ticked, the test needs at least two of its "Core to the lab group" results to be present (or its only one, if it has just one).';

// Headings for labs the practice does not use are kept (and saved back untouched) but not shown.
function labVisible(labId) {
  const c = S.overlay.context.labs;
  return !c.length || c.includes(labId);
}

const resultById = (id) => S.merged.results.find((r) => r.id === id) || null;

// Everything is editable, built-in or not: the form starts from the effective definition and a save stores the COMPLETE
// result as a practice version (an "override" for a built-in). It stays inactive until approved, and the shipped version
// keeps applying until then.
function editStateFor(inv, review) {
  if (!inv) {
    return {
      id: null,
      isBuiltin: false,
      label: '',
      kind: 'blood',
      reqs: [],
      heads: [],
      hidden: [],
      excl: [],
      members: [],
      note: '',
      newResults: [],
      error: '',
      review: false,
      changes: [],
    };
  }
  const st = {
    id: inv.id,
    isBuiltin: S.builtin.investigations.some((i) => i.id === inv.id),
    label: inv.label,
    kind: inv.kind,
    reqs: inv.requestAliases.map((a) => ({ text: a.text, system: a.system })),
    heads: (inv.headingAliases || []).map((t) => ({ text: t, lab: '' })),
    hidden: [],
    excl: (inv.exclude || []).map((t) => ({ text: t })),
    members: inv.members.map((m) => ({ result: m.result, role: m.role, anchor: !!m.anchor })),
    note: inv.note || '',
    newResults: [],
    error: '',
    review: !!review,
    changes: [],
  };
  for (const lab of S.merged.labs)
    for (const g of lab.groupHeadings || [])
      if ((g.identifies || []).includes(inv.id))
        (labVisible(lab.id) ? st.heads : st.hidden).push({ text: g.text, lab: lab.id });
  st.changes = st.isBuiltin ? OV.describeChanges(S.builtin, S.overlay, inv.id) : [];
  return st;
}

function chipsEl(items, onRemove, fmt) {
  const box = h('span', { class: 'inv-chips' });
  items.forEach((it, i) => {
    box.appendChild(
      h(
        'span',
        { class: 'inv-chip' },
        fmt(it),
        h('button', {
          type: 'button',
          class: 'inv-chip-x',
          title: 'Remove',
          'aria-label': 'Remove ' + fmt(it),
          onclick: () => onRemove(i),
          text: '×',
        })
      )
    );
  });
  return box;
}

function panel(cls, title, ...kids) {
  return h(
    'section',
    { class: 'inv-panel inv-panel-' + cls },
    h('h4', { class: 'inv-panel-title', text: title }),
    ...kids
  );
}
// requested (left) -> reported by the lab (right) -> down to the results (bottom right); "never" bottom left
function flowGrid(req, lab, never, res) {
  return h('div', { class: 'inv-flow' }, req, lab, never, res);
}

function editorRow(label, help, ...kids) {
  return h(
    'div',
    { class: 'inv-sec' },
    h('span', { class: 'lf-k', text: label }),
    h('div', { class: 'inv-edit-col' }, help ? h('span', { class: 'lf-help inv-help', text: help }) : null, ...kids)
  );
}

// "1000661000000107 · 1000651000000109": codes as text on the result's line (tooltip has units)
function codesText(r) {
  return r && r.codes.length ? r.codes.map((c) => c.conceptId).join(' · ') : 'no code';
}
function wordingText(r) {
  const w = r ? r.aliases.filter((a) => a.lab) : [];
  return w.length ? w.map((a) => `“${a.text}”`).join(' ') : '';
}

// "This is really part of another test": move it (its results, request wordings and headings) onto that test's card.
function mergeBlock(st, done) {
  const box = h('div', { class: 'inv-merge' });
  const row = h('div', { class: 'inv-edit-line', style: 'display:none' });
  const listId = 'invMergeList' + Math.random().toString(36).slice(2, 7);
  const others = S.merged.investigations.filter((i) => i.id !== st.id).sort((a, b) => a.label.localeCompare(b.label));
  const search = h('input', {
    class: 'lf-input inv-in',
    type: 'text',
    list: listId,
    placeholder: 'Search for the test it belongs to, e.g. Stool MC&S',
    'aria-label': 'Test to move this into',
  });
  const dl = h(
    'datalist',
    { id: listId },
    others.map((i) => h('option', { value: i.label }))
  );
  const err = h('span', { class: 'inv-error', role: 'alert' });
  const go = btn(
    'Move into that test',
    async () => {
      err.textContent = '';
      const q = LC.norm(search.value);
      const hits = others.filter((i) => LC.norm(i.label) === q);
      if (!q || hits.length !== 1) {
        err.textContent =
          hits.length > 1 ? 'More than one test has that name — rename one first.' : 'Pick a test from the list.';
        return;
      }
      const into = hits[0];
      const me = S.merged.investigations.find((i) => i.id === st.id);
      const n = me ? me.members.length : 0;
      if (
        !confirm(
          `Move "${st.label}" into "${into.label}"?

Its ${plural(n, 'result')}, request wordings and report headings move onto "${into.label}", then "${st.label}" is deleted. "${into.label}" goes back to awaiting review.`
        )
      )
        return;
      try {
        const r = OV.mergeInvestigation(S.builtin, S.overlay, st.id, into.id);
        await save(
          r.overlay,
          `Moved "${st.label}" into "${into.label}" (${plural(r.moved.results, 'result')}) — awaiting review.`
        );
        done(true);
      } catch (e) {
        err.textContent = ((e && e.message) || String(e)).replace(/^labcatalogue.practice: /, '');
      }
    },
    'lf-btn-sm'
  );
  row.append(search, dl, go, err);
  const link = h('button', {
    type: 'button',
    class: 'lf-link',
    text: 'clicking here',
    onclick: () => {
      row.style.display = row.style.display === 'none' ? '' : 'none';
    },
  });
  box.append(
    h(
      'span',
      { class: 'inv-merge-text' },
      'If this investigation is part of another test, you can move it to that card as one of the results for that test by ',
      link,
      '.'
    ),
    row
  );
  return box;
}

function renderEditor(st, done) {
  const redraw = () => {
    const fresh = renderEditor(st, done);
    wrap.replaceWith(fresh);
    wrap = fresh;
  };
  let wrap = h('div', { class: 'inv-body inv-editor' });
  const labOptions = S.merged.labs
    .filter((l) => labVisible(l.id))
    .map((l) => h('option', { value: l.id }, labLabel(l)));
  const input = (attrs) => h('input', { class: 'lf-input inv-in', type: 'text', maxlength: 200, ...attrs });
  const sel = (opts, value) =>
    h(
      'select',
      { class: 'lf-input inv-sel-sm' },
      opts.map(([v, l]) => h('option', { value: v, selected: v === value }, l))
    );
  const enter = (fn) => (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      fn();
    }
  };

  if (st.review) {
    wrap.appendChild(
      h(
        'div',
        { class: 'inv-review-note' },
        h('strong', { text: 'Review before approving. ' }),
        'Check the request wordings, report headings, and each result and its codes below. Change anything that is wrong, then approve.'
      )
    );
  }
  if (st.changes.length) {
    wrap.appendChild(
      h(
        'details',
        { class: 'inv-changes', open: st.review },
        h('summary', {}, `Differs from the shipped version (${st.changes.length})`),
        h(
          'ul',
          {},
          st.changes.map((c) => h('li', { text: c }))
        )
      )
    );
  }

  // name + sample
  const name = input({ value: st.label, placeholder: 'Test name', 'aria-label': 'Test name' });
  name.addEventListener('input', () => (st.label = name.value));
  const kind = sel(KIND_OPTIONS, st.kind);
  kind.setAttribute('aria-label', 'Sample');
  kind.addEventListener('change', () => (st.kind = kind.value));
  wrap.appendChild(
    editorRow(
      'Name and sample',
      null,
      h('div', { class: 'inv-edit-line' }, name, h('span', { class: 'inv-inline-label', text: 'Sample:' }), kind)
    )
  );

  // the four areas: how it is REQUESTED in Medicus -> how it COMES BACK from the lab -> the RESULTS looked for; and the
  // "never matches" guard.
  const pReq = panel('req', 'How it is requested in Medicus');
  const pLab = panel('lab', 'How it comes back from the lab');
  const pNever = panel('never', 'Never counts as this test…');
  const pRes = panel('res', 'SNOMED codes');
  wrap.appendChild(flowGrid(pReq, pLab, pNever, pRes));

  // requested as
  const reqText = input({ placeholder: 'e.g. Anti-Xa level', 'aria-label': 'Request wording' });
  const reqSys = sel(SYSTEM_OPTIONS, 'any');
  const addReq = () => {
    const t = reqText.value.trim();
    if (!t) return;
    st.reqs.push({ text: t, system: reqSys.value });
    redraw();
  };
  reqText.addEventListener('keydown', enter(addReq));
  pReq.appendChild(
    editorRow(
      'Requested as',
      'How it is requested in Medicus within the "investigation requests" list.',
      chipsEl(
        st.reqs,
        (i) => (st.reqs.splice(i, 1), redraw()),
        (x) => x.text + (x.system !== 'any' ? ` (${systemName(x.system)})` : '')
      ),
      h('div', { class: 'inv-edit-line' }, reqText, reqSys, btn('Add', addReq, 'lf-btn-sm'))
    )
  );

  // report headings (any lab, or one lab's own)
  const headText = input({ placeholder: 'Heading the lab uses on the report', 'aria-label': 'Report heading' });
  const headLab = h('select', { class: 'lf-input inv-sel-sm' }, h('option', { value: '' }, 'any lab'), labOptions);
  const addHead = () => {
    const t = headText.value.trim();
    if (!t) return;
    st.heads.push({ text: t, lab: headLab.value });
    redraw();
  };
  headText.addEventListener('keydown', enter(addHead));
  pLab.appendChild(
    editorRow(
      'Lab report heading',
      st.hidden.length
        ? `${plural(st.hidden.length, 'heading')} for labs you do not use ${st.hidden.length === 1 ? 'is' : 'are'} kept but not shown.`
        : null,
      chipsEl(
        st.heads,
        (i) => (st.heads.splice(i, 1), redraw()),
        (x) => (x.lab ? `${labShort(x.lab)} ` : '') + x.text
      ),
      h('div', { class: 'inv-edit-line' }, headText, headLab, btn('Add', addHead, 'lf-btn-sm'))
    )
  );

  // never matches
  const exclText = input({ placeholder: 'e.g. urine', 'aria-label': 'Never matches' });
  const addExcl = () => {
    const t = exclText.value.trim();
    if (!t) return;
    st.excl.push({ text: t });
    redraw();
  };
  exclText.addEventListener('keydown', enter(addExcl));
  pNever.appendChild(
    editorRow(
      '',
      "A word that means it is NOT this test, e.g. urine on a sputum culture. This is only used if a result can't be matched by SNOMED code.",
      chipsEl(
        st.excl,
        (i) => (st.excl.splice(i, 1), redraw()),
        (x) => x.text
      ),
      h('div', { class: 'inv-edit-line' }, exclText, btn('Add', addExcl, 'lf-btn-sm'))
    )
  );

  const newSpec = (m) => st.newResults.find((x) => 'new:' + x.label === m.result);
  // ONE full-width table of the results (a result is one thing, shared by every test that uses it). Each code is its own line
  // (code | unit); name, how it counts and "also called" span all of a result's code lines.
  // The autofiling columns (practice range, safety guards, filing controls, enable) join at the right, in their own colour.
  const rows = h('div', { class: 'inv-restable' });
  // Unit sits at the END of the matching columns, right beside the practice range it defines.
  const COLS = { name: 1, code: 2, role: 3, words: 4, unit: 5, range: 6, enable: 7, approval: 8 };
  const fLab = currentFilingLab();
  const fLabName = fLab ? labShort(fLab) : '';
  const cell = (cls, col, row, span, ...kids) => {
    const c = h('div', { class: 'inv-rt-c ' + cls }, ...kids);
    c.style.gridColumn = String(col);
    c.style.gridRow = span > 1 ? row + ' / span ' + span : String(row);
    return c;
  };
  if (st.members.length) {
    [
      ['Name', 'name'],
      ['Code', 'code'],
      ['How it counts', 'role'],
      ['Also called', 'words'],
      ['Unit', 'unit'],
      ['Practice normal range (min – max)', 'range'],
      ['Enable autofiling', 'enable'],
      ['Filing approval', 'approval'],
    ].forEach(([t, k]) => {
      const c = h('div', { class: 'inv-rt-h' + (COLS[k] >= COLS.range ? ' inv-rt-hf' : ''), text: t });
      c.style.gridColumn = String(COLS[k]);
      c.style.gridRow = '1';
      rows.appendChild(c);
    });
  }
  // The autofiling section of one code line: practice normal range (min – max), enable, and its own approval. Edited here,
  // saved at once; ANY change withdraws that line's approval (pure op OV.setFilingRange).
  const cleanErr = (e) => ((e && e.message) || String(e)).replace(/^labcatalogue.practice: /, '');
  const applyFiling = async (spec) => {
    try {
      await save(OV.setFilingRange(S.builtin, S.overlay, spec), null);
    } catch (e) {
      alert(cleanErr(e));
      redraw();
    }
  };
  const filingCells = (row, r, c) => {
    const f = (cls, col, ...kids) => cell('inv-rt-f ' + cls, col, row, 1, ...kids);
    if (!fLab) {
      return [f('inv-rt-frange', COLS.range, h('span', { class: 'lf-muted', text: 'no lab defined' }))];
    }
    const e = r && c ? filingEntry(r.id, fLab, c.conceptId) : null;
    const key = e ? OV.filingKey(e) : '';
    const num = (v, label) =>
      h('input', {
        class: 'lf-input inv-rt-num',
        type: 'text',
        inputmode: 'decimal',
        maxlength: 12,
        'aria-label': label + ' (' + c.conceptId + ', ' + fLabName + ')',
        value: v === null || v === undefined ? '' : String(v),
      });
    const lo = num(e && e.low, 'Minimum');
    const hi = num(e && e.high, 'Maximum');
    const on = h('input', {
      type: 'checkbox',
      checked: !!(e && e.enabled),
      'aria-label': 'Enable autofiling for ' + r.label + ' (' + c.conceptId + ') at ' + fLabName,
    });
    const submit = () =>
      applyFiling({ result: r.id, lab: fLab, code: c.conceptId, low: lo.value, high: hi.value, enabled: on.checked });
    lo.addEventListener('change', submit);
    hi.addEventListener('change', submit);
    on.addEventListener('change', submit);
    const approved = !!(e && e.provenance && e.provenance.reviewed === true);
    return [
      f('inv-rt-frange', COLS.range, lo, h('span', { text: '–' }), hi),
      f('inv-rt-fenable', COLS.enable, h('label', { class: 'lf-check' }, on, ' on')),
      f(
        'inv-rt-fapproval',
        COLS.approval,
        !e
          ? h('span', { class: 'lf-muted', text: '—' })
          : approved
            ? badge('approved', 'lf-badge-ok')
            : [
                badge('awaiting approval', 'lf-badge-warn'),
                btn(
                  'Approve',
                  () =>
                    save(
                      OV.approveFilingRange(S.overlay, key, REVIEWER),
                      'Approved the ' + r.label + ' filing setup for ' + fLabName + '.'
                    ),
                  'lf-btn-primary lf-btn-sm'
                ),
              ]
      ),
    ];
  };
  const filingCellsNoCode = (row) => [
    cell('inv-rt-f inv-rt-frange', COLS.range, row, 1, h('span', { class: 'lf-muted', text: 'needs a code first' })),
  ];
  // Clicking a code or an "also called" cell opens (or closes) that result's own editor, full width under its rows.
  const clickToEdit = (el, parts, tip) => {
    if (!parts) return el;
    el.classList.add('inv-rt-click');
    el.setAttribute('role', 'button');
    el.tabIndex = 0;
    el.title = (tip ? tip + '\n\n' : '') + 'Click to add or edit this result\u2019s codes and other names';
    el.addEventListener('click', parts.toggle);
    el.addEventListener('keydown', (e) => {
      if (e.target === el && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        parts.toggle();
      }
    });
    return el;
  };
  let cursor = 2;
  st.members.forEach((m, i) => {
    const isNew = m.result.startsWith('new:');
    const r = isNew ? null : resultById(m.result);
    const ns = isNew ? newSpec(m) : null;
    const nameText = isNew ? m.result.slice(4) + ' (new)' : r ? r.label : m.result;
    const codeList = r ? r.codes : [];
    const n = Math.max(1, codeList.length);
    const start = cursor;
    cursor += n + 1; // + a full-width line for the inline result editor
    const role = sel(ROLE_OPTIONS, m.role);
    role.addEventListener('change', () => {
      m.role = role.value;
      if (m.role !== 'core') m.anchor = false;
      redraw();
    });
    const anchor = h('input', { type: 'checkbox', checked: !!m.anchor, disabled: m.role !== 'core' });
    anchor.addEventListener('change', () => (m.anchor = anchor.checked));
    const usedBy = r ? S.merged.investigations.filter((x) => x.members.some((y) => y.result === r.id)).length : 0;
    const parts = r ? resultEditorParts(r) : null;
    rows.appendChild(
      cell(
        'inv-rt-name',
        COLS.name,
        start,
        n,
        h('strong', { text: nameText }),
        usedBy > 1 ? h('div', { class: 'lf-muted', text: 'shared by ' + usedBy + ' tests' }) : null,
        h(
          'div',
          { class: 'inv-rt-actions' },
          h('button', {
            type: 'button',
            class: 'lf-btn lf-btn-sm lf-btn-danger inv-rt-remove',
            title: 'Remove from this test — the result stays in the catalogue and in other tests',
            'aria-label': 'Remove ' + nameText + ' from this test',
            onclick: () => (st.members.splice(i, 1), redraw()),
            text: 'Remove',
          })
        )
      )
    );
    if (codeList.length) {
      codeList.forEach((c, k) => {
        const info = codeInfoFor(c);
        const q = info.qof ? ' inv-code-qof' : '';
        rows.appendChild(
          clickToEdit(
            cell(
              'inv-rt-code' + q,
              COLS.code,
              start + k,
              1,
              h('span', { class: 'inv-code-id', text: c.conceptId }),
              info.qof ? h('span', { class: 'inv-qof-tag', text: 'QOF' }) : null
            ),
            parts,
            [c.conceptId, info.desc, info.qof ? 'Counts towards QOF (' + info.qofClusters.join(', ') + ')' : '']
              .filter(Boolean)
              .join('\n')
          )
        );
        rows.appendChild(
          cell(
            'inv-rt-unit' + q,
            COLS.unit,
            start + k,
            1,
            c.unit ? c.unit : h('span', { class: 'lf-muted', text: '—' })
          )
        );
        filingCells(start + k, r, c).forEach((x) => rows.appendChild(x));
      });
    } else {
      const none = isNew && ns && ns.code ? ns.code : '';
      rows.appendChild(
        clickToEdit(
          cell(
            'inv-rt-code',
            COLS.code,
            start,
            1,
            none
              ? h('span', { class: 'inv-code-id', text: none })
              : h('span', { class: 'inv-tag inv-tag-warn', text: 'no code yet — matched by name only' })
          ),
          parts,
          ''
        )
      );
      rows.appendChild(cell('inv-rt-unit', COLS.unit, start, 1, h('span', { class: 'lf-muted', text: '—' })));
      filingCellsNoCode(start).forEach((x) => rows.appendChild(x));
    }
    rows.appendChild(
      cell(
        'inv-rt-role',
        COLS.role,
        start,
        n,
        role,
        h('label', { class: 'lf-check inv-em-any', title: ENOUGH_ALONE }, anchor, ' enough on its own')
      )
    );
    // The result's name is itself one of its names, so an unlabelled name that just repeats it adds nothing here (lab-tagged
    // ones always show). The full list is in the editor that opens when you click a code or an "also called" name.
    const words = r ? r.aliases.filter((a) => a.lab || LC.norm(a.text) !== LC.norm(r.label)) : [];
    rows.appendChild(
      clickToEdit(
        cell(
          'inv-rt-words',
          COLS.words,
          start,
          n,
          ...(words.length
            ? words.map((a) =>
                h('span', { class: 'inv-chip inv-chip-ro', text: (a.lab ? labShort(a.lab) + ': ' : '') + a.text })
              )
            : [h('span', { class: 'lf-muted', text: '—' })])
        ),
        parts,
        ''
      )
    );
    if (parts) {
      // the result's own codes and wordings are edited right here, full width (a result can be shared by several tests)
      const line = h('div', { class: 'inv-rt-edit' }, parts.holder);
      line.style.gridColumn = '1 / -1';
      line.style.gridRow = String(start + n);
      rows.appendChild(line);
    }
  });
  // which lab the autofiling columns are for (a result can have a different practice range at each lab)
  const filingLabLine = () => {
    const labsHere = S.merged.labs.filter((l) => labVisible(l.id));
    if (!labsHere.length) return null;
    const pick = h(
      'select',
      { class: 'lf-input inv-sel-sm', 'aria-label': 'Lab the autofiling columns are for' },
      labsHere.map((l) => h('option', { value: l.id, selected: l.id === fLab }, labLabel(l)))
    );
    pick.addEventListener('change', () => {
      filingLabId = pick.value;
      redraw();
    });
    return h(
      'div',
      { class: 'inv-edit-line inv-filing-lab' },
      h('span', { class: 'inv-inline-label', text: 'Lab for the ranges and autofiling below:' }),
      pick
    );
  };
  const filingNote = () =>
    h(
      'div',
      { class: 'inv-filing-note' },
      "Clicking 'Approve' means I am approving this practice normal range and autofiling setting for " +
        (fLabName || 'this lab') +
        '. It applies to this result wherever it appears (ALP in LFTs and in Bone profile is one result) and to this lab only; changing it withdraws the approval. ' +
        'The lab\u2019s own reference range is used unless you set one here. Filing does not read this yet.'
    );
  const listId = 'invResList' + Math.random().toString(36).slice(2, 7);
  const dl = h(
    'datalist',
    { id: listId },
    S.merged.results.map((r) => h('option', { value: r.label }))
  );
  const memText = input({
    placeholder: 'Result name (pick one, or type a new one)',
    list: listId,
    'aria-label': 'Result name',
  });
  const memRole = sel(ROLE_OPTIONS, 'core');
  const memAnchor = h('input', { type: 'checkbox' });
  const newBox = h('div', { class: 'inv-edit-line inv-new-result', style: 'display:none' });
  const newKind = sel(VALUE_OPTIONS, 'mixed');
  const newCode = input({ placeholder: 'SNOMED code (optional)', 'aria-label': 'SNOMED code', maxlength: 24 });
  const newLab = h(
    'select',
    { class: 'lf-input inv-sel-sm' },
    h('option', { value: '' }, 'wording: any lab'),
    labOptions.map((o) => o.cloneNode(true))
  );
  newBox.append(h('span', { class: 'lf-muted', text: 'New result:' }), newKind, newCode, newLab);
  const existing = (t) => S.merged.results.find((r) => LC.norm(r.label) === LC.norm(t));
  memText.addEventListener('input', () => {
    newBox.style.display = memText.value.trim() && !existing(memText.value) ? '' : 'none';
  });
  const addMember = () => {
    const t = memText.value.trim();
    if (!t) return;
    const r = existing(t);
    let id;
    if (r) id = r.id;
    else {
      id = 'new:' + t;
      st.newResults = st.newResults.filter((x) => x.label !== t);
      st.newResults.push({ label: t, valueKind: newKind.value, code: newCode.value.trim(), lab: newLab.value });
    }
    if (st.members.some((m) => m.result === id)) {
      alert('That result is already in this test.');
      return;
    }
    st.members.push({ result: id, role: memRole.value, anchor: memRole.value === 'core' && memAnchor.checked });
    redraw();
  };
  memText.addEventListener('keydown', enter(addMember));
  pRes.appendChild(
    editorRow(
      '',
      'Click a code or an “also called” name to add or edit it. The results marked “Core to the lab group” are what the matcher looks for. ' +
        QOF_LEGEND,
      st.members.length ? filingLabLine() : null,
      st.members.length ? rows : h('span', { class: 'lf-muted', text: 'None yet.' }),
      st.members.length ? filingNote() : null,
      h('div', { class: 'inv-panel-sub', text: 'Add more tests to this panel' }),
      h(
        'div',
        { class: 'inv-edit-line' },
        memText,
        dl,
        memRole,
        h('label', { class: 'lf-check', title: ENOUGH_ALONE }, memAnchor, ' enough on its own'),
        btn('Add', addMember, 'lf-btn-sm')
      ),
      newBox
    )
  );

  // note
  const note = h('textarea', {
    class: 'lf-input inv-in inv-note',
    rows: '1',
    maxlength: '1000',
    placeholder: 'Optional note for whoever reviews this',
    'aria-label': 'Note',
  });
  note.value = st.note;
  // only as tall as its text (it grows as you type; drag the corner to make it larger)
  const fitNote = () => {
    note.style.height = 'auto';
    note.style.height = note.scrollHeight + 2 + 'px';
  };
  note.addEventListener('input', () => {
    st.note = note.value;
    fitNote();
  });
  requestAnimationFrame(fitNote);
  wrap.appendChild(editorRow('Note', null, note));

  // save / approve
  const persist = async (approve) => {
    try {
      if (!st.label.trim()) throw new Error('Give the test a name.');
      let o = S.overlay;
      const idFor = new Map();
      for (const nr of st.newResults) {
        if (!st.members.some((m) => m.result === 'new:' + nr.label)) continue;
        const r = OV.saveResult(S.builtin, o, {
          label: nr.label,
          valueKind: nr.valueKind,
          codes: nr.code ? [{ conceptId: nr.code, role: 'primary' }] : [],
          aliases: [{ text: nr.label, ...(nr.lab ? { lab: nr.lab } : {}) }],
        });
        o = r.overlay;
        idFor.set('new:' + nr.label, r.id);
      }
      const spec = {
        id: st.id || undefined,
        label: st.label,
        kind: st.kind,
        requestAliases: st.reqs.map((x) => ({ text: x.text, system: x.system })),
        headingAliases: st.heads.filter((x) => !x.lab).map((x) => x.text),
        exclude: st.excl.map((x) => x.text),
        members: st.members.map((m) => ({ result: idFor.get(m.result) || m.result, role: m.role, anchor: m.anchor })),
        note: st.note,
        labHeadings: [...st.heads, ...st.hidden].filter((x) => x.lab).map((x) => ({ lab: x.lab, text: x.text })),
      };
      const saved = OV.saveInvestigation(S.builtin, o, spec);
      let next = saved.overlay;
      let msg = `Saved "${st.label}" — awaiting review.`;
      if (approve) {
        if (next.investigations.some((i) => i.id === saved.id)) {
          next = OV.approveInvestigation(S.builtin, next, saved.id, REVIEWER).overlay;
          msg = `Approved "${st.label}".`;
        } else msg = `"${st.label}" is the shipped test — nothing to approve.`;
      }
      await save(next, msg);
      done(true);
    } catch (e) {
      st.error = ((e && e.message) || String(e)).replace(/^labcatalogue\.practice: /, '');
      redraw();
    }
  };
  if (st.id && !st.isBuiltin) wrap.appendChild(mergeBlock(st, done));
  const foot = h('div', { class: 'inv-edit-foot' });
  // On the review screen the statement sits with the buttons: pressing Approve IS the confirmation.
  foot.appendChild(
    h('span', {
      class: 'inv-foot-note',
      text: st.review
        ? "Clicking 'Approve' means I am approving this test's wordings, results, and codes. This saves changes above and makes this test active for the features that use this catalogue."
        : 'Saving sends this test back to “awaiting review”; nothing here acts until you approve it. A change to a built-in test replaces the shipped version only once approved.',
    })
  );
  const buttons = h('span', { class: 'inv-foot-btns' });
  if (st.id && !st.isBuiltin) {
    buttons.appendChild(
      btn(
        'Delete',
        async () => {
          if (
            !confirm(
              `Delete "${st.label}" from the catalogue? This cannot be undone. (Built-in tests are never deleted.)`
            )
          )
            return;
          try {
            await save(OV.removeInvestigation(S.builtin, S.overlay, st.id).overlay, `Deleted "${st.label}".`);
            done(true);
          } catch (e) {
            st.error = ((e && e.message) || String(e)).replace(/^labcatalogue.practice: /, '');
            redraw();
          }
        },
        'lf-btn-danger'
      )
    );
  }
  buttons.appendChild(btn('Cancel', () => done(false)));
  buttons.appendChild(btn('Save', () => persist(false), st.review ? '' : 'lf-btn-primary'));
  if (st.review) buttons.appendChild(btn('Approve', () => persist(true), 'lf-btn-primary'));
  foot.appendChild(buttons);
  if (st.error) foot.appendChild(h('span', { class: 'inv-error', role: 'alert', text: st.error }));
  wrap.appendChild(foot);
  return wrap;
}

// One result's editor (codes and wordings; name and value type). Everything is editable. Used by every test that
// includes the result — the line below says how many.
// Opens / closes a result's own editor in place, inside the test's edit screen (clicked from its code or "also called" cell).
function resultEditorParts(r) {
  const holder = h('div', { class: 'inv-em-resedit' });
  const toggle = () => {
    if (holder.firstChild) {
      holder.textContent = '';
      return;
    }
    holder.appendChild(renderResultEditor(r, () => (holder.textContent = '')));
  };
  return { toggle, holder };
}

function renderResultEditor(r, done) {
  const ov = S.overlay.results.find((x) => x.id === r.id) || null;
  const usedBy = S.merged.investigations.filter((i) => i.members.some((m) => m.result === r.id));
  const st = {
    label: r.label,
    valueKind: r.valueKind,
    codes: r.codes.map((c) => ({ ...c })),
    aliases: r.aliases.map((a) => ({ ...a })),
    review: !!ov && ov.provenance.reviewed !== true,
    error: '',
  };
  let wrap;
  const build = () => {
    const w = h('div', { class: 'inv-res-edit' });
    const input = (attrs) => h('input', { class: 'lf-input inv-in', type: 'text', maxlength: 200, ...attrs });
    const nm = input({ value: st.label, 'aria-label': 'Result name' });
    nm.addEventListener('input', () => (st.label = nm.value));
    const vk = h(
      'select',
      { class: 'lf-input inv-sel-sm', 'aria-label': 'Value type' },
      VALUE_OPTIONS.map(([v, l]) => h('option', { value: v, selected: v === st.valueKind }, l))
    );
    vk.addEventListener('change', () => (st.valueKind = vk.value));
    w.appendChild(editorRow('Name', null, h('div', { class: 'inv-edit-line' }, nm, vk)));
    const code = input({ placeholder: 'SNOMED code', maxlength: 24, 'aria-label': 'SNOMED code' });
    const unit = input({ placeholder: 'unit (optional)', maxlength: 40, 'aria-label': 'Unit' });
    const addCode = () => {
      const c = code.value.trim();
      if (!c) return;
      st.codes.push({ conceptId: c, role: 'alternate', ...(unit.value.trim() ? { unit: unit.value.trim() } : {}) });
      redraw();
    };
    code.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), addCode()));
    w.appendChild(
      editorRow(
        'Codes',
        'The first code is the primary one. A code can belong to one result only.',
        chipsEl(
          st.codes,
          (i) => (st.codes.splice(i, 1), redraw()),
          (c) => c.conceptId + (c.unit ? ` (${c.unit})` : '')
        ),
        h('div', { class: 'inv-edit-line' }, code, unit, btn('Add code', addCode, 'lf-btn-sm'))
      )
    );
    const word = input({
      placeholder: 'Another name the lab or your GP system uses for this result',
      'aria-label': 'Other name',
    });
    const wlab = h(
      'select',
      { class: 'lf-input inv-sel-sm' },
      h('option', { value: '' }, 'any lab'),
      S.merged.labs.filter((l) => labVisible(l.id)).map((l) => h('option', { value: l.id }, labLabel(l)))
    );
    const addWord = () => {
      const t = word.value.trim();
      if (!t) return;
      st.aliases.push({ text: t, ...(wlab.value ? { lab: wlab.value } : {}) });
      redraw();
    };
    word.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), addWord()));
    w.appendChild(
      editorRow(
        'Also called',
        null,
        chipsEl(
          st.aliases,
          (i) => (st.aliases.splice(i, 1), redraw()),
          (a) => (a.lab ? `${labShort(a.lab)}: ` : '') + a.text
        ),
        h('div', { class: 'inv-edit-line' }, word, wlab, btn('Add name', addWord, 'lf-btn-sm'))
      )
    );
    const persist = async (approve) => {
      try {
        const out = OV.saveResult(S.builtin, S.overlay, {
          id: r.id,
          label: st.label,
          valueKind: st.valueKind,
          codes: st.codes,
          aliases: st.aliases,
          excludeAliases: r.excludeAliases,
        });
        let next = out.overlay;
        let msg = `Saved "${st.label}" — awaiting review.`;
        if (approve && next.results.some((x) => x.id === r.id)) {
          next = OV.markReviewed(next, 'results', r.id, REVIEWER);
          msg = `Approved "${st.label}".`;
        }
        await save(next, msg);
        done(true);
      } catch (e) {
        st.error = ((e && e.message) || String(e)).replace(/^labcatalogue\.practice: /, '');
        redraw();
      }
    };
    const foot = h('div', { class: 'inv-edit-foot' });
    foot.appendChild(
      h('span', {
        class: 'inv-foot-note',
        text: st.review
          ? "Clicking 'Approve result' means I am approving this result's codes and other names. This saves changes above and makes this result active for the features that use this catalogue."
          : `Used by ${plural(usedBy.length, 'test')}${
              usedBy.length
                ? ': ' +
                  usedBy
                    .slice(0, 4)
                    .map((i) => i.label)
                    .join(', ') +
                  (usedBy.length > 4 ? '…' : '')
                : ''
            }. Saving sends this result (and any practice test using it) back to “awaiting review”.`,
      })
    );
    const buttons = h('span', { class: 'inv-foot-btns' });
    buttons.appendChild(btn('Cancel', () => done(false), 'lf-btn-sm'));
    buttons.appendChild(btn('Save result', () => persist(false), st.review ? 'lf-btn-sm' : 'lf-btn-primary lf-btn-sm'));
    if (st.review) buttons.appendChild(btn('Approve result', () => persist(true), 'lf-btn-primary lf-btn-sm'));
    foot.appendChild(buttons);
    if (st.error) foot.appendChild(h('span', { class: 'inv-error', role: 'alert', text: st.error }));
    w.appendChild(foot);
    return w;
  };
  const redraw = () => {
    const fresh = build();
    wrap.replaceWith(fresh);
    wrap = fresh;
  };
  wrap = build();
  return wrap;
}

function finishEdit() {
  if (S.editing) S.open.delete(S.editing); // the card goes back to its one-line summary
  S.editing = null;
  S.editState = null;
  render();
}

function renderInvestigation(d) {
  const inv = d.inv;
  const editing = S.editing === inv.id && S.editState;
  const open = S.open.has(inv.id) || !!editing;
  const requests = inv.requestAliases.map((a) => a.text);
  const reqText = requests.join(' · ');

  const actions = h('span', { class: 'inv-actions' });
  // Approval is only possible from the review screen, so the person has the whole test in front of them.
  if (d.needsReview && d.ov) {
    actions.appendChild(
      btn(
        'Review',
        () => {
          S.editing = inv.id;
          S.editState = editStateFor(inv, true);
          S.open.add(inv.id);
          render();
        },
        'lf-btn-primary lf-btn-sm',
        'Open the whole test to check it, then approve.'
      )
    );
  }
  if (d.ov && d.inBuiltin) {
    actions.appendChild(
      btn(
        'Revert to built-in',
        async () => {
          if (!confirm(`Put "${inv.label}" back to the shipped version? Your changes to it will be discarded.`)) return;
          await save(
            OV.revertInvestigation(S.builtin, S.overlay, inv.id).overlay,
            `"${inv.label}" reverted to the shipped version.`
          );
        },
        'lf-btn-sm'
      )
    );
  }
  if (d.ov && !d.inBuiltin) {
    actions.appendChild(
      btn(
        'Delete',
        async () => {
          if (
            !confirm(
              `Delete "${inv.label}" from the catalogue? This cannot be undone. (Built-in tests are never deleted — use Disable.)`
            )
          )
            return;
          const r = OV.removeInvestigation(S.builtin, S.overlay, inv.id);
          await save(r.overlay, `Deleted "${inv.label}".`);
        },
        'lf-btn-danger lf-btn-sm'
      )
    );
  }
  if (d.inBuiltin) {
    actions.appendChild(
      btn(
        d.disabled ? 'Re-enable' : 'Disable',
        async () => {
          if (
            !d.disabled &&
            !confirm(
              `Disable "${inv.label}"? Requests for it will stay outstanding and it will not be recognised until re-enabled.`
            )
          )
            return;
          await save(
            OV.setInvestigationDisabled(S.overlay, inv.id, !d.disabled),
            d.disabled ? 'Re-enabled.' : 'Disabled.'
          );
        },
        'lf-btn-sm',
        'Disabling is the safe direction: the test simply stops being recognised.'
      )
    );
  }
  actions.appendChild(
    btn(
      'Edit',
      () => {
        S.editing = inv.id;
        S.editState = editStateFor(inv);
        render();
      },
      'lf-btn-sm',
      d.inBuiltin
        ? 'Change this built-in test for your practice (the shipped version can be restored)'
        : 'Edit this test'
    )
  );

  const top = h(
    'div',
    { class: 'inv-top' },
    h('span', { class: 'inv-name', text: inv.label }),
    h(
      'span',
      { class: 'inv-req', title: reqText ? 'Requested as: ' + reqText : '' },
      reqText ? h('span', { class: 'inv-req-k', text: 'requested as ' }) : null,
      reqText || '—'
    ),
    h(
      'span',
      { class: 'lf-badges inv-badges' },
      badge(kindLabel(inv.kind)),
      inv.requestAliases.length ? null : badge('needs a request', 'lf-badge-warn'),
      badge(d.status.text, d.status.cls),
      (() => {
        const f = filingStatus(inv);
        if (!f.on) return null;
        return f.approved === f.on
          ? badge('autofiling on', 'lf-badge-ok')
          : badge('autofiling — awaiting approval', 'lf-badge-warn');
      })(),
      d.disabled ? badge('disabled', 'lf-badge-warn') : null
    ),
    actions
  );
  const card = h(
    'div',
    { class: 'lf-card inv-item' + (d.needsReview ? '' : ' lf-card-on') + (open ? ' inv-open' : '') },
    top
  );
  if (d.via) card.appendChild(h('div', { class: 'inv-via', text: `Matched by result: ${d.via}` }));

  if (editing) {
    card.appendChild(renderEditor(S.editState, () => finishEdit()));
  } else if (open) {
    const body = h('div', { class: 'inv-body' });
    const sysTag = (a) => a.text + (a.system && a.system !== 'any' ? ` (${systemName(a.system)})` : '');
    const chips = (list, fmt) =>
      h(
        'span',
        { class: 'inv-headchips' },
        list.map((x) => h('span', { class: 'inv-headchip' }, fmt(x)))
      );
    const heads = headingChips(inv);
    const rows = resultsOf(inv);
    const reqs = inv.requestAliases;
    body.appendChild(
      flowGrid(
        panel(
          'req',
          'How it is requested in Medicus',
          h('div', { class: 'inv-panel-cap', text: 'Requested as' }),
          reqs.length
            ? chips(reqs, sysTag)
            : h('span', {
                class: 'lf-muted',
                text: 'No request wording yet — press Edit and add how it appears in the investigation requests list.',
              })
        ),
        panel(
          'lab',
          'How it comes back from the lab',
          h('div', { class: 'inv-panel-cap', text: 'Lab report heading' }),
          heads.length
            ? chips(heads, (x) => [x.lab ? h('span', { class: 'inv-headlab', text: x.lab + ' ' }) : null, x.text])
            : h('span', { class: 'lf-muted', text: 'none recorded — recognised from the request wording and results' })
        ),
        panel(
          'never',
          'Never matches…',
          inv.exclude && inv.exclude.length
            ? chips(inv.exclude, (x) => x)
            : h('span', { class: 'lf-muted', text: 'Nothing excluded.' })
        ),
        panel(
          'res',
          'SNOMED codes',
          h('div', { class: 'inv-panel-cap', text: QOF_LEGEND }),
          rows.length
            ? h(
                'div',
                { class: 'inv-reslist' },
                rows.map((x) => resultRow(inv, x))
              )
            : h('span', { class: 'lf-muted', text: 'None — recognised from request and heading only.' })
        )
      )
    );
    if (inv.note)
      body.appendChild(
        h('div', { class: 'inv-sec' }, h('span', { class: 'lf-k', text: 'Note' }), h('span', { text: inv.note }))
      );
    card.appendChild(body);
  }
  return card;
}

function renderBrowse() {
  const all = S.merged.investigations.map(describe);
  const pending = all.filter((d) => d.needsReview && d.ov);
  const search = h('input', {
    class: 'lf-input inv-search',
    type: 'search',
    placeholder: 'Search tests, request wordings, headings, result names and codes…',
    value: S.query,
    'aria-label': 'Search investigations and results',
  });
  search.addEventListener('input', () => {
    S.query = search.value;
    renderList();
  });
  const kindSelect = h(
    'select',
    { class: 'lf-input inv-sel-sm inv-kind-filter', 'aria-label': 'Filter by sample' },
    h('option', { value: '' }, 'All samples'),
    KIND_OPTIONS.map(([v, l]) => h('option', { value: v, selected: S.kindFilter === v }, l))
  );
  kindSelect.addEventListener('change', () => {
    S.kindFilter = kindSelect.value;
    renderList();
  });
  const filters = [
    ['all', 'All'],
    ['builtin', 'Built-in'],
    ['practice', 'Practice'],
    ['review', `Awaiting review (${pending.length})`],
    ['autofiling', 'Autofiling enabled'],
    ['noautofiling', 'Autofiling not enabled'],
  ].map(([id, label]) =>
    btn(
      label,
      () => {
        S.filter = id;
        render();
      },
      S.filter === id ? 'lf-btn-primary lf-btn-sm' : 'lf-btn-sm'
    )
  );
  const card = h(
    'div',
    { class: 'inv-browse' },
    h(
      'div',
      { class: 'inv-browse-bar' },
      search,
      kindSelect,
      h('div', { class: 'lf-toolbar-btns' }, filters),
      btn(
        '+ New investigation',
        () => {
          S.editing = '__new';
          S.editState = editStateFor(null);
          render();
        },
        'lf-btn-sm'
      ),
      // There is deliberately no bulk approval: each test is approved from its own review screen.
      pending.length
        ? btn(
            `Review next (${pending.length})`,
            () => {
              const d = pending.slice().sort((x, y) => x.inv.label.localeCompare(y.inv.label))[0];
              S.query = '';
              S.filter = 'review';
              S.editing = d.inv.id;
              S.editState = editStateFor(d.inv, true);
              S.open.add(d.inv.id);
              render();
            },
            'lf-btn-sm'
          )
        : null
    ),
    h('div', { class: 'lf-count inv-count', id: 'invCount' }),
    h('div', { class: 'inv-list', id: 'invList' })
  );
  return card;
}

function renderList() {
  const list = root && root.querySelector('#invList');
  if (!list) return;
  const shown = visibleInvestigations();
  const all = S.merged.investigations.length;
  const count = root.querySelector('#invCount');
  if (count) {
    const builtin = S.merged.investigations.filter((i) => S.builtin.investigations.some((b) => b.id === i.id)).length;
    count.textContent = `${shown.length === all ? plural(all, 'investigation') : `${shown.length} of ${all} investigations`} · ${builtin} built-in`;
  }
  list.textContent = '';
  if (S.editing === '__new' && S.editState) {
    list.appendChild(
      h(
        'div',
        { class: 'lf-card inv-item inv-open' },
        h('div', { class: 'inv-top' }, h('span', { class: 'inv-name', text: 'New investigation' })),
        renderEditor(S.editState, () => finishEdit())
      )
    );
  }
  if (!shown.length) {
    list.appendChild(h('div', { class: 'lf-empty', text: 'Nothing matches.' }));
    return;
  }
  for (const d of shown) list.appendChild(renderInvestigation(d));
}

// Report headings now live inside each investigation's details. What remains here: labs (to approve a lab you added)
// and any heading that covers a MIXED group (no single investigation to hang it on).
function renderLabs() {
  const labs = S.merged.labs;
  const invById = new Map(S.merged.investigations.map((i) => [i.id, i]));
  const det = h(
    'details',
    { class: 'inv-details inv-labs' },
    h('summary', {}, `Labs (${labs.length}) and mixed report headings`)
  );
  if (!labs.length) {
    det.appendChild(h('div', { class: 'lf-muted', text: 'No labs defined.' }));
    return det;
  }
  // Approving a lab activates EVERY heading mapping it carries — including headings that identify other tests — so the
  // review card must list them all, not just the mixed-group ones. A mapping the reviewer never saw must not exist.
  const refLabel = (ref) => (ref.startsWith('inv:') ? (invById.get(ref.slice(4)) || {}).label : ref.slice(4)) || ref;
  for (const lab of labs) {
    const ov = S.overlay.labs.find((l) => l.id === lab.id);
    const needs = ov && ov.provenance.reviewed !== true;
    const heads = lab.groupHeadings || [];
    const rename = () => {
      const now = (S.overlay.context.labNames || {})[lab.id] || lab.name;
      const next = prompt(
        'A name that means something to your team for this lab (“' +
          lab.identifiers.performerOrg +
          '” is its code). Leave blank to go back to the original name.',
        now
      );
      if (next === null) return;
      save(OV.renameLab(S.overlay, lab.id, next), next.trim() ? 'Lab renamed.' : 'Lab name reset.');
    };
    const block = h(
      'div',
      { class: 'inv-lab-block' },
      h('strong', {
        text: `${lab.name} — ${lab.identifiers.performerOrg}${lab.identifiers.department ? ' / ' + lab.identifiers.department : ''}`,
      }),
      ' ',
      btn('Rename', rename, 'lf-btn-sm'),
      ' ',
      needs ? badge('awaiting review', 'lf-badge-warn') : null,
      needs ? ' ' : null,
      needs
        ? btn(
            'Approve lab',
            async () => save(OV.markReviewed(S.overlay, 'labs', lab.id, REVIEWER), `Approved ${lab.name}.`),
            'lf-btn-primary lf-btn-sm'
          )
        : null,
      heads.length
        ? h(
            'ul',
            {},
            heads.map((g) => {
              const identifies = (g.identifies || []).map((x) => (invById.get(x) || {}).label || x);
              const may = (g.mayContain || []).map(refLabel);
              const parts = [];
              if (identifies.length) parts.push('identifies ' + identifies.join(', '));
              if (may.length) parts.push('may contain ' + may.join(', '));
              return h('li', {}, h('strong', { text: g.text }), ' → ' + (parts.join('; ') || '—'));
            })
          )
        : h('div', { class: 'lf-muted', text: 'No report headings.' })
    );
    det.appendChild(block);
  }
  return det;
}

// ── Match requests to lab reports (one place to read, scan and match) ──────────────────────────────────────────
// LEFT  = how it is REQUESTED in Medicus. Populated by reading the practice's Outstanding Requests tests (the import), plus
//         request wordings seen on cards that the catalogue does not know.
// RIGHT = how it COMES BACK from the lab. Populated by reading the pending investigation-results queue (read-only): the lab's
//         report groups, with their results and SNOMED codes. Groups the scan can link are already matched; the rest can be
//         dragged onto a request (or chosen from a dropdown).
// One button runs both, in that order, so both sides have something to work with. Nothing is ever added except what is
// ticked, and everything added arrives awaiting review. Only test names / headings / codes / units are kept from reports.
const SCAN_DEFAULT_LIMIT = 100;
S.scan = {
  lab: null, // lab id the imported request names come from ('' = not lab-specific); null = not chosen yet
  limit: SCAN_DEFAULT_LIMIT,
  phase: 'idle', // idle | importing | reading | ready | error
  progress: null,
  stop: false,
  error: '',
  ran: false,
  filterLeft: '',
  filterRight: '',
  lastApply: null, // { done, failed } from the last "Add the ticked matches"
  importNotes: null,
  read: null,
  analysis: null,
  items: [], // [{ u, choice, checked }] one per lab group the scan wants a decision on
  reqChecked: new Set(), // normalised unrecognised request labels to create as request-only tests
};

function updateScanProgress() {
  const el = root && root.querySelector('#invScanProgress');
  const p = S.scan.progress;
  if (el && p) el.textContent = `Reading reports… ${p[0]} of ${p[1]}`;
}

async function runMatch() {
  const sc = S.scan;
  sc.phase = 'importing';
  sc.ran = true;
  sc.error = '';
  sc.stop = false;
  sc.progress = null;
  sc.analysis = null;
  sc.items = [];
  sc.lastApply = null;
  sc.reqChecked = new Set();
  render();
  try {
    // 1) the requested side: the practice's own Outstanding Requests tests
    const tests = await readOirTests();
    if (tests.length) {
      const imp = IMP.importOirTests(tests, S.builtin, { labId: sc.lab || undefined });
      const merged = IMP.mergeIntoOverlay(S.overlay, imp.overlay);
      sc.importNotes = {
        read: tests.length,
        added: merged.added,
        skipped: merged.skipped,
        dismissed: merged.dismissedSkipped || 0,
        review: imp.review,
      };
      if (merged.added) {
        await labcatalogueSaveOverlay(merged.overlay);
        await load();
      }
    } else {
      sc.importNotes = { read: 0, added: 0, skipped: 0, review: [] };
    }
    // 2) the lab side: the results queue
    sc.phase = 'reading';
    render();
    if (!window.PracticeCode || !window.LabAllocateCore)
      throw new Error('The reading helpers did not load. Reload this page.');
    const resolved = await window.PracticeCode.resolve();
    const code = resolved && resolved.code;
    if (!code || !/^[a-f0-9]{4,8}$/i.test(code))
      throw new Error(
        'No Medicus practice code found. Open Medicus in a browser tab (or set the practice code under Suite settings) and try again.'
      );
    const client = window.LabAllocateCore.createClient(`https://${code}.api.england.medicus.health`);
    const r = await SC.collectObservations(client, {
      limit: sc.limit,
      concurrency: 3,
      onProgress: (d, t) => {
        sc.progress = [d, t];
        updateScanProgress();
      },
      shouldStop: () => sc.stop,
    });
    sc.read = { reports: r.observations.length, failed: r.failed, queueSize: r.queueSize, stopped: sc.stop };
    const targets = SC.findGaps(S.merged, S.overlay.context).map((g) => g.id);
    sc.analysis = SC.analyse(S.merged, r.observations, { targets });
    sc.items = [...sc.analysis.proposals, ...sc.analysis.unmatched].map((u) => {
      // one generic group several tests share (an ultrasound): the person picks which tests it answers; never ticked for them
      if (u.multi) return { u, choice: 'tests', checked: false, tests: new Set(u.candidates) };
      if (u.target) return { u, choice: 'test:' + u.target, checked: true }; // linked with evidence: ticked, still reviewable
      if (u.hint) return { u, choice: 'test:' + u.hint, checked: false }; // a hint is only pre-selected
      return { u, choice: u.maybe && u.maybe.length === 1 ? 'req:' + u.maybe[0] : '', checked: false };
    });
    sc.phase = 'ready';
  } catch (e) {
    sc.phase = 'error';
    const status = e && e.status;
    sc.error =
      status === 401 || status === 403
        ? 'Medicus did not accept the request — sign in to Medicus in a browser tab and try again.'
        : (e && e.message) || String(e);
  }
  render();
}

function parseChoice(v) {
  if (!v) return null;
  if (v === 'group') return { type: 'group' };
  if (v.startsWith('req:')) return { type: 'request', label: v.slice(4) };
  if (v.startsWith('test:')) return { type: 'test', id: v.slice(5) };
  if (v === 'tests') return { type: 'tests' };
  return null;
}

// The board's two lists are redrawn in place (drag, drop, tick, filter) so the filter boxes keep their focus.
let boardRefs = null;
function drawBoard() {
  if (!boardRefs) return;
  boardRefs.left.textContent = '';
  boardRefs.right.textContent = '';
  fillLeft(boardRefs.left);
  fillRight(boardRefs.right);
}

const matchedTo = (value) => S.scan.items.filter((it) => it.choice === value);

function fillLeft(list) {
  const sc = S.scan;
  const a = sc.analysis;
  const q = LC.norm(sc.filterLeft);
  const fits = (...texts) => !q || texts.some((t) => LC.norm(t).includes(q));
  const gaps = SC.findGaps(S.merged, S.overlay.context);

  const dropTarget = (el, value) => {
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      el.classList.add('inv-drop-over');
    });
    el.addEventListener('dragleave', () => el.classList.remove('inv-drop-over'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('inv-drop-over');
      const it = sc.items.find((x) => x.u.key === e.dataTransfer.getData('text/plain'));
      if (!it) return;
      it.choice = value;
      it.checked = true; // dragging is a deliberate act
      drawBoard();
    });
  };
  const chipsFor = (value) =>
    matchedTo(value).map((it) =>
      h(
        'span',
        { class: 'inv-match-chip', title: 'Matched — press × to undo' },
        `← “${it.u.heading}”`,
        h('button', {
          type: 'button',
          class: 'inv-chip-x',
          'aria-label': 'Unmatch ' + it.u.heading,
          text: '×',
          onclick: () => {
            it.choice = '';
            it.checked = false;
            drawBoard();
          },
        })
      )
    );
  const item = (value, title, sub, extra) => {
    const el = h(
      'div',
      { class: 'inv-board-item' + (matchedTo(value).length ? ' inv-board-matched' : '') },
      extra || null,
      h('span', { class: 'inv-board-name', text: title }),
      sub ? h('span', { class: 'lf-muted inv-board-sub', text: sub }) : null,
      chipsFor(value)
    );
    dropTarget(el, value);
    return el;
  };

  if (a) list.appendChild(item('group', 'Keep as a group-and-results test (no request yet)', 'drop a lab group here'));
  const tests = gaps.filter((g) => {
    const inv = S.merged.investigations.find((i) => i.id === g.id);
    return fits(g.label, ...(inv ? inv.requestAliases.map((r) => r.text) : []));
  });
  if (tests.length)
    list.appendChild(
      h('div', { class: 'inv-board-h', text: `Tests still waiting for a lab report (${tests.length})` })
    );
  for (const g of tests) {
    const inv = S.merged.investigations.find((i) => i.id === g.id);
    const reqs =
      inv && inv.requestAliases.length ? inv.requestAliases.map((r) => r.text).join(' · ') : 'no request wording yet';
    list.appendChild(item('test:' + g.id, g.label, `${kindLabel(g.kind)} · ${reqs}`));
  }
  if (!gaps.length && !a) {
    list.appendChild(
      h('div', {
        class: 'lf-muted',
        text: 'Nothing waiting yet — press the button above to read your Outstanding Requests tests and the results queue.',
      })
    );
  }
  const unknown = a ? a.unknownRequests.filter((r) => fits(r.label)) : [];
  if (unknown.length)
    list.appendChild(
      h('div', { class: 'inv-board-h', text: `Requests the catalogue does not recognise (${unknown.length})` })
    );
  for (const r of unknown.slice(0, 200)) {
    const k = LC.norm(r.label);
    const cb = h('input', {
      type: 'checkbox',
      checked: sc.reqChecked.has(k),
      'aria-label': 'Create a test for ' + r.label,
      title: 'Tick to create a test for this request (its wording only)',
    });
    cb.addEventListener('change', () => (cb.checked ? sc.reqChecked.add(k) : sc.reqChecked.delete(k)));
    list.appendChild(
      item('req:' + r.label, r.label, `${plural(r.count, 'card')}${r.kind ? ' · ' + kindLabel(r.kind) : ''}`, cb)
    );
  }
  if (q && !tests.length && !unknown.length)
    list.appendChild(h('div', { class: 'lf-muted', text: 'Nothing matches the filter.' }));
}

function fillRight(list) {
  const sc = S.scan;
  const a = sc.analysis;
  const q = LC.norm(sc.filterRight);
  const fits = (...texts) => !q || texts.some((t) => LC.norm(t).includes(q));
  if (!a) {
    list.appendChild(
      h('div', {
        class: 'lf-muted',
        text:
          sc.phase === 'reading' || sc.phase === 'importing'
            ? 'Reading…'
            : 'Lab report groups appear here once the results queue has been read.',
      })
    );
    return;
  }
  const shown = sc.items.filter((it) => fits(it.u.heading, ...it.u.results.map((r) => r.name)));
  if (!sc.items.length)
    list.appendChild(
      h('div', { class: 'lf-muted', text: 'Every lab group was recognised and is complete — nothing to match.' })
    );
  for (const it of shown.slice(0, 150)) list.appendChild(groupItem(it, a.unknownRequests));
  if (sc.items.length && !shown.length)
    list.appendChild(h('div', { class: 'lf-muted', text: 'Nothing matches the filter.' }));
}

// One filter PER side: the two sides name things differently ("cervical screening" is "smear" on the lab's report).
function renderBoard() {
  const sc = S.scan;
  const mkFilter = (side, placeholder) => {
    const f = h('input', {
      class: 'lf-input inv-board-filter',
      type: 'search',
      placeholder,
      value: sc[side],
      'aria-label': placeholder,
    });
    f.addEventListener('input', () => {
      sc[side] = f.value;
      drawBoard();
    });
    return f;
  };
  const leftList = h('div', { class: 'inv-board-list' });
  const rightList = h('div', { class: 'inv-board-list' });
  boardRefs = { left: leftList, right: rightList };
  const board = h(
    'div',
    { class: 'inv-board' },
    h(
      'section',
      { class: 'inv-board-col inv-board-left' },
      h('h4', { class: 'inv-board-title', text: 'How it is requested in Medicus' }),
      mkFilter('filterLeft', 'Filter requests — e.g. cervical, urea…'),
      leftList
    ),
    h('span', { class: 'inv-board-arrow', 'aria-hidden': 'true', text: '→' }),
    h(
      'section',
      { class: 'inv-board-col inv-board-right' },
      h('h4', { class: 'inv-board-title', text: 'How it comes back from the lab' }),
      mkFilter('filterRight', 'Filter lab groups — e.g. smear, cytology…'),
      rightList
    )
  );
  drawBoard();
  return board;
}

// Apply what is ticked ONE ITEM AT A TIME against the catalogue as it stands after the previous one, so a single problem
// never blocks the rest, duplicates are never created (a request that now resolves to a test is attached to it), and the
// person is told exactly what was added and what could not be.
async function applyTicked() {
  const sc = S.scan;
  const a = sc.analysis;
  const label = (id) => (S.merged.investigations.find((i) => i.id === id) || { label: id }).label;
  const cleanMsg = (e) => ((e && e.message) || String(e)).replace(/^labcatalogue.practice: /, '');
  let overlay = S.overlay;
  const done = [];
  const failed = [];
  const effective = () => OV.mergeCatalogue(S.builtin, overlay, { includeUnreviewed: true }).catalogue;
  const describeAdded = (x) =>
    [
      x.tests ? plural(x.tests, 'new test') : '',
      x.headings ? plural(x.headings, 'heading') : '',
      x.codes ? plural(x.codes, 'code') : '',
      x.members ? plural(x.members, 'result') : '',
      x.aliases ? plural(x.aliases, 'other name') : '',
      x.labs ? plural(x.labs, 'new lab') : '',
    ]
      .filter(Boolean)
      .join(', ');
  const apply = (title, makeFills) => {
    try {
      const fills = makeFills(effective());
      if (!fills) return;
      const r = OV.applyFills(S.builtin, overlay, fills);
      overlay = r.overlay;
      done.push({ title, added: describeAdded(r.added) || 'nothing new — it was already recorded' });
    } catch (e) {
      failed.push({ title, reason: cleanMsg(e) });
    }
  };
  const createdFromItems = new Set();
  for (const it of sc.items.filter((x) => x.checked && x.choice)) {
    let action = parseChoice(it.choice);
    if (action && action.type === 'tests')
      action = it.tests && it.tests.size ? { type: 'tests', ids: [...it.tests] } : null;
    if (action && action.type === 'request') createdFromItems.add(LC.norm(action.label));
    const where = action
      ? action.type === 'tests'
        ? action.ids.map(label).join(' + ')
        : action.type === 'test'
          ? label(action.id)
          : action.type === 'request'
            ? action.label
            : 'a group-and-results test'
      : '';
    apply(`“${it.u.heading}” → ${where}`, (cat) => {
      // a request that already resolves to a test (in the catalogue or just created) is attached to it, never duplicated
      if (action.type === 'request') {
        const hits = LC.resolveRequest(LC.buildIndex(cat), action.label);
        if (hits.length) action = { type: 'test', id: hits[0].investigationId };
      }
      const prop = SC.orphanToProposal(it.u, action);
      return prop ? SC.fillsFromProposals(cat, [prop]).fills : null;
    });
  }
  const reqs = a.unknownRequests.filter((r) => sc.reqChecked.has(LC.norm(r.label))).map((r) => r.label);
  apply(`${plural(reqs.length, 'request')} as new tests`, (cat) => {
    const idx = LC.buildIndex(cat);
    const fresh = reqs.filter((r) => !createdFromItems.has(LC.norm(r)) && !LC.resolveRequest(idx, r).length);
    return fresh.length ? SC.fillsForRequests(fresh) : null;
  });
  sc.lastApply = { done, failed };
  sc.analysis = null;
  sc.items = [];
  sc.phase = 'idle';
  if (done.length) {
    try {
      await save(
        overlay,
        `Added ${done.length} match${done.length === 1 ? '' : 'es'} — awaiting review. Read again to fill in anything new.`
      );
      return;
    } catch (e) {
      sc.lastApply.failed.push({ title: 'Saving', reason: cleanMsg(e) });
    }
  }
  render();
}

function applyResultEl() {
  const r = S.scan.lastApply;
  if (!r || (!r.done.length && !r.failed.length)) return null;
  return h(
    'div',
    { class: 'inv-apply', role: 'status' },
    h('div', { class: 'inv-apply-title', text: 'What was just added' }),
    r.done.map((d) => h('div', { class: 'inv-apply-ok', text: `✓ ${d.title} — ${d.added}` })),
    r.failed.map((d) =>
      h('div', { class: 'inv-error inv-apply-bad', text: `✗ ${d.title} — could not be added: ${d.reason}` })
    )
  );
}

function basisText(u) {
  return (
    {
      recognised: 'recognised from its results',
      sole: 'the only test on the card that lacks a lab heading',
      consistent: 'consistent across reports',
      ambiguous: 'could be more than one test',
    }[u.basis] || ''
  );
}

// One lab group, draggable. Groups the scan could link with evidence arrive matched and ticked; a hint or a suggestion
// is only pre-SELECTED, never ticked.
function groupItem(it, unknownRequests) {
  const u = it.u;
  const tick = h('input', { type: 'checkbox', checked: it.checked && !!it.choice, 'aria-label': 'Add ' + u.heading });
  tick.disabled = !it.choice;
  tick.addEventListener('change', () => (it.checked = tick.checked));
  const seen = new Set();
  const opts = (list, mk) => list.filter((x) => (seen.has(x.k) ? false : (seen.add(x.k), true))).map(mk);
  const suggested = (u.candidates || []).map((id) => ({ k: 'test:' + id, id }));
  const reqOpts = opts(
    [
      ...(u.maybe || []).map((l) => ({ k: 'req:' + LC.norm(l), label: l, star: true })),
      ...unknownRequests
        .filter((r) => !r.kind || r.kind === u.kind || u.kind === 'other')
        .map((r) => ({ k: 'req:' + LC.norm(r.label), label: r.label })),
    ],
    (r) =>
      h('option', { value: 'req:' + r.label, selected: it.choice === 'req:' + r.label }, (r.star ? '★ ' : '') + r.label)
  );
  const nameOf = (id) => (S.merged.investigations.find((i) => i.id === id) || { label: id }).label;
  const suggestedOpts = opts(suggested, (t) =>
    h('option', { value: 'test:' + t.id, selected: it.choice === 'test:' + t.id }, nameOf(t.id))
  );
  const testOpts = opts(
    S.merged.investigations
      .filter((i) => i.kind === u.kind || i.kind === 'other')
      .sort((x, y) => x.label.localeCompare(y.label))
      .map((i) => ({ k: 'test:' + i.id, id: i.id })),
    (t) => h('option', { value: 'test:' + t.id, selected: it.choice === 'test:' + t.id }, nameOf(t.id))
  );
  const multiBox = u.multi
    ? h(
        'div',
        { class: 'inv-multi' },
        h('div', {
          class: 'inv-scan-meta',
          text: 'This group is the same for all of these tests, so it cannot say which was done. Tick every test it answers — a report is then only ever flagged "possibly resulted — confirm" against them, never auto-ticked, when more than one is requested.',
        }),
        (u.candidates || []).map((id) => {
          const cb = h('input', { type: 'checkbox', checked: !!(it.tests && it.tests.has(id)) });
          cb.addEventListener('change', () => {
            if (!it.tests) it.tests = new Set();
            if (cb.checked) it.tests.add(id);
            else it.tests.delete(id);
            if (!it.tests.size) it.checked = false;
            tick.disabled = !it.tests.size;
          });
          return h('label', { class: 'inv-multi-item' }, cb, ' ', nameOf(id));
        })
      )
    : null;
  if (u.multi) tick.disabled = !(it.tests && it.tests.size);
  const sel = h(
    'select',
    { class: 'lf-input inv-sel-sm inv-scan-choice', 'aria-label': 'What is ' + u.heading },
    h('option', { value: '' }, '— drag onto a request, or choose here —'),
    suggestedOpts.length ? h('optgroup', { label: 'Suggested' }, suggestedOpts) : null,
    reqOpts.length
      ? h('optgroup', { label: 'New test from an unrecognised request (★ = on the same card)' }, reqOpts)
      : null,
    testOpts.length ? h('optgroup', { label: 'Add to a test' }, testOpts) : null,
    h(
      'option',
      { value: 'group', selected: it.choice === 'group' },
      'Keep as a group-and-results test (no request yet)'
    )
  );
  sel.addEventListener('change', () => {
    it.choice = sel.value;
    if (!it.choice) it.checked = false;
    drawBoard();
  });
  const results = u.results.slice(0, 6).map((r) =>
    h('span', {
      class: 'inv-scan-res' + (r.code ? '' : ' inv-scan-nocode'),
      text: [r.name, r.code || 'no code', r.unit].filter(Boolean).join(' · '),
    })
  );
  if (u.results.length > 6) results.push(h('span', { class: 'lf-muted', text: `+${u.results.length - 6} more` }));
  const why = [
    `seen in ${plural(u.reports, 'report')}`,
    kindLabel(u.kind || 'other'),
    basisText(u),
    u.conflict ? 'the cards disagree about which test it is' : '',
    !u.basis && u.maybe && u.maybe.length ? `the card also lists: ${u.maybe.join(', ')}` : '',
    !u.basis && (!u.maybe || !u.maybe.length) ? 'no likely request found on the card' : '',
    u.headingKnown ? 'heading already known: adding results/codes only' : '',
  ].filter(Boolean);
  const row = h(
    'div',
    {
      class: 'inv-scan-row inv-orphan' + (it.choice ? ' inv-orphan-matched' : ''),
      draggable: 'true',
      title: 'Drag onto a request on the left to match them',
    },
    h(
      'div',
      { class: 'inv-scan-head' },
      tick,
      h('span', { class: 'inv-drag-grip', 'aria-hidden': 'true', text: '⠿' }),
      h('span', { class: 'inv-scan-heading', text: `“${u.heading}”` }),
      h('span', { class: 'lf-muted', text: `${u.lab.name}${u.lab.isNew ? ' (new lab)' : ''}` })
    ),
    h('div', { class: 'inv-scan-meta', text: why.join(' · ') }),
    u.recognisedFor && u.recognisedFor.length
      ? h('div', {
          class: 'inv-scan-meta inv-scan-warn',
          text:
            'Already recognised for several tests, so choose which one gets what is missing: ' +
            u.recognisedFor
              .map((r) => {
                const bits = [
                  r.headings ? plural(r.headings, 'heading') : '',
                  r.results ? plural(r.results, 'result') : '',
                  r.members ? plural(r.members, 'linked result') : '',
                ].filter(Boolean);
                return `${(S.merged.investigations.find((i) => i.id === r.id) || { label: r.id }).label} (missing: ${bits.join(', ') || 'nothing'})`;
              })
              .join('; '),
        })
      : null,
    u.why && u.why.length
      ? h('div', { class: 'inv-scan-meta inv-scan-warn', text: 'Why it is not recognised: ' + u.why.join('; ') + '.' })
      : null,
    u.unknownOnCard && u.unknownOnCard.length
      ? h('div', {
          class: 'inv-scan-meta inv-scan-warn',
          text: `The card also has a request the catalogue does not recognise (${u.unknownOnCard.join(', ')}) — this group may belong to that instead.`,
        })
      : null,
    h('div', { class: 'inv-scan-results' }, results),
    it.choice === 'tests' && multiBox ? multiBox : null,
    h('div', { class: 'inv-orphan-pick' }, sel)
  );
  row.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', u.key);
    e.dataTransfer.effectAllowed = 'move';
    row.classList.add('inv-dragging');
  });
  row.addEventListener('dragend', () => row.classList.remove('inv-dragging'));
  return row;
}

function importNotesEl(n) {
  const groups = {};
  for (const x of n.review) (groups[x.type] = groups[x.type] || []).push(x);
  const labels = {
    merged: 'Merged duplicates',
    repaired: 'Repaired',
    extends: 'Extend built-in tests',
    review: 'Please check',
    overlap: 'Look-alikes kept separate',
    'not-merged': 'Look-alikes kept separate',
    skipped: 'Skipped',
    unchanged: 'Nothing to add',
    disabled: 'Disabled built-ins',
  };
  const restore = n.dismissed
    ? h(
        'div',
        { class: 'inv-scan-meta' },
        `${plural(n.dismissed, 'test')} you deleted earlier ${n.dismissed === 1 ? 'was' : 'were'} not added back. `,
        btn(
          'Bring them back',
          () => save(OV.restoreDismissed(S.overlay), 'Deleted tests will be added back the next time you read.'),
          'lf-btn-sm'
        )
      )
    : null;
  const details = h(
    'details',
    { class: 'inv-details' },
    h(
      'summary',
      {},
      n.read
        ? `Your Outstanding Requests tests: ${plural(n.read, 'test')} read — ${n.added ? plural(n.added, 'entry', 'entries') + ' added, awaiting review' : 'nothing new to add'}`
        : 'No Outstanding Requests tests to read'
    ),
    Object.keys(groups).map((k) =>
      h(
        'details',
        { class: 'inv-details', open: k === 'review' || k === 'merged' },
        h('summary', {}, `${labels[k] || k} (${groups[k].length})`),
        h(
          'ul',
          {},
          groups[k].map((x) => h('li', { text: x.message }))
        )
      )
    )
  );
  return h('div', {}, details, restore);
}

function renderMatch() {
  const sc = S.scan;
  if (sc.lab === null) {
    const c = S.overlay.context.labs;
    sc.lab = c.length ? c[0] : S.merged.labs.length === 1 ? S.merged.labs[0].id : '';
  }
  const gaps = SC.findGaps(S.merged, S.overlay.context);
  const busy = sc.phase === 'importing' || sc.phase === 'reading';
  const card = h('div', { class: 'lf-card inv-card inv-match' });
  card.appendChild(h('div', { class: 'lf-card-name', text: 'Match requests to lab reports' }));
  card.appendChild(
    h('p', {
      class: 'lf-help',
      text:
        'One button reads your Outstanding Requests tests (how tests are requested in Medicus) and then the reports waiting in Investigation Results (how the lab sends them back, read-only). ' +
        'Only test names, headings, codes and units are kept — no values, patient or staff details. Nothing is added unless you tick it, and everything added arrives awaiting review.',
    })
  );
  const labSel = h(
    'select',
    { class: 'lf-input inv-sel-sm', 'aria-label': 'Lab your test names come from' },
    h('option', { value: '' }, 'test names: not lab-specific'),
    S.merged.labs.map((l) => h('option', { value: l.id, selected: sc.lab === l.id }, 'test names from ' + labLabel(l)))
  );
  labSel.addEventListener('change', () => (sc.lab = labSel.value));
  const lim = h('input', {
    class: 'lf-input inv-limit',
    type: 'number',
    min: '10',
    max: '300',
    value: String(sc.limit),
    'aria-label': 'Reports to read',
  });
  lim.addEventListener(
    'change',
    () => (sc.limit = Math.max(10, Math.min(300, parseInt(lim.value, 10) || SCAN_DEFAULT_LIMIT)))
  );
  const go = btn(sc.ran ? 'Read again' : 'Read my tests and the results queue', runMatch, 'lf-btn-primary');
  go.disabled = busy;
  card.appendChild(
    h(
      'div',
      { class: 'inv-scan-go' },
      go,
      busy
        ? btn(
            'Stop',
            () => {
              sc.stop = true;
            },
            'lf-btn-sm'
          )
        : null,
      h('label', { class: 'lf-check' }, 'Reports to read ', lim),
      labSel,
      h('span', {
        class: 'lf-muted',
        id: 'invScanProgress',
        text: sc.phase === 'importing' ? 'Reading your tests…' : sc.phase === 'reading' ? 'Reading reports…' : '',
      })
    )
  );
  card.appendChild(
    h('div', {
      class: 'lf-muted inv-match-status',
      text: `${plural(gaps.length, 'test')} still lack${gaps.length === 1 ? 's' : ''} a lab heading or result codes.`,
    })
  );
  if (S.problems.length)
    card.appendChild(
      h('div', {
        class: 'inv-error',
        text: `${plural(S.problems.length, 'catalogue entry', 'catalogue entries')} could not be used (see "catalogue problems" at the bottom of this page) — anything that depends on them will not appear.`,
      })
    );
  if (sc.phase === 'error') card.appendChild(h('div', { class: 'inv-error', role: 'alert', text: sc.error }));
  if (sc.importNotes) card.appendChild(importNotesEl(sc.importNotes));
  if (sc.read) {
    card.appendChild(
      h('div', {
        class: 'lf-v',
        text:
          `Read ${plural(sc.read.reports, 'report')}` +
          (sc.read.queueSize > sc.read.reports + sc.read.failed ? ` of ${sc.read.queueSize} waiting` : '') +
          (sc.read.failed ? `, ${sc.read.failed} could not be read` : '') +
          (sc.read.stopped ? ' (stopped early)' : '') +
          (sc.analysis
            ? ` · ${plural(sc.analysis.stats.groups, 'group')} seen, ${sc.analysis.stats.explained} already recognised.`
            : ''),
      })
    );
  }

  card.appendChild(
    h('p', {
      class: 'lf-help',
      text: 'Drag a lab group (right) onto a request (left) to match them — or choose in its dropdown. Tick a request on the left to create a test for its wording alone. Matches with evidence arrive ticked; a hint is only pre-selected.',
    })
  );
  card.appendChild(renderBoard());
  const applied = applyResultEl();
  if (applied) card.appendChild(applied);

  if (sc.analysis) {
    card.appendChild(
      h(
        'div',
        { class: 'lf-card-actions' },
        btn('Add the ticked matches (awaiting review)', applyTicked, 'lf-btn-primary'),
        btn(
          'Discard',
          () => {
            sc.analysis = null;
            sc.items = [];
            sc.phase = 'idle';
            render();
          },
          'lf-btn-sm'
        )
      )
    );
  }
  return card;
}

function renderProblems() {
  if (!S.problems.length) return null;
  const canRemove = (x) =>
    x.id && ['results', 'investigations', 'labs'].includes(x.kind) && !/\(ignored\)$/.test(x.reason);
  return h(
    'details',
    { class: 'inv-details inv-problems', open: true },
    h('summary', {}, `${plural(S.problems.length, 'catalogue problem')} — these entries are ignored until fixed`),
    h(
      'ul',
      {},
      S.problems.slice(0, 50).map((x) =>
        h(
          'li',
          {},
          `${x.kind || ''} ${x.id || ''}: ${x.reason} `,
          canRemove(x)
            ? btn(
                'Remove this entry',
                async () => {
                  if (
                    !confirm(
                      `Remove the ${x.kind.replace(/s$/, '')} "${x.id}" from the catalogue? It is not being used, and this cannot be undone.`
                    )
                  )
                    return;
                  try {
                    await save(OV.removeEntry(S.overlay, x.kind, x.id), `Removed "${x.id}".`);
                  } catch (e) {
                    S.error = ((e && e.message) || String(e)).replace(/^labcatalogue.practice: /, '');
                    render();
                  }
                },
                'lf-btn-danger lf-btn-sm'
              )
            : null
        )
      )
    )
  );
}

function render() {
  if (!root) return;
  root.textContent = '';
  if (!LC || !OV || !IMP || typeof labcatalogueLoadEffective !== 'function') {
    root.appendChild(h('div', { class: 'lf-empty', text: 'Lab catalogue helpers failed to load. Reload this page.' }));
    return;
  }
  if (!S.loaded) {
    root.appendChild(h('div', { class: 'lf-empty', text: 'Loading…' }));
    return;
  }
  if (S.error && !S.merged) {
    root.appendChild(h('div', { class: 'lf-empty', text: 'The lab catalogue could not be loaded: ' + S.error }));
    return;
  }
  const wrap = h('div', { class: 'lf-module' });
  if (S.error) wrap.appendChild(h('div', { class: 'lf-notice' }, h('p', { text: S.error })));
  if (S.toast) wrap.appendChild(h('div', { class: 'lf-toast lf-toast-show', role: 'status', text: S.toast }));
  wrap.appendChild(renderBanner());
  wrap.appendChild(renderContext());
  if (SC) wrap.appendChild(renderMatch());
  const browse = renderBrowse();
  wrap.appendChild(browse);
  wrap.appendChild(renderLabs());
  const pr = renderProblems();
  if (pr) wrap.appendChild(pr);
  root.appendChild(wrap);
  renderList();
}

async function init(container) {
  root = container;
  render();
  await load();
}

const _mount = typeof document !== 'undefined' ? document.getElementById('invMount') : null;
if (_mount) init(_mount);
