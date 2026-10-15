// Local fresh-install/demo and offline smoke. Uses the hosting e2e Playwright install.
// PHLIP_CHROME_PATH optionally selects an already installed Chromium executable.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('../phlip-hosting/e2e/node_modules/playwright');
const root = path.resolve(__dirname, '../phlip-web/public');
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname), url.pathname.endsWith('/') ? 'index.html' : '');
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    res.end(fs.readFileSync(file));
  } catch { res.writeHead(404).end(); }
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.PHLIP_CHROME_PATH });
    for (const width of [390, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 844 } });
      const page = await context.newPage();
      const errors = [], missing = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('response', r => { if (r.status() === 404) missing.push(r.url()); });
      await page.goto(`http://127.0.0.1:${server.address().port}/?demo=1`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => typeof S !== 'undefined' && Object.keys(S.conns).length > 1);
      for (const kind of ['people', 'chat', 'polls', 'tasks', 'timeline']) {
        await page.evaluate(kind => boardOpenPage(kind), kind);
        await page.waitForTimeout(150);
        assert.ok(await page.locator('.main').innerText(), `${kind} must render`);
      }
      await page.evaluate(() => openCreateDraft());
      await page.locator('#cd-title-input').waitFor({ state: 'visible' });
      await page.fill('#cd-title-input', 'Cleanup verification picnic');
      await page.click('#cd-create-btn');
      await page.waitForFunction(() => Object.values(S.conns).some(c => (c.events || []).some(e =>
        e._title === 'Cleanup verification picnic' || e.title === 'Cleanup verification picnic')));
      await page.evaluate(() => {
        const c = activeConn();
        const ev = c.events.find(e => e._title === 'Cleanup verification picnic' || e.title === 'Cleanup verification picnic');
        openEventConversation(ev.id, 'description');
      });
      await page.evaluate(() => navigator.serviceWorker.ready);
      await page.waitForFunction(() => !!navigator.serviceWorker.controller);
      const cacheCount = await page.evaluate(async () => {
        const names = await caches.keys();
        const cache = await caches.open(names.find(n => n.startsWith('phlip-shell-')));
        return (await cache.keys()).length;
      });
      assert.ok(cacheCount >= 192, `Incomplete offline cache: ${cacheCount}`);
      await context.setOffline(true);
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForFunction(() => typeof S !== 'undefined' && Object.keys(S.conns).length > 1);
      assert.deepEqual(errors, [], `JavaScript errors at ${width}px`);
      assert.deepEqual(missing, [], `Missing assets at ${width}px`);
      console.log(`${width}px: fresh demo, tabs, event creation, event description, offline reload passed`);
      await context.close();
    }
  } finally {
    if (browser) await browser.close();
    server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
