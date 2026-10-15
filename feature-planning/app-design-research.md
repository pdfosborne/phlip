# Interaction Design Principles for a Group Planning App: Android-Native and Desktop-Web

## TL;DR
- **Build one conceptual model, two interaction skins.** Keep naming, information architecture, iconography, and state identical across platforms, but implement navigation, gestures, and dismissal using each platform's *native* conventions — bottom navigation + system-back + bottom sheets on Android (Material 3), and a persistent visible left/top nav + keyboard + Escape/click-outside/close-button on desktop web.
- **Anchor every decision in established heuristics and measurable budgets:** respond to input in under 100 ms (leaving only ~50 ms for input handling), animate at 60 fps by producing each frame in ~10 ms of work (16 ms total budget minus ~6 ms browser overhead), keep transitions ~200–300 ms on mobile and 150–200 ms on desktop, meet 48 dp touch targets (Material) / 24 px minimum (WCAG 2.2 SC 2.5.8), and give every gesture a visible non-gesture equivalent (WCAG 2.5.1 / 2.5.7).
- **The two most important platform-specific rules:** on Android, support predictive back (Google Play's Apps Experience Program states "there are no exemptions for this guideline"), never put Settings in the bottom bar, and use undo-snackbars instead of confirmation dialogs; on desktop, never hide primary navigation behind a hamburger (NN/g found hidden navigation "cuts discoverability almost in half"), make everything keyboard-operable, and use URL-as-state so views are deep-linkable and survive refresh.

## Key Findings
- Material 3 has **deprecated the navigation drawer as the primary phone pattern**; use a bottom navigation bar for 3–5 top-level destinations on compact widths and an (expanded) navigation rail on medium/expanded widths. The drawer role is now reserved for account/workspace switching or 6+ destinations.
- **Predictive back is effectively required.** Android's Apps Experience Program guideline states the requirement "applies to all apps on the phone, tablet, foldable, and Wear form factors. There are no exemptions for this guideline." Back should progressively preview its destination and be interruptible.
- **Undo-via-snackbar beats confirmation dialogs** for destructive-but-recoverable actions (deleting a plan, removing an invitee) — Material explicitly designs snackbars to carry a single Undo/Retry action and time out automatically, and states that if two or more actions are needed you must use a dialog instead.
- On desktop, **NN/g's quantitative study (179 participants, 6 sites, run Dec 2015) found hidden navigation was used on desktop in only 27% of cases vs 48% (combo) and 50% (visible)**, with users "at least 39% slower when the navigation was hidden" and rating tasks ~21% harder. Visible or combo nav should be the default on large screens.
- **WCAG 2.2 (Oct 2023) adds criteria that bear directly on a planner:** 2.5.7 Dragging Movements, 2.5.8 Target Size (24 px min), 2.4.11 Focus Not Obscured, 3.2.6 Consistent Help — plus existing 2.5.1 Pointer Gestures, 2.1.2 No Keyboard Trap, 2.4.3 Focus Order.
- Notification deep links (critical for invites) should build a **synthetic back stack** so Back walks up the app hierarchy toward Home rather than dumping the user out.

---

## Details and the Numbered Principles

### A. Foundational / cross-cutting principles

**Heuristics that apply.** The design should be governed by Nielsen's 10 usability heuristics (visibility of system status; match to the real world; user control and freedom / undo; consistency and standards; error prevention; recognition over recall; flexibility; aesthetic minimalism; help users recover from errors; help & documentation). Layer on the "Laws of UX": **Fitts's Law** (time to hit a target is a function of distance and size — so make frequent actions big and close to the resting cursor/thumb), **Hick's Law** (decision time grows with the number/complexity of choices — so limit top-level destinations and use progressive disclosure), and **Jakob's Law** (users spend most of their time in *other* apps and expect yours to work the same way — so honor platform conventions rather than inventing new ones). Add direct manipulation, reversibility/forgiveness, and recognition over recall as recurring tests.

**"Natural and fluid" is a latency-and-motion budget, not a vibe.** The web.dev RAIL model gives concrete numbers: respond to input in under **100 ms** (only ~50 ms is actually available for handling because input can be queued up to 50 ms), render animation frames within the **16 ms** budget while targeting **~10 ms of work per frame** (the browser needs ~6 ms of that budget itself), keep idle work chunked to ≤50 ms so input isn't blocked, and if an action will take longer than 100 ms show immediate feedback (spinner, skeleton, optimistic state). Beyond ~1 s users feel the task merely "progressing"; beyond ~10 s they abandon.

**Motion communicates hierarchy and origin.** Use Material's motion patterns deliberately:
- **Container transform** — when a persistent container (a plan card, a FAB) morphs into a detail view; creates a visible link between the two.
- **Shared axis** — for spatial/navigational relationships (X for onboarding steps, Y for a stepper, Z for parent→child drill-in).
- **Fade through** — for elements with *no* strong relationship (switching bottom-nav destinations, refreshing).
- **Fade** — for elements entering/exiting in place (dialogs, menus, snackbars, FAB).

Durations: Material ships duration tokens (short ~50–200 ms, medium ~250–400 ms, long ~450–600 ms) and two easing sets — **Emphasized** (recommended for most on-screen transitions) and **Standard** (when speed/practicality matters). Enter and exit should use *different* timings — exit is always faster. Desktop transitions should be faster and simpler than mobile — roughly **150–200 ms** — because they cover less distance and complex web transitions risk dropped frames. Gesture-driven animations (predictive back, sheet drag) must be **interruptible** and track the finger 1:1.

> **Principle 1 — One mental model, two interaction skins.** *Rationale:* Jakob's Law cuts both ways — cross-platform users need consistent concepts (a "Plan" is a Plan everywhere) but platform-native mechanics. **On Android:** implement with Material 3 components, system back, touch gestures. **On desktop web:** implement with visible nav, pointer + keyboard, ARIA patterns. Keep names, icons, IA, and state identical.

> **Principle 2 — Respect the latency and frame budget.** *Rationale:* Perceived performance is a first-class feature. **On Android & desktop:** feedback in under 100 ms, animation at 60 fps, optimistic UI for network writes (RSVP toggles, availability edits), skeletons for loads >1 s.

> **Principle 3 — Motion must explain "where did this come from / where am I going."** *Rationale:* Consistent, origin-anchored motion builds a spatial model. **On Android:** container transform for card→detail, shared-Z for drill-in, fade-through for tab switches. **On desktop:** subtler/faster (150–200 ms), respect `prefers-reduced-motion`.

### B. Android-specific (Material Design 3 / Material You)

**Navigation.** Bottom navigation bar for **3–5** top-level destinations on compact (phone) widths; it stays visible while drilling down, each item goes straight to a destination (never opens a menu/dialog), and the system Back button does **not** cycle between tabs. For a group planner, sensible top-level destinations are **Plans/Events, Calendar, Groups, Activity/Chat, Profile** (5 max). On medium/expanded widths (foldables, tablets, Chromebooks) swap the bar for a **navigation rail**, and use the **expanded rail** (which now replaces the deprecated navigation drawer) where you'd historically have used a drawer. Settings must **not** be a bottom-nav destination.

**Predictive back, edge-to-edge.** Support the predictive back gesture (opt in via `enableOnBackInvokedCallback`); Android's Apps Experience Program states there are "no exemptions" for supporting the back-to-home predictive animation. Back should: dismiss an open bottom sheet/menu/dialog first, then navigate up the in-app stack, then preview back-to-home. Distinguish **Up** (within-app hierarchical parent, the top-app-bar arrow) from **Back** (chronological/system). Draw edge-to-edge and keep touch targets out of the system gesture insets. Reserve the left/right screen edges for the system back gesture.

**Sheets, dialogs.** 
- **Modal bottom sheet** — a focused menu/action list or secondary content that must be dealt with; has a scrim, blocks the rest of the UI, dismiss by swipe-down, scrim tap, back gesture, or drag handle. Ideal for a plan's quick-actions or an RSVP picker.
- **Standard bottom sheet** — co-exists with main content (no scrim), for content kept visible while interacting elsewhere.
- **Side sheet** — supporting content on larger widths.
- **Dialog** — a short, critical decision requiring 2+ actions (a snackbar can't carry two actions — Material says if there are two or more actions, use a dialog).
- **Full-screen dialog** — a self-contained sub-task like "Create plan" with many inputs on a phone.

**Swipe conventions.** Swipe-to-dismiss/-action on list rows (with icon + color reveal for archive/delete), swipe between tabs, pull-to-refresh, and drag handles on sheets. **Avoid** custom horizontal swipes that start at the screen edge — they collide with the system back gesture; the gesture-exclusion API is capped at 200 dp (calculated as ~4 × 48 dp touch targets plus padding) precisely so no app can hijack an edge. **Every gesture needs a visible non-gesture equivalent** (an overflow/kebab item for a swipe action) — both for discoverability and for WCAG 2.5.1.

**FAB.** Use a single FAB for the one highest-value action — **"New plan"/"Create event."** Use an **extended FAB** (icon + label) on primary screens where the action needs emphasis; collapse to icon-only on scroll. Don't put more than one FAB-level action on a screen; secondary actions belong in the top app bar or overflow.

**Long-press / multi-select / contextual action bar.** Long-press a plan or invitee to enter selection mode; the top app bar transforms into a **contextual action bar** showing bulk actions (delete, move, invite) and a count, with a close (X) to exit. Provide the same actions via per-item overflow for discoverability.

**Settings placement.** Android's own guidance: settings are "usually not essential to the primary user journeys" and belong in secondary locations — **place Settings in the top-app-bar overflow menu after all other items (except Help & Feedback)**, or as a destination reached from Profile/Account. Do not put Settings in bottom navigation. Separate **per-screen settings** (e.g., a single plan's notification toggle) from **global settings**.

**Touch targets, one-handed use.** Minimum **48 dp** touch targets (Material accessibility). Place primary actions in the bottom half / thumb-reach zone on large phones; keep destructive or rare actions out of easy accidental reach.

**Feedback: snackbar vs toast vs dialog.** Use a **snackbar** for brief, actionable feedback — especially **undo** ("Plan deleted — Undo"): it's non-blocking, times out, sits at snackbar elevation (above content, equal to the FAB, below dialogs and sheets), and carries a single action. Prefer undo-snackbars over "Are you sure?" dialogs for destructive-but-recoverable actions (delete plan, remove guest, decline invite) — it's faster and more forgiving. Use a **toast** only for non-interactive system messages (Android-only; can't be swiped off, no action). Use a **dialog** when the choice is critical or needs 2+ actions.

**Notifications & deep linking (critical for a planner).** Invites and reminders arrive as notifications that deep-link into a specific plan. Per Android's official guidance ("Start an Activity from a Notification"), tapping a notification "must take the user back through the app's normal work flow to the Home screen" — so build a **synthetic back stack**. For a "regular" activity in your normal UX flow, define `android:parentActivityName` on each activity and construct the `PendingIntent` with `TaskStackBuilder.addNextIntentWithParentStack()`; for nav-graph apps use `TaskStackBuilder`/`NavDeepLinkBuilder`. An explicit deep link (the notification case) "clears and replaces" the task back stack with the destination plus the synthesized start destination of each nesting level, so pressing Back navigates "back up the navigation stack just as though they entered your app from its entry point." Set `setAutoCancel(true)` so the notification clears on tap.

**Large screens / foldables.** Use the three Material **canonical layouts**: **list-detail** (plans list beside a plan's detail — ideal for the core browse-and-open flow), **supporting pane** (primary content ~2/3, supporting pane ~1/3 — e.g., calendar + details), and **feed** (grid of cards for an activity/discovery view). Drive layout with **window size classes**: compact (<600 dp), medium (≥600 dp), expanded (≥840 dp), plus newer large/extra-large breakpoints. The Compose Material 3 Adaptive library provides `ListDetailPaneScaffold`, `SupportingPaneScaffold`, and `NavigationSuiteScaffold` (which auto-swaps bottom bar ↔ rail).

### C. Desktop PC browser–specific

**Navigation.** Prefer a **persistent, visible** left sidebar or top nav bar. NN/g's quantitative testing (179 participants across 6 sites) found hidden navigation is discovered and used far less — on desktop only 27% of the time vs 48–50% for combo/visible nav — with users "at least 39% slower" and rating tasks harder, and the effect *stronger on desktop* than mobile. A collapsible sidebar is fine if it defaults open and collapses to icons+labels (not a mystery-meat hamburger). Use **breadcrumbs** for deep hierarchies (Group › Plan › Settings). A hamburger is acceptable only on narrow/responsive widths, placed top-left where users look; on wide screens, "out of sight is out of mind."

**Desktop-only affordances.** Use **hover states, tooltips, cursor changes (pointer/grab/text), and visible focus rings**. Hover can *progressively disclose* secondary actions (row hover reveals edit/delete) — but never hide *critical* actions behind hover-only, because hover doesn't exist on touch/keyboard and fails accessibility. Always pair a hover-revealed action with a persistent kebab/meatball menu.

**Right-click / context menus.** Only override the native browser context menu when you offer genuinely useful object-specific commands (right-click a plan → duplicate, share, delete). Always mirror those commands in a visible **kebab (⋮)** menu so they're discoverable without right-click, and don't suppress the browser's default menu on plain text/links.

**Keyboard interaction (follow WAI-ARIA APG).** Everything operable by keyboard: logical **tab order** (matching visual/DOM order, SC 2.4.3), **Enter/Space** to activate, **arrow keys** to traverse within composite widgets (menus, menubars, listboxes, comboboxes, disclosure), **Escape** to close menus/dialogs. Per the APG Dialog (Modal) pattern: move focus into the dialog on open (first focusable element, or a labelled container for long content), **trap focus** within it (Tab cycles, Shift+Tab reverses, looping) — but always provide Escape/close so it's never a *keyboard trap* per SC 2.1.2 — and **restore focus** to the trigger on close. Set `role="dialog"`/`aria-modal="true"` + `aria-labelledby`, and mark background `inert`/`aria-hidden`. Provide **skip links**.

**Keyboard shortcuts + command palette.** Offer a planner-appropriate set: quick-create (e.g., `C` for new plan), `/` or `Cmd/Ctrl-K` for search, and a **command palette** (`Cmd/Ctrl-K`) that unifies search + navigation + actions — a pattern popularized by VS Code, Linear, Slack, and Notion. It should be a keyboard fast-path layered on top of already-visible navigation, not a substitute for it. Make it discoverable with a visible ⌘K chip and inline shortcut hints next to commands (Superhuman-style, so power users graduate to direct shortcuts), and ensure the same shortcut toggles it closed and restores prior focus. Don't clash with reserved browser/OS shortcuts.

**Modals vs inline vs side panel vs page.** Per NN/g and SaaS practice: a **modal** is right only when the task is short, self-contained, and the interruption is the point (confirm, quick-create, destructive warning). If the user must *reference the background* (viewing a plan's details next to the calendar), use a **side panel/drawer** — it keeps context visible. Use **inline expansion** for small frequent edits (rename, toggle status). Use a **dedicated page** for anything long/multi-step (>~30 s, multiple steps, or cross-referencing data). Modals are the most overused SaaS pattern — reach for a drawer or inline first, and never let a modal fill most of the screen (that belongs on its own page).

**Dismissal on desktop.** Provide **all three** where appropriate — **Escape key, click-outside (scrim), and an explicit close (X) button** — for modals and popovers; this is both a usability and accessibility expectation. (For genuinely critical/destructive confirmations, drop click-outside so users can't dismiss accidentally.)

**Drag and drop.** Dragging events on a calendar and reordering agenda/list items is a strong desktop affordance (à la Google Calendar / Fantastical). But WCAG 2.2 **SC 2.5.7** requires a **single-pointer, non-drag alternative**, and the interaction must be fully keyboard-operable: Tab to the item, activate "move/grab," arrow to reposition, Enter to drop, Escape to cancel — with screen-reader announcements for pick-up/move/drop (see the Salesforce accessible-DnD patterns). Provide explicit "move to…" controls or click-to-select/click-to-place; don't rely on HTML5 drag events alone.

**Browser-native expectations.** Treat the **URL as state**: every meaningful view (a plan, a date range, a filter) should be deep-linkable, bookmarkable, and survive **refresh** without losing state. The **browser Back button** must behave sanely with SPA routes and modals (opening a modal may push history so Back closes it; don't trap the user). Support **open-in-new-tab** on links. Set responsive breakpoints so a narrowed browser window degrades gracefully.

**Multi-window / real-time sync.** Group planning is collaborative — expect the same user in multiple tabs and multiple users editing concurrently. Sync state in real time (RSVPs, availability, comments) with presence indicators and optimistic updates, and reconcile conflicts gracefully.

> **Principle 4 — On Android, the system owns the edges and the Back gesture; on desktop, the keyboard owns everything.** 
> **Principle 5 — Never hide primary navigation on a large screen.** 
> **Principle 6 — Undo, don't interrogate:** prefer reversible actions + undo over confirmation dialogs. 
> **Principle 7 — Every gesture and every drag has a visible, single-pointer, keyboard equivalent.** 
> **Principle 8 — Preserve context: modal only when the interruption is the point; otherwise side panel / inline / page.** 
> **Principle 9 — URL is state on the web; synthetic back stack on Android.** 
> **Principle 10 — Settings live in secondary locations, never in primary nav.**

### D. Menus and settings information architecture

**Decision rule for where an item goes:**
- **Primary nav (bottom bar / rail / sidebar):** the 3–5 destinations users visit constantly (Plans, Calendar, Groups, Activity, Profile).
- **Top app bar action / toolbar button:** frequent screen-level actions (search, filter, create).
- **Overflow / kebab (⋮) menu:** infrequent or screen-specific actions (export, archive, report), and Settings/Help.
- **Contextual menu (long-press / right-click):** object-specific actions on a specific item.
- **Settings screen:** persistent preferences and configuration.

**Settings taxonomy for a collaborative product** — split clearly into **Personal/Account** vs **Group/Workspace** scopes:
- **Account:** profile, email/phone, connected calendars, sign-out, delete account.
- **Notification preferences (critical for a planner):** invites, RSVP changes, reminders (with lead time), comments/mentions, daily/weekly digest — per-channel (push / email / in-app) with sensible defaults ON for invites & reminders, digest for low-priority.
- **Privacy/visibility:** who can see my availability, who can invite me, default plan visibility.
- **Group-level settings:** membership/roles, who can create plans, group defaults, co-admins (Partiful ships co-admins who "create and manage events without sharing logins" as precedent).
- **Defaults:** default reminder time, default plan duration, time zone.

**Notification-settings design:** granular *enough* to prevent opt-out-of-everything, but grouped by category with good defaults. Offer per-plan mute and a global quiet-hours toggle.

### E. Accessibility and inclusivity

- **WCAG 2.2 SC 2.5.8 Target Size (24 px min)** vs **Material 48 dp** — these differ; **use 48 dp on Android** (stricter, thumb-friendly) and treat **24 px as the floor on desktop**, growing hit areas with padding.
- **SC 2.5.7 Dragging Movements** & **2.5.1 Pointer Gestures** — single-pointer, non-path alternatives for all drag/swipe/multipoint interactions (note the WCAG 2.2 clarification that the single-pointer alternative can't itself be a drag).
- **SC 2.4.11 Focus Not Obscured** — sticky headers/sheets must not fully hide the focused element.
- **SC 3.2.6 Consistent Help** — keep the help/contact entry point in the same place on every screen.
- **SC 2.1.2 No Keyboard Trap** & **2.4.3 Focus Order** — modals trap focus but always allow Escape; focus order matches reading order.
- **Screen readers:** TalkBack (Android) users can't perform custom swipes — expose swipe actions as accessibility actions and via the visible overflow. Announce dynamic changes (new RSVP, plan updated) via **live regions** on web (`aria-live`) and appropriate announcements on Android.
- **Reduced motion:** honor `prefers-reduced-motion` (web) and the Remove-animations system setting (Android) — collapse long transitions to short fades (~100 ms) or none.

### F. Precedents (ground, don't copy)
- **Partiful** — named Google Play's Best Overall App of 2024 (per TechCrunch, Nov 18, 2024; founded 2020 by Palantir alums Joy Tao and Shreya Murthy, built with React Native) — link-based invites, RSVP without forcing app install, co-admins, questionnaires, text-blast updates; strong on lightweight social RSVP.
- **Doodle / Calendly** — availability/poll-driven scheduling.
- **Google Calendar / Fantastical** — drag-to-create and drag-to-reschedule on the calendar grid.
- **Slack / Discord / Notion / Linear** — command palette (Cmd-K), real-time collaborative sync, keyboard-first power features.
- **WhatsApp/Airbnb-style group coordination** — group threads with structured plan objects.

---

## Gesture Decision Table

| Gesture | What it should do | Platform | Required non-gesture equivalent |
|---|---|---|---|
| Edge swipe L/R | System Back (predictive) | Android | On-screen Up arrow in top app bar |
| Swipe down on sheet | Dismiss bottom sheet | Android | Scrim tap, Back, close/drag handle |
| Swipe on list row | Reveal/commit row action (archive/delete) | Android | Per-row overflow (⋮) menu item |
| Swipe L/R between tabs | Switch section tabs | Android | Tap the tab / bottom-nav item |
| Pull down at top | Refresh | Android | Manual refresh in overflow |
| Long-press item | Enter multi-select / context menu | Android | Kebab menu → "Select" |
| Drag event on grid | Reschedule event | Both | "Edit → change time" + keyboard move (Tab/arrow/Enter) |
| Drag to reorder | Reorder agenda/list | Both | "Move up/down" menu + keyboard reorder |
| Right-click | Object context menu | Desktop | Visible kebab (⋮) menu |
| Hover | Reveal secondary actions / tooltip | Desktop | Persistent kebab + focus-visible equivalent |
| Cmd/Ctrl-K | Open command palette | Desktop | Visible search field + ⌘K chip |

## Dismissal Matrix

| Surface | Android dismissal | Desktop-web dismissal |
|---|---|---|
| Alert/confirmation dialog | Explicit button; Back; (scrim tap only if non-critical) | Explicit button; Escape; (click-outside only if non-critical) |
| Full-screen dialog / create flow | Close (X) or Back; explicit Save/Cancel | Close (X); Escape; explicit Save/Cancel |
| Modal bottom sheet | Swipe down, scrim tap, Back, drag handle | n/a (use modal/drawer) |
| Standard bottom sheet | Collapse via drag/handle; stays until dismissed | n/a |
| Side panel / drawer (details) | Back; swipe; close (X) | Escape; click-outside; close (X) |
| Popover / dropdown menu | Tap outside; Back; select item | Escape; click-outside; select item; Tab-away |
| Snackbar | Auto-timeout; swipe off; action tap | Auto-timeout; action click; (optional dismiss X) |
| Contextual action bar (multi-select) | Close (X); Back | Escape; Close (X); deselect all |

## Settings Placement Rubric

| Question | If yes → |
|---|---|
| Visited on nearly every session, core task? | Primary navigation |
| Frequent, screen-scoped action (search, filter, create)? | Top app bar / toolbar |
| Infrequent or screen-specific? | Overflow / kebab menu |
| Acts on one specific object? | Contextual (long-press / right-click), mirrored in kebab |
| Persistent preference/configuration? | Settings screen |
| Applies to me only vs the whole group? | Split: Personal/Account vs Group/Workspace settings |
| Global vs one plan? | Global Settings vs per-plan inline setting |

## Anti-patterns to Avoid
- **Don't** bury frequently used actions in the overflow menu — **do** promote them to the top bar/toolbar or FAB.
- **Don't** ship icon-only menus with ambiguous glyphs — **do** pair icons with labels, especially in nav.
- **Don't** hide primary navigation behind a hamburger on desktop — **do** show it persistently; reserve the hamburger for narrow widths.
- **Don't** use a confirmation dialog for every destructive action — **do** perform the action and offer Undo via snackbar.
- **Don't** create custom edge swipes that fight the Android system back gesture — **do** keep the edges for the system and put actions inboard.
- **Don't** rely on hover or drag as the *only* way to do something — **do** provide a visible, keyboard/single-pointer equivalent.
- **Don't** use a modal when the user needs to see the background — **do** use a side panel or inline edit.
- **Don't** lose state on refresh or break the browser Back button — **do** make views URL-addressable.
- **Don't** put Settings in the bottom navigation bar — **do** place it in overflow or under Profile.
- **Don't** dump the user to the home screen when they press Back from a notification-opened plan — **do** synthesize the parent back stack.
- **Don't** vary component placement screen-to-screen — **do** keep positional consistency so users build a spatial model.

## Recommendations
1. **Lock the shared conceptual layer first** — a single glossary (Plan, Event, Group, Invite, RSVP, Availability), one icon set, one state model, one IA. This is what makes the two platforms feel like one product. *Benchmark to change course:* if usability testing shows users can't predict where a feature lives across platforms, tighten naming/IA before touching visuals.
2. **Android build order:** bottom nav (5 destinations) → predictive back + edge-to-edge → FAB "New plan" → modal bottom sheets for quick actions → undo-snackbars → notification deep links with synthetic back stack → adaptive canonical layouts (`ListDetailPaneScaffold`, `NavigationSuiteScaffold`) for tablets/foldables.
3. **Desktop build order:** persistent left sidebar + breadcrumbs → full keyboard operability + focus management (APG dialog pattern) → side-panel plan details next to calendar → command palette (Cmd-K) → drag-to-reschedule *with* keyboard/single-pointer alternative → URL-as-state everywhere.
4. **Bake WCAG 2.2 AA in from day one** — 48 dp / 24 px targets, single-pointer alternatives, focus-not-obscured, consistent help, no keyboard traps, reduced-motion. Retrofitting is far costlier.
5. **Instrument the budgets:** track input-response latency (target <100 ms), frame rate (60 fps), and time-to-interactive; treat regressions as bugs. *Threshold:* if p75 interaction latency exceeds 100 ms or animations drop below 60 fps on mid-tier devices, stop and optimize before adding features.

## Caveats
- **Guidance has shifted recently and sources sometimes lag.** The navigation drawer's deprecation and the expanded navigation rail are part of the Material 3 "Expressive" update (announced May 2025); older Material 2 pages still describe drawers as a primary pattern. Where m2 and m3 conflict, follow m3.
- **Target-size guidance genuinely differs** between Material (48 dp) and WCAG 2.2 (24 px) — this is not an error; they serve different baselines. Use the stricter 48 dp on touch.
- **"Predictive back mandatory"** refers to Google Play's Apps Experience Program guideline (which states "there are no exemptions for this guideline") plus Android's strong platform push; it is enforced through program qualification and Play surfacing rather than an OS-level hard block on every app.
- **Navigation 3 changes deep-link responsibility.** The synthetic-back-stack guidance above reflects classic Jetpack Navigation (Nav2, XML/Kotlin DSL/Compose); in the newer Navigation 3 model the developer owns and manages the back stack directly and must synthesize parents themselves.
- **OEM deviations:** some forked Android builds (e.g., certain MIUI/Xiaomi devices) don't reliably honor synthesized notification back stacks — test on real devices.
- Several supporting details (RAIL thresholds, command-palette conventions, modal-overuse guidance, Partiful facts) are corroborated against primary sources (web.dev, NN/g, W3C/WAI-ARIA APG, developer.android.com, m3.material.io, TechCrunch); secondary summaries were used only where they restated those primaries.