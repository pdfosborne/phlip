const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const scripts = path.join(__dirname, '../phlip-web/public/scripts');
const load = (ctx, file) => vm.runInContext(fs.readFileSync(path.join(scripts, file), 'utf8'), ctx, { filename: file });

// Both create surfaces must enforce channel and type restrictions identically.
const conn = {};
const channel = { enabledCardIds: ['Coffee'] };
const cards = [{ label: 'Coffee' }, { label: 'Dinner' }, { label: 'Other', custom: true },
  { label: 'Imported' }, { label: 'Blocked' }, { label: 'Else', somethingElse: true }];
const ctx = vm.createContext({
  activeConn: () => conn, activeEventChannel: () => channel,
  eventTypeCards: () => cards, canUseEventType: c => c.label !== 'Blocked',
  isImportedEventCardLabel: label => label === 'Imported',
  eventTypeAllowedByEnabledIds: (c, ids) => ids.includes(c.label),
});
load(ctx, 'hand/hand-create-entry.js');
assert.equal(ctx.enabledEventCards().map(c => c.label).join(','), 'Coffee,Other');
assert.equal(ctx.createVisibleEventCards().map(c => c.label).join(','), 'Coffee');
assert.equal(ctx.createVisibleEventCards(conn, { channel: null }).map(c => c.label).join(','), 'Coffee,Dinner');
assert.equal(cards.length, 6, 'eligibility must not mutate the source catalog');

// Event filtering must never infer a tag from the previous message or mutate input.
load(ctx, 'shell/chatScope.js');
const messages = [{ id: 'a', mentionedEventIds: ['e', 'e'] }, { id: 'b' }, { id: 'c', eventId: 'e' }];
const filtered = ctx.messagesInEventScope(messages, 'e');
assert.equal(filtered.map(m => m.id).join(','), 'a,c');
assert.equal(filtered[0]._scopeEventId, 'e');
assert.equal(messages[0]._scopeEventId, undefined);
assert.equal(ctx.messagesInEventScope(messages, null), messages);

// The shared storage owner preserves safe fallbacks and quota-failure behavior.
const values = new Map();
const storage = vm.createContext({ localStorage: {
  getItem: k => values.get(k) ?? null,
  setItem: (k, v) => { if (k === 'full') throw Error('quota'); values.set(k, v); },
} });
storage.window = storage;
load(storage, 'boot/storage.js');
load(storage, 'hand/hand-storage.js');
assert.equal(vm.runInContext('loadJSON("missing", 42)', storage), 42);
values.set('broken', '{');
assert.equal(vm.runInContext('loadJSON("broken", 42)', storage), 42);
assert.equal(vm.runInContext('persistJSON("full", {})', storage), false);
assert.equal(vm.runInContext('persistJSON("ok", { value: 7 })', storage), true);
assert.equal(vm.runInContext('loadJSON("ok", {}).value', storage), 7);
console.log('Cleanup behavior contracts passed');
