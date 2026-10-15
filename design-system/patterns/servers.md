# Servers

How people add a server, and how a server they host becomes reachable to friends.

Three kinds:

| Type | Who it’s for | Where data lives |
|---|---|---|
| **Personal** | You only | This device |
| **Google Drive** | Friend groups | A shared Drive board folder (plaintext markdown) |
| **Self-hosted** | Clubs | This phone, reached over the Internet through Cloudflare |

Same Wi-Fi and phone hotspot are not offered. Existing LAN/hotspot memberships still reconnect if already stored.

## Add-server menu

The rail **+** is create-first. It opens a dedicated dialog (CMP-dialog-2), not Join.

**Step 1 — Create a server**
- Lead: it starts on this phone only. Google Drive or self-hosted is chosen later in sharing settings.
- **Start from scratch**, then templates (friend / family / circles / club / business). **From a backup file**.
- Footer: **Join a server**. Join’s Cancel on the URL step reads **Back** and returns here.

**Step 2 — Name**
- Server name and the template preview. The host name comes from the person’s existing name. If the alpha acknowledgement is not yet accepted, an inline check with a “Show info” link. **Create** stays disabled until it is ticked.
- Back returns to step 1 (INT-6 / INT-9).

**Create**
- `createServer`. Toast Device only. No Drive vs self-hosted step here.

`hostingAvailable()` gates create (and backup). Shells that cannot host open Join.

## Join

- Cloudflare invite URL (self-hosted Internet).
- **Join a Drive folder** — Google Sign-In, then the Google Picker on a folder shared with the user (or paste the Drive folder link). If the picker cannot see the folder, copy tells them to open it in Drive once.
- No Nearby servers, no “Join host's Wi-Fi first”, no Drive join codes.

## Self-hosted lifecycle

A new server starts **Device only**: only this phone; nobody else can join yet. In **Set up sharing** the owner picks **Google Drive** or **Self-hosted**.

| Reach | Means |
|---|---|
| **Device only** | Only this phone. Loopback bind. No internet. |
| **Internet** | Friends join from anywhere through a Cloudflare domain. |
| **Drive** | Shared through Google Drive (not a hosted reach mode). |

## Sharing this server

Use Device only, Internet and Drive in user-facing copy. Internal device/local/direct/public values are unchanged for leftover native sessions.

The Device only chip opens full-screen **Set up sharing**. Drive chips open the Drive folder share path.

**Return to device only** turns off Internet sharing for that hosted server. **Stop hosting on this phone** belongs to device-wide administration and affects all hosted servers. Backups and deletion stay in Data settings.

## Sharing setup

Full-screen modal with fixed Back/Close header, scrollable content and fixed progress/action footer:

1. Connection: **Google Drive** or **Self-hosted**. Keep device only is an underlined exit. Drive Sign-In creates a Drive board in that Google account. Self-hosted continues to Cloudflare Internet.
2. Setup (self-hosted): Cloudflare domain prerequisites. Explain provider resources before connecting Cloudflare.
3. Review: concise responsibilities, expandable details and explicit outstanding acknowledgements. Enable is a separate action.
4. Invite: only when native status reports Internet available; otherwise show the specific blocker and Retry.

Back goes one step. Close returns to the originating screen. Drafts are per server, contain only mode and step, and reconcile with native state when reopened. Navigation never enables sharing. Reuse native readiness gates; a configured hostname alone is not evidence that Internet sharing is live.

Web `hostCall("setReachMode", …, "local"|"direct")` and hotspot start are refused.

## Rules

- **PAT-servers-1 — Create first.** The rail + opens the create menu. Join is a footer action, not the default.
- **PAT-servers-2 — Device only at create.** A new server is on this phone until the owner runs Set up sharing. Shells that cannot host open Join.
- **PAT-servers-3 — Only the checks for the chosen option.** Do not ask host rules or safety until the owner picks Self-hosted (Internet). Google Drive Sign-In is the connection step; it does not use Cloudflare steps.
- **PAT-servers-4 — Invite never dead-ends.** Invite on a device-only hosted server opens the guide; after Internet is on, Invite continues. Drive Invite copies the board folder link.
- **PAT-servers-5 — Hide rather than disable.** When `hostingAvailable()` is false, create is Join. The demo toast-blocks live Drive. Served host origins still open Join.
- **PAT-servers-6 — Alpha only at create.** Host rules live in the self-hosted guide, not on Google Drive.
