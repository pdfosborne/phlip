# States

Every view has more states than its happy path. Design them all before shipping.

| State | Presentation | See |
|---|---|---|
| Loading, under 100 ms | Nothing | INT-14 |
| Loading, 100 ms – 1 s | An inline spinner, or the control shown busy | INT-14 |
| Loading, over 1 s | A skeleton of the real layout | INT-14 |
| Empty | One line and one action | CNT-13 |
| Connecting / offline | Rail status dot, the "reaching" pulse, the reconnect banner | PAT-states-2 |
| Pending sync | A pending mark on the row or message until the host confirms | INT-12 |
| Failed write | An inline error with Retry | INT-15 |
| Pending approval | The event row faded with a dashed outline and a "Pending approval" label; approvers get Approve (Primary) and Block | PAT-states-4 |
| Blocked event | A "Blocked" label; the creator is notified with the reason | — |
| Limited ("Reserved") stub | Time, duration and RSVP count only — no title, place or details | PAT-states-5 |
| Not permitted | Actions you can't take are hidden; where creation is impossible the board says why | CMP-menu-2, PAT-create-8 |
| Past | Events leave the Timeline once they end and live in Memories | — |
| Demo | The demo bar across the top, with Reset demo | PLT-19 |

## Rules

- **PAT-states-1 — Design every state.** Each data view specifies its empty, loading, error and offline states before it ships.
- **PAT-states-2 — Connection status is calm and local.** It shows on the server's rail button (status dot and reach badge) and escalates gently. The thresholds are in `scripts/net/net-part2.js`: the reconnect banner appears after 8 s of reaching, and a server reads as aging after 2 min and stale after 30 min without sync. The pulse settles per MOT-8. Cached content always stays readable.
- **PAT-states-3 — Offline still works.** Cached content stays usable (local-first). Writes queue with pending marks and go out on reconnect.
- **PAT-states-4 — Shape and words, not colour alone.** Pending approval is a dashed outline plus a label; blocked is a label plus a reason.
- **PAT-states-5 — Redaction reveals nothing.** Limited stubs show no hints of hidden content: no blurred titles, no partial text.
- **PAT-states-6 — Errors are specific and recoverable.** Say what failed, next to it, and offer Retry where possible.
- **PAT-states-7 — Loading never jumps.** Skeletons match the final geometry, and content fades in over `--dur-base`.
- **PAT-states-8 — Empty events explain the next step.** An empty event view says “No upcoming events” and offers New event when permitted. When filters hide upcoming events, say so and offer Show all events. Read-only views explain that events cannot be added here. Do not label a filtered-empty view as a connection failure.
