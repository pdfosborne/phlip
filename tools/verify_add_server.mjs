#!/usr/bin/env node
/**
 * Headless checks for the add-server menu + hosting guide.
 * Serves phlip-web/public, stubs AshNative, drives Chromium via playwright-core.
 *
 *   node tools/verify_add_server.mjs
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "phlip-web", "public");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".gif": "image/gif",
};

function startStaticServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    let rel = decodeURIComponent(url.pathname);
    if (rel === "/__ash_test_hook.js") {
      res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
      res.end("window.__ashS = function () { return S; };");
      return;
    }
    if (rel === "/") rel = "/index.html";
    const file = path.normalize(path.join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC)) {
      res.writeHead(403).end();
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404).end("not found");
        return;
      }
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function ashNativeInit(on) {
    const calls = [];
    const state = {
      running: false,
      setup: {
        alphaAckAccepted: false,
        rulesAccepted: false,
        localPrepAccepted: false,
        devicePrepAccepted: false,
        operatorAck: false,
        dataAck: false,
        publicRiskAck: false,
        cloudflareConfigured: false,
        publicReady: false,
      },
      consent: {
        alphaTitle: "Alpha software",
        alphaBody: "Early software; updates may break things or lose data.",
        hostRulesTitle: "Server rules for hosts",
        hostRulesBody: "You are responsible for who you let in.",
        hostRulesAccept: "Accept rules",
        localPrepTitle: "Safer hosting for Local",
        localPrepBody: "Same Wi-Fi only.",
        localPrepAccept: "Acknowledge",
      },
      servers: [],
    };
    const status = () => JSON.stringify({
      running: state.running,
      setup: state.setup,
      consent: state.consent,
      servers: state.servers,
    });
    const push = () => {
      try { window.ashSyncHostStatus?.(JSON.parse(status())); } catch {}
    };
    class FakeWS {
      constructor() {
        this.readyState = 0;
        setTimeout(() => {
          this.readyState = 3;
          try { this.onerror?.(new Event("error")); } catch {}
          try { this.onclose?.(new CloseEvent("close")); } catch {}
        }, 0);
      }
      close() { this.readyState = 3; }
      send() {}
    }
    window.WebSocket = FakeWS;
    localStorage.setItem("ash_me_named", "1");
    localStorage.setItem("ash_me", JSON.stringify({ id: "me1", name: "Phil" }));
    window.AshNative = {
      _calls: calls,
      hostingAvailable: () => on,
      hostStatus: () => status(),
      startHosting: () => {
        calls.push(["startHosting"]);
        state.running = true;
        push();
        return JSON.stringify({ ok: true });
      },
      acceptAlphaAck: () => {
        calls.push(["acceptAlphaAck"]);
        state.setup.alphaAckAccepted = true;
        push();
        return JSON.stringify({ ok: true });
      },
      acceptHostRules: () => {
        calls.push(["acceptHostRules"]);
        state.setup.rulesAccepted = true;
        push();
        return JSON.stringify({ ok: true });
      },
      acceptLocalPrep: () => {
        calls.push(["acceptLocalPrep"]);
        state.setup.localPrepAccepted = true;
        push();
        return JSON.stringify({ ok: true });
      },
      acceptDevicePrep: () => {
        calls.push(["acceptDevicePrep"]);
        state.setup.devicePrepAccepted = true;
        push();
        return JSON.stringify({ ok: true });
      },
      acceptPatchWarning: () => {
        calls.push(["acceptPatchWarning"]);
        state.setup.patchAckSatisfied = true;
        push();
        return JSON.stringify({ ok: true });
      },
      acceptOperatorAck: () => {
        calls.push(["acceptOperatorAck"]);
        state.setup.operatorAck = true;
        push();
        return JSON.stringify({ ok: true });
      },
      acceptDataAck: () => {
        calls.push(["acceptDataAck"]);
        state.setup.dataAck = true;
        push();
        return JSON.stringify({ ok: true });
      },
      acceptPublicRiskAck: () => {
        calls.push(["acceptPublicRiskAck"]);
        state.setup.publicRiskAck = true;
        push();
        return JSON.stringify({ ok: true });
      },
      openCloudflareSetup: () => {
        calls.push(["openCloudflareSetup"]);
        state.setup.cloudflareConfigured = true;
        state.setup.cloudflareDomain = "example.phlip.test";
        state.setup.publicReady = true;
        push();
        return JSON.stringify({ ok: true });
      },
      setPublicHosting: (serverId, on) => {
        calls.push(["setPublicHosting", serverId, on]);
        const s = state.servers.find((x) => x.id === serverId);
        if (!s) return JSON.stringify({ ok: false, error: "Server not found" });
        s.isPublic = !!on;
        s.sharingReady = { ...(s.sharingReady || {}), public: !!on };
        push();
        return JSON.stringify({ ok: true });
      },
      createServer: (name, preset, activity, hostName) => {
        calls.push(["createServer", name, preset, activity, hostName]);
        if (!state.setup.alphaAckAccepted) {
          return JSON.stringify({ ok: false, error: "Accept the alpha software risks first" });
        }
        const id = "srv1";
        state.servers = [{
          id, name, reachMode: "device", isPublic: false, pending: [], lanUrl: "",
        }];
        const list = [{
          id: `srv-local-${id}`,
          url: "ws://127.0.0.1:3999/ws",
          name,
          token: "tok",
          pass: "secret",
          reachMode: "device",
          isPublic: false,
        }];
        try { window.ashSyncServers?.(list); } catch {}
        push();
        return JSON.stringify({ ok: true, id });
      },
      setReachMode: (serverId, mode) => {
        calls.push(["setReachMode", serverId, mode]);
        const s = state.servers.find((x) => x.id === serverId);
        if (!s) return JSON.stringify({ ok: false, error: "Server not found" });
        if (s.reachMode === "device" && mode !== "device") {
          if (!state.setup.rulesAccepted) {
            return JSON.stringify({ ok: false, error: "Accept the server rules first" });
          }
          if (!state.setup.localPrepAccepted) {
            return JSON.stringify({ ok: false, error: "Read safer hosting for Local first" });
          }
        }
        s.reachMode = mode;
        push();
        try {
          window.ashSyncServers?.([{
            id: `srv-local-${serverId}`,
            url: "ws://127.0.0.1:3999/ws",
            name: s.name,
            token: "tok",
            pass: "secret",
            reachMode: mode,
            isPublic: false,
          }]);
        } catch {}
        return JSON.stringify({ ok: true });
      },
      openApprovedNetworks: () => {
        calls.push(["openApprovedNetworks"]);
        return JSON.stringify({ ok: true });
      },
    };
}

async function loadPlaywright() {
  const require = createRequire(path.join(ROOT, "phlip-hosting/e2e/package.json"));
  try {
    return require("playwright-core");
  } catch {
    try {
      return require("playwright");
    } catch {
      throw new Error("Install playwright-core in phlip-hosting/e2e (npm install playwright-core)");
    }
  }
}

function chromePath() {
  if (process.env.PHLIP_CHROME_PATH) return process.env.PHLIP_CHROME_PATH;
  const home = process.env.HOME || "";
  const p = path.join(home, ".cache/ms-playwright/chromium-1223/chrome-linux64/chrome");
  return fs.existsSync(p) ? p : undefined;
}

async function main() {
  const { chromium } = await loadPlaywright();
  const server = await startStaticServer();
  const port = server.address().port;
  const origin = `http://appassets.androidplatform.net:${port}`;
  const outDir = path.join(os.tmpdir(), "phlip-add-server");
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    executablePath: chromePath(),
    args: [
      `--host-resolver-rules=MAP appassets.androidplatform.net 127.0.0.1`,
      "--disable-gpu",
    ],
  });

  const fail = [];
  const check = (name, ok, extra = "") => {
    if (!ok) fail.push(name + (extra ? ` (${extra})` : ""));
    console.log(ok ? `ok  ${name}` : `FAIL ${name}${extra ? " — " + extra : ""}`);
  };

  const openApp = async (hostingOn, width = 1280) => {
    const context = await browser.newContext({
      viewport: { width, height: 800 },
      serviceWorkers: "block",
    });
    await context.addInitScript(ashNativeInit, hostingOn);
    const page = await context.newPage();
    page.on("pageerror", (e) => console.warn("pageerror", e.message));
    await page.goto(origin + "/", { waitUntil: "domcontentloaded" });
    await page.locator(".rail-join").waitFor({ timeout: 15000 });
    await page.addScriptTag({ url: origin + "/__ash_test_hook.js" });
    await page.evaluate(() => {
      document.getElementById("app")?.classList.add("nav-open", "on");
      try { renderRail(); renderSidebar(); } catch {}
    });
    await page.waitForSelector(".rail-join", { timeout: 10000 });
    return { context, page };
  };

  {
    const { context, page } = await openApp(true, 1280);
    await page.click(".rail-join");
    await page.waitForSelector(".add-server-card");
    await page.screenshot({ path: path.join(outDir, "1280.png") });
    const title = await page.locator("#add-server-title").innerText();
    check("plus opens create menu", /Create a server/i.test(title), title);
    const menuText = await page.locator("#add-server-body").innerText();
    check("menu offers current templates", /Start from scratch/i.test(menuText) && /Friend group/i.test(menuText), menuText);
    check("sharing is configured later", /Google Drive or self-hosted later/i.test(await page.locator("#add-server-lead").innerText()));
    check("menu has no Wi-Fi or hotspot", !/Same Wi-Fi|Phone hotspot/i.test(menuText), menuText);

    await page.click('[data-preset="club"]');
    await page.waitForSelector("#add-server-create");
    const createDisabled = await page.locator("#add-server-create").isDisabled();
    check("alpha keeps Create disabled", createDisabled);
    await page.click("#add-server-back");

    await page.click("#add-server-join");
    await page.waitForSelector("#join-modal-title");
    const joinTitle = await page.locator("#join-modal-title").innerText();
    const backLabel = await page.locator("#j-cancel").innerText();
    check("join from menu", /Join a server/i.test(joinTitle), joinTitle);
    check("join url-step is Back", /Back/i.test(backLabel), backLabel);
    await page.click("#j-cancel");
    await page.waitForSelector(".add-server-card");
    check("back returns to menu", /Create a server|Self-hosted/i.test(await page.locator("#add-server-title").innerText()));
    if (/Self-hosted/i.test(await page.locator("#add-server-title").innerText())) {
      await page.click("#add-server-back");
    }
    await page.click('[data-preset="scratch"]');
    await page.fill("#add-server-name", "Family");
    await page.check("#add-server-alpha");
    await page.locator("#add-server-create").waitFor({ state: "visible" });
    await page.waitForSelector("#add-server-create:not([disabled])");
    await page.click("#add-server-create");
    let created = false;
    for (let i = 0; i < 40; i++) {
      created = await page.evaluate(() => !!(window.__ashS?.()?.conns?.["srv-local-srv1"]));
      if (created) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    check("conn landed", created);
    if (!created) throw new Error("hosted conn did not land");
    const calls = await page.evaluate(() => window.AshNative._calls);
    const startIdx = calls.findIndex((c) => c[0] === "startHosting");
    const createIdx = calls.findIndex((c) => c[0] === "createServer");
    const createArgs = calls.find((c) => c[0] === "createServer");
    check("startHosting then createServer", startIdx >= 0 && createIdx > startIdx);
    check("createServer args", !!(createArgs && createArgs[1] === "Family" && createArgs[2] === "scratch" && createArgs[3] === "" && createArgs[4] === "Phil"), JSON.stringify(createArgs));
    const active = await page.evaluate(() => window.__ashS().activeConnId);
    check("switches to new conn", active === "srv-local-srv1", String(active));

    await page.evaluate(() => {
      const S = window.__ashS();
      const conn = S.conns["srv-local-srv1"];
      conn.me = { id: "me1", name: "Phil", role: "host" };
      conn.reachMode = "device";
      conn.status = "online";
      S.activeConnId = "srv-local-srv1";
      renderSidebar(true);
      renderRail();
      document.getElementById("app")?.classList.add("nav-open");
    });
    await page.waitForSelector("#side-device-chip");
    const reachPaint = await page.locator("#side-device-chip").evaluate((el) => {
      const cs = getComputedStyle(el);
      const menu = document.getElementById("side-server-menu-btn");
      const title = document.getElementById("group-name");
      const dot = el.querySelector(".rail-dot");
      return {
        text: el.innerText.replace(/\s+/g, " ").trim(),
        cls: el.className,
        svgs: el.querySelectorAll("svg").length,
        hasDot: !!(dot && dot.classList.contains("online")),
        bg: cs.backgroundColor,
        radius: cs.borderRadius,
        title: title?.textContent || "",
        sameRow: !!(menu && Math.abs(menu.offsetTop - el.offsetTop) <= 4),
      };
    });
    check("sidebar reach label", /Device only/i.test(reachPaint.text), reachPaint.text);
    check("sidebar reach is text-only",
      reachPaint.cls.includes("side-host-reach") && /Device only/i.test(reachPaint.text),
      JSON.stringify(reachPaint));
    check("sidebar reach names the server",
      /Family/i.test(reachPaint.title),
      JSON.stringify(reachPaint));
    await page.screenshot({ path: path.join(outDir, "sidebar-reach.png") });

    await page.click("#side-device-chip");
    await page.waitForSelector("#hosting-guide-title");
    const chipGuide = await page.locator("#hosting-guide-body").innerText();
    check("device-only chip opens sharing choices",
      /Google Drive/i.test(chipGuide) && /Self-hosted/i.test(chipGuide) && !/Same Wi-Fi|Phone hotspot/i.test(chipGuide),
      chipGuide.slice(0, 240));
    await page.click("#hosting-guide-close");

    await page.evaluate(() => {
      closeSideOverlay();
      const S = window.__ashS();
      const conn = S.conns["srv-local-srv1"];
      conn.me = { id: "me1", name: "Phil", role: "host" };
      conn.reachMode = "device";
      S.activeConnId = "srv-local-srv1";
      renderSidebar(true);
      document.getElementById("app")?.classList.add("nav-open");
    });
    const shareShown = await page.evaluate(() => {
      const b = document.getElementById("side-share-btn");
      return !!(b && !b.hidden);
    });
    check("invite hidden until sharing is configured", !shareShown);
    await page.evaluate(() => sharePersonalInviteLink(window.__ashS().conns["srv-local-srv1"]));
    await page.waitForSelector("#hosting-guide-body, .host-guide-title, #sharing-mode-public");
    const guideBody = await page.locator("#hosting-guide-body").innerText().catch(() => page.locator("body").innerText());
    check("guide offers Drive and self-hosting", /Google Drive/i.test(guideBody) && /Self-hosted/i.test(guideBody) && !/Same Wi-Fi|Phone hotspot/i.test(guideBody), guideBody.slice(0, 240));
    await page.locator("#sharing-mode-public, .host-guide-choice").first().click();
    await page.locator("button").filter({ hasText: /^Continue$/i }).first().click();
    const setupText = await page.locator("#hosting-guide-body").innerText();
    check("setup is Cloudflare Internet", /Cloudflare/i.test(setupText) && !/hotspot/i.test(setupText), setupText.slice(0, 240));
    const reachCalls = await page.evaluate(() => window.AshNative._calls.filter((c) => c[0] === "setReachMode"));
    check("web never setReachMode local or direct", !reachCalls.some((c) => c[2] === "local" || c[2] === "direct"), JSON.stringify(reachCalls));

    await context.close();
  }

  {
    const { context, page } = await openApp(false, 400);
    await page.click(".rail-join");
    await page.waitForSelector("#join-modal-title");
    const join = await page.locator("#join-modal-title").innerText();
    const joinBody = await page.locator(".modal-card").innerText();
    check("join-only shell opens join directly", /Join a server/i.test(join), join);
    check("join has Drive folder, no Nearby/hotspot", /Join a Drive folder/i.test(joinBody) && !/Nearby servers|Join host's Wi-Fi/i.test(joinBody), joinBody.slice(0, 240));
    await page.screenshot({ path: path.join(outDir, "400.png") });
    await context.close();
  }

  {
    const { context, page } = await openApp(true, 400);
    await page.click(".rail-join");
    await page.waitForSelector(".add-server-card");
    await page.screenshot({ path: path.join(outDir, "400-menu.png") });
    await context.close();
  }

  await browser.close();
  server.close();
  if (fail.length) {
    console.error("Failed:", fail.join("; "));
    process.exit(1);
  }
  console.log("All add-server checks passed. Screenshots in", outDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
