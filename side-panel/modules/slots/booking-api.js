// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Booking API shim for the Slots module (one-release re-export).
//
// THE SPLIT:
//   shared/booking-core.js     — the ENDPOINTS. Every /scheduling/* call.
//   shared/booking-identity.js — slots-style first-matching-tab identity
//                                (detectMedicusTab / detectPatientId).
//   this file                  — re-exports both so slots.js's existing
//                                `import { … } from './booking-api.js'` is
//                                unchanged. modules/shared booking surfaces
//                                now import the shared files directly
//                                (architecture plan Phase 3.3).

'use strict';

export {
  MAX_WINDOW_DAYS,
  MAX_CONCURRENCY,
  fetchAppointmentFinder,
  fetchAvailableSlots,
  reserveSlot,
  fetchCreateForm,
  createAppointment,
  releaseReservation,
  findSlotsInWindow,
} from '../../../shared/booking-core.js';

export { detectMedicusTab, detectPatientId } from '../../../shared/booking-identity.js';
