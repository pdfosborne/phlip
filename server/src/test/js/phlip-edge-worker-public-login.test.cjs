const fs = require("fs");
const path = require("path");
const assert = require("assert");

if (!globalThis.crypto) globalThis.crypto = require("crypto").webcrypto;

const cacheMap = new Map();
globalThis.caches = {
  default: {
    async match(req) {
      const response = cacheMap.get(req.url);
      return response ? response.clone() : undefined;
    },
    async put(req, response) {
      cacheMap.set(req.url, response.clone());
    },
    async delete(req) {
      return cacheMap.delete(req.url);
    },
  },
};

const kvMap = new Map();
const env = {
  EDGE_SECRET: "edge-secret",
  ORIGIN: "https://origin.test",
  HOST_SYNC: "host-sync",
  KV: {
    async get(key) {
      return kvMap.get(key) || null;
    },
    async put(key, value) {
      kvMap.set(key, String(value));
    },
    async delete(key) {
      kvMap.delete(key);
    },
    async list() {
      return { keys: [], list_complete: true };
    },
  },
};

const originCalls = [];
globalThis.fetch = async (url, init = {}) => {
  const incoming = url instanceof Request ? url : null;
  const parsed = new URL(incoming ? incoming.url : url);
  const method = init.method || incoming?.method || "GET";
  originCalls.push(`${method} ${parsed.pathname}`);
  if (parsed.pathname === "/ash-auth-salt") {
    return Response.json({ type: "authSalt", salt: "blind-or-real" });
  }
  if (parsed.pathname === "/ash-ok") {
    return Response.json({
      ok: true,
      name: "Private server name",
      minAge: 18,
      joinTag: "AB12",
      futureSensitiveField: "must-not-leak",
    });
  }
  if (parsed.pathname === "/ash-login") {
    if (parsed.searchParams.has("fail")) {
      return Response.json(
        { type: "error", error: "Wrong name or password." },
        { status: 403 },
      );
    }
    return Response.json({
      type: "welcome",
      token: "verified-member-token",
      user: { id: "user-1" },
    });
  }
  if (parsed.pathname === "/ash-join") {
    const rawBody = incoming
      ? await incoming.clone().text()
      : (init.body && typeof init.body.getReader === "function"
          ? await new Response(init.body).text()
          : String(init.body || "{}"));
    const body = JSON.parse(rawBody || "{}");
    if (body.name === "Queued") throw new Error("origin unavailable");
    if (body.name === "Welcome") {
      return Response.json({
        type: "welcome",
        token: "new-member-token",
        user: { id: "new-user", name: "Welcome" },
      });
    }
    return Response.json({
      type: "waiting",
      requestId: "request-1",
      setupNonce: "setup-1",
    });
  }
  if (parsed.pathname === "/ash-join-wait") {
    if (parsed.searchParams.get("id") === "approved") {
      return Response.json({
        type: "welcome",
        token: "approved-member-token",
        user: { id: "approved-user", name: "Approved" },
      });
    }
    if (parsed.searchParams.get("id") === "error") {
      return Response.json({ type: "error", error: "expired" }, { status: 404 });
    }
    return Response.json({ type: "waiting", requestId: "request-1" });
  }
  if (parsed.pathname === "/ash-rpc") {
    return Response.json({ type: "pong" });
  }
  return new Response("shell", {
    status: 200,
    headers: { "content-type": "text/html" },
  });
};

const workerPath = path.resolve(
  __dirname,
  "../../main/assets/edge/phlip-edge-worker.js",
);
const workerSource = fs
  .readFileSync(workerPath, "utf8")
  .replace("export default {", "globalThis.edgeWorker = {");
new Function(workerSource)();

const hostHeaders = { host: "public.example" };
const memberBindingCount = () =>
  [...kvMap.keys()].filter((key) => key.startsWith("member:public.example:")).length;
