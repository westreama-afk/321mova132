const DEFAULT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";
const DEFAULT_ALLOWED_HOSTS = [
  "321movies.co.uk",
  "www.321movies.co.uk",
  "321movies.xyz",
  "www.321movies.xyz",
  "localhost:3038",
  "127.0.0.1:3038",
  "localhost",
];

// --- HELPERS ---
function safeUrl(input) {
  try { return new URL(input); } catch { return null; }
}

function getAllowedHosts(env) {
  const raw = (env.ALLOWED_HOSTS || "").trim();
  if (!raw) return DEFAULT_ALLOWED_HOSTS;
  return raw.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
}

function hostMatchesAllowed(urlObj, allowedHosts) {
  const hostname = urlObj.hostname.toLowerCase();
  return allowedHosts.some((allowed) => {
    if (allowed.includes(":")) return urlObj.host.toLowerCase() === allowed;
    return hostname === allowed || hostname.endsWith(`.${allowed}`);
  });
}

function resolveAllowedOrigin(req, env) {
  const allowedHosts = getAllowedHosts(env);
  const origin = req.headers.get("origin");
  if (origin) {
    const u = safeUrl(origin);
    if (u && hostMatchesAllowed(u, allowedHosts)) return u.origin;
  }
  const referer = req.headers.get("referer");
  if (referer) {
    const u = safeUrl(referer);
    if (u && hostMatchesAllowed(u, allowedHosts)) return u.origin;
  }
  return null;
}

function buildHeaders(p) {
  const extra = (function() { try { return JSON.parse(p || "{}"); } catch { return {}; } })();
  const h = new Headers();
  Object.entries(extra).forEach(([k, v]) => h.set(k, String(v)));
  if (!h.get("User-Agent")) h.set("User-Agent", DEFAULT_UA);
  const ref = extra.Referer || extra.referer;
  if (!h.get("Referer") && ref) h.set("Referer", ref);

  h.delete("accept-encoding");
  h.delete("content-length");
  h.delete("host");
  h.delete("cookie");
  return h;
}

function withCors(resp, allowedOrigin) {
  if (!allowedOrigin) return resp;
  resp.headers.set("Access-Control-Allow-Origin", allowedOrigin);
  resp.headers.set("Vary", "Origin");
  resp.headers.set("Access-Control-Allow-Headers", "Content-Type, Range, X-Proxy-Key");
  resp.headers.set("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");
  resp.headers.set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");
  return resp;
}

function sanitizeResponseHeaders(h) {
  const out = new Headers(h);
  out.delete("content-encoding");
  out.set("Cache-Control", "public, max-age=43200");
  return out;
}

function abs(u, b) {
  try { return new URL(u, b).href; } catch { return u; }
}

// --- M3U8 LOGIC ---
function rewriteM3u8Text(text, absoluteTarget, headers, base, token, allowedOrigin) {
  const hParam = encodeURIComponent(JSON.stringify(Object.fromEntries(headers.entries())));
  const kParam = token ? `&k=${encodeURIComponent(token)}` : "";

  const lines = text.split("\n").map((line) => {
    if (line.startsWith("#")) {
      if (line.startsWith("#EXT-X-KEY") || line.startsWith("#EXT-X-MAP") || line.startsWith("#EXT-X-MEDIA")) {
        const m = line.match(/URI="([^"]+)"/);
        if (m) {
          const u = abs(m[1], absoluteTarget);
          let type = "ts-proxy";
          if (line.includes("MEDIA")) {
            type = "m3u8-proxy";
          } else if (/\.mp4(\?|$)/i.test(u)) {
            type = "mp4-proxy";
          }
          return line.replace(m[1], `${base}/${type}?url=${encodeURIComponent(u)}&headers=${hParam}${kParam}`);
        }
      }
      return line;
    }
    const t = line.trim();
    if (!t) return line;
    const absolute = abs(t, absoluteTarget);
    const isPlaylist = /\.m3u8(\?|$)/i.test(absolute) || absolute.includes("/playlist/");
    const isMp4 = /\.mp4(\?|$)/i.test(absolute);
    return isPlaylist
      ? `${base}/m3u8-proxy?url=${encodeURIComponent(absolute)}&headers=${hParam}${kParam}`
      : isMp4
      ? `${base}/mp4-proxy?url=${encodeURIComponent(absolute)}&headers=${hParam}${kParam}`
      : `${base}/ts-proxy?url=${encodeURIComponent(absolute)}&headers=${hParam}${kParam}`;
  });

  return withCors(
    new Response(lines.join("\n"), {
      status: 200,
      headers: { "Content-Type": "application/vnd.apple.mpegurl" },
    }),
    allowedOrigin,
  );
}

// --- PROXY FUNCTIONS ---
async function fetchUpstream(url, options, maxRetries = 2) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const r = await fetch(url, options);
      if (r.ok || r.status === 206 || r.status < 500) return r;
    } catch (e) {
      if (attempt === maxRetries) throw e;
    }
  }
}

