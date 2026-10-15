/* channel-linked-feeds.js — linked event feeds + chat mirrors.
 * Globals out: openLinkedEventFeedsModal, linkedFeedsSummaryText, openLinkedChatMirrorsModal
 * Load after: render.js; before: channel-settings / channel-form-components
 */
function openLinkedEventFeedsModal(targetConnId, targetChannelId, targetName, onDone) {
  const meta = isPersonalMetaEventsLinkTarget(targetConnId, targetChannelId);
  const rows = allLinkableEventChannels(targetConnId, targetChannelId);
  const selected = new Set(
    directLinkedEventSourcesFor(targetConnId, targetChannelId).map(l => linkedFeedKey(l.connId, l.channelId))
  );
  const byServer = new Map();
  for (const row of rows) {
    if (!byServer.has(row.serverName)) byServer.set(row.serverName, []);
    byServer.get(row.serverName).push(row);
  }

  const sections = [...byServer.entries()].map(([server, list]) => `
    <div class="linked-feed-server">
      <div class="linked-feed-server-name">${esc(server)}</div>
      <div class="linked-feed-list">
        ${list.map(r => {
          const key = linkedFeedKey(r.connId, r.channelId);
          return `<label class="linked-feed-chip">
            <input type="checkbox" data-conn="${esc(r.connId)}" data-ch="${esc(r.channelId)}" ${selected.has(key) ? "checked" : ""}>
            <span>${ic("ticket", "ico-inline event-outline-icon")} ${esc(r.channelName)}</span>
          </label>`;
        }).join("")}
      </div>
    </div>`).join("");

  const opened = AshModal.open({
    className: "linked-feeds-modal",
    html: `
    <div class="modal-card">
      <h4>${meta || PersonalSpace.isPersonal(activeConn()) ? "Linked agendas" : "Linked event groups"}</h4>
      <p class="cat-hint">${meta
        ? "Choose which agendas on <b>Personal</b> appear on Events (e.g. Plans). Agendas those already link to are included automatically. Stored on this device only."
        : PersonalSpace.isPersonal(activeConn()) || targetConnId === "personal"
          ? `Show events from other agendas in <b>${esc(targetName || "this one")}</b>. Nested links pass through. Stored on this device only — pick agendas from servers you’re on.`
          : `Show events from other agendas in <b>${esc(targetName || "this one")}</b>. Nested links pass through. Stored on this device only — Personal agendas can’t be linked outbound here.`}</p>
      <div class="linked-feed-scroll">
        ${sections || `<p class="empty-note">${meta ? "No other personal agendas to link yet." : "No other agendas to link yet."}</p>`}
      </div>
      <div class="actions">
        <button type="button" class="cancel" id="linked-feeds-clear" ${rows.length ? "" : "disabled"}>Clear all</button>
        <div>
          <button type="button" class="cancel" id="linked-feeds-cancel">Cancel</button>
          <button type="button" class="save" id="linked-feeds-save">Save</button>
        </div>
      </div>
    </div>`,
    singleton: "return",
  });
  if (!opened) return;
  const { overlay, close } = opened;
  overlay.querySelector("#linked-feeds-cancel").onclick = close;
  overlay.querySelector("#linked-feeds-clear").onclick = () => {
    overlay.querySelectorAll(".linked-feed-chip input").forEach(inp => { inp.checked = false; });
  };
  overlay.querySelector("#linked-feeds-save").onclick = () => {
    const next = [...overlay.querySelectorAll(".linked-feed-chip input:checked")].map(inp => ({
      connId: inp.dataset.conn,
      channelId: inp.dataset.ch,
    }));
    setLinkedEventSources(targetConnId, targetChannelId, next);
    close();
    try { if (typeof onDone === "function") onDone(next); } catch {}
    try { renderView(); } catch {}
    try { renderSidebar(); } catch {}
  };
}

