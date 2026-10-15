/* Phlip legal / contact copy for the host-served browser client.
 * Keep in sync with LegalDocs.kt and ContactDocs.kt in the Android app. */
(function (global) {
  "use strict";

  global.PHLIP_HELP_FAQS_URL = "https://phlipapp.com/FAQs";

  global.PHLIP_LEGAL = {
    title: "Legal",
    subtitle: "Terms of service, moderation, privacy, the Phlip licence, and third-party software notices.",
    sections: [
      {
        title: "Terms of service",
        body:
          "Last updated: 24 July 2026\n\n" +
          "Phlip is software that lets one Android phone host friend-group servers (events, chat, and related features). " +
          "There is no Phlip company cloud that stores your group’s chat or events.\n\n" +
          "1. Acceptance\n" +
          "By installing or using Phlip you agree to these terms. If you do not agree, do not use the app.\n\n" +
          "2. The host is the operator\n" +
          "Whoever creates and runs a server on their phone is that server’s operator. They decide who may join, " +
          "set age ratings, approve or remove members, and are responsible for the community and content on that device. " +
          "Phlip provides tools; it does not moderate private groups for you.\n\n" +
          "3. Your account on a server\n" +
          "Members pick a display name and password for each server. Passwords are never sent in plaintext. " +
          "The host can remove you; removed clients drop that server from their list.\n\n" +
          "4. Age\n" +
          "Servers set a minimum age (at least 13+). You must meet a server’s age rating before joining. " +
          "Do not use Phlip if you are under 13.\n\n" +
          "5. Acceptable use\n" +
          "Do not use Phlip to break the law, harm others, distribute illegal content, spam, or attack systems. " +
          "Hosts should remove abusive members. Members can report content to the host.\n\n" +
          "6. Public hosting\n" +
          "Making a server Public uses Cloudflare Tunnel on a domain you control. That exposes the host phone to the internet. " +
          "You accept those risks when you enable Public (see the in-app disclosure).\n\n" +
          "7. Support purchases\n" +
          "Optional “Support us” purchases (via Google Play) buy cosmetics only. They never unlock or remove hosting or core features.\n\n" +
          "8. No warranty\n" +
          "Phlip is provided “as is”, without warranties of any kind. We do not guarantee uptime, data durability, " +
          "or that hosting will suit your needs. You use it at your own risk.\n\n" +
          "9. Limitation of liability\n" +
          "To the fullest extent allowed by law, Phlip’s authors and distributors are not liable for indirect, " +
          "incidental, or consequential damages, or for content stored on a host’s device.\n\n" +
          "10. Changes\n" +
          "We may update these terms in the app. Continued use after an update means you accept the revised terms.",
      },
      {
        title: "Server moderation & host responsibilities",
        body:
          "Last updated: 24 July 2026\n\n" +
          "Phlip does not run a company moderation team for private friend groups. " +
          "Each server is moderated by the person whose phone hosts it, and by roles they grant.\n\n" +
          "1. Who moderates\n" +
          "• The host (phone operator) is responsible for that server’s community and for content stored on their device.\n" +
          "• The host may grant admin or moderator roles so trusted members can help (for example reviewing reports or deleting abusive chat).\n" +
          "• Phlip’s developers do not see your group’s chat or events and cannot Approve joiners, remove members, or delete messages inside your server.\n\n" +
          "2. Host responsibilities\n" +
          "Before creating servers, hosts accept in-app host rules. In practice a host should:\n" +
          "• Set an honest age rating (13+ / 16+ / 18+) and only Approve people who meet it.\n" +
          "• Approve or deny new joiners by name; share join codes only with people they trust.\n" +
          "• Act on reports and remove members who break the group’s norms or the law.\n" +
          "• Keep the phone powered and online while friends need the server; data lives on that device.\n" +
          "• Treat Public hosting as operating something reachable from the internet — still Approve joiners, but expect wider exposure (see the Public risk disclosure).\n\n" +
          "3. How moderation works in the app\n" +
          "• New members wait for host Approve (name only — passwords stay private).\n" +
          "• Members (and broadcast guests where applicable) can report people or content; reports go to the host and any admins/moderators, not to Phlip as a company.\n" +
          "• Hosts/admins/moderators can review the reports inbox, remove members, and delete chat messages when needed.\n" +
          "• Members can leave, or leave and ask the host to purge their contributions (events they created may remain as history).\n\n" +
          "4. What members should do\n" +
          "If something is wrong inside a group, use in-app report tools and contact that server’s host (or a mod they appointed). " +
          "For problems with the Phlip app itself (crashes, install, purchases), use Contact & Bug Report — not the group’s host.\n\n" +
          "5. Illegal or harmful use\n" +
          "Hosts must not knowingly run servers for illegal activity. They should remove illegal or seriously harmful content and abusive members. " +
          "Phlip may refuse support or distribution channels may act where store or law requires — but day-to-day group moderation stays with the host.",
      },
      {
        title: "Privacy policy",
        body:
          "Last updated: 24 July 2026\n\n" +
          "1. Who holds your group data\n" +
          "Chat, events, member lists, and related server content live on the host’s Android device " +
          "(encrypted at rest on that phone where the product supports it). Phlip does not run a company server " +
          "that stores your group’s messages or events.\n\n" +
          "2. What the host sees\n" +
          "The host (and roles they grant) can see membership, display names, and content their server settings allow. " +
          "They Approve joiners by name. Member passwords are never sent in plaintext.\n\n" +
          "3. What leaves the phone\n" +
          "• Local / same Wi‑Fi: traffic stays on your network between clients and the host.\n" +
          "• Public: traffic goes through Cloudflare Tunnel. Cloudflare may see connection metadata and " +
          "transport framing; end-to-end encrypted payloads remain opaque to the tunnel.\n" +
          "• Support purchases: Google Play processes payment; Phlip receives purchase entitlements for cosmetics.\n\n" +
          "4. On your device\n" +
          "The app stores local preferences, remembered server list, and similar client data on your device. " +
          "A hashed device fingerprint may be sent to a server to help returning sign-in — not your raw device serial.\n\n" +
          "5. What we don’t collect as a company\n" +
          "We do not operate a content backend that logs your chats or events. We do not sell your group content. " +
          "Crash or store analytics, if ever added by a distribution channel, would be described here when enabled.\n\n" +
          "6. Leaving and deletion\n" +
          "You can leave a server. “Leave & delete my data” asks the host to purge your RSVPs, chat, reactions, " +
          "and similar contributions (events you created may remain as history). The host can also remove you.\n\n" +
          "7. Children\n" +
          "Phlip is not directed at children under 13. Servers enforce a minimum age of at least 13+.\n\n" +
          "8. Contact\n" +
          "For privacy questions about a specific group, contact that group’s host. " +
          "For the Phlip app itself, use the Support / contact options published with the app store listing.",
      },
      {
        title: "Licence",
        body:
          "Last updated: 24 July 2026\n\n" +
          "Phlip Proprietary Software Licence\n" +
          "Copyright © 2026 the Phlip authors. All rights reserved.\n\n" +
          "Phlip (including its source code, binaries, documentation, trademarks, and related assets) is proprietary software. " +
          "It is not open source and is not licensed under the Apache License 2.0 or any other open-source licence.\n\n" +
          "1. Grant of licence (end users)\n" +
          "If you obtained Phlip through an authorised distribution channel (for example Google Play or another store or download we designate), " +
          "we grant you a personal, non-exclusive, non-transferable, revocable licence to install and use the compiled App on devices you control, " +
          "solely in accordance with the in-app Terms of Service, our Privacy Policy, and the applicable store terms.\n\n" +
          "This licence does not grant you rights to the source code, to create derivative works, or to redistribute Phlip " +
          "except as those Terms allow (for example normal use of the hosted client UI served by a Host to their Members).\n\n" +
          "2. Restrictions\n" +
          "Except where mandatory law requires otherwise, or we give prior written permission, you may not:\n" +
          "• Copy, modify, merge, publish, distribute, sublicense, sell, rent, lease, or lend Phlip or any substantial part of it.\n" +
          "• Reverse engineer, decompile, or disassemble the App, except where mandatory law expressly permits it.\n" +
          "• Remove or obscure proprietary notices, copyright marks, or licence legends.\n" +
          "• Use Phlip’s name, logos, or branding to suggest endorsement without permission.\n" +
          "• Use Phlip for any unlawful purpose.\n\n" +
          "3. Hosting and self-hosted use\n" +
          "Running Phlip as a Host on your own device, and Members connecting to that Host, is permitted under the end-user Terms. " +
          "That does not make Phlip open source, and does not grant a licence to redistribute, fork, or rebrand the software.\n\n" +
          "4. Third-party components\n" +
          "Phlip may include or depend on third-party libraries and services. Those components remain under their own licences " +
          "(which may include Apache License 2.0 or other open-source terms). See Third-party notices below. " +
          "Nothing in this proprietary licence changes those third-party licences.\n\n" +
          "5. No warranty / liability\n" +
          "Phlip is provided subject to the warranty disclaimers and liability limits in the Terms of Service.\n\n" +
          "6. Termination\n" +
          "Your licence ends automatically if you breach these terms or the Terms of Service. " +
          "On termination you must stop using Phlip and uninstall copies you control, " +
          "except for data that lawfully remains on a Host’s device under the Terms.\n\n" +
          "7. Contact and changes\n" +
          "For licensing permissions beyond this document, use Contact & Bug Report or the support address on the store listing / website. " +
          "We may update this licence in future App releases; continued use after an update constitutes acceptance where permitted by law.",
      },
      {
        title: "Third-party notices",
        body:
          "Phlip includes or relies on the following third-party software and services. " +
          "Licenses below are summaries; full texts are available from each project, and the " +
          "Apache License 2.0 text for the bundled cloudflared binary ships with the app (assets/licenses). " +
          "These notices do not change Phlip’s proprietary licence above.\n\n" +
          "AndroidX / Jetpack (Core, AppCompat, Material, WebKit, SplashScreen)\n" +
          "Copyright The Android Open Source Project. Licensed under the Apache License 2.0.\n" +
          "https://developer.android.com/jetpack\n\n" +
          "Kotlin standard library\n" +
          "Copyright JetBrains s.r.o. and Kotlin contributors. Licensed under the Apache License 2.0.\n" +
          "https://github.com/JetBrains/kotlin\n\n" +
          "NanoHTTPD / nanohttpd-websocket\n" +
          "Copyright NanoHttpd. Licensed under the BSD 3-Clause License.\n" +
          "https://github.com/NanoHttpd/nanohttpd\n\n" +
          "Gson (Google)\n" +
          "Copyright Google Inc. Licensed under the Apache License 2.0.\n" +
          "https://github.com/google/gson\n\n" +
          "Google Play Billing Library\n" +
          "Copyright Google LLC. Use of Play Billing is subject to Google Play terms.\n" +
          "https://developer.android.com/google/play/billing\n\n" +
          "Google Play In-App Update (app-update)\n" +
          "Copyright Google LLC. Use is subject to Google Play terms.\n" +
          "https://developer.android.com/guide/playcore/in-app-updates\n\n" +
          "Lucide icons\n" +
          "Copyright Lucide Contributors. Licensed under the ISC License. Inline SVG line icons in the web client.\n" +
          "https://github.com/lucide-icons/lucide\n\n" +
          "cloudflared (Cloudflare Tunnel)\n" +
          "Bundled native helper for optional Public hosting. Copyright Cloudflare, Inc. " +
          "Licensed under the Apache License 2.0; Public use also subject to Cloudflare’s terms for your account.\n" +
          "https://github.com/cloudflare/cloudflared\n\n" +
          "Phlip web client assets\n" +
          "First-party HTML/CSS/JS served by the host (the Lucide icon set above is the one third-party asset). " +
          "Optional LAN crypto helper (crypto-lite) is first-party code " +
          "implementing standard SHA-256 / PBKDF2 / AES-GCM for browsers without Web Crypto on plain HTTP. " +
          "Covered by the Phlip Proprietary Software Licence above.",
      },
    ],
  };

  global.PHLIP_CONTACT = {
    title: "Contact & Bug Report",
    subtitle: "Reach the Phlip developers with questions, feedback, or something that broke.",
    sections: [
      {
        title: "How to contact us",
        body:
          "For help using Phlip, start with Help — FAQs live at phlipapp.com/FAQs.\n\n" +
          "To contact the developers directly (bugs, feedback, or account/store questions about the app itself), " +
          "use the email address below once it is published.\n\n" +
          "Email: coming soon\n\n" +
          "Until then, check the Play Store listing and phlipapp.com for updated contact details.",
      },
      {
        title: "Reporting a bug",
        body:
          "When you report a bug, include as much of this as you can:\n\n" +
          "• What you were trying to do\n" +
          "• What happened instead (exact error text if any)\n" +
          "• Whether you were Host or joining someone else’s server\n" +
          "• Local / same Wi‑Fi vs Public (Cloudflare) hosting\n" +
          "• Your device / browser (phone model, Android or iOS version, or desktop browser name)\n" +
          "• Approximate time it happened\n\n" +
          "Do not send passwords, invite passphrases, or private group chat. " +
          "Screenshots of the error screen are welcome if they don’t show private messages.",
      },
      {
        title: "What we can help with",
        body:
          "We can help with the Phlip app itself — crashes, install/update issues, hosting setup, " +
          "and Support us / Play purchases.\n\n" +
          "We cannot moderate a private group’s chat or events. For problems inside a specific server " +
          "(who can join, removed members, reported messages), contact that group’s host.",
      },
    ],
  };
})(typeof window !== "undefined" ? window : globalThis);