async function tsProxy(target, headers, host, allowedOrigin, base, token) {
  const absolute = abs(target, host || target);
  try {
    // Pass through Range header for MP4 seeking
    const fetchHeaders = new Headers(headers);
    const reqRange = headers.get("range");
    if (reqRange) {
      fetchHeaders.set("range", reqRange);
    }

    const isMp4 = absolute.toLowerCase().endsWith(".mp4");
    const isMp4Range = isMp4 && reqRange;

    const r = await fetchUpstream(absolute, {
      headers: fetchHeaders,
      redirect: "follow",
      cf: {
        cacheTtl: 43200,
        cacheEverything: true,
        cacheKey: isMp4Range ? `${absolute}|${reqRange}` : absolute
      }
    });

    const ct = (r.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("mpegurl")) {
      const text = await r.text();
      return rewriteM3u8Text(text, absolute, headers, base, token, allowedOrigin);
    }

    const respHeaders = sanitizeResponseHeaders(r.headers);

    if (isMp4) {
      respHeaders.set("Content-Type", "video/mp4");
      // For full 200 responses only: drop Content-Length so the browser streams progressively.
      // For 206 range responses: keep it — removing it causes NS_ERROR_NET_PARTIAL_TRANSFER
      // when the upstream drops the connection before the full range is delivered.
      if (r.status !== 206) {
        respHeaders.delete("Content-Length");
      }
      // Do NOT set Transfer-Encoding: chunked — Cloudflare handles this automatically.
    } else if (absolute.toLowerCase().match(/\.(html|js|png|jpg|woff2?|ts)$/) || absolute.includes(".ts")) {
      respHeaders.set("Content-Type", "video/mp2t");
    }

    // Preserve Range response headers for MP4 seeking
    const contentRange = r.headers.get("content-range");
    if (contentRange) {
      respHeaders.set("Content-Range", contentRange);
    }
    const acceptRanges = r.headers.get("accept-ranges");
    if (acceptRanges) {
      respHeaders.set("Accept-Ranges", acceptRanges);
    } else if (isMp4) {
      respHeaders.set("Accept-Ranges", "bytes");
    }

    // STREAMING: r.body starts sending data immediately
    return withCors(
      new Response(r.body, {
        status: r.status,
        headers: respHeaders,
      }),
      allowedOrigin,
    );
  } catch (e) {
    console.error("[ts-proxy] Error fetching:", e);
    return withCors(new Response(`err: ${e}`, { status: 502 }), allowedOrigin);
  }
}

async function m3u8Proxy(target, headers, base, host, token, allowedOrigin) {
  const absoluteTarget = abs(target, host || target);
  try {
    const up = await fetch(absoluteTarget, { headers, redirect: "follow" });
    if (!up.ok) return withCors(new Response("fail", { status: up.status }), allowedOrigin);
    const text = await up.text();
    return rewriteM3u8Text(text, absoluteTarget, headers, base, token, allowedOrigin);
  } catch (e) {
    console.error("[m3u8-proxy] Error:", e);
    return withCors(new Response(`err: ${e}`, { status: 502 }), allowedOrigin);
  }
}

// --- API PROXY (server-to-server, key-authenticated, no origin check) ---
async function apiProxy(target, headers, allowedOrigin) {
  try {
    const r = await fetch(target, { headers, redirect: "follow" });
    const text = await r.text();
    return withCors(
      new Response(text, { status: r.status, headers: { "Content-Type": r.headers.get("content-type") || "text/plain" } }),
      allowedOrigin,
    );
  } catch (e) {
    return withCors(new Response(`err: ${e}`, { status: 502 }), allowedOrigin);
  }
}

// --- MAIN ROUTER ---
export default {
  async fetch(req, env) {
    try {
      const reqUrl = new URL(req.url);
      const allowedOrigin = resolveAllowedOrigin(req, env);
      if (req.method === "OPTIONS") return withCors(new Response(null, { status: 204 }), allowedOrigin);

      const defaultKey = "j7wYkYhVgQn5x2L6k2M8hVQfD4zN3bP1aR7uT0cXyE6dZX4sW";
      const requiredKey = (env.PROXY_KEY || "").trim();
      const token = reqUrl.searchParams.get("k") || req.headers.get("x-proxy-key") || defaultKey;

      // /api-proxy: server-to-server, key-authenticated, no browser origin required
      if (reqUrl.pathname.includes("/api-proxy")) {
        const expectedKey = requiredKey || defaultKey;
        if (token !== expectedKey) return new Response("bad key", { status: 403 });
        const target = reqUrl.searchParams.get("url");
        if (!target) return new Response("no url", { status: 400 });
        return apiProxy(target, buildHeaders(reqUrl.searchParams.get("headers")), allowedOrigin);
      }

      if (!allowedOrigin) return new Response("forbidden", { status: 403 });
      if (requiredKey && token !== requiredKey) return new Response("bad key", { status: 403 });

      const target = reqUrl.searchParams.get("url");
      if (!target) return new Response("no url", { status: 400 });

      const headers = buildHeaders(reqUrl.searchParams.get("headers"));
      const base = `${reqUrl.protocol}//${reqUrl.host}`;
      let host = reqUrl.searchParams.get("host") || headers.get("X-Proxy-Host") || headers.get("x-proxy-host");
      headers.delete("X-Proxy-Host");
      headers.delete("x-proxy-host");

      if (reqUrl.pathname.includes("/ts-proxy") || reqUrl.pathname.includes("/mp4-proxy")) {
        return tsProxy(target, headers, host, allowedOrigin, base, requiredKey ? token : "");
      } else {
        return m3u8Proxy(target, headers, base, host, requiredKey ? token : "", allowedOrigin);
      }
    } catch (e) {
      return new Response(`worker error: ${e}`, { status: 500 });
    }
  },
};