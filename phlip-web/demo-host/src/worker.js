const SECURITY = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Content-Security-Policy": "frame-ancestors 'none'",
};

function withSecurity(res) {
  const headers = new Headers(res.headers);
  for (const [key, value] of Object.entries(SECURITY)) {
    if (!headers.has(key)) headers.set(key, value);
  }
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

export default {
  async fetch(request, env) {
    let res = await env.ASSETS.fetch(request);
    if (res.status === 404) {
      const url = new URL(request.url);
      if (!/\.[a-zA-Z0-9]+$/.test(url.pathname)) {
        const index = new URL(request.url);
        index.pathname = "/index.html";
        res = await env.ASSETS.fetch(new Request(index, request));
      }
    }
    return withSecurity(res);
  },
};
