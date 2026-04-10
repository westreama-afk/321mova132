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

function safeUrl(input) {
  try {
    return new URL(input);
  } catch {
    return null;
  }
}

function getAllowedHosts(env) {
  const raw = (env.ALLOWED_HOSTS || "").trim();
  if (!raw) return DEFAULT_ALLOWED_HOSTS;
  return raw
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

function hostMatchesAllowed(urlObj, allowedHosts) {
  const host = urlObj.host.toLowerCase();
  const hostname = urlObj.hostname.toLowerCase();

  return allowedHosts.some((allowed) => {
    if (allowed.includes(":")) return host === allowed;
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

function parseHeaders(p) {
  try {
    return JSON.parse(p || "{}");
  } catch {
    return {};
  }
}

function buildHeaders(p) {
  const extra = parseHeaders(p);
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

function preflight(allowedOrigin) {
  if (!allowedOrigin) return new Response("forbidden", { status: 403 });
  return withCors(new Response("", { status: 204 }), allowedOrigin);
}

function abs(u, b) {
  try {
    return new URL(u, b).href;
  } catch {
    return u;
  }
}

function shouldForceTsContentType(target, upstreamHeaders) {
  const url = String(target || "").toLowerCase();
  if (
    url.endsWith(".html") ||
    url.endsWith(".js") ||
    url.endsWith(".png") ||
    url.endsWith(".jpg") ||
    url.endsWith(".ico") ||
    url.endsWith(".woff") ||
    url.endsWith(".woff2")
  ) {
    return true;
  }

  const ct = String(upstreamHeaders.get("content-type") || "").toLowerCase();
  return ct.includes("text/html") || ct.includes("application/javascript") || ct.includes("text/plain");
}

function sanitizeResponseHeaders(h) {
  const out = new Headers(h);
  out.delete("content-encoding");
  out.delete("content-length");
  return out;
}

function rewriteM3u8Text(text, absoluteTarget, headers, base, token, allowedOrigin) {
  const hParam = encodeURIComponent(JSON.stringify(Object.fromEntries(headers.entries())));
  const kParam = token ? `&k=${encodeURIComponent(token)}` : "";

  const lines = text.split("\n").map((line) => {
    if (line.startsWith("#")) {
      if (line.startsWith("#EXT-X-KEY")) {
        const m = line.match(/URI="([^"]+)"/);
        if (m) {
          const key = abs(m[1], absoluteTarget);
          return line.replace(
            m[1],
            `${base}/ts-proxy?url=${encodeURIComponent(key)}&headers=${hParam}${kParam}`,
          );
        }
      }

      if (line.startsWith("#EXT-X-MAP")) {
        // Initialization segment — may use obfuscated extensions (e.g. .woff).
        const m = line.match(/URI="([^"]+)"/);
        if (m) {
          const mapUrl = abs(m[1], absoluteTarget);
          return line.replace(
            m[1],
            `${base}/ts-proxy?url=${encodeURIComponent(mapUrl)}&headers=${hParam}${kParam}`,
          );
        }
      }

      if (line.startsWith("#EXT-X-MEDIA")) {
        const m = line.match(/URI="([^"]+)"/);
        if (m) {
          const u = abs(m[1], absoluteTarget);
          return line.replace(
            m[1],
            `${base}/m3u8-proxy?url=${encodeURIComponent(u)}&headers=${hParam}${kParam}`,
          );
        }
      }

      return line;
    }

    const t = line.trim();
    if (!t) return line;

    const absolute = abs(t, absoluteTarget);
    const isPlaylist = /\.m3u8(\?|$)/i.test(absolute) || absolute.includes("/playlist/");
    return isPlaylist
      ? `${base}/m3u8-proxy?url=${encodeURIComponent(absolute)}&headers=${hParam}${kParam}`
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

async function tsProxy(target, headers, host, allowedOrigin, base, token) {
  const absolute = abs(target, host || target);
  try {
    const r = await fetch(absolute, { headers, redirect: "follow" });

    const ct = (r.headers.get("content-type") || "").toLowerCase();
    const isM3u8ContentType = ct.includes("mpegurl");

    // If content-type is definitively a playlist, rewrite it immediately.
    if (isM3u8ContentType) {
      const text = await r.text();
      return rewriteM3u8Text(text, absolute, headers, base, token, allowedOrigin);
    }

    // Buffer then peek at first bytes — CDNs sometimes serve sub-playlists
    // with obfuscated extensions (.txt, .woff, etc.) and a generic content-type.
    const buf = await r.arrayBuffer();
    const peek = new TextDecoder("utf-8", { fatal: false }).decode(buf.slice(0, 8)).trimStart();
    if (peek.startsWith("#EXTM3U")) {
      const text = new TextDecoder().decode(buf);
      return rewriteM3u8Text(text, absolute, headers, base, token, allowedOrigin);
    }

    const respHeaders = sanitizeResponseHeaders(r.headers);
    if (shouldForceTsContentType(absolute, r.headers)) {
      respHeaders.set("Content-Type", "video/mp2t");
    }

    return withCors(
      new Response(buf, {
        status: r.status,
        statusText: r.statusText,
        headers: respHeaders,
      }),
      allowedOrigin,
    );
  } catch (e) {
    return withCors(new Response(`ts fetch error: ${e}`, { status: 502 }), allowedOrigin);
  }
}

async function m3u8Proxy(target, headers, base, host, token, allowedOrigin) {
  const absoluteTarget = abs(target, host || target);
  let up;

  try {
    up = await fetch(absoluteTarget, { headers, redirect: "follow" });
  } catch (e) {
    return withCors(new Response(`m3u8 fetch error: ${e}`, { status: 502 }), allowedOrigin);
  }

  if (!up.ok) {
    return withCors(new Response(`m3u8 fetch failed: ${up.status}`, { status: up.status }), allowedOrigin);
  }

  let text;
  try {
    text = await up.text();
  } catch (e) {
    return withCors(new Response(`m3u8 read error: ${e}`, { status: 502 }), allowedOrigin);
  }

  return rewriteM3u8Text(text, absoluteTarget, headers, base, token, allowedOrigin);
}

export default {
  async fetch(req, env) {
    try {
      const allowedOrigin = resolveAllowedOrigin(req, env);

      if (req.method === "OPTIONS") {
        return preflight(allowedOrigin);
      }

      // Block non-allowed domains
      if (!allowedOrigin) {
        return new Response("forbidden origin/referer", { status: 403 });
      }

      // Optional shared key check (strongly recommended)
      const requiredKey = (env.PROXY_KEY || "").trim();
      const reqUrl = new URL(req.url);
      const token = reqUrl.searchParams.get("k") || req.headers.get("x-proxy-key") || "j7wYkYhVgQn5x2L6k2M8hVQfD4zN3bP1aR7uT0cXyE6dZX4sW";

      if (requiredKey && token !== requiredKey) {
        return withCors(new Response("forbidden key", { status: 403 }), allowedOrigin);
      }

      const target = reqUrl.searchParams.get("url");
      if (!target) return withCors(new Response("missing url", { status: 400 }), allowedOrigin);

      const targetUrl = safeUrl(target);
      if (!targetUrl || !/^https?:$/.test(targetUrl.protocol)) {
        return withCors(new Response("invalid target url", { status: 400 }), allowedOrigin);
      }

      const headers = buildHeaders(reqUrl.searchParams.get("headers"));
      const base = `${reqUrl.protocol}//${reqUrl.host}`;
      let host = reqUrl.searchParams.get("host");

      if (!host) host = headers.get("X-Proxy-Host") || headers.get("x-proxy-host");
      headers.delete("X-Proxy-Host");
      headers.delete("x-proxy-host");

      return reqUrl.pathname.includes("/ts-proxy")
        ? tsProxy(target, headers, host, allowedOrigin, base, requiredKey ? token : "")
        : m3u8Proxy(target, headers, base, host, requiredKey ? token : "", allowedOrigin);
    } catch (e) {
      return new Response(`worker error: ${e}`, { status: 500 });
    }
  },
};
