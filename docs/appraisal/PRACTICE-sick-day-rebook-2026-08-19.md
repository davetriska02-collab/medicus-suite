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

## Round 2 — Monday morning (still inside captured contracts)

Reception, 08:05, one GP called in sick:

| Need | Verdict | Shipped |
|---|---|---|
| Who do I phone? | Inline "still needs rebook" hints vanish into the list. The leftover **is** the work. | First-class phone list: original time, name, type/length, why. Copy. Stays after Stage. |
| Number to dial | Not on `embedded-overview.patient` (id, name, preferredName only). Inventing a contacts GET would be a new endpoint. | List says look them up in Medicus. Ask the driving bot if overview/cancel GET already has a telephone. |
| Did we drown the duty GP? | Nearest-slot dump piles everyone onto the first similar list. | Covering-list preview (already booked + incoming + free tiles). Default cap 6 extra per dest; reception can raise it. |
| Two patients, one slot | Independent suggest offered the same 14:00 twice. | Greedy consume in clock order. |
| Suggesting 08:15 at 10:40 | Useless, and a no-show risk if Finalised. | Skip past slots when the book date is today. Future dummy Sundays unchanged. |
| What do I tell the patient? | "Move X → Y — will not send a booking message" is engineer-speak. | Confirm bar: **Rebooked with Y at {time} — {patient} (was …) — Medicus will not send a booking message**. SMS still off. |

GP covering:

| Need | Verdict | Shipped |
|---|---|---|
| See the pile-on before it writes | Preview, not a surprise at 11:00. | Covering-list preview on the review step. |
| Home visits / wrong type | Already matched on delivery + type + site + length. | Unchanged. |
| Waiting room | Do not phone someone who is already here. | Locked leftovers labelled waiting room. |

Still held (need a capture, do not invent):

- Send-to On on a **safe dummy** channel (Mouse's live form showed real-looking NHS email and UK mobiles — do not submit).
- Next-day similar slot.
- Move-to-queue.
- Telephone / NHS number on leftover rows, if a **captured GET** already returns them.

## Judgement call

Defaulting matched rows to **accept** favours Monday speed. Reverse it by
defaulting to **leave** if reception would rather opt in than opt out.
The dest extra cap (default 6) is the brake on drowning one duty list.

Live Sunday dummy (`4af732e`) proved cover cap, cover preview, and
"Rebooked with Y". It also showed: remaining-free must subtract the
incoming run (4 tiles − 30 min = 2, not 4); default must be the
**earliest** similar slot, not closest clock; leftover phone list must
stay visible when the count is zero.
