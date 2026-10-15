// Board All chat smoke test (Oct 2026 chat model).
//
// Runs the demo build in headless Chromium at phone size and checks the main
// All chat behaviours: event bar and list, jump + stepper + Back, #label focus,
// tagging without filtering, tag prefill after a jump, one-tap RSVP, the event
// card, selection's "Add to #Event", the create card and the event page tabs.
//
// Setup once (from phlip-web/):   npm i --no-save playwright && npx playwright install chromium
// Run (from the repo root):       node phlip-web/tools/smoke/board-chat-smoke.mjs
// Options: --headed (watch it), --shots DIR (save a screenshot per check),
//          --browser PATH (use an existing Chromium instead of the installed one)
//
// Exits 1 if any check fails. Uses a fixed clock (Tue 13 Oct 2026, 15:30) so
// dates in the demo data are stable.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', 'public');
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const shots = opt('--shots');
if (shots) fs.mkdirSync(shots, { recursive: true });

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('Playwright is not installed. From phlip-web/: npm i --no-save playwright && npx playwright install chromium');
  process.exit(2);
}

// --- static server for phlip-web/public -----------------------------------
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  let file = path.join(root, url === '/' ? 'index.html' : url);
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/?demo=1`;

// --- browser ---------------------------------------------------------------
const browser = await chromium.launch({ headless: !args.includes('--headed'), executablePath: opt('--browser') || undefined });
const FIXED = new Date(2026, 9, 13, 15, 30).getTime();
const errors = [];

async function freshPage() {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 732 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.clock.setFixedTime(FIXED);
  await p.goto(base, { waitUntil: 'load' });
  await p.waitForFunction(() => typeof boardEventNavItems === 'function' && document.querySelector('#chat-scroll'), null, { timeout: 15000 });
  await p.waitForTimeout(1500);
  await seed(p);
  return p;
}

// Demo data plus a few events in every RSVP state and some event chat.
async function seed(p) {
  await p.evaluate(() => {
    const conn = activeConn();
    const list = conn.messages[S.activeView.id];
    const me = conn.me?.id || 'me';
    const now = Date.now();
    const base = conn.events.find((e) => e.id === 'fr-quiz');
    const mk = (id, title, icon, days, rsvps) => conn.events.push({ ...base, id, title, _title: title, icon, when: now + days * 864e5, createdAt: now - 2 * 864e5, rsvps: rsvps || {}, notes: [] });
    mk('sm-walk', 'Sunday walk', 'mountains', 6);
    mk('sm-flat', 'Flat viewing', 'house', 3, { [me]: 'going' });
    mk('sm-fives', '5-a-side', 'football', 2, { [me]: 'out' });
    let k = 0;
    const t = now - 3 * 3600e3;
    const add = (text, name, uid, eventId) => { k++; list.push({ id: 'sm' + k, ts: t + k * 9 * 60e3, _text: text, text, name, userId: uid, eventId, conversationId: eventId ? 'event-' + eventId : 'sm' + k }); };
    add('Heath on Sunday?', 'Sam', 'u0', 'sm-walk');
    add('Bring boots', 'Jo', 'u1', 'sm-walk');
    add('lol the match', 'Alex', 'u3');
    add('Viewing Thu 6pm', 'Zara', 'u2', 'sm-flat');
    add('Need 2 more for Wednesday', 'Alex', 'u3', 'sm-fives');
    add('anyone free later', 'Zara', 'u2');
    list.sort((a, b) => a.ts - b.ts);
    renderView(true);
    const s = document.querySelector('#chat-scroll');
    s.scrollTop = s.scrollHeight;
  });
  await p.waitForTimeout(600);
}

const results = [];
async function check(name, fn) {
  const p = await freshPage();
  try {
    await fn(p);
    results.push([name, true]);
    console.log(`  ok    ${name}`);
  } catch (e) {
    results.push([name, false]);
    console.log(`  FAIL  ${name}\n        ${String(e.message).split('\n')[0]}`);
  }
  if (shots) await p.screenshot({ path: path.join(shots, name.replace(/[^\w]+/g, '-') + '.png') }).catch(() => {});
  await p.context().close();
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const text = (p, sel) => p.evaluate((s) => document.querySelector(s)?.innerText.replace(/\s+/g, ' ').trim() || '', sel);

console.log('Board chat smoke');

await check('feed: events lead (icon, face chip), connected chains, no reply buttons, no event colours', async (p) => {
  const r = await p.evaluate(() => {
    const s = document.querySelector('#chat-scroll');
    const evMsgs = [...s.querySelectorAll('.msg[data-event]')].filter((m) => !m.closest('.board-event-card'));
    const leads = evMsgs.filter((m) => m.querySelector(':scope > .msg-ev-lead')).length;
    const chips = evMsgs.filter((m) => m.classList.contains('head-gap')).every((m) => m.querySelector('.msg-meta .msg-who-face'));
    const plain = [...s.querySelectorAll('.msg:not([data-event])')].filter((m) => m.classList.contains('head-gap') && !m.closest('.board-event-card'));
    const handles = plain.every((m) => m.querySelector(':scope > .avatar'));
    // A chain is one connected line: the rail above every branch (a later
    // speaker) reaches the top of its curve, and stacked lines get none.
    const chainMsgs = [...s.querySelectorAll('.msg.chain-next, .msg.chain-prev')];
    const chainOk = chainMsgs.every((m, i) => {
      if (!m.classList.contains('chain-prev')) return true;
      const b = getComputedStyle(m, '::before');
      if (!m.classList.contains('head-gap')) return b.display === 'none';
      const prev = chainMsgs[i - 1];
      if (!prev || !prev.classList.contains('chain-next')) return false;
      // The rail above reaches this line; the branch leaves the rail's edge at
      // a height the rail covers (its own stub on the last speaker).
      const railBottom = prev.getBoundingClientRect().bottom - parseFloat(getComputedStyle(prev, '::after').bottom);
      const top = m.getBoundingClientRect().top;
      const own = getComputedStyle(m, '::after');
      const reach = m.classList.contains('chain-end') ? top + parseFloat(own.top) + parseFloat(own.height) : Infinity;
      const branchY = top + parseFloat(b.top) + parseFloat(b.height);
      return b.display !== 'none' && railBottom >= top - 0.5 && reach >= branchY - 0.5 && parseFloat(b.left) === parseFloat(getComputedStyle(prev, '::after').left) + 2;
    });
    return {
      bar: document.querySelector('#board-event-bar')?.innerText || '',
      labels: s.querySelectorAll('.msg-event-tag').length,
      chained: s.querySelectorAll('.msg.chain-next, .msg.chain-prev').length,
      evMsgs: evMsgs.length,
      leads, chips, handles, chainOk,
      replyButtons: s.querySelectorAll('.msg-event-continue, [data-board-reply]').length,
      inlineColour: document.querySelectorAll('#view [style*="--run"], #view [style*="--ev:"]').length,
      filtered: !!S.chatFilterEventId,
    };
  });
  expect(/up next|now|events/i.test(r.bar), `event bar missing (got "${r.bar}")`);
  expect(r.labels > 0, 'no #labels in the feed');
  expect(r.chained >= 2, 'no chains (sm-walk has two messages in a row)');
  expect(r.leads === r.evMsgs && r.leads > 0, `event messages lead with the event icon (${r.leads}/${r.evMsgs})`);
  expect(r.chips, 'event messages show the sender as a face chip on the name line');
  expect(r.handles, 'general chat keeps the face');
  expect(r.chainOk, 'chain rails should be connected');
  expect(r.replyButtons === 0, `${r.replyButtons} reply buttons on messages`);
  expect(r.inlineColour === 0, `${r.inlineColour} elements carry an event colour`);
  expect(!r.filtered, 'All chat should not start filtered');
});

await check('event list: rows by RSVP state, by date only, one-tap answer', async (p) => {
  await p.click('[data-event-nav-toggle]');
  await p.waitForSelector('#board-event-list');
  const rows = await p.evaluate(() => [...document.querySelectorAll('#board-event-list .board-event-row')].map((r) => ({
    st: (r.className.match(/is-rsvp-(\w+)/) || [])[1], answer: !!r.querySelector('[data-event-nav-answer]'), id: r.querySelector('[data-event-nav-go]')?.dataset.eventNavGo,
  })));
  expect(rows.some((r) => r.st === 'need' && r.answer), 'no "needs RSVP" row with ✓ / ✕');
  expect(rows.every((r) => r.answer === (r.st === 'need')), 'only "needs RSVP" rows have ✓ / ✕');
  expect(rows.some((r) => r.st === 'out'), 'no "can\'t go" row');
  expect(!(await p.$('[data-event-nav-sort]')), 'the list should have no sort control');
  const walk = rows.find((r) => r.id === 'sm-walk');
  expect(walk && walk.st === 'need', 'Sunday walk should need an answer');
  await p.click('[data-event-nav-answer="yes"][data-event-id="sm-walk"]');
  await p.waitForTimeout(400);
  const st = await p.evaluate(() => boardEventRsvpState(boardFindEvent('sm-walk', null, activeConn())));
  expect(st === 'going', `after ✓ the state is ${st}`);
  const snack = await p.evaluate(() => document.body.innerText.includes('Change'));
  expect(snack, 'no "Change" notice after answering');
});

await check('jump: list row pans with a stepper, never filters; Back returns', async (p) => {
  const total = await p.evaluate(() => document.querySelectorAll('#chat-scroll .msg[data-msg-id]').length);
  await p.click('[data-event-nav-toggle]');
  await p.click('#board-event-list [data-event-nav-go]');
  await p.waitForTimeout(1000);
  const r = await p.evaluate(() => ({ step: document.querySelector('#board-event-stepper')?.innerText.replace(/\s+/g, ' ') || '', list: !!document.querySelector('#board-event-list'), msgs: document.querySelectorAll('#chat-scroll .msg[data-msg-id]').length, filtered: !!S.chatFilterEventId, src: S.boardEventStep?.source }));
  expect(/^#/.test(r.step), `no event bar (got "${r.step}")`);
  expect(!r.list, 'list should close after a jump');
  expect(!r.filtered && r.msgs === total, 'a jump must not filter the chat');
  expect(r.src === 'nav', `step source ${r.src}`);
  const back = await p.evaluate(() => ashBackCloseTopLayer());
  await p.waitForTimeout(500);
  const gone = await p.evaluate(() => !S.boardEventStep);
  expect(back && gone, 'Back should end the jump');
});

await check('#label opens its event page (the icon is how you focus)', async (p) => {
  const id = await p.evaluate(() => {
    boardActiveMessages().push({ id: 'lb1', ts: Date.now(), _text: 'see you there', text: 'see you there', name: 'Jo', userId: 'u1', eventId: 'fr-quiz', conversationId: 'event-fr-quiz' });
    renderView(true);
    const t = [...document.querySelectorAll('#chat-scroll .msg-event-tag')].filter((el) => el.getClientRects().length).pop();
    t.scrollIntoView({ block: 'center' });
    t.dataset.smokeTarget = '1';
    return t.dataset.eventTag;
  });
  await p.waitForTimeout(300);
  await p.click('#chat-scroll .msg-event-tag[data-smoke-target="1"]');
  await p.waitForTimeout(800);
  const r = await p.evaluate(() => ({ page: S.conversationsThread?.eventId || null, step: S.boardEventStep?.eventId || null }));
  expect(r.page === id && !r.step, `#label should open the event page (${JSON.stringify(r)})`);
});

