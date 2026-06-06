// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Sentinel — Active Problems Extractor
// Extracts the active problem list from the patient view.
// Used for QOF register membership detection.

(function(global) {
  'use strict';

  const MONTHS = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };

  // Common Medicus problem-list headings + variants for different views
  const PROBLEM_HEADINGS = [
    'Active Problems',
    'Active Conditions',
    'Significant Problems',
    'Problems',
    'Major',           // sub-section heading in clinical summary
    'Minor',           // sub-section heading in clinical summary
    'Major Problems',
    'Minor Problems'
  ];

  // Headings to deliberately exclude (e.g. "Past Problems")
  const EXCLUDED_HEADINGS = [
    'past problems',
    'resolved problems',
    'inactive problems'
  ];

  function findHeadingsByText(doc, candidates) {
    const headings = Array.from(doc.querySelectorAll('h1, h2, h3, h4, h5, h6'));
    const lowered = candidates.map(c => c.toLowerCase().trim());
    return headings.filter(h => {
      const t = (h.textContent || '').trim().toLowerCase();
      if (EXCLUDED_HEADINGS.includes(t)) return false;
      return lowered.includes(t);
    });
  }

  function parseDate(s) {
    if (!s) return null;
    const t = String(s).trim();
    // MMM YYYY (e.g. "Feb 2024" or "Feb 2026*")
    let m = t.match(/([A-Za-z]{3})[a-z]*\s+(\d{4})/);
    if (m) {
      const mo = MONTHS[m[1].toLowerCase()];
      if (mo) return `${m[2]}-${mo}-01`;
    }
    // DD MMM YYYY
    m = t.match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/);
    if (m) {
      const mo = MONTHS[m[2].toLowerCase()];
      if (mo) return `${m[3]}-${mo}-${m[1].padStart(2, '0')}`;
    }
    // YYYY only
    m = t.match(/^(\d{4})$/);
    if (m) return `${m[1]}-01-01`;
    return null;
  }

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

  // Extract problems from one heading's section. Multiple strategies tried.
  function extractFromSection(doc, heading, sourceLabel) {
    const out = [];
    if (!heading) return out;

    // Strategy 1: list-item style (care-record problems tab)
    const liItems = elementsAfterHeading(doc, heading, 'li.m-list-item, li.item, li');
    liItems.forEach(li => {
      // For m-list-item, take the first non-secondary span
      const content = li.querySelector('.m-list-item--content') || li;
      let label = null;
      const spans = content.querySelectorAll('span');
      for (const s of spans) {
        if (s.classList.contains('secondary-text')) continue;
        const t = (s.textContent || '').trim();
        if (t && t.length > 2 && t.length < 200) {
          label = t;
          break;
        }
      }
      // Fallback: full LI text minus dates
      if (!label) {
        const full = (li.textContent || '').trim();
        if (full && full.length > 2 && full.length < 200) {
          label = full;
        }
      }
      if (!label) return;
      // Extract date from any date-class child or trailing date pattern
      let codedDate = null;
      const dateEl = li.querySelector('.item__date, time, [class*="date" i]:not([class*="header"]):not([class*="title"])');
      if (dateEl) {
        codedDate = parseDate((dateEl.textContent || '').trim());
      }
      if (!codedDate) {
        const trailingDate = label.match(/([A-Za-z]{3}[a-z]*\s+\d{4}\*?)\s*$/);
        if (trailingDate) {
          codedDate = parseDate(trailingDate[1]);
          label = label.slice(0, label.lastIndexOf(trailingDate[0])).trim();
        }
      }
      out.push({ label: label.replace(/\*$/, '').trim(), codedDate, status: 'active', source: sourceLabel });
    });

    // Strategy 2: clinical-summary tabular style (text with date at end on each row)
    // Used when problems are shown as "Problem name ... Date" rows
    if (out.length === 0) {
      const startLevel = parseInt(heading.tagName[1], 10) || 6;
      const walker = doc.createTreeWalker(doc.body, 1);
      walker.currentNode = heading;
      const datePattern = /([A-Za-z]{3}[a-z]*\s+\d{4})\*?/;
      const candidates = [];
      while (walker.nextNode()) {
        const n = walker.currentNode;
        if (/^H[1-6]$/.test(n.tagName)) {
          const level = parseInt(n.tagName[1], 10) || 6;
          if (level <= startLevel) break;
          continue;
        }
        const txt = (n.textContent || '').trim();
        if (txt.length < 5 || txt.length > 200) continue;
        if (!datePattern.test(txt)) continue;
        candidates.push(n);
      }
      // Keep only leaf-ish elements (drop ancestors)
      const leaves = candidates.filter(c =>
        !candidates.some(o => o !== c && c.contains(o))
      );
      leaves.forEach(el => {
        const txt = (el.textContent || '').trim();
        const m = txt.match(/^(.+?)\s+([A-Za-z]{3}[a-z]*\s+\d{4})\*?\s*$/);
        if (!m) return;
        const label = m[1].trim();
        const codedDate = parseDate(m[2]);
        if (!label || label.length < 3) return;
        out.push({ label, codedDate, status: 'active', source: sourceLabel });
      });
    }

    return out;
  }

  function extract(doc) {
    doc = doc || (typeof document !== 'undefined' ? document : null);
    if (!doc) return { problems: [] };

    const problems = [];
    const seen = new Set();

    PROBLEM_HEADINGS.forEach(label => {
      const headings = findHeadingsByText(doc, [label]);
      headings.forEach(h => {
        const items = extractFromSection(doc, h, label);
        items.forEach(p => {
          const key = p.label.toLowerCase();
          if (seen.has(key)) return;
          seen.add(key);
          problems.push(p);
        });
      });
    });

    return { problems };
  }

  const api = { extract, findHeadingsByText, parseDate, extractFromSection, PROBLEM_HEADINGS };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.SentinelProblems = api;
  }
})(typeof window !== 'undefined' ? window : global);
