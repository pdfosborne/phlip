/* Per-server sharing controls; phone-wide controls live in Hosting on this phone. */
const _sharingAdvancedOpen = Object.create(null);
function renderServerSharing(body, s, setup, running) {
  body.replaceChildren();
  const main = document.createElement("div");
  main.className = "sharing-settings";
  body.appendChild(main);
  const device = s.reachMode === "device" && !s.isPublic;
  const title = document.getElementById("side-overlay-title");
  if (title) title.textContent = `Sharing · ${s.name || "Server"}`;
  const start = () => openHostingGuide(s.id, { fromHost: true });
  shareGuideText(main, hostSharingLabel(s), "h3");
  if (device) {
    shareGuideText(main, "Only available on this phone.");
    shareGuideButton(main, "Set up sharing", start, true);
  } else {
    const ready = Object.values(s.sharingReady || {}).some(Boolean);
    for (const pick of [s.reachMode, ...(s.isPublic ? ["public"] : [])]) {
      if (pick !== "device") shareGuideText(main, hostSharingMessage(s, setup, pick));
    }
    shareGuideButton(main, "Invite people", () => hostSharingInvite(s), true).disabled = !ready;
    shareGuideButton(main, "Change sharing", start);
    shareGuideButton(main, "Return to device only", async () => {
      if (!(await ashConfirm(`Stop sharing “${s.name}”? People will disconnect. Its data stays on this phone and other servers keep running.`))) return;
      const res = hostCall("returnServerToDeviceOnly", s.id);
      if (res?.ok === false) toast(res.error || "Could not stop sharing");
      else { try { localStorage.removeItem(`phlip.sharingSetup.${s.id}`); } catch {} }
      readHostStatus(); refreshHostSettingsPanel();
    }).classList.add("sharing-text-link");
    const availability = document.createElement("section");
    main.appendChild(availability);
    shareGuideText(availability, "Availability", "h4");
    shareGuideText(availability, "Keep this phone powered and connected while people need access.");
    if (s.reachMode === "local" || s.isPublic) {
      appendHostNetworkPausedBanner(availability, setup);
      appendApprovedNetworksButton(availability);
    }
    if (s.reachMode === "direct") availability.appendChild(buildHostHotspotSection(s));
    const advanced = document.createElement("details");
    advanced.className = "sharing-advanced";
    advanced.open = !!_sharingAdvancedOpen[s.id];
    advanced.ontoggle = () => { _sharingAdvancedOpen[s.id] = advanced.open; };
    shareGuideText(advanced, "Advanced", "summary");
    if (s.isPublic || setup.cloudflareConfigured) {
      shareGuideButton(advanced, "Domain and credentials", () => hostCall("openCloudflareSetup"));
    }
    if (s.isPublic) shareGuideButton(advanced, "Turn off Internet sharing", async () => {
      if (!(await ashConfirm("Turn off Internet sharing? Nearby sharing will keep its current setting."))) return;
      const res = hostCall("setPublicHosting", s.id, false);
      if (res?.ok === false) toast(res.error || "Could not turn off Internet sharing");
      readHostStatus(); refreshHostSettingsPanel();
    });
    if (s.reachMode !== "device") shareGuideButton(advanced, "Turn off nearby sharing", async () => {
      if (!(await ashConfirm("Turn off nearby sharing? Internet sharing will keep its current setting."))) return;
      const res = hostCall("setReachMode", s.id, "device");
      if (res?.ok === false) toast(res.error || "Could not turn off nearby sharing");
      readHostStatus(); refreshHostSettingsPanel();
    });
    advanced.appendChild(buildHostedServerCard(s, setup, { page: true, advanced: true }));
    main.appendChild(advanced);
  }
  if (!running) appendHostStartButton(main);
  shareGuideButton(main, "Hosting on this phone", () => openHostSettingsPanel("hostSetup")).classList.add("sharing-text-link");
}
