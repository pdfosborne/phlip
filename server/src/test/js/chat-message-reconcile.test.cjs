const fs = require("fs");
const path = require("path");
const assert = require("assert");

const source = fs.readFileSync(
  path.resolve(__dirname, "../../../../../phlip-web/public/scripts/handlers/handlers-dispatch.js"),
  "utf8",
);
const { handle, reconcileAuthoritativeChatMessage } = new Function(
  `${source}; return { handle, reconcileAuthoritativeChatMessage };`,
)();

globalThis.S = { activeConnId: "server-1", activeView: { kind: "channel", id: "chat-1" } };
globalThis.Panel = { channelOpen: () => false, channelState: () => null };
globalThis.markChannelRead = () => {};
globalThis.cacheConn = () => {};
globalThis.renderView = () => {};
globalThis.renderSidebar = () => {};
globalThis.syncChannelInfoBtn = () => {};
globalThis.refreshActiveChatIncrementally = () => true;
globalThis.decMsg = async (message) => { message._text = "hello"; };

(async () => {
  const optimistic = {
    id: "client-message-1", channelId: "chat-1", userId: "me",
    text: "ciphertext", _text: "hello", syncStatus: "pending",
  };
  const conn = {
    id: "server-1", key: {}, me: { id: "me" },
    messages: { "chat-1": [optimistic] },
  };
  const wire = {
    id: optimistic.id, channelId: optimistic.channelId, userId: "me",
    name: "Me", text: optimistic.text, ts: 123,
  };

  const merged = reconcileAuthoritativeChatMessage(conn, wire);
  assert.strictEqual(merged, optimistic, "authoritative data must retain optimistic object identity");
  assert.equal(merged._text, "hello", "identical ciphertext must retain visible plaintext");
  assert.equal(merged.syncStatus, "synced");
  assert.equal(conn.messages["chat-1"].length, 1, "reconciliation must not duplicate messages");

  // Ack-before-broadcast must not alter the same-object merge behavior.
  handle(conn, { type: "messageAck", id: wire.id, accepted: true });
  handle(conn, { type: "message", message: wire });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.strictEqual(conn.messages["chat-1"][0], optimistic);
  assert.equal(conn.messages["chat-1"][0]._text, "hello");
  assert.equal(conn.messages["chat-1"].length, 1);

  // A remote message must be decrypted on the exact object inserted into conn.
  const remote = { id: "remote-message-1", channelId: "chat-1", userId: "other", text: "remote-cipher", ts: 124 };
  handle(conn, { type: "message", message: remote });
  await new Promise(resolve => setTimeout(resolve, 0));
  const storedRemote = conn.messages["chat-1"].find(message => message.id === remote.id);
  assert.equal(storedRemote._text, "hello");

  // Broadcast-before-ack remains deduplicated and ends synced.
  handle(conn, { type: "messageAck", id: remote.id, accepted: true });
  assert.equal(storedRemote.syncStatus, "synced");
  assert.equal(conn.messages["chat-1"].filter(message => message.id === remote.id).length, 1);

  console.log("chat message reconciliation tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
