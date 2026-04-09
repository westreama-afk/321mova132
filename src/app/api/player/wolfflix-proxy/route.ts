import { NextRequest, NextResponse } from "next/server";

const WOLFFLIX_HOSTNAME = "api.wolfflix.xyz";
const WOLFFLIX_ORIGIN = "https://wolfflix.xyz";
const WOLFFLIX_REFERER = "https://wolfflix.xyz/";
const REQUEST_TIMEOUT_MS = 15000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Expose-Headers": "Content-Length,Content-Type,Accept-Ranges,Content-Range",
};

const isPlaylist = (contentType: string | null, url: URL): boolean => {
  const normalizedType = (contentType || "").toLowerCase();
  if (normalizedType.includes("application/vnd.apple.mpegurl")) return true;
  if (normalizedType.includes("application/x-mpegurl")) return true;
  return url.pathname.toLowerCase().endsWith(".m3u8");
};

const buildLocalProxyUrl = (request: NextRequest, upstreamUrl: string): string => {
  const proxyUrl = new URL("/api/player/wolfflix-proxy", request.nextUrl.origin);
  proxyUrl.searchParams.set("url", upstreamUrl);
  return proxyUrl.toString();
};

const resolveTargetUrl = (request: NextRequest): URL | null => {
  const raw = request.nextUrl.searchParams.get("url");
  if (!raw) return null;

  const decoded = (() => {
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  })();

  try {
    const target = new URL(decoded);
    if (!["http:", "https:"].includes(target.protocol)) return null;
    if (target.hostname !== WOLFFLIX_HOSTNAME) return null;
    return target;
  } catch {
    return null;
  }
};

const rewriteDirectiveUri = (line: string, baseUrl: URL, request: NextRequest): string => {
  const uriMatch = line.match(/URI="([^"]+)"/i);
  if (!uriMatch) return line;

  try {
    const absolute = new URL(uriMatch[1], baseUrl).toString();
    const proxied = buildLocalProxyUrl(request, absolute);
    return line.replace(uriMatch[1], proxied);
  } catch {
    return line;
  }
};

const rewritePlaylist = (playlist: string, baseUrl: URL, request: NextRequest): string => {
  return playlist
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return line;

      if (trimmed.startsWith("#")) {
        return rewriteDirectiveUri(line, baseUrl, request);
      }

      try {
        const absolute = new URL(trimmed, baseUrl).toString();
        return buildLocalProxyUrl(request, absolute);
      } catch {
        return line;
      }
    })
    .join("\n");
};

const createResponseHeaders = (upstreamHeaders?: Headers, playlist = false): Headers => {
  const headers = new Headers();

  if (playlist) {
    headers.set("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
  } else if (upstreamHeaders) {
    const passThrough = [
      "content-type",
      "content-length",
      "accept-ranges",
      "content-range",
      "etag",
      "last-modified",
      "cache-control",
    ];

    for (const name of passThrough) {
      const value = upstreamHeaders.get(name);
      if (value) headers.set(name, value);
    }
  }

  for (const [name, value] of Object.entries(CORS_HEADERS)) {
    headers.set(name, value);
  }

  if (!headers.has("Cache-Control")) {
    headers.set("Cache-Control", "no-store, max-age=0");
  }

  return headers;
};

const proxyRequest = async (request: NextRequest, method: "GET" | "HEAD"): Promise<NextResponse> => {
  const targetUrl = resolveTargetUrl(request);
  if (!targetUrl) {
    return NextResponse.json({ error: "Invalid or unsupported target URL" }, { status: 400 });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const upstreamHeaders = new Headers({
      accept: request.headers.get("accept") || "*/*",
      origin: WOLFFLIX_ORIGIN,
      referer: WOLFFLIX_REFERER,
      "user-agent": USER_AGENT,
    });

    const range = request.headers.get("range");
    if (range) upstreamHeaders.set("range", range);

    const upstreamResponse = await fetch(targetUrl.toString(), {
      method,
      cache: "no-store",
      signal: controller.signal,
      headers: upstreamHeaders,
    });

    if (method === "HEAD") {
      return new NextResponse(null, {
        status: upstreamResponse.status,
        headers: createResponseHeaders(upstreamResponse.headers, false),
      });
    }

    if (!isPlaylist(upstreamResponse.headers.get("content-type"), targetUrl)) {
      return new NextResponse(upstreamResponse.body, {
        status: upstreamResponse.status,
        headers: createResponseHeaders(upstreamResponse.headers, false),
      });
    }

    const originalPlaylist = await upstreamResponse.text();
    const rewrittenPlaylist = rewritePlaylist(originalPlaylist, targetUrl, request);

    return new NextResponse(rewrittenPlaylist, {
      status: upstreamResponse.status,
      headers: createResponseHeaders(upstreamResponse.headers, true),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Wolfflix proxy failed";
    return NextResponse.json({ error: message }, { status: 502 });
  } finally {
    clearTimeout(timeoutId);
  }
};

export const dynamic = "force-dynamic";

export const OPTIONS = async () => new NextResponse(null, { status: 204, headers: CORS_HEADERS });

export const HEAD = async (request: NextRequest) => proxyRequest(request, "HEAD");

export const GET = async (request: NextRequest) => proxyRequest(request, "GET");
