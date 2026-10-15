/* handlers-clone.js — local member purge + hotspot first-join flag.
 * Load after: net.js; before: handlers-dispatch.js
 */

function applyLocalMemberPurge(conn, userId) {
  if (!conn || !userId) return;
  for (const ev of (conn.events || [])) {
    if (ev.createdBy === userId) {
      ev.createdBy = "";
      ev.createdByName = "";
    }
    if (ev.stickerBy === userId) {
      ev.stickerBy = null;
      ev.stickerByName = null;
    }
    if (ev.rsvps) delete ev.rsvps[userId];
    if (ev.reactions) {
      delete ev.reactions[userId];
      if (!Object.keys(ev.reactions).length) ev.reactions = null;
    }
    if (ev.addedBy) {
      delete ev.addedBy[userId];
      for (const [k, v] of Object.entries(ev.addedBy)) {
        if (v === userId) delete ev.addedBy[k];
      }
      if (!Object.keys(ev.addedBy).length) ev.addedBy = null;
    }
    if (Array.isArray(ev.notes)) {
      ev.notes = ev.notes.filter(n => n.userId !== userId);
      for (const n of ev.notes) {
        if (Array.isArray(n.mentionedUserIds)) {
          n.mentionedUserIds = n.mentionedUserIds.filter(id => id !== userId);
        }
      }
      if (!ev.notes.length) ev.notes = null;
    }
  }
  const msgs = conn.messages || {};
  for (const chId of Object.keys(msgs)) {
    const list = (msgs[chId] || []).filter(msg => msg.userId !== userId);
    for (const msg of list) {
      if (Array.isArray(msg.mentionedUserIds)) {
        msg.mentionedUserIds = msg.mentionedUserIds.filter(id => id !== userId);
      }
    }
    if (list.length) msgs[chId] = list;
    else delete msgs[chId];
  }
  conn.messages = msgs;
  conn.reports = (conn.reports || []).filter(r =>
    r.reporterId !== userId && !(r.targetType === "user" && r.targetId === userId));
  conn.notifications = (conn.notifications || []).filter(n => n.fromUserId !== userId);
  if (Array.isArray(conn.blocked)) conn.blocked = conn.blocked.filter(id => id !== userId);
}

// Handles a message from one specific conn's socket (or the personal echo
// loop). Reads/writes conn.* directly — never the S.* accessors, which follow
// whatever conn is active on screen and would silently corrupt a background
// conn's data if used here.
// Set when a joiner is waiting on manual Wi-Fi connect (hotspot first-join flow).
let _hotspotFirstJoin = null;
