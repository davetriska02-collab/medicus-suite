# Research: the Medicus data surface (from the Medicus Suite codebase)

*Source: analysis of `davetriska02-collab/medicus-suite` (Chrome MV3 extension, 2026-06-10).*

## Architecture facts worth inheriting

- MV3, plain JS, no bundler; node `test-*.js` tests; side-panel modules; service worker owns polls.
- Host permissions: `https://*.medicus.health/*`, `https://*.api.england.medicus.health/*`.
- Practice code: 4–8 hex chars → API subdomain `https://{code}.api.england.medicus.health`.
- All Medicus calls are **REST with `credentials: 'include'`** (logged-in session) — API-first,
  DOM scraping is legacy fallback only. Concurrent fetches via `Promise.allSettled`.
- PHI minimisation: patient names reduced to initials before any persistence; read-only; no
  telemetry.
- XSS: every interpolated value escaped via an `esc()` helper.

## The endpoint this product is built on

```
GET {code}.api.england.medicus.health/scheduling/data/appointment-book/embedded-overview
    ?date=YYYY-MM-DD&filterByUsualLocation=false
```

Response shape (fields actually observed):

```json
{
  "staffSchedules": [
    {
      "name": "Dr Alice Smith",
      "schedule": [
        {
          "summary": { "status": { "isCancelled": false } },
          "entries": [
            {
              "diaryEntryType": { "value": "slot" | "appointment" },
              "startDateTime": "2026-06-10T09:00:00",
              "patient": { "id": "uuid", "name": "Smith, Alice" },
              "appointmentType": { "name": "GP consultation" },
              "displayStatus": { "value": "booked" | "arrived" | "cancelled" },
              "compiledReasonForAppointment": "free text",
              "deliveryMode": { "value": "face-to-face" | "remote" | "telephone" }
            }
          ]
        }
      ]
    }
  ]
}
```

Notes: clinicians are identified **by display name only** (no user UUIDs at this level) — hence
`staff.medicusName` matching in this product. Cancelled schedule blocks must be skipped.

## Other available endpoints (future features)

| Endpoint | Returns | Rota-manager use |
|---|---|---|
| `/reporting/data/activity/report?startDate&endDate` | per-clinician `rowData`: consultations, routine/non-routine Rx tasks, medicationReviews, documentTasks, investigationReportTasks | workload-aware fairness, timesheet verification |
| `/tasks/data/{taskType}/task-list?createdAt_startDate&...` | tasks by type (`medical_patient_request_task`, `admin_…`, `review_investigation_results_task`, `prescription_request_task_routine`/`_non_routine`) with `createdAt` | demand curves by hour/day for demand-driven planning |
| `/referrals/clinical-audit-report?referralStartDate&...` | referrals with `referringClinician`, priority, status | per-clinician analytics |
| Pusher WebSocket relay | `appointments-updated` broadcasts | event-driven re-reconciliation instead of polling |

## What Medicus does NOT expose (this product owns it)

Working patterns/contracts, leave records, duty rotas, locum bookings, supervision relationships,
multi-day scheduling. No service-account auth — everything requires a logged-in user session,
which is why the extension form factor is the right one.

## Condor (`.condor-plan.md` in medicus-suite)

The Suite's Condor module is a live operational dashboard (slots remaining, waiting room,
submissions by hour, per-clinician workload bars, a 17:00 "day score") — **not** a rota manager.
Its data contract and 15s polling patterns are the template for our future demand-driven views.
