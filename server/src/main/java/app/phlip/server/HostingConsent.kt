package app.phlip.server

/**
 * Plain-language host / public / member disclosures for public release.
 * Acceptance is gated in SettingsActivity (create + Public) and the web join modal.
 */
object HostingConsent {

    const val HOST_RULES_TITLE = "Server rules for hosts"

    const val HOST_RULES_BODY =
        "Before you enable sharing, understand what hosting means:\n\n" +
            "• You are the operator of every server on this phone — like running a small website for your group.\n" +
            "• All group data (members, events, chat) is stored on this device. There is no Phlip company server holding that content.\n" +
            "• You decide who joins: new people wait for your Approve. You can remove people later.\n" +
            "• You are responsible for the community on your servers — who is in them, and what people post.\n" +
            "• Local stays on the same Wi‑Fi. Making a server Public is a separate step with extra risks.\n" +
            "• Keep this phone powered and online while friends need access. If it sleeps or loses network, the server stops.\n\n" +
            "By accepting, you agree to host responsibly and only create servers for groups you are willing to run."

    const val HOST_RULES_ACCEPT = "I accept the hosting responsibilities"

    /** Early / alpha software risk — required before hosting. */
    const val ALPHA_ACK_TITLE = "Alpha software"

    const val ALPHA_ACK_BODY =
        "Phlip is in ALPHA development. It is early software and is not finished product.\n\n" +
            "Risks you must accept:\n" +
            "• Features may be incomplete, unstable, or change without notice.\n" +
            "• Updates may break functionality you already rely on.\n" +
            "• Updates or bugs may cause loss of data on this phone (servers, members, events, chat, and settings).\n" +
            "• There is no guarantee of backups, recovery, or compatibility between builds.\n" +
            "• Do not rely on Phlip as the only copy of important information.\n\n" +
            "Only continue if you understand these early-development risks and accept them."

    const val ALPHA_ACK_ACCEPT = "I understand — accept alpha risks"

    const val PUBLIC_RISK_TITLE = "Make this server Public?"

    const val PUBLIC_RISK_BODY =
        "Public means friends can reach this server from anywhere on the internet (via Cloudflare Tunnel on your domain), not only on your Wi‑Fi.\n\n" +
            "Risks you must accept:\n" +
            "• Anyone with the join code or public link can request to join — you still Approve, but the server is reachable worldwide.\n" +
            "• You remain the operator and are responsible for who joins and for content stored on this phone.\n" +
            "• Cloudflare can see connection metadata and any unencrypted framing (not end‑to‑end message bodies).\n" +
            "• The phone must stay on and online; if it sleeps or loses network, Public stops.\n" +
            "• You must keep a Cloudflare account, domain, and API token configured — Public will not work without them.\n" +
            "• Public event Broadcasts use Workers KV (~1,000 writes/day on Free). For full Broadcasts (reactions, busy events), upgrade to Workers Paid (\$5/month): Cloudflare Account → Compute → Workers & Pages → upgrade Workers plan. Mark Paid in Phlip Settings after upgrading.\n\n" +
            "Only continue if you understand these risks and still want this server on the public internet."

    const val PUBLIC_RISK_ACCEPT = "YES I UNDERSTAND RISK"

    /** Red-state device patch warning (§8.4). [patchLabel] e.g. "August 2019". */
    fun patchWarningBody(patchLabel: String): String =
        "This device hasn't had a security update since $patchLabel.\n\n" +
            "Phlip runs in Android's app sandbox, so a flaw in Phlip can't normally reach the rest of your phone. " +
            "On a device with an older patch, that protection is weaker — known Android vulnerabilities from this period can be used to break out of the sandbox.\n\n" +
            "Ways to reduce risk if you host from this phone:\n\n" +
            "• Keep the phone clean — factory reset, no personal Google account, no other apps — so there's less on it worth targeting.\n\n" +
            "• Consider guest Wi‑Fi for the host phone — that can limit how far a compromise on the phone can reach other devices at home. " +
            "Trade-off: Local servers on guest Wi‑Fi usually aren't visible to phones on your main network, so friends on the main Wi‑Fi may need Public hosting (or to join the same guest network) to connect."

    const val PATCH_WARNING_TITLE = "Device security updates"
    const val PATCH_WARNING_ACCEPT = "I understand — continue"

    /** Local (same Wi‑Fi) safer-host tips — before creating Local servers. */
    const val LOCAL_PREP_TITLE = "Safer hosting for Local"