const helpersSource = fs.readFileSync(
  path.resolve(__dirname, "../../../../../phlip-web/public/scripts/helpers/helpers-part3.js"),
  "utf8",
);
const renderSource = [
  fs.readFileSync(
    path.resolve(__dirname, "../../../../../phlip-web/public/scripts/render/render-join-parse.js"),
    "utf8",
  ),
  fs.readFileSync(
    path.resolve(__dirname, "../../../../../phlip-web/public/scripts/render/render-join-modal.js"),
    "utf8",
  ),
].join("\n");
const handlersSource = fs.readFileSync(
  path.resolve(__dirname, "../../../../../phlip-web/public/scripts/handlers/handlers-dispatch.js"),
  "utf8",
);
const servedSource = fs.readFileSync(
  path.resolve(__dirname, "../../../../../phlip-web/public/scripts/shell/served.js"),
  "utf8",
);
assert.ok(
  servedSource.includes("const url = String(inviteUrl || \"\").trim()"),
  "Open in Phlip must never fall back to a bare root origin",
);
assert.ok(servedSource.includes("extractInviteSlug(url)"));
assert.ok(servedSource.includes("if (parsed.protocol === \"https:\" && !slug) return \"\""));
assert.ok(servedSource.includes("document.addEventListener(\"ash:welcome\""));
assert.ok(servedSource.includes("personalInviteUrl(conn)"));
assert.ok(servedSource.includes("await ensurePersonalInviteUrl(conn)"));
const completeOpenTargetSource = servedSource.match(
  /(function completeOpenInPhlipTarget\([\s\S]*?\r?\n})\r?\n\r?\n\/\*\*/,
)?.[1];
assert.ok(completeOpenTargetSource, "complete invite target guard must exist");
const completeOpenInPhlipTarget = new Function(
  "location",
  "extractInviteSlug",
  `${completeOpenTargetSource}; return completeOpenInPhlipTarget;`,
)(
  { origin: "https://public.example" },
  (raw) => new URL(raw).pathname.match(/^\/j\/([^/]+)/i)?.[1] || "",
);
assert.equal(
  completeOpenInPhlipTarget("https://public.example/"),
  "",
  "anonymous Public root must not be an app target",
);
assert.equal(
  completeOpenInPhlipTarget("https://public.example/j/current99?from=browser"),
  "https://public.example/j/current99",
  "personal invite target must retain the complete canonical /j/slug URL",
);
assert.ok(
  renderSource.includes("if (hasHost && bootstrapBase"),
  "atomic origin + slug prefill must bootstrap directly without returning to URL entry",
);
const parseJoinSectionsSource = renderSource.match(
  /(function parseJoinCodeSections\([\s\S]*?\r?\n})\r?\n\r?\nconst ASH_PUBLIC_ROUTE_KEY/,
)?.[1];
assert.ok(parseJoinSectionsSource, "join prefill parser must exist");
const parseJoinCodeSections = new Function(
  "extractInviteSlug",
  "normInviteSlug",
  `${parseJoinSectionsSource}; return parseJoinCodeSections;`,
)(
  (raw) => {
    const text = String(raw || "");
    try {
      const parsed = new URL(text);
      const explicit = parsed.searchParams.get("slug");
      if (explicit) return explicit.toLowerCase().replace(/[^a-z0-9]/g, "");
      return parsed.pathname.match(/^\/j\/([^/]+)/i)?.[1] || "";
    } catch {
      return text.match(/\/j\/([a-z0-9]+)/i)?.[1] || "";
    }
  },
  (raw) => String(raw || "").toLowerCase().replace(/[^a-z0-9]/g, ""),
);
let parsedJoin = parseJoinCodeSections(
  "phlip://join?url=https%3A%2F%2Fpublic.example%2Fj%2Fcurrent99&slug=current99",
);
assert.equal(parsedJoin.host, "https://public.example/j/current99");
assert.equal(parsedJoin.inviteSlug, "current99");
parsedJoin = parseJoinCodeSections(
  "phlip://join?url=https%3A%2F%2Fpublic.example&slug=current99",
);
assert.equal(
  parsedJoin.host,
  "https://public.example/j/current99",
  "legacy origin + slug deep links must also fill the complete invite URL",
);
assert.ok(
  renderSource.includes("if (publicHttps && (!loginSalt || !authVerifier))"),
  "public login must stop before posting when verifier derivation is incomplete",
);
const passwordSetupAt = handlersSource.indexOf("await completePasswordSetup(conn, pendingPw, m)");
const passwordAdmissionAt = handlersSource.indexOf("admitWelcomeUi();", passwordSetupAt);
assert.ok(
  passwordSetupAt >= 0 && passwordAdmissionAt > passwordSetupAt,
  "new-member password setup must finish before welcome UI admission",
);
const inviteMetaGuardSource = helpersSource.match(
  /function publicInviteMetaConfirmed\([^)]*\) \{[\s\S]*?\n\}/,
)?.[0];
assert.ok(inviteMetaGuardSource, "client invite metadata guard must exist");
const publicInviteMetaConfirmed = new Function(
  `${inviteMetaGuardSource}; return publicInviteMetaConfirmed;`,
)();
const unlockEdgeGateSource = helpersSource.match(
  /(async function unlockEdgeGate\([\s\S]*?\r?\n})\r?\n\r?\n\/\*\* Candidate bases/,
)?.[1];
assert.ok(unlockEdgeGateSource, "client edge unlock function must exist");
function buildUnlockEdgeGate(serverFetchImpl, rememberImpl = () => {}) {
  return new Function(
    "serverFetch",
    "rememberEdgeInvite",
    `${unlockEdgeGateSource}; return unlockEdgeGate;`,
  )(serverFetchImpl, rememberImpl);
}
assert.equal(
  publicInviteMetaConfirmed("https://public.example", "current99", { ok: true }),
  false,
  "client must reject anonymous ash-ok for a personal invite",
);
assert.equal(
  publicInviteMetaConfirmed(
    "https://public.example",
    "current99",
    { ok: true, name: "Public test" },
  ),
  true,
  "client should accept invite-tier server metadata",
);
assert.equal(
  publicInviteMetaConfirmed("https://public.example", "", { ok: true }),
  true,
  "bare returning-member health checks do not require invite metadata",
);

