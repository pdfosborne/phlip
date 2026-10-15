/* channel-suggestions.js — event shared-notes binding (event chat sheet).
 * Globals out: bindEventNotesSection
 * The detail popup's suggestions / alternatives UI is archived (archive/web/E1-event-detail-popup).
 * Load after: channel-chains.js; before: channel.js facade
 */

function bindEventNotesSection(root, ev) {
  if (!root || !ev) return;
  const scope = root;
  const conn = ownerConnFor(ev) || activeConn();
  const eventId = ev.id;

  scope.querySelector("#event-note-shared-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = scope.querySelector("#event-note-shared-input");
    const text = (input?.value || "").trim();
    if (!text || !conn) return;
    const noteId = typeof genLocalId === "function" ? genLocalId() : undefined;
    send({
      type: "eventNote",
      eventId,
      noteId,
      noteKind: "shared",
      pinned: true,
      text: await encrypt(text, conn.key),
    }, conn.id);
    input.value = "";
    toast("Shared note added");
  });

  scope.querySelectorAll(".event-note-del").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const payload = {
        type: "deleteEventNote",
        eventId,
        noteId: btn.dataset.noteId || undefined,
        noteTs: Number(btn.dataset.noteTs) || undefined,
        noteUserId: btn.dataset.noteUser || undefined,
      };
      if (typeof ashUndoSnackbar === "function" && typeof hideLocalEventNote === "function") {
        ashUndoSnackbar({
          message: "Note deleted · Undo",
          hide: () => hideLocalEventNote(ev, payload),
          restore: restoreLocalEventNote,
          commit: () => send(payload, conn.id),
          refresh: () => {
            if (typeof renderView === "function") renderView(true);
          },
        });
        return;
      }
      send(payload, conn.id);
    });
  });
}