await check('focus: other events hidden, general chat at half, focus tags the box; icon again releases', async (p) => {
  const id = await p.evaluate(() => {
    const el = [...document.querySelectorAll('#chat-scroll .msg:not(.chain-prev) > .msg-ev-lead')].pop();
    el.scrollIntoView({ block: 'center' });
    return el.closest('.msg').dataset.event;
  });
  await p.waitForTimeout(300);
  const lead = `#chat-scroll .msg[data-event="${id}"]:not(.chain-prev) > .msg-ev-lead >> nth=-1`;
  await p.click(lead);
  await p.waitForTimeout(700);
  const r = await p.evaluate((id) => {
    const other = [...document.querySelectorAll('#chat-scroll .msg[data-event]')].find((m) => m.dataset.event && m.dataset.event !== id);
    const general = document.querySelector('#chat-scroll .board-msg-run:not([data-event])');
    return { step: S.boardEventStep?.eventId, tag: boardDestinationState.value?.eventId || null, otherShown: other ? other.getClientRects().length > 0 : null, general: general ? Number(getComputedStyle(general).opacity) : null, eye: !!document.querySelector('[data-event-step-others]') };
  }, id);
  expect(r.step === id && r.tag === id, `focus + tag for ${id} (${JSON.stringify(r)})`);
  expect(r.otherShown === null || r.otherShown === false, 'other events should be hidden while focused');
  expect(!r.eye, 'no eye: other events stay hidden');
  expect(r.general === null || r.general <= 0.5, `general chat fades to half (${r.general})`);
  await p.click(lead);
  await p.waitForTimeout(500);
  expect(await p.evaluate(() => !S.boardEventStep && !boardDestinationState.value), 'the icon again releases focus and tag');
});

await check('# tag: picker, chip, stepper, no filter; the stepper ✕ removes', async (p) => {
  const total = await p.evaluate(() => document.querySelectorAll('#chat-scroll .msg[data-msg-id]').length);
  await p.click('#board-compose-add');
  await p.waitForTimeout(300);
  const open = await p.evaluate(() => !document.querySelector('#board-destination-picker')?.hidden);
  expect(open, '# did not open the picker');
  expect(await p.evaluate(() => document.activeElement?.id !== 'composer-input'), '# should not raise the keyboard (browse first)');
  const rows = await p.evaluate(() => [...document.querySelectorAll('#board-destination-picker .board-destination-option')].map((b) => b.className));
  expect(rows.length > 0 && rows.every((c) => /is-rsvp-/.test(c)), 'picker rows should show RSVP state');
  await p.evaluate(() => boardDestinationChoose('sm-walk'));
  await p.waitForTimeout(500);
  const r = await p.evaluate(() => ({ chip: document.querySelector('.board-destination-chip')?.innerText.replace(/\s+/g, ' ') || '', step: S.boardEventStep?.eventId, filtered: !!S.chatFilterEventId, msgs: document.querySelectorAll('#chat-scroll .msg[data-msg-id]').length }));
  expect(/Sunday/.test(r.chip), `chip shows "${r.chip}"`);
  expect(r.step === 'sm-walk', 'tagging should show that event\'s stepper');
  expect(!r.filtered && r.msgs === total, 'tagging must not filter the chat');
  await p.click('#board-event-stepper [data-event-step-close]');
  await p.waitForTimeout(400);
  expect(await p.evaluate(() => !boardDestinationState.value && !S.boardEventStep), 'the stepper ✕ should remove the tag and its stepper');
});

await check('event icon starts a message in that event (no keyboard)', async (p) => {
  const id = await p.evaluate(() => {
    const lead = [...document.querySelectorAll('#chat-scroll .msg:not(.chain-prev) > .msg-ev-lead:not(.spacer)')].pop();
    lead.scrollIntoView({ block: 'center' });
    return lead.closest('.msg').dataset.event;
  });
  await p.waitForTimeout(300);
  await p.click(`#chat-scroll .msg[data-event="${id}"]:not(.chain-prev) > .msg-ev-lead >> nth=-1`);
  await p.waitForTimeout(500);
  const r = await p.evaluate(() => ({ tag: boardDestinationState.value?.eventId || null, step: S.boardEventStep?.eventId || null, focused: document.activeElement?.id === 'composer-input' }));
  expect(r.tag === id, `the icon should tag the message box with its event (${r.tag} vs ${id})`);
  expect(r.step === id, 'and show that event\'s stepper');
  expect(!r.focused, 'the icon should not raise the keyboard');
  await p.click('#composer-input');
  await p.waitForTimeout(200);
  expect(await p.evaluate(() => document.activeElement?.id === 'composer-input'), 'tapping the message box should bring the keyboard up');
});

