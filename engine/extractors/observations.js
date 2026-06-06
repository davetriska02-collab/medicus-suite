// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Sentinel — Observations Extractor
// Reads observation values (BP, weight, HbA1c, ...) from the patient view.
// Multi-strategy: DL/dt/dd pairs (Medicus standard), then generic row walker.

(function(global) {
  'use strict';

  const MONTHS = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };

  function parseMedicusDate(s) {
    if (!s) return null;
    const m = String(s).match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/i);
    if (!m) return null;
    const mo = MONTHS[m[2].toLowerCase()];
    if (!mo) return null;
    return `${m[3]}-${mo}-${m[1].padStart(2, '0')}`;
  }

  function findHeadingByText(doc, text) {
    const headings = doc.querySelectorAll('h1, h2, h3, h4, h5, h6');
    const target = text.toLowerCase().trim();
    for (const h of headings) {
      if ((h.textContent || '').trim().toLowerCase() === target) return h;
    }
    return null;
  }

  // Find all <dl> elements in the section bounded by this heading and the next
  // heading at same-or-higher level.
  function findDlsInSection(doc, sectionHeading) {
    if (!sectionHeading) return [];
    const startLevel = parseInt(sectionHeading.tagName[1], 10) || 6;
    const walker = doc.createTreeWalker(doc.body, 1);
    walker.currentNode = sectionHeading;
    const dls = [];
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (/^H[1-6]$/.test(n.tagName)) {
        const level = parseInt(n.tagName[1], 10) || 6;
        if (level <= startLevel) break;
        continue;
      }
      if (n.tagName === 'DL') dls.push(n);
    }
    return dls;
  }

  // Parse a <dd> element containing a value and a date.
  function parseDdValue(ddEl) {
    if (!ddEl) return null;
    let dateRaw = null;
    let valueText = null;

    // Strategy 1: dedicated date element
    const dateSelector = '.item__date, time, [class*="date" i]:not([class*="header"]):not([class*="title"])';
    const dateEl = ddEl.querySelector(dateSelector);
    if (dateEl) {
      // Prefer ISO from <time datetime> if present
      const timeEl = ddEl.querySelector('time[datetime]');
      if (timeEl) {
        const dt = timeEl.getAttribute('datetime');
        if (dt && /^\d{4}-\d{2}-\d{2}/.test(dt)) {
          const clone = ddEl.cloneNode(true);
          const dc = clone.querySelector(dateSelector);
          if (dc) dc.remove();
          return { date: dt.slice(0, 10), value: (clone.textContent || '').trim() || null };
        }
      }
      dateRaw = (dateEl.textContent || '').trim();
      const clone = ddEl.cloneNode(true);
      const dc = clone.querySelector(dateSelector);
      if (dc) dc.remove();
      valueText = (clone.textContent || '').trim();
    } else {
      const full = (ddEl.textContent || '').trim();
      const m = full.match(/^(.+?)\s*(?:Measured on\s*)?(\d{1,2}\s+[A-Za-z]{3,}\s+\d{4})\s*$/);
      if (!m) return null;
      valueText = m[1].trim();
      dateRaw = m[2];
    }

    const cleaned = dateRaw.replace(/^Measured on\s*/i, '').trim();
    const dateMatch = cleaned.match(/(\d{1,2}\s+[A-Za-z]{3,}\s+\d{4})/);
    if (!dateMatch) return null;
    const dateIso = parseMedicusDate(dateMatch[1]);
    if (!dateIso) return null;

    return { date: dateIso, value: valueText || null };
  }

  // Generic row finder for non-DL layouts. Walk down to find date leaves,
  // then walk UP to find smallest container with both date + non-date letters.
  function findObservationRows(doc, sectionHeading) {
    if (!sectionHeading) return [];
    const startLevel = parseInt(sectionHeading.tagName[1], 10) || 6;
    const datePattern = /\d{1,2}\s+[A-Za-z]{3,}\s+\d{4}/;
    const MAX_ROW_TEXT = 250;

    const walker = doc.createTreeWalker(doc.body, 1);
    walker.currentNode = sectionHeading;
    const dateContainers = [];
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (/^H[1-6]$/.test(n.tagName)) {
        const level = parseInt(n.tagName[1], 10) || 6;
        if (level <= startLevel) break;
        continue;
      }
      const txt = (n.textContent || '').trim();
      if (!datePattern.test(txt)) continue;
      dateContainers.push(n);
    }
    const dateLeaves = dateContainers.filter(d =>
      !dateContainers.some(o => o !== d && d.contains(o))
    );
    const rows = new Set();
    dateLeaves.forEach(leaf => {
      let el = leaf;
      while (el && el !== doc.body) {
        const txt = (el.textContent || '').trim();
        if (txt.length > MAX_ROW_TEXT) break;
        const withoutDate = txt
          .replace(/\d{1,2}\s+[A-Za-z]{3,}\s+\d{4}/g, '')
          .replace(/measured on/gi, '')
          .trim();
        if (/[A-Za-z]{2,}/.test(withoutDate)) {
          rows.add(el);
          break;
        }
        el = el.parentElement;
      }
    });
    return Array.from(rows);
  }

  function parseObservationRow(rowEl) {
    let dateRaw = null;
    let beforeText = null;
    const dateSelector = '.item__date, [class*="date" i]:not([class*="header"]):not([class*="title"])';
    const dateEl = rowEl.querySelector(dateSelector);
    if (dateEl) {
      dateRaw = (dateEl.textContent || '').trim();
      const clone = rowEl.cloneNode(true);
      const dc = clone.querySelector(dateSelector);
      if (dc) dc.remove();
      beforeText = (clone.textContent || '').trim();
    } else {
      const fullText = (rowEl.textContent || '').trim();
      const m = fullText.match(/^(.+?)\s*(?:Measured on\s*)?(\d{1,2}\s+[A-Za-z]{3,}\s+\d{4})\s*$/);
      if (!m) return null;
      beforeText = m[1].trim();
      dateRaw = m[2];
    }
    const cleaned = dateRaw.replace(/^Measured on\s*/i, '').trim();
    const dateMatch = cleaned.match(/(\d{1,2}\s+[A-Za-z]{3,}\s+\d{4})/);
    if (!dateMatch) return null;
    const dateIso = parseMedicusDate(dateMatch[1]);
    if (!dateIso) return null;

    const nvMatch = beforeText.match(/^([A-Za-z][A-Za-z\s&\-]*?)(\d.*)?$/);
    const name = nvMatch ? nvMatch[1].trim() : beforeText;
    const value = (nvMatch && nvMatch[2]) ? nvMatch[2].trim() : null;
    if (!name) return null;
    return { name, date: dateIso, value };
  }

  // Heading variants to try, across views
  const OBS_HEADINGS = [
    'Key Observations',
    'Observations',
    'Recent Results (last 3 Months)',
    'Recent Results',
    'Investigation Results'
  ];

  function extract(doc) {
    doc = doc || (typeof document !== 'undefined' ? document : null);
    if (!doc) return { observations: [], parseFailures: [] };

    const observations = [];
    const parseFailures = [];
    const seen = new Set();

    OBS_HEADINGS.forEach(label => {
      const heading = findHeadingByText(doc, label);
      if (!heading) return;

      // Strategy A: definition list
      const dls = findDlsInSection(doc, heading);
      let extractedFromDl = 0;
      dls.forEach(dl => {
        let currentName = null;
        Array.from(dl.children).forEach(child => {
          if (child.tagName === 'DT') {
            currentName = (child.textContent || '').trim();
          } else if (child.tagName === 'DD' && currentName) {
            const parsed = parseDdValue(child);
            if (parsed) {
              const key = `${currentName}|${parsed.date}`;
              if (!seen.has(key)) {
                seen.add(key);
                observations.push({
                  name: currentName,
                  code: null,
                  date: parsed.date,
                  value: parsed.value,
                  source: `${label} (dl)`
                });
                extractedFromDl++;
              }
            }
            currentName = null;
          }
        });
      });

      // Strategy B: generic walker (only if no DL hits)
      if (extractedFromDl === 0) {
        const rows = findObservationRows(doc, heading);
        rows.forEach(el => {
          const parsed = parseObservationRow(el);
          if (!parsed) {
            const txt = (el.textContent || '').trim();
            if (txt.length < 200) parseFailures.push({ section: label, text: txt.slice(0, 120) });
            return;
          }
          const key = `${parsed.name}|${parsed.date}`;
          if (seen.has(key)) return;
          seen.add(key);
          observations.push({ ...parsed, code: null, source: label });
        });
      }
    });

    return { observations, parseFailures };
  }

  const api = { extract, findHeadingByText, parseMedicusDate, findDlsInSection, parseDdValue, findObservationRows, parseObservationRow };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.SentinelObservations = api;
  }
})(typeof window !== 'undefined' ? window : global);
