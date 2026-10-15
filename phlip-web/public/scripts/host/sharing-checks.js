/* Required acknowledgements. Native gates remain the authority for enabling. */
function hostGuidePaintAck(parent, setup, consent, refresh, key, prefix, call, title, summary) {
  buildHostAckCard({ id: `sharing-${key}`, parent, done: !!setup[key], compact: true,
    title, summary: setup[key] ? "Acknowledged" : summary,
    bodyText: consent[`${prefix}Body`] || summary, acceptLabel: "I understand and accept",
    onAccept: () => hostCall(call),
  }, refresh);
}
function hostGuidePaintChecks(parent, pick, setup, consent, refresh) {
  hostGuidePaintAck(parent, setup, consent, refresh, "rulesAccepted", "hostRules", "acceptHostRules", "Hosting responsibilities", "You control who joins and what is posted. Group data is stored on this phone; you are responsible for running the group.");
  if (pick === "public") {
    hostGuidePaintAck(parent, setup, consent, refresh, "alphaAckAccepted", "alpha", "acceptAlphaAck", "Alpha software", "This version is still being tested. Features may fail and data may be lost; keep backups.");
    const done = !!setup.devicePrepAccepted && !!setup.publicRiskAck;
    const summary = "This phone is reachable on the internet through your domain. Keep it updated. Membership rules still decide who can join.";
    buildHostAckCard({ id: "sharing-internet-hosting", parent, done, compact: true,
      title: "Internet hosting",
      summary: done ? "Acknowledged" : summary,
      bodyText: "People can reach this server from anywhere through your domain. Keep this phone updated, and consider a dedicated device for hosting. Anyone with an invite can request to join; you still approve them. Sharing does not change your membership or board permissions. The phone needs to stay powered and online.",
      acceptLabel: "I understand and accept",
      onAccept: () => {
        const device = hostCall("acceptDevicePrep");
        if (device?.ok === false) return device;
        return hostCall("acceptPublicRiskAck");
      },
    }, refresh);
    hostGuidePaintAck(parent, setup, consent, refresh, "patchAckSatisfied", "patch", "acceptPatchWarning", "Device security", `Security patch: ${setup.patchLabel || "unknown"}. An outdated device has additional security risks.`);
    hostGuidePaintAck(parent, setup, consent, refresh, "operatorAck", "operator", "acceptOperatorAck", "Host responsibility", "You operate this service and are responsible for the community and its content.");
    hostGuidePaintAck(parent, setup, consent, refresh, "dataAck", "data", "acceptDataAck", "Cloudflare data handling", "Internet connections pass through Cloudflare. Review what information the provider handles.");
  }
  if (pick === "public" && setup.belowMinSafe) {
    shareGuideText(parent, "Update Phlip before enabling Internet sharing.").className = "host-server-error";
    shareGuideButton(parent, "Check for updates", () => { hostCall("checkHostUpdates"); setTimeout(refresh, 1200); });
  }
  if (pick === "public" && !setup.cloudflareConfigured) {
    shareGuideText(parent, "Connect your Cloudflare domain in Setup before continuing.");
    shareGuideButton(parent, "Back to setup", () => hostGuideSetStep(1));
  }
}
