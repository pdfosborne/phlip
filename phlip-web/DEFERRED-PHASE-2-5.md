# Web refactor follow-up

Phases 0–5 of [webclientrefactorplan.md](../feature-planning/webclientrefactorplan.md) are complete (rails, shared utils, channel / hand / render splits, consolidation docs + `storage.js` / `onceFlag` adoption).

**Follow-up executed:** [phlip-web-atomic-modules-followup-plan.md](../feature-planning/phlip-web-atomic-modules-followup-plan.md) — Parts 1–3 (thin `hand.js` / `channel.js` facades; hand-create + remaining oversized backlog). Runtime JS organized under [`public/scripts/<domain>/`](public/scripts/). Smoke rows: [`SMOKE-CHECKLIST.md`](SMOKE-CHECKLIST.md). Ceiling exceptions: [`public/_modules/ownership.md`](public/_modules/ownership.md). Shell CACHE ≥ `phlip-shell-v263`.

**Optional later polish (not blocking):**

- Trim empty facades after external symbol audits
- Named domain renames for remaining mechanical `*-partN.js` Part 3 splits (pitch/sharecard/chat/net/helpers/host/hotspot)
- Further internal split of `handlers-dispatch.js` / `render-deck-editor-body.js` / `render-join-modal.js` only if review needs smaller diffs
- Broader `onDelegated` adoption only where remount-safe
- Create-channel modal still embeds access UI (Phase 2 note)
- Manual smoke matrices after large merges