function assertHsts(response, label) {
  assert.equal(
    response.headers.get("strict-transport-security"),
    "max-age=31536000; includeSubDomains",
    `${label} must include HSTS`,
  );
}

async function assertNonceCsp(response, label) {
  assertHsts(response, label);
  const csp = response.headers.get("content-security-policy") || "";
  assert.ok(csp.includes("default-src 'none'"), `${label} must default deny`);
  assert.ok(csp.includes("form-action 'self'"), `${label} must limit forms`);
  assert.ok(csp.includes("frame-ancestors 'none'"), `${label} must deny framing`);
  assert.ok(!csp.includes("unsafe-eval"), `${label} must not allow eval`);
  assert.ok(!csp.includes("form-action http: https:"), `${label} must not allow broad forms`);
  const nonce = csp.match(/script-src 'nonce-([^']+)'/)?.[1];
  assert.ok(nonce, `${label} must include a script nonce`);
  const body = await response.text();
  for (const tag of body.match(/<script\b[^>]*>/gi) || []) {
    assert.ok(tag.includes(`nonce="${nonce}"`), `${label} script must carry the CSP nonce`);
  }
  for (const tag of body.match(/<style\b[^>]*>/gi) || []) {
    assert.ok(tag.includes(`nonce="${nonce}"`), `${label} style must carry the CSP nonce`);
  }
  return body;
}

