/* channel-chains.js — chain status helpers + strip/row wiring.
 * Globals out: chainStatusOf, appendChainStrip, …
 * Load after: channel-ticket-cards.js; before: channel-suggestions.js
 */

function chainStatusOf(ev) {
  if (!ev?.chainOf) return null;
  return ev.chainStatus === "linked" ? "linked" : "proposal";
}

function chainModeOf(primaryEv) {
  return primaryEv?.chainMode === "choice" ? "choice" : "sequence";
}

function chainReactionCount(ev) {
  // reactions is { userId → emoji|"emoji|count" }, not { emoji → [userIds] }.
  // Summing string .length made "👍" count as 2.
  const rx = ev?.reactions || {};
  let n = 0;
  for (const v of Object.values(rx)) {
    if (typeof rxParts === "function") {
      const p = rxParts(v);
      if (p.emoji) n += Math.max(1, p.count || 1);
    } else if (v) {
      n += 1;
    }
  }
  return n;
}

function chainLeadId(links) {
  let bestId = null, best = -1;
  for (const ev of links || []) {
    const n = chainReactionCount(ev);
    if (n > best) { best = n; bestId = ev.id; }
  }
  return best > 0 ? bestId : null;
}

/** Bare avatar for the proposer (021 — drop Host/name chip). */
function chainProposerAvatarHTML(ev) {
  if (eventOrganiserEmpty(ev)) {
    return `<span class="chain-chip-av avatar-sm avatar-empty" title="Former organiser" aria-hidden="true"></span>`;
  }
  const id = ev?.createdBy;
  if (!id) return "";
  const name = eventOrganiserName(ev) || "someone";
  return `<span class="chain-chip-av" title="Suggested by ${esc(name)}">${avatarStack([id], 1)}</span>`;
}

function chainChipTimeLabel(ev) {
  if (!ev?.when) return "";
  if (ev.whenPrecision === "unconfirmed") return "TBD";
  if (ev.whenPrecision === "day") return "All day";
  if (ev.whenPrecision === "period") {
    return (typeof DAY_PERIODS !== "undefined" && DAY_PERIODS?.find?.(p => p.id === ev.whenPeriod)?.label)
      || ev.whenPeriod || "";
  }
  return typeof fmtTime === "function" ? fmtTime(ev.when) : "";
}

/**
 * Build one chip element for the attached strip.
 * @param {{ leadId?: string }} [opts]
 * @returns {HTMLElement}
 */
function chainChipEl(ev, primaryEv, { leadId } = {}) {
  const status = chainStatusOf(ev);
  const linked = status === "linked";
  const warn = linked && !!ev.chainDepWarnWhen;
  const lead = !linked && chainModeOf(primaryEv) === "choice" && leadId && ev.id === leadId;
  const className = "chain-chip"
    + (linked ? " chain-chip-real" : " chain-chip-prop")
    + (warn ? " chain-chip-warn" : "")
    + (lead ? " chain-chip-lead" : "")
    + (ev._pending ? " pending-sync" : "");
  const count = chainReactionCount(ev);
  const payload = linked
    ? `<span class="chain-chip-tm">${esc(chainChipTimeLabel(ev))}</span>`
    : (count ? `<span class="chain-chip-cnt">👍 ${count}</span>` : "");
  const warnIcon = warn
    ? `<span class="chain-chip-wi" aria-hidden="true">!</span>`
    : "";
  const bodyHTML = `
    <span class="chain-chip-nm">${esc(eventDisplayTitle(ev))}</span>
    ${payload}
    ${warnIcon}
    ${chainProposerAvatarHTML(ev)}`;
  const aria = linked
    ? `${eventDisplayTitle(ev)} · ${chainChipTimeLabel(ev) || "linked"}`
    : `${eventDisplayTitle(ev)}${count ? ` · ${count} reactions` : " · proposal"}`;

  const el = document.createElement("button");
  el.type = "button";
  el.className = className;
  el.dataset.id = ev.id;
  el.dataset.focusKey = "ev:" + ev.id;
  if (primaryEv?.id) el.dataset.chainOf = primaryEv.id;
  el.innerHTML = bodyHTML;
  el.setAttribute("aria-label", aria);
  {
    const { accent } = (typeof catStyleFor === "function")
      ? catStyleFor(ev)
      : { accent: "var(--sage)" };
    el.style.setProperty("--accent", accent);
  }
  return el;
}

function chainConnectorHTML(mode, index) {
  if (index === 0) return `<span class="chain-strip-ar" aria-hidden="true">→</span>`;
  if (mode === "choice") return `<span class="chain-strip-or" aria-hidden="true">or</span>`;
  return `<span class="chain-strip-ar" aria-hidden="true">→</span>`;
}

/**
 * 021 — attached strip under the primary ticket (replaces separate chain-row).
 * Call with the primary ticket element already in the DOM.
 */
function appendChainStrip(primaryEl, links, primaryEv) {
  if (!primaryEl || !links?.length || !primaryEv) return;
  // Expire proposal chips when the parent has passed; keep linked.
  const parentPast = primaryEv.when != null && primaryEv.when < Date.now() - 3 * 3600e3;
  const visible = parentPast
    ? links.filter(e => chainStatusOf(e) === "linked")
    : links;
  if (!visible.length) return;

  primaryEl.classList.add("has-chain-strip");
  const strip = document.createElement("div");
  strip.className = "chain-strip";
  strip.dataset.chainOf = primaryEv.id;
  strip.setAttribute("role", "list");
  strip.setAttribute("aria-label", "What's next");

  const mode = chainModeOf(primaryEv);
  const leadId = mode === "choice" ? chainLeadId(visible) : null;
  const scroll = document.createElement("div");
  scroll.className = "chain-strip-scroll";

  visible.forEach((link, i) => {
    const wrap = document.createElement("div");
    wrap.className = "chain-strip-item";
    wrap.setAttribute("role", "listitem");
    wrap.innerHTML = chainConnectorHTML(mode, i);
    wrap.appendChild(chainChipEl(link, primaryEv, { leadId }));
    scroll.appendChild(wrap);
  });
  strip.appendChild(scroll);

  // Dependency alert under strip when any linked child is warned.
  const warned = visible.find(e => e.chainDepWarnWhen && chainStatusOf(e) === "linked");
  if (warned) {
    const parentLabel = typeof fmtTime === "function" && primaryEv.when
      ? (primaryEv.whenPrecision === "day" ? "that day"
        : primaryEv.whenPrecision === "period"
          ? (DAY_PERIODS?.find?.(p => p.id === primaryEv.whenPeriod)?.label || "a new time")
          : fmtTime(primaryEv.when))
      : "a new time";
    const alert = document.createElement("div");
    alert.className = "chain-dep-alert";
    alert.innerHTML = `<span class="chain-dep-alert-ico" aria-hidden="true">!</span>`
      + `<span><b>${esc(typeof eventDisplayTitle === "function" ? eventDisplayTitle(primaryEv) : shown(primaryEv._title))}</b> moved to ${esc(parentLabel)}. `
      + `<b>${esc(typeof eventDisplayTitle === "function" ? eventDisplayTitle(warned) : shown(warned._title))}</b> may need changing.</span>`;
    strip.appendChild(alert);
  }

  primaryEl.appendChild(strip);
}