await check('leaving a focus: the stepper ✕ clears it and its tag, re-tapping the event icon leaves too', async (p) => {
  const lead = (id) => `#chat-scroll .msg[data-event="${id}"]:not(.chain-prev) > .msg-ev-lead >> nth=-1`;
  const id = await p.evaluate(() => {
    const el = [...document.querySelectorAll('#chat-scroll .msg:not(.chain-prev) > .msg-ev-lead')].pop();
    el.scrollIntoView({ block: 'center' });
    return el.closest('.msg').dataset.event;
  });
  await p.waitForTimeout(300);
  const st = () => p.evaluate(() => ({ step: S.boardEventStep?.eventId || null, tag: boardDestinationState.value?.eventId || null, stepper: !!document.querySelector('#board-event-stepper') }));
  await p.click(lead(id));
  await p.waitForTimeout(500);
  const done = await p.$('#board-event-stepper [data-event-step-close]');
  expect(done && (await done.isVisible()), 'a tag\'s stepper should show its ✕');
  expect(await p.evaluate(() => getComputedStyle(document.querySelector('#board-destination-slot')).display === 'none' && /^#/.test(document.querySelector('#board-event-stepper')?.innerText.trim() || '')), 'the event bar is the tag: no chip in the box while it shows');
  await p.fill('#composer-input', 'keep me');
  await p.evaluate(() => document.activeElement.blur());
  await done.click();
  await p.waitForTimeout(500);
  let r = await st();
  expect(!r.step && !r.tag && !r.stepper, `Done should leave the focus and remove the tag (${JSON.stringify(r)})`);
  expect((await p.inputValue('#composer-input')) === 'keep me', '✕ keeps the draft');
  await p.click(lead(id));
  await p.waitForTimeout(500);
  expect((await st()).step === id, 'icon focuses again');
  await p.click(lead(id));
  await p.waitForTimeout(500);
  r = await st();
  expect(!r.step && !r.tag, `re-tapping the focused event's icon should leave it (${JSON.stringify(r)})`);
});

await check('event page from the top bar: list › and the stepper name open it', async (p) => {
  await p.click('[data-event-nav-toggle]');
  await p.click('#board-event-list [data-event-nav-go]');
  await p.waitForTimeout(900);
  const stepId = await p.evaluate(() => S.boardEventStep?.eventId);
  await p.click('#board-event-stepper [data-event-step-page]');
  await p.waitForTimeout(700);
  expect(await p.evaluate((id) => S.conversationsThread?.eventId === id && document.querySelectorAll('[data-conv-tab]').length > 0, stepId), 'the stepper\'s event name should open the event page');
  await p.evaluate(() => ashBack());
  await p.waitForTimeout(700);
  await p.click('[data-event-nav-toggle]');
  await p.waitForSelector('#board-event-list');
  const n = await p.evaluate(() => [...document.querySelectorAll('#board-event-list .board-event-row')].filter((r) => r.querySelector('[data-event-nav-page]')).length
    === document.querySelectorAll('#board-event-list .board-event-row').length);
  expect(n, 'every list row should have an open-event button');
  const id = await p.evaluate(() => document.querySelector('#board-event-list [data-event-nav-page]').dataset.eventNavPage);
  await p.click(`#board-event-list [data-event-nav-page="${id}"]`);
  await p.waitForTimeout(700);
  const r = await p.evaluate(() => ({ page: S.conversationsThread?.eventId || null, list: !!document.querySelector('#board-event-list') }));
  expect(r.page === id, `› should open the event page (${r.page} vs ${id})`);
  expect(!r.list, 'the list closes');
});

await check('swipe right on general chat: tag state, pick more, drag onto an event', async (p) => {
  await p.evaluate(() => { const s = document.querySelector('#chat-scroll'); s.scrollTop = s.scrollHeight; });
  await p.waitForTimeout(300);
  // A left-to-right swipe on "anyone free later" (general chat).
  const sw = await (await p.$('#chat-scroll .msg[data-msg-id="sm6"] .msg-body')).boundingBox();
  const cdp = await p.context().newCDPSession(p);
  const tp = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await tp('touchStart', sw.x + 30, sw.y + 8);
  for (let i = 1; i <= 8; i++) { await tp('touchMove', sw.x + 30 + i * 14, sw.y + 9); await p.waitForTimeout(16); }
  await tp('touchEnd');
  await p.waitForTimeout(500);
  const st = await p.evaluate(() => ({ tagging: !!S.boardSelect?.tagging, ids: S.boardSelect?.ids || [], reacts: !!document.querySelector('#board-select-reacts') }));
  expect(st.tagging && st.ids[0] === 'sm6', `swipe should start the tag state (${JSON.stringify(st)})`);
  expect(!st.reacts, 'no reaction strip in the tag state');
  await p.click('#chat-scroll .msg[data-msg-id="sm3"] .msg-body');
  await p.waitForTimeout(300);
  expect(await p.evaluate(() => S.boardSelect?.ids.length === 2), 'tapping another message picks it too');
  const src = await (await p.$('#chat-scroll .msg[data-msg-id="sm6"] .msg-body')).boundingBox();
  const dst = await (await p.$('#chat-scroll .msg[data-event="sm-flat"] .msg-body')).boundingBox();
  await p.mouse.move(src.x + 20, src.y + 6);
  await p.mouse.down();
  await p.mouse.move(src.x + 30, src.y - 10, { steps: 4 });
  await p.mouse.move(dst.x + 40, dst.y + 6, { steps: 8 });
  await p.waitForTimeout(150);
  const during = await p.evaluate(() => ({ on: boardDragActive(), hint: document.querySelector('.board-drag-hint')?.textContent || '', more: document.querySelector('.board-drag-more')?.textContent || '' }));
  expect(during.on && /Flat/.test(during.hint) && /\+1/.test(during.more), `drag did not carry both onto the event (${JSON.stringify(during)})`);
  await p.mouse.up();
  await p.waitForTimeout(500);
  const evs = await p.evaluate(() => ['sm6', 'sm3'].map((id) => boardMessageEventId(boardActiveMessages().find((m) => m.id === id))));
  expect(evs.every((e) => e === 'sm-flat'), `both should be in Flat viewing (got ${evs})`);
  expect(await p.evaluate(() => !S.boardSelect && document.body.innerText.includes('Undo')), 'drop ends the tag state and offers Undo');
});

await check('event in focus: swipe right tags into it; long-press leads with "Add to" it', async (p) => {
  await p.evaluate(() => boardEventNavGo('sm-walk', 'start'));
  await p.waitForTimeout(800);
  await p.evaluate(() => { const s = document.querySelector('#chat-scroll'); s.scrollTop = s.scrollHeight; });
  await p.waitForTimeout(300);
  await p.evaluate(() => boardSelectBegin('sm6'));
  await p.waitForTimeout(300);
  const block = await text(p, '.board-select-block');
  expect(/^Add to #Sunday/i.test(block), `long-press block should lead with the focused event ("${block.slice(0, 40)}")`);
  await p.evaluate(() => boardSelectClear());
  await p.waitForTimeout(200);
  const sw = await (await p.$('#chat-scroll .msg[data-msg-id="sm6"] .msg-body')).boundingBox();
  const cdp = await p.context().newCDPSession(p);
  const tp = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await tp('touchStart', sw.x + 30, sw.y + 8);
  for (let i = 1; i <= 8; i++) { await tp('touchMove', sw.x + 30 + i * 14, sw.y + 9); await p.waitForTimeout(16); }
  await tp('touchEnd');
  await p.waitForTimeout(600);
  const ev = await p.evaluate(() => boardMessageEventId(boardActiveMessages().find((m) => m.id === 'sm6')));
  expect(ev === 'sm-walk', `swipe should tag into the focused event (got ${ev})`);
  expect(await p.evaluate(() => !S.boardSelect), 'quick tag does not open the tag state');
});

await check('picking an event from the list tags the message box (no keyboard); Back undoes both', async (p) => {
  await p.click('[data-event-nav-toggle]');
  await p.click('#board-event-list [data-event-nav-go="sm-walk"]');
  await p.waitForTimeout(900);
  const r = await p.evaluate(() => ({ chip: document.querySelector('.board-destination-chip')?.innerText.replace(/\s+/g, ' ') || '', src: S.boardEventStep?.source, kb: document.activeElement?.id === 'composer-input' }));
  expect(/Sunday/.test(r.chip), `no tag chip after the pick (got "${r.chip}")`);
  expect(r.src === 'nav' && !r.kb, `a jump, keyboard down (${JSON.stringify(r)})`);
  await p.evaluate(() => ashBackCloseTopLayer());
  await p.waitForTimeout(500);
  expect(await p.evaluate(() => !S.boardEventStep && !boardDestinationState.value), 'Back ends the jump and its tag');
});

await check('event card: box opens the event, RSVP opens its menu instead', async (p) => {
  const card = '#chat-scroll .board-event-card.is-message[data-event="fr-quiz"]';
  await p.evaluate((c) => document.querySelector(c)?.scrollIntoView({ block: 'center' }), card);
  await p.click(`${card} [data-board-rsvp-menu]`);
  await p.waitForTimeout(400);
  const menu = await p.evaluate(() => !document.querySelector('#tl-quick-menu')?.hidden && !S.conversationsThread?.eventId);
  expect(menu, 'RSVP should open the menu and stay in All chat');
  await p.evaluate(() => { document.querySelector('#tl-quick-backdrop')?.click(); if (typeof timelineCloseQuickMenu === 'function') timelineCloseQuickMenu(); });
  await p.waitForTimeout(300);
  await p.click(`${card} .board-event-box .board-event-title`);
  await p.waitForTimeout(800);
  const page = await p.evaluate(() => S.conversationsThread?.eventId);
  expect(page === 'fr-quiz', `the box should open the event page (got ${page})`);
});

await check('long-press: no quick "Add to" without an event in focus; reactions sit by the message', async (p) => {
  await p.evaluate(() => {
    const conn = activeConn();
    const list = conn.messages[S.activeView.id];
    const last = list.filter((m) => m.eventId === 'sm-flat').pop();
    list.push({ id: 'sm-stray', ts: last.ts + 60e3, _text: 'I can come', text: 'I can come', name: 'Jo', userId: 'u1' });
    list.sort((a, b) => a.ts - b.ts);
    renderView(true);
    boardSelectBegin('sm-stray');
  });
  await p.waitForTimeout(500);
  const block = await text(p, '.board-select-block');
  expect(!/^Add to/i.test(block), `no quick "Add to" without focus ("${block.slice(0, 40)}")`);
  const gap = await p.evaluate(() => { const m = document.querySelector('#chat-scroll .msg[data-msg-id="sm-stray"]').getBoundingClientRect(); const r = document.querySelector('#board-select-reacts')?.getBoundingClientRect(); return r ? Math.round(Math.min(Math.abs(m.top - r.bottom), Math.abs(r.top - m.bottom))) : null; });
  expect(gap !== null && gap <= 12, `reaction strip should sit next to the message (gap ${gap})`);
});

await check('draft from chat: clear the title; typing is an active choice', async (p) => {
  const id = await p.evaluate(() => {
    const conn = activeConn();
    const list = conn.messages[S.activeView.id];
    list.push({ id: 'sm-plan', ts: Date.now() - 60e3, _text: 'Sunday roast next Sunday at 7pm', text: 'Sunday roast next Sunday at 7pm', name: 'Jo', userId: 'u1' });
    renderView(true);
    const s = document.querySelector('#chat-scroll');
    s.scrollTop = s.scrollHeight;
    return 'sm-plan';
  });
  await p.waitForTimeout(500);
  await p.click(`.msg[data-msg-id="${id}"] .msg-plan-hit >> nth=0`);
  await p.waitForTimeout(500);
  expect(await p.$('.board-from-bar'), 'draft bar did not open');
  await p.click('.board-from-field-row [data-board-from-clear="title"]');
  await p.waitForTimeout(300);
  const empty = await p.evaluate(() => ({ title: boardFromChatFields().opts.title || '', input: !!document.querySelector('[data-board-from-type]'), picking: S.boardFromChat.correcting }));
  expect(empty.title === '', 'clearing should empty the title');
  expect(!empty.input, 'clearing should not open a text box (no keyboard)');
  expect(empty.picking === 'title', 'after clearing, the title is ready for tapped words');
  for (const field of ['date', 'time']) {
    await p.click(`[data-board-from-correct="${field}"]`);
    await p.waitForTimeout(150);
    expect(!(await p.$(`[data-board-from-typeit="${field}"]`)), `${field}: no Type button (tap words instead)`);
  }
  await p.click('[data-board-from-correct="title"]');
  for (const [field, value] of [['title', 'family lunch'], ['place', "Mum's"]]) {
    if (field !== 'title') await p.click(`[data-board-from-correct="${field}"]`);
    await p.waitForTimeout(150);
    expect(!(await p.$('[data-board-from-type]')), `${field}: no text box until Type is tapped`);
    await p.click(`[data-board-from-typeit="${field}"]`);
    await p.waitForTimeout(150);
    expect(await p.evaluate((f) => document.activeElement?.dataset?.boardFromType === f, field), `${field}: Type should focus its box`);
    await p.keyboard.type(value);
    await p.keyboard.press('Enter');
    await p.waitForTimeout(200);
  }
  const opts = await p.evaluate(() => boardFromChatFields().opts);
  expect(opts.title === 'Family lunch', `title ${opts.title}`);
  expect(opts.day != null && /7pm/.test(opts.timeText || ''), `date/time kept from the chat (${opts.timeText})`);
  expect(opts.where === "Mum's", `place ${opts.where}`);
  expect(await p.evaluate(() => !document.querySelector('[data-board-from-go]').disabled), 'Create should be enabled');
});

await check('quick create: date / time pickers, close place suggestions that never block', async (p) => {
  const t = await p.evaluate(() => ['7pm–8pm', '7pm to 9pm', 'at 7 actually 8pm'].map((x) => planInterpretTime(x)?.startMin));
  expect(t[0] === 19 * 60 && t[1] === 19 * 60 && t[2] === 20 * 60, `time ranges read from their start (${t})`);
  await p.evaluate(() => {
    boardActiveMessages().push({ id: 'qc1', ts: Date.now() - 60e3, _text: 'Sunday roast next Sunday at 7pm', text: 'Sunday roast next Sunday at 7pm', name: 'Jo', userId: 'u1' });
    renderView(true);
    const s = document.querySelector('#chat-scroll');
    s.scrollTop = s.scrollHeight;
  });
  await p.waitForTimeout(500);
  await p.click('.msg[data-msg-id="qc1"] .msg-plan-hit >> nth=0');
  await p.waitForTimeout(500);
  await p.click('[data-board-from-correct="date"]');
  await p.click('[data-board-from-pick="date"]');
  await p.waitForTimeout(300);
  const day = await p.evaluate(() => [...document.querySelectorAll('.board-from-pop [data-bf-day]')].find((el) => new Date(Number(el.dataset.bfDay)).getDate() === 24)?.dataset.bfDay);
  await p.click(`.board-from-pop [data-bf-day="${day}"]`);
  await p.waitForTimeout(300);
  await p.click('[data-board-from-correct="time"]');
  await p.click('[data-board-from-pick="time"]');
  await p.waitForTimeout(300);
  await p.click('.board-from-pop [data-cd-min="30"]');
  await p.click('.board-from-pop [data-cd-hour="20"]');
  await p.waitForTimeout(300);
  const o = await p.evaluate(() => { const x = boardFromChatFields().opts; return { ...x, start: planInterpretTime(x.timeText)?.startMin }; });
  expect(new Date(o.day).getDate() === 24 && o.start === 20 * 60 + 30, `picked ${JSON.stringify(o)}`);
  await p.click('[data-board-from-correct="place"]');
  await p.click('[data-board-from-typeit="place"]');
  await p.keyboard.type('the anchr');
  await p.waitForTimeout(300);
  const sug = await p.evaluate(() => [...document.querySelectorAll('[data-board-from-place]')].map((b) => b.dataset.boardFromPlace));
  expect(sug.includes('The Anchor, Borough'), `suggests the close match (${sug})`);
  await p.keyboard.press('Control+a');
  await p.keyboard.type('Somewhere new');
  await p.waitForTimeout(300);
  const free = await p.evaluate(() => ({ sug: document.querySelectorAll('[data-board-from-place]').length, where: boardFromChatFields().opts.where, postable: boardFromChatFields().postable }));
  expect(free.sug === 0 && free.where === 'Somewhere new' && free.postable, `free text is fine (${JSON.stringify(free)})`);
});

await check('format: UK dates, black switch, no Edit draft, a near-miss place never blocks Create, no chat text as an event name', async (p) => {
  const when = await p.evaluate(() => conversationWhenLabel({ when: new Date(2026, 9, 18, 20, 0).getTime() }));
  expect(/^Sun 18 Oct · /.test(when), `UK date (${when})`);
  await p.click('#board-title-btn');
  await p.waitForTimeout(300);
  const sw = await p.evaluate(() => { const el = document.querySelector('[data-board-hide-declined]'); const cs = getComputedStyle(el); return { app: cs.appearance || cs.webkitAppearance, bg: cs.backgroundColor }; });
  expect(sw.app === 'none', `switch is the app's own (${JSON.stringify(sw)})`);
  await p.click('#board-title-btn');
  await p.evaluate(() => {
    const list = boardActiveMessages();
    list.push({ id: 'fm1', ts: Date.now() - 60e3, _text: 'Sunday roast next Sunday at 7pm', text: 'Sunday roast next Sunday at 7pm', name: 'Jo', userId: 'u1' });
    list.push({ id: 'fm2', ts: Date.now() - 30e3, _text: 'Anyone seen my keys', text: 'Anyone seen my keys', name: 'Zara', userId: 'u2' });
    renderView(true);
    const s = document.querySelector('#chat-scroll');
    s.scrollTop = s.scrollHeight;
  });
  await p.waitForTimeout(400);
  await p.evaluate(() => boardSelectBegin('fm2'));
  await p.waitForTimeout(300);
  const block = await text(p, '.board-select-new');
  expect(/^New event Add a date$/.test(block), `no chat text as the name (${block})`);
  await p.evaluate(() => boardSelectClear());
  await p.click('.msg[data-msg-id="fm1"] .msg-plan-hit >> nth=0');
  await p.waitForTimeout(400);
  expect(!(await p.$('[data-board-from-edit]')), 'no Edit draft in quick create');
  await p.click('[data-board-from-correct="place"]');
  await p.click('[data-board-from-typeit="place"]');
  await p.keyboard.type('the anchr');
  await p.click('[data-board-from-done]');
  await p.waitForTimeout(200);
  const before = await p.evaluate(() => activeConn().events.length);
  await p.click('[data-board-from-go]');
  await p.waitForTimeout(1000);
  const after = await p.evaluate(() => activeConn().events.length);
  expect(after === before + 1, 'a near-miss place must not block Create');
});

await check('creating is quick create: + opens it empty with Confirm attendance; the form is Edit event only', async (p) => {
  await p.click('#board-event-bar [data-event-nav-create]');
  await p.waitForTimeout(500);
  const q = await p.evaluate(() => ({ quick: !!document.querySelector('.board-from-bar'), form: document.body.classList.contains('tl-creating'), confirm: !!document.querySelector('.board-from-bar [data-board-from-confirm]'), selected: (S.boardFromChat?.selected || []).length }));
  expect(q.quick && !q.form && q.confirm && q.selected === 0, `+ should open quick create empty (${JSON.stringify(q)})`);
  await p.click('.board-from-opt');
  expect(await p.evaluate(() => S.boardFromChat?.confirmAttendance === true && boardFromChatFields().opts.confirmAttendance === true), 'Confirm attendance carries into the event');
  await p.click('[data-board-from-cancel]');
  await p.waitForTimeout(300);
  // The form as Edit event: ⋯ keeps Confirm attendance; no "Draft from text".
  await p.evaluate(() => { window.__canEdit = window.canEditEvent; window.canEditEvent = () => true; openEditEventDraft(boardFindEvent('sm-walk', null, activeConn())); });
  await p.waitForTimeout(600);
  await p.click('#cd-more-btn');
  await p.waitForTimeout(300);
  const menu = await text(p, '#cd-popover.cd-more-popover');
  expect(/Confirm attendance/.test(menu) && !/Draft from text/.test(menu), `edit ⋯ menu: "${menu}"`);
  const r = await p.evaluate(() => {
    const card = document.querySelector('#cd-card').getBoundingClientRect();
    const btn = document.querySelector('#cd-create-btn').getBoundingClientRect();
    return { right: card.right - btn.right };
  });
  expect(r.right < 40, `Save sits at the right edge (${r.right}px from it)`);
  await p.evaluate(() => { closeCreateDraftPopovers(); closeCreateDraft(true); window.canEditEvent = window.__canEdit; renderView(true); });
  await p.waitForTimeout(300);
});

await check('event card: ✓ / ✕ when unanswered, quiet status once answered, no Hide chat button', async (p) => {
  const card = '#chat-scroll .board-event-card.is-message[data-event="sm-walk"]';
  await p.evaluate((c) => document.querySelector(c)?.scrollIntoView({ block: 'center' }), card);
  const before = await p.evaluate((c) => ({ ask: !!document.querySelector(`${c} [data-board-rsvp-answer="yes"]`), chevron: !!document.querySelector(`${c} .board-event-title .ico`), fold: !!document.querySelector(`${c} [data-board-collapse]`) }), card);
  expect(!before.fold, 'no "Hide chat" on the card');
  expect(before.ask, 'an unanswered event shows ✓ / ✕');
  expect(!before.chevron, 'no › on the card title');
  await p.click(`${card} [data-board-rsvp-answer="yes"]`);
  await p.waitForTimeout(500);
  const after = await p.evaluate((c) => ({ st: boardEventRsvpState(boardFindEvent('sm-walk', null, activeConn())), text: document.querySelector(`${c} .board-rsvp`)?.innerText.trim(), page: S.conversationsThread?.eventId || null, fold: !!document.querySelector(`${c} [data-board-collapse]`) }), card);
  expect(!after.fold, '"Hide chat" stays off the card once answered (long-press sheet)');
  expect(after.st === 'going' && after.text === 'Going' && !after.page, `answered in place, quiet "Going" (${JSON.stringify(after)})`);
});

await check('quick tag: after a long-press the message below stays tappable into the selection (reactions never cover it)', async (p) => {
  const ids = await p.evaluate(() => {
    const list = boardActiveMessages();
    list.push({ id: 'qt1', ts: Date.now() - 90e3, _text: 'first one', text: 'first one', name: 'Jo', userId: 'u1', conversationId: 'qt1' });
    list.push({ id: 'qt2', ts: Date.now() - 60e3, _text: 'second one', text: 'second one', name: 'Sam', userId: 'u0', conversationId: 'qt2' });
    renderView(true);
    document.querySelector('.msg[data-msg-id="qt1"]').scrollIntoView({ block: 'center' });
    return ['qt1', 'qt2'];
  });
  await p.waitForTimeout(300);
  await p.evaluate(() => boardSelectBegin('qt1'));
  await p.waitForTimeout(400);
  const hit = await p.evaluate(() => { const r = document.querySelector('.msg[data-msg-id="qt2"] .msg-body').getBoundingClientRect(); const el = document.elementFromPoint(r.x + 20, r.y + r.height / 2); return el?.closest('.msg')?.dataset.msgId || el?.id || el?.className; });
  expect(hit === 'qt2', `the next message is covered (${hit})`);
  await p.click('.msg[data-msg-id="qt2"] .msg-body');
  await p.waitForTimeout(300);
  const sel = await p.evaluate(() => S.boardSelect?.ids || []);
  expect(ids.every((id) => sel.includes(id)), `tap adds it (${sel})`);
});

await check('event card long-press: sheet with Hide chat / Open event; the release tap does not open it', async (p) => {
  const card = '#chat-scroll .board-event-card.is-message[data-event="sm-flat"]';
  await p.evaluate((c) => document.querySelector(c)?.scrollIntoView({ block: 'center' }), card);
  await p.waitForTimeout(300);
  const b = await p.evaluate((c) => { const r = document.querySelector(`${c} .board-event-when-line`).getBoundingClientRect(); return { x: r.x + 20, y: r.y + 6 }; }, card);
  await p.mouse.move(b.x, b.y);
  await p.mouse.down();
  await p.waitForTimeout(650);
  await p.mouse.up();
  await p.waitForTimeout(500);
  const r = await p.evaluate(() => ({ acts: [...document.querySelectorAll('.board-card-sheet [data-board-card-act]')].map((x) => x.innerText.trim()), page: S.conversationsThread?.eventId || null }));
  expect(r.acts.join('|') === 'Hide chat|Open event' && !r.page, `sheet ${JSON.stringify(r)}`);
  await p.click('.board-card-sheet [data-board-card-act="eye-off"]');
  await p.waitForTimeout(500);
  const h = await p.evaluate(() => ({ hidden: boardEventIsHidden(boardFindEvent('sm-flat', null, activeConn())), show: !!document.querySelector('[data-board-show="sm-flat"]') }));
  expect(h.hidden && h.show, `hidden with "Show chat" on the card (${JSON.stringify(h)})`);
});

await check('event bar: plain wording; with no events it offers New event and # hides', async (p) => {
  const bar = await text(p, '#board-event-bar');
  expect(/\d+ events? to answer|^Next:/.test(bar) && !/UP NEXT| new\b/.test(bar), `bar says "${bar}"`);
  await p.evaluate(() => { activeConn().events.splice(0); renderView(true); });
  await p.waitForTimeout(500);
  const r = await p.evaluate(() => ({ bar: document.querySelector('#board-event-bar')?.innerText.replace(/\s+/g, ' ').trim(), create: !!document.querySelector('#board-event-bar [data-event-nav-create]'), hash: document.querySelector('#board-compose-add')?.hidden }));
  expect(r.bar && /No events yet/.test(r.bar) && r.create, `empty bar: ${JSON.stringify(r)}`);
  expect(r.hash === true, '# should hide until there is an event');
});

await check('archive by age: older chat moves to Archive (default 2 weeks), set in the Archive view', async (p) => {
  await p.evaluate(() => { const list = boardActiveMessages(); list.unshift({ id: 'old1', ts: Date.now() - 20 * 864e5, _text: 'ancient news', text: 'ancient news', name: 'Jo', userId: 'u1', conversationId: 'old1' }); renderView(true); });
  await p.waitForTimeout(400);
  let r = await p.evaluate(() => ({ days: boardArchiveDays(), old: !!document.querySelector('#chat-scroll .msg[data-msg-id="old1"]'), note: !!document.querySelector('[data-board-open-archive]') }));
  expect(r.days === 14 && !r.old && r.note, `default: old chat archived with a note (${JSON.stringify(r)})`);
  await p.click('[data-board-open-archive]');
  await p.waitForTimeout(600);
  r = await p.evaluate(() => ({ on: boardArchiveOn(), old: !!document.querySelector('#chat-scroll .msg[data-msg-id="old1"]'), age: document.querySelector('[data-board-archive-age]')?.innerText.trim() }));
  expect(r.on && r.old && /Older than 2 weeks/.test(r.age), `the note opens Archive, where it is (${JSON.stringify(r)})`);
  await p.click('[data-board-archive-age]');
  await p.click('[data-archive-days="0"]');
  await p.waitForTimeout(400);
  await p.click('[data-board-all-chat]');
  await p.waitForTimeout(500);
  r = await p.evaluate(() => ({ on: boardArchiveOn(), old: !!document.querySelector('#chat-scroll .msg[data-msg-id="old1"]'), note: !!document.querySelector('[data-board-open-archive]') }));
  expect(!r.on && r.old && !r.note, `Never keeps it in All chat (${JSON.stringify(r)})`);
});

await check('archive exits (All chat, menu, Back); board menu Settings; Wipe board clears content, keeps the board', async (p) => {
  const into = async () => { await p.click('#board-title-btn'); await p.click('[data-board-page="archive"]'); await p.waitForTimeout(400); };
  await into();
  await p.click('[data-board-all-chat]');
  await p.waitForTimeout(400);
  expect(await p.evaluate(() => !boardArchiveOn()), '← All chat leaves Archive');
  await into();
  await p.click('#board-title-btn');
  await p.click('[data-board-page="chat"]');
  await p.waitForTimeout(400);
  expect(await p.evaluate(() => !boardArchiveOn()), 'menu All chat leaves Archive');
  await into();
  await p.evaluate(() => ashBack());
  await p.waitForTimeout(400);
  expect(await p.evaluate(() => !boardArchiveOn()), 'Back leaves Archive');
  await p.evaluate(() => { window.canManageServer = () => true; });
  await p.click('#board-title-btn');
  await p.click('[data-board-settings]');
  await p.waitForTimeout(600);
  expect(await p.$('#ch-wipe-board'), 'Settings opens the board sheet with Wipe board');
  const boards = await p.evaluate(() => (activeConn().boards || []).length);
  await p.click('#ch-wipe-board');
  await p.waitForTimeout(400);
  await p.evaluate(() => [...document.querySelectorAll('button')].find((x) => x.innerText.trim() === 'Wipe')?.click());
  await p.waitForTimeout(800);
  const r = await p.evaluate(() => ({ msgs: boardActiveMessages().filter((m) => !m.activity).length, bar: document.querySelector('#board-event-bar')?.innerText || '', boards: (activeConn().boards || []).length }));
  expect(r.msgs === 0 && /No events yet/.test(r.bar) && r.boards === boards, `wiped (${JSON.stringify(r)})`);
  // No chat yet: New event is muted and explains instead of opening.
  const muted = await p.evaluate(() => document.querySelector('#board-event-bar [data-event-nav-create]')?.getAttribute('aria-disabled'));
  await p.click('#board-event-bar [data-event-nav-create]', { force: true });
  await p.waitForTimeout(300);
  expect(muted === 'true' && await p.evaluate(() => !S.boardFromChat && !document.body.classList.contains('tl-creating')), `New event with no chat (${muted})`);
});

await check('plan dates: underlined while ahead, plain once passed', async (p) => {
  const r = await p.evaluate(() => {
    const list = boardActiveMessages();
    list.push({ id: 'pl1', ts: Date.now() - 5 * 864e5, _text: 'Barbers 10am tomorrow', text: 'Barbers 10am tomorrow', name: 'Jo', userId: 'u1', conversationId: 'pl1' });
    list.push({ id: 'pl2', ts: Date.now() - 60e3, _text: 'Drinks tomorrow?', text: 'Drinks tomorrow?', name: 'Jo', userId: 'u1', conversationId: 'pl2' });
    renderView(true);
    const marks = (id) => document.querySelectorAll(`#chat-scroll .msg[data-msg-id="${id}"] .msg-plan-hit`).length;
    return { past: marks('pl1'), ahead: marks('pl2') };
  });
  expect(r.past === 0 && r.ahead > 0, `marks ${JSON.stringify(r)}`);
});

await check('quick fixes: /t is plain text while tasks are parked; Show chat top right; draft date/time never reflow; member count', async (p) => {
  const t = await p.evaluate(() => ({ draft: parseChatTaskDraft('/t buy milk').mode, ph: document.querySelector('.composer.is-board input, .composer.is-board textarea')?.placeholder || '' }));
  expect(t.draft == null && !/\/t/.test(t.ph), `/t still active (${JSON.stringify(t)})`);
  const fold = await p.evaluate(() => {
    const id = [...document.querySelectorAll('#chat-scroll .board-event-card[data-event]')][0]?.dataset.event;
    if (!id) return null;
    boardSetEventOverride(id, true); renderView(true);
    const card = document.querySelector(`#chat-scroll .board-event-card[data-event="${id}"]`);
    const f = card?.querySelector('.board-event-fold')?.getBoundingClientRect();
    const title = card?.querySelector('.board-event-title')?.getBoundingClientRect();
    const rsvp = card?.querySelector('.board-rsvp')?.getBoundingClientRect();
    boardSetEventOverride(id, null); renderView(true);
    return f && { top: Math.abs(f.top - title.top) < 12, apart: !rsvp || f.bottom <= rsvp.top || rsvp.height === 0, deco: true };
  });
  expect(fold && fold.top && fold.apart, `Show chat placement ${JSON.stringify(fold)}`);
  const n = await p.evaluate(() => document.getElementById('view-sub')?.textContent || '');
  expect(/\d+ members?/.test(n), `member count shows (${n})`);
  await p.evaluate(() => {
    boardActiveMessages().push({ id: 'qf1', ts: Date.now() - 60e3, _text: 'Sunday roast next Sunday at 7pm', text: 'Sunday roast next Sunday at 7pm', name: 'Jo', userId: 'u1' });
    renderView(true);
    const s = document.querySelector('#chat-scroll'); s.scrollTop = s.scrollHeight;
  });
  await p.waitForTimeout(400);
  await p.click('.msg[data-msg-id="qf1"] .msg-plan-hit >> nth=0');
  await p.waitForTimeout(400);
  const box = () => p.evaluate(() => ['date', 'time'].map((f) => { const r = document.querySelector(`[data-board-from-correct="${f}"]`).getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width)].join(','); }).join(' '));
  const a = await box();
  await p.click('[data-board-from-correct="date"]'); await p.waitForTimeout(250);
  const b = await box();
  await p.click('[data-board-from-correct="time"]'); await p.waitForTimeout(250);
  const c = await box();
  await p.evaluate(() => document.querySelector('[data-board-from-cancel]')?.click());
  expect(a === b && b === c, `date/time moved: ${a} / ${b} / ${c}`);
});

await check('links: chat URLs are underlined links; an event place given as a map link shows its name, linked', async (p) => {
  const r = await p.evaluate(() => {
    boardActiveMessages().push({ id: 'lk1', ts: Date.now() - 30e3, _text: 'Tickets: https://example.com/tix?id=4, or www.bbc.co.uk.', text: 'x', name: 'Jo', userId: 'u1' });
    boardActiveMessages().push({ id: 'lk2', ts: Date.now() - 20e3, _text: 'Friday social tennis 6.30pm until 8pm at https://maps.app.goo.gl/JK2ttgKzCK7h86rS9', text: 'x', name: 'Jo', userId: 'u1' });
    renderView(true);
    const links = (id) => [...document.querySelectorAll(`.msg[data-msg-id="${id}"] a.msg-link`)].map((a) => a.getAttribute('href'));
    const mk = (w, d) => ({ id: 'pl' + Math.random(), _where: w, where: w, _details: d || '' });
    return {
      one: links('lk1'), two: links('lk2'),
      twoText: document.querySelector('.msg[data-msg-id="lk2"] .msg-body')?.textContent || '',
      full: boardEventPlace(mk('https://www.google.com/maps/place/The+Anchor+Bankside/@51.507,-0.094,17z')),
      named: boardEventPlace(mk('Tennis club https://maps.app.goo.gl/abc')),
      mapped: boardEventPlace(mk('The Anchor', 'Map: https://maps.app.goo.gl/zzz')),
      plain: boardEventPlace(mk('The Anchor')),
    };
  });
  expect(r.one.join(' ') === 'https://example.com/tix?id=4 https://www.bbc.co.uk', `chat links ${JSON.stringify(r.one)}`);
  expect(r.two.length === 1 && /maps\.app\.goo\.gl/.test(r.two[0]) && /6\.30pm until 8pm at https/.test(r.twoText), `plan + link ${JSON.stringify(r.two)} ${r.twoText}`);
  expect(r.full.text === 'The Anchor Bankside' && /google/.test(r.full.href), `full map link ${JSON.stringify(r.full)}`);
  expect(r.named.text === 'Tennis club' && r.named.href, `name + link ${JSON.stringify(r.named)}`);
  expect(r.mapped.text === 'The Anchor' && /zzz/.test(r.mapped.href), `name + Map ${JSON.stringify(r.mapped)}`);
  expect(r.plain.text === 'The Anchor' && !r.plain.href, `plain place ${JSON.stringify(r.plain)}`);
  // Tapping a link opens it (a new window here) and never the event page.
  const popup = p.context().waitForEvent('page', { timeout: 3000 }).catch(() => null);
  await p.evaluate(() => { const s = document.querySelector('#chat-scroll'); s.scrollTop = s.scrollHeight; });
  await p.click('.msg[data-msg-id="lk1"] a.msg-link >> nth=0');
  const pg = await popup;
  if (pg) await pg.close().catch(() => {});
  expect(pg, 'tapping a chat link opens it');
  expect(await p.evaluate(() => !S.chatFilterEventId), 'a link tap never opens an event');
  await p.evaluate(() => { const list = boardActiveMessages(); for (const id of ['lk1', 'lk2']) { const i = list.findIndex((m) => m.id === id); if (i >= 0) list.splice(i, 1); } renderView(true); });
});

await check('roles: names and initials take the top role colour; People has one role list; short sidebar labels', async (p) => {
  const r = await p.evaluate(() => {
    const c = activeConn();
    const keep = JSON.stringify({ roles: c.customRoles || null, members: (c.members || []).map((m) => [m.id, m.role, m.roleTagIds]) });
    c.customRoles = [{ id: 'r-c', name: 'Committee', color: '#2E6B3D', sortOrder: 1 }, { id: 'r-d', name: 'Drivers', color: '#d98c2b', sortOrder: 2 }];
    const others = (c.members || []).filter((m) => m.id !== c.me?.id && !m.isHost && effectiveRole(m) !== 'host');
    const [a, b, d] = others;
    a.role = 'admin'; b.role = 'user'; b.roleTagIds = ['r-d', 'r-c']; d.role = 'user'; d.roleTagIds = undefined;
    const out = {
      admin: memberRoleColor(a.id), tagged: memberRoleColor(b.id), plain: memberRoleColor(d.id),
      nameStyle: roleNameStyle(a.id), plainStyle: roleNameStyle(d.id),
      face: memberAvatarRoleStyle(a.id), plainFace: memberAvatarRoleStyle(d.id),
      mod: roleDisplayColor('moderator'),
    };
    // Sidebar labels
    const base = c.channels.find((x) => x.kind === 'event' && x.boardId);
    const f = (v) => ({ view: !!v });
    const mk = (perms) => ({ ...base, id: 'tmp-acc', linkedChatChannelId: null, rolePerms: perms });
    out.labels = [
      boardViewAccessMeta(mk({ moderator: f(1), user: f(1), viewer: f(1) }), c),
      boardViewAccessMeta(mk({ moderator: f(1), user: f(1), viewer: f(0), 'r-c': f(1) }), c)?.label,
      boardViewAccessMeta(mk({ moderator: f(1), user: f(0), viewer: f(0) }), c)?.label,
      boardViewAccessMeta(mk({ moderator: f(0), user: f(0), viewer: f(0), 'r-c': f(1), 'r-d': f(1) }), c)?.label,
    ];
    // People: one list
    c.me.role = 'host'; c.me.isHost = true;
    window.__sentRoles = []; window.__send = window.send; window.send = (m) => { if (/Role/.test(m.type)) __sentRoles.push(m.type); };
    Nav.set({ kind: 'members' }); renderView();
    const row = [...document.querySelectorAll('.people-row')].find((x) => x.querySelector('.people-name')?.textContent.includes(b.name));
    out.chips = [...(row?.querySelectorAll('.people-role-pill') || [])].map((x) => x.textContent.trim());
    out.add = !!row?.querySelector('.people-role-add-btn');
    out.old = !!document.querySelector('.people-base-role, .people-role-tags');
    out.keep = keep; out.bName = b.name;
    return out;
  });
  expect(r.admin && r.tagged === '#2E6B3D' && !r.plain, `top role colours ${JSON.stringify([r.admin, r.tagged, r.plain])}`);
  expect(/color-mix/.test(r.nameStyle) && !r.plainStyle && /color-mix/.test(r.face) && /text-secondary/.test(r.plainFace), 'name and face follow the role; Member stays plain');
  expect(r.mod.toUpperCase() === '#3E7BDB', `moderator is blue (${r.mod})`);
  expect(r.labels[0] == null && r.labels[1] === 'Members' && r.labels[2] === 'Moderators+' && r.labels[3] === 'Committee, Drivers', `sidebar labels ${JSON.stringify(r.labels)}`);
  expect(r.chips.join(',') === 'Committee,Drivers' && r.add && !r.old, `People row ${JSON.stringify(r.chips)} add=${r.add} old=${r.old}`);
  await p.locator('.people-row', { hasText: r.bName }).locator('.people-role-add-btn').click();
  await p.locator('.people-row', { hasText: r.bName }).locator('.people-role-item', { hasText: 'Moderator' }).click();
  await p.waitForTimeout(200);
  expect(await p.evaluate(() => __sentRoles.includes('setMemberRole')), 'picking a tier sends setMemberRole');
  await p.evaluate((keep) => {
    window.send = window.__send;
    const c = activeConn(); const k = JSON.parse(keep);
    c.customRoles = k.roles || undefined;
    for (const [id, role, tags] of k.members) { const m = c.members.find((x) => x.id === id); if (m) { m.role = role; m.roleTagIds = tags; } }
    Nav.openChannel ? Nav.openChannel(S.activeEventChannelId || c.channels.find((x) => x.kind === 'chat' && x.boardId)?.id) : null;
    renderView(true);
  }, r.keep);
  await p.waitForTimeout(300);
});

await check('long-press: Edit / Delete in the top bar (no ⋮), Draw in the reactions; edit saves; no "…" messages; no text selection', async (p) => {
  await p.evaluate(() => {
    const c = activeConn();
    boardActiveMessages().push({ id: 'ed1', ts: Date.now() - 40e3, _text: 'Typo heer', text: 'Typo heer', name: 'You', userId: c.me.id });
    boardActiveMessages().push({ id: 'ed-empty', ts: Date.now() - 30e3, name: 'You', userId: c.me.id });
    renderView(true);
    const s = document.querySelector('#chat-scroll'); s.scrollTop = s.scrollHeight;
  });
  await p.waitForTimeout(300);
  const dots = await p.evaluate(() => ({ empty: !!document.querySelector('.msg[data-msg-id="ed-empty"]'), dots: [...document.querySelectorAll('#chat-scroll .msg-body')].some((b) => b.textContent.trim() === '…') }));
  expect(!dots.empty && !dots.dots, `a message with no text is skipped, never "…" (${JSON.stringify(dots)})`);
  await p.evaluate(() => boardSelectBegin('ed1'));
  await p.waitForTimeout(300);
  const bar = await p.evaluate(() => ({ btns: [...document.querySelectorAll('#board-select-bar button')].map((b) => b.getAttribute('aria-label')), draw: !!document.querySelector('#board-select-reacts [data-select-draw]') }));
  expect(bar.btns.includes('Edit message') && bar.btns.includes('Delete message') && !bar.btns.includes('More actions') && bar.draw, `bar ${JSON.stringify(bar)}`);
  await p.click('[data-select-edit]');
  await p.waitForTimeout(300);
  await p.fill('#ash-prompt-input', 'Typo here');
  await p.click('#ash-prompt-ok');
  await p.waitForTimeout(400);
  const ed = await p.evaluate(() => { const el = document.querySelector('.msg[data-msg-id="ed1"]'); return { body: el?.querySelector('.msg-body')?.textContent.trim(), mark: !!el?.querySelector('.msg-edited') }; });
  expect(ed.body === 'Typo here' && ed.mark, `edited ${JSON.stringify(ed)}`);
  const sel = await p.evaluate(() => getComputedStyle(document.querySelector('#chat-scroll .msg-body')).userSelect + '/' + getComputedStyle(document.querySelector('.side-board-head, #side-list, body')).userSelect);
  expect(!/text|auto/.test(sel), `long-press must not select text (${sel})`);
  // A linked place shows its name only (before the first comma).
  const place = await p.evaluate(() => { const ev = { id: 'pl-x', _where: 'https://www.google.com/maps/place/Macclesfield+Tennis+Club,+Park+Ln,+Macclesfield/@53.2,-2.1,17z', where: 'x' }; const d = document.createElement('div'); d.innerHTML = boardEventPlaceHTML(ev); return d.textContent; });
  expect(place === 'Macclesfield Tennis Club', `place link text "${place}"`);
  await p.evaluate(() => { const list = boardActiveMessages(); for (const id of ['ed1', 'ed-empty']) { const i = list.findIndex((m) => m.id === id); if (i >= 0) list.splice(i, 1); } renderView(true); });
});

await check('lead tiles: icon > date > time when events in view share an icon', async (p) => {
  const r = await p.evaluate(() => {
    renderView(true);
    const conn = activeConn();
    const leadFor = (id) => document.querySelector(`#chat-scroll .msg[data-event="${id}"] > .msg-ev-lead:not(.spacer)`);
    const ids = [...new Set([...document.querySelectorAll('#chat-scroll .msg[data-event] > .msg-ev-lead:not(.spacer)')].map((b) => b.parentElement.dataset.event))];
    if (ids.length < 2) return { ids };
    const [a, b] = ids.slice(0, 2).map((id) => conn.events.find((e) => e.id === id));
    const keep = { ai: a.icon, bi: b.icon, aw: a.when, bw: b.when };
    const subs = () => [a, b].map((ev) => [...(leadFor(ev.id)?.querySelectorAll('.msg-ev-lead-sub') || [])].map((s) => s.textContent));
    const day = new Date(); day.setDate(day.getDate() + 3); day.setHours(18, 0, 0, 0);
    a.icon = b.icon = 'parachute'; a.when = day.getTime(); b.when = day.getTime() + 864e5;
    renderView(true);
    const shared = subs();
    b.when = day.getTime() + 2 * 3600e3;
    renderView(true);
    const sameDay = subs();
    a.icon = 'sailboat'; b.icon = 'tent';
    renderView(true);
    const unique = subs();
    Object.assign(a, { icon: keep.ai, when: keep.aw }); Object.assign(b, { icon: keep.bi, when: keep.bw });
    renderView(true);
    return { ids, shared, sameDay, unique };
  });
  expect(r.shared, `needs two events with leads in view (${JSON.stringify(r)})`);
  expect(r.shared.every((l) => l.length === 1 && /\d+ \w{3}/.test(l[0])), `shared icon adds the date (${JSON.stringify(r.shared)})`);
  expect(r.sameDay.every((l) => l.length === 2) && r.sameDay[0][1] !== r.sameDay[1][1], `shared day adds the time (${JSON.stringify(r.sameDay)})`);
  expect(r.unique.every((l) => l.length === 0), `unique icons show the icon alone (${JSON.stringify(r.unique)})`);
});

await check('tagging only offers this board\'s events (not another board linked into the chat)', async (p) => {
  const r = await p.evaluate(() => {
    const conn = activeConn();
    const own = conn.channels.find((c) => c.id === conversationActiveEventChannel()?.id);
    const other = conn.channels.find((c) => c.kind === 'event' && c.boardId && own && c.boardId !== own.boardId);
    const base = conn.events.find((e) => e.channelId === own.id && !e.chainOf);
    conn.events.push({ ...base, id: 'sm-other-board', title: 'Other board thing', _title: 'Other board thing', channelId: other.id, when: Date.now() + 2 * 864e5, rsvps: {}, notes: [] });
    other.linkedChatChannelId = S.activeView.id;
    (conn.messages[S.activeView.id] ||= []).push({ id: 'sm-leak', ts: Date.now(), _text: 'leak', text: 'leak', name: 'Sam', userId: 'u0', eventId: 'sm-other-board', conversationId: 'event-sm-other-board' });
    renderView(true);
    const ids = [...boardContinueEventTargets().map((t) => t.eventId), ...boardSelectEventChoices(null, '').map((e) => e.id), ...boardDropZones().map((z) => z.eventId)];
    delete other.linkedChatChannelId;
    conn.events = conn.events.filter((e) => e.id !== 'sm-other-board');
    conn.messages[S.activeView.id] = conn.messages[S.activeView.id].filter((m) => m.id !== 'sm-leak');
    renderView(true);
    return { ids, own: boardEventNavEvents().length };
  });
  expect(r.own > 0 && !r.ids.includes('sm-other-board'), `another board's event offered for tagging (${JSON.stringify(r)})`);
});

await check('parked for now: no Timeline, Tasks, Polls or pinned boards to open', async (p) => {
  await p.click('#board-title-btn');
  await p.waitForTimeout(300);
  const pages = await p.evaluate(() => [...document.querySelectorAll('#board-options [data-board-page]')].map((b) => b.dataset.boardPage));
  expect(!pages.some((k) => ['timeline', 'tasks', 'polls'].includes(k)), `board menu still offers ${pages.join(', ')}`);
  expect(pages.includes('chat') && pages.includes('people') && pages.includes('archive'), 'All chat, People and Archive stay');
  const kind = await p.evaluate(() => { boardOpenPage('polls'); return boardPageKind(); });
  expect(kind === 'chat', `a parked page opened (${kind})`);
  const side = await p.evaluate(() => document.querySelector('#side-list, .side-list, #sidebar')?.innerText || document.body.innerText);
  expect(!/Pinned (locations|people)/i.test(side), 'the sidebar still shows pinned boards');
});

await check('event page: Chat, Sign-ups and Details tabs render', async (p) => {
  await p.evaluate(() => boardOpenEventPage('fr-quiz'));
  await p.waitForTimeout(800);
  for (const tab of ['attendance', 'description', 'chat']) {
    await p.click(`[data-conv-tab="${tab}"]`);
    await p.waitForTimeout(400);
  }
  const r = await p.evaluate(() => ({ tabs: document.querySelectorAll('[data-conv-tab]').length, msgs: document.querySelectorAll('#chat-scroll .msg').length, bar: !!document.querySelector('#board-event-bar') }));
  expect(r.tabs >= 3 && r.msgs > 0, 'event page tabs or chat missing');
  expect(!r.bar, 'the event bar should not show on the event page');
});

await browser.close();
server.close();
const failed = results.filter(([, ok]) => !ok).length;
if (errors.length) console.log(`\nPage errors:\n  ${[...new Set(errors)].join('\n  ')}`);
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed || errors.length ? 1 : 0);
