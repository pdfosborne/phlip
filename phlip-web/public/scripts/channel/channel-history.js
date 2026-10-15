/* channel-history.js — shared-history + Memories history board render.
 * Globals out: renderSharedHistory, renderHistory, sharedHistoryEvents
 * Load after: channel-members.js; before: channel-agenda.js
 * Note: collatedChatMessages lives in channel-chat.js
 */

function renderSharedHistory(view, otherUserId) {
  view.style.cssText = "display:flex;flex-direction:column;flex:1;min-height:0";
  const other = S.members.find(u => u.id === otherUserId);
  const events = sharedHistoryEvents(otherUserId);
  view.innerHTML = `
    <div class="events-scroll no-tray"><div class="events-wrap">
      <div class="board-head">
        <button type="button" class="text-btn" id="shared-back">← People</button>
        <h4>Shared with ${esc(other?.name || "member")}</h4>
        <p class="empty-note" style="margin:4px 0 0">${events.length} event${events.length === 1 ? "" : "s"} you’re both in${other && isBlocked(otherUserId) ? " · Blocked" : ""}</p>
      </div>
      <div id="shared-actions" class="people-actions" style="margin:0 0 12px;justify-content:flex-start"></div>
      <div id="shared-list"></div>
    </div></div>`;
  view.querySelector("#shared-back").onclick = () => {
    Nav.landDefault();
    try { landOnTodayWeekView(); } catch {}
    renderSidebar();
    renderView();
    if (typeof openChannelPanelMode === "function") {
      openChannelPanelMode("info", activeChannelForPanel()?.id || null, { tab: "people", peopleSub: "server" });
    }
  };
  const actions = view.querySelector("#shared-actions");
  if (actions && other && canReport() && otherUserId !== S.me?.id) {
    const blocked = isBlocked(otherUserId);
    const blockBtn = document.createElement("button");
    blockBtn.type = "button";
    blockBtn.className = "people-btn" + (blocked ? " on" : "");
    blockBtn.textContent = blocked ? "Unblock" : "Block";
    blockBtn.onclick = async () => {
      const name = other.name || "this member";
      if (!blocked) {
        if (setMemberBlocked(otherUserId, true)) {
          if (typeof ashUndoSnackbar === "function") {
            ashUndoSnackbar({
              message: `Blocked ${name} · Undo`,
              hide: () => true,
              restore: () => setMemberBlocked(otherUserId, false),
              commit: null,
              refresh: () => renderSharedHistory(view, otherUserId),
            });
          } else {
            toast(`Blocked ${name}`);
            renderSharedHistory(view, otherUserId);
          }
        }
      } else if (setMemberBlocked(otherUserId, false)) {
        toast(`Unblocked ${name}`);
        renderSharedHistory(view, otherUserId);
      }
    };
    actions.appendChild(blockBtn);
  }
  const box = view.querySelector("#shared-list");
  if (!events.length) {
    box.innerHTML = `<p class="empty-note">No shared events yet — RSVP or chat on the same plans to build history.</p>`;
    return;
  }
  for (const ev of events) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "shared-event-card";
    const when = ev.when ? fmtDay(ev.when) : "Time TBD";
    card.innerHTML = `<strong>${esc(eventDisplayTitle(ev) || "Event")}</strong><span>${esc(when)}</span>`;
    card.onclick = () => {
      Nav.openEventDetail(ev.id);
      renderSidebar();
      renderView();
    };
    box.appendChild(card);
  }
}