function linkedFeedsSummaryText(connId, channelId) {
  const links = directLinkedEventSourcesFor(connId, channelId);
  if (!links.length) {
    return isPersonalMetaEventsLinkTarget(connId, channelId)
      ? "None yet — add Plans or other personal agendas"
      : "None — only this channel’s events";
  }
  const labels = links.map(l => {
    const c = S.conns[l.connId];
    const ch = sourceChannelsFor(c).find(x => x.id === l.channelId);
    const server = connDisplayName(c);
    const name = ch?.name || "Events";
    return c?.id === connId || isPersonalMetaEventsLinkTarget(connId, channelId)
      ? name
      : `${server} · ${name}`;
  });
  const nested = expandedLinkedEventSourcesFor(connId, channelId).length - links.length;
  const base = labels.length <= 2 ? labels.join(", ") : `${labels.slice(0, 2).join(", ")} +${labels.length - 2} more`;
  return nested > 0 ? `${base} (+${nested} via links)` : base;
}

/** Personal: pick remote chat channels whose messages feed into this personal chat. */
function openLinkedChatMirrorsModal(personalChatId, targetName, onDone) {
  const rows = typeof allLinkableRemoteChatChannels === "function"
    ? allLinkableRemoteChatChannels() : [];
  const selected = new Set(
    (typeof directLinkedChatMirrorsFor === "function" ? directLinkedChatMirrorsFor(personalChatId) : [])
      .map(l => linkedFeedKey(l.connId, l.channelId))
  );
  const byServer = new Map();
  for (const row of rows) {
    if (!byServer.has(row.serverName)) byServer.set(row.serverName, []);
    byServer.get(row.serverName).push(row);
  }

  const sections = [...byServer.entries()].map(([server, list]) => `
    <div class="linked-feed-server">
      <div class="linked-feed-server-name">${esc(server)}</div>
      <div class="linked-feed-list">
        ${list.map(r => {
          const key = linkedFeedKey(r.connId, r.channelId);
          return `<label class="linked-feed-chip">
            <input type="checkbox" data-conn="${esc(r.connId)}" data-ch="${esc(r.channelId)}" ${selected.has(key) ? "checked" : ""}>
            <span># ${esc(r.channelName)}</span>
          </label>`;
        }).join("")}
      </div>
    </div>`).join("");

  const opened = AshModal.open({
    className: "linked-feeds-modal",
    html: `
    <div class="modal-card">
      <h4>Mirror chats</h4>
      <p class="cat-hint">Show messages from chats on servers you’ve joined in <b>${esc(targetName || "this chat")}</b>. Stored on this device only.</p>
      <div class="linked-feed-scroll">
        ${sections || `<p class="empty-note">Join a server with a chat channel to mirror it here.</p>`}
      </div>
      <div class="actions">
        <button type="button" class="cancel" id="linked-chats-clear" ${rows.length ? "" : "disabled"}>Clear all</button>
        <div>
          <button type="button" class="cancel" id="linked-chats-cancel">Cancel</button>
          <button type="button" class="save" id="linked-chats-save">Save</button>
        </div>
      </div>
    </div>`,
    singleton: "return",
  });
  if (!opened) return;
  const { overlay, close } = opened;
  overlay.querySelector("#linked-chats-cancel").onclick = close;
  overlay.querySelector("#linked-chats-clear").onclick = () => {
    overlay.querySelectorAll(".linked-feed-chip input").forEach(inp => { inp.checked = false; });
  };
  overlay.querySelector("#linked-chats-save").onclick = () => {
    const next = [...overlay.querySelectorAll(".linked-feed-chip input:checked")].map(inp => ({
      connId: inp.dataset.conn,
      channelId: inp.dataset.ch,
    }));
    setLinkedChatMirrors(personalChatId, next);
    close();
    try { if (typeof onDone === "function") onDone(next); } catch {}
    try { renderView(); } catch {}
    try { renderSidebar(); } catch {}
  };
}

/** Channels with the §7 standing rule — shown before minting an invite link. */

