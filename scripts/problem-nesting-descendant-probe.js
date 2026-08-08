// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — descendant-search diagnostic probe
//
// PURPOSE: problem-nesting.js's suggestion builder (buildNestingSuggestions)
// relies on a two-step live SNOMED descendant-search query
// (constrainingParentConcepts + query=<conceptId>) to decide whether one
// on-record problem is a genuine descendant of another. A real live miss was
// found 2026-08-08: 53889007 "Nuclear cataract" wasn't suggested as a child
// of 193570009 "Cataract" despite Nick confirming it genuinely sits under
// that hierarchy. This script tests candidate root causes directly against
// Medicus's own API, rather than guessing:
//   1. Is the coded "Cataract" problem on THIS record actually 193570009,
//      or a different/synonym concept? (a wrong assumption here would
//      explain everything downstream, trivially)
//   2. Does the ISOLATED pair query (just the two concepts, nothing else)
//      find nuclear cataract under cataract at all?
//   3. Does the SAME query, run with the FULL comma-joined list of every
//      OTHER active concept on the record — exactly replicating what
//      runScan's own "combined" step builds — still find it? If (2)
//      succeeds but (3) fails, that isolates the bug to something about a
//      long constrainingParentConcepts list, and step 4 bisects the list
//      length to find roughly where it breaks.
//
// USAGE
//   1. Open the patient's Clinical Summary (care-record or task/split page)
//      where both concepts are coded active problems. DevTools → Console
//      (the page's own console, not the extension's).
//   2. Paste this whole file, press Enter — runs once immediately for the
//      nuclear-cataract/cataract pair.
//   3. To check a DIFFERENT suspected pair later (per the override rules
//      file's own note: "worth a probe if this keeps happening for other
//      genuinely-SNOMED pairs"), call
//      chDescendantProbe('<childConceptId>', '<parentConceptId>') again —
//      no need to re-paste the file, it stays defined on window.
//
// PATIENT DATA: read-only GETs, the same ones the shipped scan already
// makes. Concept ids/descriptions print to your own local console only —
// nothing is sent anywhere or saved to disk unless you do that yourself.
(function () {
  'use strict';

  var CARE_RECORD_RE = /\/([0-9a-f]{4,})\/(?:patient\/patient\/care-record|care-record)\/([0-9a-f-]{36})/i;
  var TASK_OVERVIEW_RE =
    /\/([0-9a-f]{4,})\/tasks\/data\/([^/]+)\/overview\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

  function apiBase() {
    var parts = location.pathname.split('/').filter(Boolean);
    return 'https://' + (parts[0] || '') + '.api.' + location.hostname;
  }
  function apiGet(path) {
    return fetch(apiBase() + path, {
      credentials: 'include',
      headers: { Accept: 'application/json, text/plain, */*' },
    }).then(function (r) {
      if (!r.ok) throw new Error('API ' + r.status + ' for ' + path);
      return r.json();
    });
  }

  async function resolvePatientId() {
    var m = location.pathname.match(CARE_RECORD_RE);
    if (m) return m[2];
    m = location.pathname.match(TASK_OVERVIEW_RE);
    if (!m) return null;
    var data = await apiGet('/tasks/data/' + m[2] + '/overview/' + m[3]);
    var d = (data && data.data) || data || {};
    return (d.patient && d.patient.id) || d.patientId || null;
  }

  function searchDescendants(conceptId, rootsCsv) {
    var path =
      '/clinical/gb/snomed/search/description/constrained?constrainingParentConcepts=' +
      encodeURIComponent(rootsCsv) +
      '&query=' +
      encodeURIComponent(conceptId);
    return apiGet(path).then(function (data) {
      return (data && data.results) || [];
    });
  }
  function resultsContain(results, conceptId) {
    return (results || []).some(function (r) {
      var v = (r && r.value) || r;
      return !!(v && v.conceptId === conceptId);
    });
  }
  function shortRows(results) {
    return (results || []).slice(0, 10).map(function (r) {
      var v = (r && r.value) || r;
      return { description: v && v.description, conceptId: v && v.conceptId };
    });
  }

  async function chDescendantProbe(childConceptId, parentConceptId) {
    childConceptId = String(childConceptId || '53889007'); // Nuclear cataract
    parentConceptId = String(parentConceptId || '193570009'); // Cataract
    console.log('[descendant-probe] testing child ' + childConceptId + ' against candidate parent ' + parentConceptId);

    console.log('[descendant-probe] resolving patient…');
    var patientId = await resolvePatientId();
    if (!patientId) {
      console.error(
        '[descendant-probe] could not resolve a patientId from this page — open the Clinical Summary (care-record or task/split page) first.'
      );
      return;
    }
    console.log('[descendant-probe] patientId:', patientId);

    var summary = await apiGet('/clinical/data/clinical-summary/summary/' + encodeURIComponent(patientId));
    var problems = (summary && summary.problems) || [];
    console.log('[descendant-probe] ' + problems.length + ' active problems on this record');

    var overviews = await Promise.all(
      problems.map(function (p) {
        return apiGet('/clinical/data/problem/slideover/overview/' + encodeURIComponent(p.id)).catch(function () {
          return null;
        });
      })
    );

    var conceptById = {};
    problems.forEach(function (p, i) {
      var ov = overviews[i];
      var code = ov && ov.problemCode;
      var conceptId = code && code.conceptId != null ? String(code.conceptId) : null;
      if (conceptId) conceptById[p.id] = { conceptId: conceptId, description: p.problemCodeDescription };
    });

    var distinctConcepts = Array.from(
      new Set(
        Object.keys(conceptById).map(function (id) {
          return conceptById[id].conceptId;
        })
      )
    );

    console.log('[descendant-probe] every on-record problem whose description contains "cataract":');
    console.table(
      Object.keys(conceptById)
        .map(function (id) {
          return conceptById[id];
        })
        .filter(function (c) {
          return /cataract/i.test(c.description);
        })
    );

    var hasParentOnRecord = distinctConcepts.indexOf(parentConceptId) !== -1;
    var hasChildOnRecord = distinctConcepts.indexOf(childConceptId) !== -1;
    console.log(
      '[descendant-probe] is ' + parentConceptId + " (assumed parent) actually this record's own coded concept?",
      hasParentOnRecord
    );
    console.log(
      '[descendant-probe] is ' + childConceptId + " (assumed child) actually this record's own coded concept?",
      hasChildOnRecord
    );
    if (!hasParentOnRecord || !hasChildOnRecord) {
      console.warn(
        '[descendant-probe] at least one concept id is NOT on this record as assumed — the record may use a different/synonym code. Check the table above before trusting the rest of this report.'
      );
    }

    console.log(
      '[descendant-probe] --- Test 1: ISOLATED pair query (constrainingParentConcepts = just the parent) ---'
    );
    var isolatedResults = await searchDescendants(childConceptId, parentConceptId).catch(function (e) {
      console.error('[descendant-probe] isolated query failed:', e.message);
      return [];
    });
    var isolatedHit = resultsContain(isolatedResults, childConceptId);
    console.log(
      '[descendant-probe] isolated query result count:',
      isolatedResults.length,
      '— found child?',
      isolatedHit
    );
    console.table(shortRows(isolatedResults));

    var otherConcepts = distinctConcepts.filter(function (c) {
      return c !== childConceptId;
    });
    console.log(
      '[descendant-probe] --- Test 2: COMBINED query, exactly replicating runScan (constrainingParentConcepts = all ' +
        otherConcepts.length +
        ' other on-record concepts joined) ---'
    );
    var combinedResults = await searchDescendants(childConceptId, otherConcepts.join(',')).catch(function (e) {
      console.error('[descendant-probe] combined query failed:', e.message);
      return [];
    });
    var combinedHit = resultsContain(combinedResults, childConceptId);
    console.log(
      '[descendant-probe] combined query result count:',
      combinedResults.length,
      '— found child?',
      combinedHit
    );

    if (isolatedHit && !combinedHit && otherConcepts.length > 1) {
      console.log(
        '[descendant-probe] --- Test 3: isolated succeeded, combined failed — bisecting list length to find the break point ---'
      );
      var sizesToTry = Array.from(new Set([1, 5, 10, 20, Math.floor(otherConcepts.length / 2), otherConcepts.length]))
        .filter(function (n) {
          return n > 0 && n <= otherConcepts.length;
        })
        .sort(function (a, b) {
          return a - b;
        });
      for (var i = 0; i < sizesToTry.length; i++) {
        var n = sizesToTry[i];
        var subset = otherConcepts.slice(0, n);
        // The real parent must actually be IN this subset or the test proves nothing.
        if (subset.indexOf(parentConceptId) === -1) subset = [parentConceptId].concat(subset.slice(0, n - 1));
        var res = await searchDescendants(childConceptId, subset.join(',')).catch(function () {
          return [];
        });
        console.log(
          '[descendant-probe] list length ' + subset.length + ': found?',
          resultsContain(res, childConceptId)
        );
      }
    }

    console.log('[descendant-probe] DONE — summary:');
    console.log('  Parent concept (' + parentConceptId + ') on this record:', hasParentOnRecord);
    console.log('  Child concept (' + childConceptId + ') on this record:', hasChildOnRecord);
    console.log('  Isolated pair query finds it:', isolatedHit);
    console.log('  Full combined query (as runScan actually builds it) finds it:', combinedHit);
    if (isolatedHit && !combinedHit) {
      console.warn(
        '[descendant-probe] CONFIRMED: the isolated pair works but the full-list combined query does not — this is a real bug in how the long constrainingParentConcepts list behaves, not a SNOMED-modelling gap. See Test 3 above for roughly where it breaks.'
      );
    } else if (!isolatedHit) {
      console.warn(
        "[descendant-probe] the ISOLATED pair query itself does not find it — not a list-length issue. Either the assumed concept id is wrong (see the record-membership check above) or Medicus's own index genuinely does not have this edge for this pair."
      );
    } else {
      console.log(
        '[descendant-probe] both queries found it — this specific pair is NOT currently reproducing the miss.'
      );
    }
  }

  window.chDescendantProbe = chDescendantProbe;
  chDescendantProbe();
})();
