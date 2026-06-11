// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Sentinel — Medications Extractor
// Multi-view, multi-pattern medication extraction.
// Heading variants and DOM patterns differ across Medicus views.

(function(global) {
  'use strict';

  const DOSE_PATTERN = /\d+\s*(mg|mcg|microgram|microgrammes?|g|ml|units?|iu|%|\/dose|\/spray|\/puff)/i;

  const MED_HEADINGS = [
    // Prescription request task overview
    'Current Repeat Medications',
    'Acute Prescriptions (Last 12 months)',
    'Acute Prescriptions',
    // Care record / medication tab
    'Repeat Medications',
    'Acute Medications',
    'Medications Prescribed Elsewhere',
    'Over-the-Counter Medications',
    'Over-the-Counter Medication'
  ];

  function findHeadingByText(doc, text) {
    const headings = doc.querySelectorAll('h1, h2, h3, h4, h5, h6');
    const target = text.toLowerCase().trim();
    for (const h of headings) {
      if ((h.textContent || '').trim().toLowerCase() === target) return h;
    }
    return null;
  }

  // Walk forward from heading, returning elements matching selector until next
  // heading at same-or-higher level.
  function elementsAfterHeading(doc, heading, selector) {
    if (!heading) return [];
    const startLevel = parseInt(heading.tagName[1], 10) || 6;
    const walker = doc.createTreeWalker(doc.body, 1);
    walker.currentNode = heading;
    const results = [];
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (/^H[1-6]$/.test(n.tagName)) {
        const level = parseInt(n.tagName[1], 10) || 6;
        if (level <= startLevel) break;
        continue;
      }
      if (n.matches && n.matches(selector)) results.push(n);
    }
    return results;
  }

  // Extract medications from one section, trying strategies in priority order.
  function extractFromSection(doc, heading, sourceLabel) {
    const meds = [];
    if (!heading) return meds;

    // Strategy 1: care-record style li.m-list-item with nested .m-list-item--content
    const listItems = elementsAfterHeading(doc, heading, '.m-list-item, li.m-list-item');
    listItems.forEach(li => {
      const content = li.querySelector('.m-list-item--content') || li;
      const spans = content.querySelectorAll('span');
      let drugName = null;
      for (const s of spans) {
        if (s.classList.contains('secondary-text')) continue;
        const t = (s.textContent || '').trim();
        if (t && t.length < 150 && DOSE_PATTERN.test(t)) {
          drugName = t;
          break;
        }
      }
      if (drugName) meds.push({ name: drugName, startDate: null, source: sourceLabel });
    });
    if (meds.length > 0) return meds;

    // Strategy 2: prescription-overview style li.item
    const liItems = elementsAfterHeading(doc, heading, 'li.item');
    liItems.forEach(li => {
      const txt = (li.textContent || '').trim();
      if (txt && txt.length < 200 && DOSE_PATTERN.test(txt)) {
        meds.push({ name: txt, startDate: null, source: sourceLabel });
      }
    });
    if (meds.length > 0) return meds;

    // Strategy 3: generic li or dt with dose pattern
    const generic = elementsAfterHeading(doc, heading, 'li, dt');
    generic.forEach(el => {
      const txt = (el.textContent || '').trim();
      if (!txt || txt.length > 200) return;
      if (!DOSE_PATTERN.test(txt)) return;
      const firstLine = txt.split(/\n/)[0].trim();
      const useText = (firstLine && firstLine.length > 3 && DOSE_PATTERN.test(firstLine)) ? firstLine : txt;
      meds.push({ name: useText, startDate: null, source: sourceLabel });
    });
    return meds;
  }

  function extract(doc) {
    doc = doc || (typeof document !== 'undefined' ? document : null);
    if (!doc) return { medications: [] };
    const medications = [];

    MED_HEADINGS.forEach(label => {
      const heading = findHeadingByText(doc, label);
      if (!heading) return;
      const sectionMeds = extractFromSection(doc, heading, label);
      sectionMeds.forEach(m => {
        if (medications.some(existing => existing.name === m.name)) return;
        medications.push(m);
      });
    });

    return { medications };
  }

  const api = { extract, findHeadingByText, elementsAfterHeading, extractFromSection, DOSE_PATTERN, MED_HEADINGS };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.SentinelMedications = api;
  }
})(typeof window !== 'undefined' ? window : global);