    const val LOCAL_PREP_BODY =
        "Local means friends reach this server only on the same Wi‑Fi as this phone — not over the internet.\n\n" +
            "Safer Local hosting:\n" +
            "• Prefer a dedicated host phone if you can — less personal data on the device that stores your group.\n" +
            "• Keep the phone powered and awake while friends need access; sleep or offline stops the server.\n" +
            "• Same network only — guests on a different SSID (including guest Wi‑Fi) usually cannot see Local servers.\n" +
            "• Know who shares your Wi‑Fi: anyone on that network who has the join code can request to join.\n" +
            "• Local does not use Cloudflare. Going Public is a separate setup with different risks.\n\n" +
            "By accepting, you understand Local is Wi‑Fi‑only and that you’re responsible for who joins."

    const val LOCAL_PREP_ACCEPT = "I’ve read this — continue"

    /** Network approval when hosting on a new LAN. */
    const val NETWORK_APPROVE_TITLE = "Approve this network?"

    const val NETWORK_APPROVE_BODY =
        "Phlip only serves on networks you approve. This Wi‑Fi (or Ethernet) is new.\n\n" +
            "• Approve once — host here for now, including Nearby discovery so friends can " +
            "find you. Plaintext LAN Broadcast links stay off. " +
            "If you leave and come back, you’ll be asked again.\n\n" +
            "• Always trust — treat this like home. Full LAN behaviour, including " +
            "LAN Broadcast minting. Prefer this only on networks you control."

    const val NETWORK_APPROVE_ONCE = "Approve once"
    const val NETWORK_ALWAYS_TRUST = "Always trust"
    const val NETWORK_PAUSE_TITLE = "Hosting paused — new network"
    const val NETWORK_PAUSE_TEXT = "Tap to approve before guests can join."
    const val NETWORK_PAUSE_BUSY_TEXT =
        "Guests may be unable to connect right now — tap to approve this network."
    const val NETWORK_OFFLINE_TITLE = "No network"
    const val NETWORK_OFFLINE_TEXT =
        "Consider using Direct connect so nearby phones can join without shared Wi‑Fi."

    /** Public / Cloudflare safer-host tips — required before Public. */
    const val DEVICE_PREP_TITLE = "Safer hosting for Public"

    const val DEVICE_PREP_BODY =
        "A dedicated, wiped phone on a guest network turns “my life got compromised” into “I throw away a phone and rotate a tunnel token.”\n\n" +
            "Recommended for Public:\n" +
            "• Factory-reset this phone before using it as a host.\n" +
            "• Use a throwaway Google account for Play updates (no personal mail, photos, payment, or recovery links to your real accounts). Or sideload and check for updates yourself.\n" +
            "• Put the host phone on your guest Wi‑Fi. The tunnel is outbound-only, so Public still works — isolation stops a compromised phone from reaching your router, NAS, or other devices.\n" +
            "• Host from the old phone; use your daily driver as a normal Phlip client.\n\n" +
            "Clean phone → data loss is contained. Clean phone + guest network → the incident is contained."

    const val DEVICE_PREP_ACCEPT = "I’ve read this — continue"

    const val UPDATE_NEEDED_TITLE = "Update Phlip"

    const val OPERATOR_ACK_TITLE = "You are the operator"
    const val OPERATOR_ACK_BODY =
        "Before Public: you are the operator of your server (like running a website). " +
            "You are responsible for who joins and for the data on this phone."
    const val OPERATOR_ACK_ACCEPT = "I understand — I am the operator"

    const val DATA_ACK_TITLE = "Cloudflare data disclosure"
    const val DATA_ACK_BODY =
        "Cloudflare sees connection metadata and any unencrypted traffic through the tunnel " +
            "(display names, invite checks, WebSocket framing). Message bodies use end-to-end " +
            "encryption in the app — Cloudflare cannot read those. You must accept Cloudflare’s terms."
    const val DATA_ACK_ACCEPT = "I understand — accept data disclosure"

    const val HSTS_GUIDE_TITLE = "Recommended HTTPS hardening"
    const val HSTS_GUIDE_BODY =
        "After your domain shows Active in Cloudflare, protect every Public server subdomain with HSTS:\n\n" +
            "Cloudflare dashboard → select your domain → SSL/TLS → Edge Certificates → " +
            "HTTP Strict Transport Security (HSTS) → Enable HSTS.\n\n" +
            "On the Configure tab, use these settings:\n" +
            "• Enable HSTS: On\n" +
            "• Max Age Header: 1 month (Cloudflare’s lowest dashboard option)\n" +
            "• Apply HSTS policy to subdomains: On\n" +
            "• Preload: Off\n" +
            "• No-Sniff Header: On\n" +
            "• Tap Save\n\n" +
            "Confirm existing and newly created Public servers still open over HTTPS. Then return " +
            "after one month and raise Max Age Header to 12 months. Keep subdomains and No-Sniff On, " +
            "and keep Preload Off.\n\n" +
            "Only enable subdomains after every current and future subdomain is HTTPS-only. Keep " +
            "preload off unless you separately understand and accept its long-lived browser consequences."
}
