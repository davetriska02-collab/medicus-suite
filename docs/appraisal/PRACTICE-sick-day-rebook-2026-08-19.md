# Synthetic critique — sick-day list rebook (2026-08-19)

This is a **synthetic** reception/GP read of the design, not real user research.
It shaped v1. The write is only the captured cross-list move.

## What v1 does

One **Sick day…** button. Pick a list. Each booked (not arrived) tile gets
the next similar free slot on another diary that day: same type, length,
site, delivery. Reception accepts, picks another match, or leaves as
still-needs-rebook. Stage then Finalise. SMS off until a Send-to capture.

## Reception (Monday morning)

| Worry | Verdict | v1 rule |
|---|---|---|
| Speed | One button + defaults that accept a real match is fast enough if the confirm bar is the brake. Auto-Finalise would be reckless. | Propose accept; human Finalise. |
| Accidental send | The message they want is not captured. Wiring Send-to On now would invent a patient-facing write. | SMS/email **off**. Confirm bar says so. |
| Wrong list | Emptying the duty GP by mis-click. | Explicit pick of whose list; staff name on the review. |
| Covering GP already full | Dumping onto a packed list creates overlap (Test A). | No similar free slot → still needs rebook. Not written. |
| Patient in waiting room | Moving someone already arrived. | Arrived tiles locked, labelled waiting room. |

## GP

| Worry | Verdict | v1 rule |
|---|---|---|
| Leftover list | The point of the button. | Whole day list, one pass. |
| Home visits | A "similar" f2f slot is the wrong job. | Delivery must match. Home visit ≠ face-to-face. |
| Double-book | Covering list with no gap. | Slot conflict check; no `allowOverlappingAppointments=allow`. |
| Similar but wrong type | 10-min phone vs 15-min GP. | Type id and duration must match. No type picker. |

## Held (need a capture)

- Send-to On wording ("due to unforeseen circumstances…").
- Queue / DNA / Reschedule menu.
- Stretch into a booked neighbour.

## Judgement call

Defaulting matched rows to **accept** favours Monday speed. Reverse it by
defaulting to **leave** if reception would rather opt in than opt out.