(async () => {
  let rememberedInvite = "";
  let unlock = buildUnlockEdgeGate(
    async () => Response.json({ ok: true }),
    (_base, token) => { rememberedInvite = token; },
  );
  let unlocked = await unlock("https://public.example", "", "current99");
  assert.equal(unlocked.ok, false, "cookie-only/malformed gate success must not unlock WebView");
  assert.equal(rememberedInvite, "");
  unlock = buildUnlockEdgeGate(
    async () => Response.json({ ok: true, token: "app-invite-token" }),
    (_base, token) => { rememberedInvite = token; },
  );
  unlocked = await unlock("https://public.example", "", "current99");
  assert.equal(unlocked.ok, true);
  assert.equal(rememberedInvite, "app-invite-token");
  unlock = buildUnlockEdgeGate(async () => { throw new Error("offline"); });
  unlocked = await unlock("https://public.example", "", "current99");
  assert.equal(unlocked.ok, false, "invite verifier reachability failure must stay explicit");

  let response = await edgeWorker.fetch(
    new Request("https://public.example/", { headers: hostHeaders }),
    env,
  );
  assert.equal(response.status, 200, "tier-none root should serve login shell");
  await assertNonceCsp(response, "tier-none root");

  response = await edgeWorker.fetch(
    new Request("https://public.example/ash-ok", { headers: hostHeaders }),
    env,
  );
  assert.deepEqual(
    await response.json(),
    { ok: true },
    "tier-none ash-ok must project an exact anonymous health response",
  );
  assertHsts(response, "tier-none ash-ok");
  response = await edgeWorker.fetch(
    new Request("https://public.example/ash-ok", {
      method: "HEAD",
      headers: hostHeaders,
    }),
    env,
  );
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "", "tier-none ash-ok HEAD must have no body");
  assertHsts(response, "tier-none ash-ok HEAD");

  response = await edgeWorker.fetch(
    new Request("https://public.example/edge/gate", {
      headers: { ...hostHeaders, accept: "text/html" },
    }),
    env,
  );
  await assertNonceCsp(response, "invite-required gate");

  response = await edgeWorker.fetch(
    new Request("https://public.example/j/unknown99", {
      headers: { ...hostHeaders, accept: "text/html" },
    }),
    env,
  );
  assert.equal(response.status, 404);
  const expiredInviteHtml = await assertNonceCsp(response, "expired invite");
  assert.ok(
    !expiredInviteHtml.includes("phlip-open-in-app"),
    "expired invite must not offer opening a revoked link in Phlip",
  );

  kvMap.set(
    "slug:current99",
    JSON.stringify({ hostname: "public.example", hostDisplayName: "Public test" }),
  );
  kvMap.set(
    "slugs:public.example",
    JSON.stringify({ slugs: ["current99"], hostDisplayName: "Public test" }),
  );
  response = await edgeWorker.fetch(
    new Request("https://public.example/edge/gate", {
      method: "POST",
      headers: {
        ...hostHeaders,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ slug: "current99", inviteSlug: "current99" }),
    }),
    env,
  );
  assert.equal(response.status, 200, "current slug should mint invite tier");
  const inviteToken = (await response.json()).token;
  assert.ok(inviteToken, "app clients need an invite token header fallback");

  response = await edgeWorker.fetch(
    new Request("https://public.example/ash-ok", {
      headers: { ...hostHeaders, "x-phlip-invite": inviteToken },
    }),
    env,
  );
  const inviteMeta = await response.json();
  assert.equal(inviteMeta.name, "Private server name");
  assert.equal(inviteMeta.minAge, 18);
  assertHsts(response, "invite-tier ash-ok");

  const beforeInviteJoin = originCalls.length;
  const bindingsBeforeWaiting = memberBindingCount();
  response = await edgeWorker.fetch(
    new Request("https://public.example/ash-join", {
      method: "POST",
      headers: {
        ...hostHeaders,
        "x-phlip-invite": inviteToken,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "App invite", inviteSlug: "current99" }),
    }),
    env,
  );
  assert.equal(response.status, 200, "invite-tier app join should reach origin");
  assert.equal((await response.json()).type, "waiting");
  assert.equal(
    memberBindingCount(),
    bindingsBeforeWaiting,
    "waiting responses must never bind member tier",
  );
  assert.ok(
    originCalls.slice(beforeInviteJoin).includes("POST /ash-join"),
    "valid app invite must use /ash-join",
  );
  assertHsts(response, "invite-tier ash-join");

  response = await edgeWorker.fetch(
    new Request("https://public.example/j/current99", {
      headers: { ...hostHeaders, accept: "text/html" },
    }),
    env,
  );
  const personalInvitePage = await assertNonceCsp(response, "personal invite");
  assert.ok(personalInvitePage.includes('id="phlip-open-in-app"'));
  assert.ok(
    personalInvitePage.includes(
      'href="phlip://join?url=https%3A%2F%2Fpublic.example%2Fj%2Fcurrent99&amp;slug=current99"',
    ),
    "valid invite must deep-link the complete personal invite URL",
  );
  assert.ok(personalInvitePage.includes('"phlip://join?url="'));
  assert.ok(personalInvitePage.includes('"&slug=" + encodedSlug'));
  assert.ok(personalInvitePage.includes("package=com.phlip"));
  assert.ok(personalInvitePage.includes('iterations: 150000'));
  assert.ok(personalInvitePage.includes('fetch("/ash-auth-salt?"'));
  assert.ok(personalInvitePage.includes('fetch("/ash-login"'));
  assert.ok(
    personalInvitePage.indexOf('fetch("/ash-login"') <
      personalInvitePage.indexOf('fetch("/j/" + encodeURIComponent(slug) + "/request"'),
    "invite page must try existing-member login before requesting new-member approval",
  );

  response = await edgeWorker.fetch(
    new Request("https://public.example/j/current99", {
      headers: {
        ...hostHeaders,
        accept: "application/octet-stream",
        "sec-fetch-mode": "navigate",
        "sec-fetch-dest": "document",
      },
    }),
    env,
  );
  assert.equal(response.status, 200);
  assert.ok(
    (await assertNonceCsp(response, "unusual invite navigation")).includes('id="phlip-open-in-app"'),
    "document navigation headers must select invite HTML despite an unusual Accept header",
  );

  response = await edgeWorker.fetch(
    new Request("https://public.example/j/current99/request", {
      method: "POST",
      headers: {
        ...hostHeaders,
        accept: "text/html",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "name=Waiting",
    }),
    env,
  );
  await assertNonceCsp(response, "join waiting");

  response = await edgeWorker.fetch(
    new Request("https://public.example/j/current99/request", {
      method: "POST",
      headers: {
        ...hostHeaders,
        accept: "text/html",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "name=Welcome",
    }),
    env,
  );
  await assertNonceCsp(response, "join welcome");
  const bindingsAfterDirectWelcome = memberBindingCount();
  assert.ok(bindingsAfterDirectWelcome > bindingsBeforeWaiting, "direct invite welcome must bind member tier");

  response = await edgeWorker.fetch(
    new Request("https://public.example/j/current99/request", {
      method: "POST",
      headers: {
        ...hostHeaders,
        accept: "text/html",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "name=Queued",
    }),
    env,
  );
  assert.equal(response.status, 202);
  await assertNonceCsp(response, "queued join");

  response = await edgeWorker.fetch(
    new Request("https://public.example/?s=not-synced", {
      headers: { ...hostHeaders, accept: "text/html" },
    }),
    env,
  );
  const unavailableHtml = await assertNonceCsp(response, "Broadcast unavailable");
  assert.ok(!unavailableHtml.includes("phlip-open-in-app"));

  cacheMap.set(
    new Request("https://phlip-edge.internal/cache/shareClosed%3Aclosed-one").url,
    Response.json({ closed: true }),
  );
  response = await edgeWorker.fetch(
    new Request("https://public.example/?s=closed-one", {
      headers: { ...hostHeaders, accept: "text/html" },
    }),
    env,
  );
  const endedHtml = await assertNonceCsp(response, "Broadcast ended");
  assert.ok(!endedHtml.includes("phlip-open-in-app"));

  response = await edgeWorker.fetch(
    new Request("https://public.example/ash-auth-salt?name=Alice", {
      headers: hostHeaders,
    }),
    env,
  );
  assert.equal(response.status, 200, "tier-none auth salt should be proxied");
  assertHsts(response, "tier-none auth salt");

  const beforeBlockedApis = originCalls.length;
  for (const [endpoint, method] of [
    ["/ash-join", "POST"],
    ["/ash-join-wait?id=request", "GET"],
    ["/ash-poll", "GET"],
    ["/ash-rpc", "POST"],
    ["/ash-leave", "POST"],
  ]) {
    response = await edgeWorker.fetch(
      new Request(`https://public.example${endpoint}`, {
        method,
        headers: { ...hostHeaders, "content-type": "application/json" },
        ...(method === "POST" ? { body: "{}" } : {}),
      }),
      env,
    );
    assert.equal(response.status, 401, `tier-none ${endpoint} must stay blocked`);
    assertHsts(response, `tier-none ${endpoint}`);
  }
  assert.equal(
    originCalls.length,
    beforeBlockedApis,
    "blocked member/join APIs must not reach origin",
  );

  const bindingsBeforeFailure = memberBindingCount();
  response = await edgeWorker.fetch(
    new Request("https://public.example/ash-login?fail=1", {
      method: "POST",
      headers: { ...hostHeaders, "content-type": "application/json" },
      body: "{}",
    }),
    env,
  );
  assert.equal(response.status, 403);
  assertHsts(response, "failed public login");
  assert.equal(
    memberBindingCount(),
    bindingsBeforeFailure,
    "failed login must not bind member tier",
  );

  response = await edgeWorker.fetch(
    new Request("https://public.example/ash-login", {
      method: "POST",
      headers: { ...hostHeaders, "content-type": "application/json" },
      body: "{}",
    }),
    env,
  );
  assert.equal(response.status, 200, "verified login should be proxied");
  assertHsts(response, "verified public login");
  assert.ok(
    [...kvMap.keys()].some((key) => key.startsWith("member:public.example:")),
    "verified welcome should bind member tier",
  );

  response = await edgeWorker.fetch(
    new Request("https://public.example/ash-rpc", {
      method: "POST",
      headers: {
        ...hostHeaders,
        "content-type": "application/json",
        "x-ash-token": "verified-member-token",
      },
      body: "{}",
    }),
    env,
  );
  assert.equal(response.status, 200, "bound member bearer should pass barrier");
  assertHsts(response, "member proxy");
  assert.ok(originCalls.includes("POST /ash-rpc"));

  response = await edgeWorker.fetch(
    new Request("https://public.example/ash-join", {
      method: "POST",
      headers: {
        ...hostHeaders,
        "x-phlip-invite": inviteToken,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "Welcome", inviteSlug: "current99" }),
    }),
    env,
  );
  assert.equal((await response.clone().json()).type, "welcome");
  assertHsts(response, "invite-tier immediate welcome");
  response = await edgeWorker.fetch(
    new Request("https://public.example/ash-rpc", {
      method: "POST",
      headers: {
        ...hostHeaders,
        "content-type": "application/json",
        "x-ash-token": "new-member-token",
      },
      body: "{}",
    }),
    env,
  );
  assert.equal(response.status, 200, "join welcome bearer must work on the first member RPC");

  const beforeWaitBinding = memberBindingCount();
  response = await edgeWorker.fetch(
    new Request("https://public.example/ash-join-wait?id=request-1", {
      headers: { ...hostHeaders, "x-phlip-invite": inviteToken },
    }),
    env,
  );
  assert.equal((await response.json()).type, "waiting");
  assert.equal(memberBindingCount(), beforeWaitBinding, "join-wait waiting must not bind");
  response = await edgeWorker.fetch(
    new Request("https://public.example/ash-join-wait?id=approved", {
      headers: { ...hostHeaders, "x-phlip-invite": inviteToken },
    }),
    env,
  );
  assert.equal((await response.json()).type, "welcome");
  response = await edgeWorker.fetch(
    new Request("https://public.example/ash-rpc", {
      method: "POST",
      headers: {
        ...hostHeaders,
        "content-type": "application/json",
        "x-ash-token": "approved-member-token",
      },
      body: "{}",
    }),
    env,
  );
  assert.equal(response.status, 200, "approval welcome bearer must work on the first member RPC");

  console.log("worker public-login barrier test passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
