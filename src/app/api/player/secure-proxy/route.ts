import { NextRequest, NextResponse } from "next/server";
import { createPlayerProxyToken, decodePlayerProxyToken, isPlayerProxyTokenEnabled } from "@/utils/playerProxyToken";

const TOKEN_PARAM = "token";
const WORKER_KEY_HEADER = "x-proxy-key";
const SECURE_PROXY_ROUTE_PATH = "/api/player/secure-proxy";
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const applyCorsHeaders = (headers: Headers): void => {
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Range");
  headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  headers.set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");
};

const withCors = (response: NextResponse): NextResponse => {
  applyCorsHeaders(response.headers);
  return response;
};

const asAbsoluteUrl = (value: string, base?: string): string => {
  try {
    return new URL(value, base).toString();
  } catch {
    return value;
  }
};

const isPlaylistLike = (url: string, contentType: string): boolean => {
  const normalizedContentType = contentType.toLowerCase();
  return (
    /\.m3u8($|\?)/i.test(url) ||
    normalizedContentType.includes("application/vnd.apple.mpegurl") ||
    normalizedContentType.includes("application/x-mpegurl")
  );
};

const sanitizeUpstreamHeaders = (headers: Headers): Headers => {
  const next = new Headers(headers);
  next.delete("set-cookie");
  next.delete("content-security-policy");
  next.delete("content-security-policy-report-only");
  next.delete("x-frame-options");
  return next;
};

const toSecureProxyUrl = (
  _request: NextRequest,
  targetUrl: string,
  expiresAtUnixSeconds: number,
): string | null => {
  const token = createPlayerProxyToken(targetUrl, expiresAtUnixSeconds);
  if (!token) return null;

  const params = new URLSearchParams({
    [TOKEN_PARAM]: token,
  });
  return `${SECURE_PROXY_ROUTE_PATH}?${params.toString()}`;
};

const rewritePlaylistBody = (
  request: NextRequest,
  playlistBody: string,
  playlistUrl: string,
  expiresAtUnixSeconds: number,
): string | null => {
  const rewriteTarget = (raw: string): string | null => {
    const absolute = asAbsoluteUrl(raw, playlistUrl);
    return toSecureProxyUrl(request, absolute, expiresAtUnixSeconds);
  };

  const lines = playlistBody.split("\n").map((line) => {
    if (line.startsWith("#")) {
      if (line.includes('URI="')) {
        return line.replace(/URI="([^"]+)"/g, (fullMatch, capturedUri: string) => {
          const rewritten = rewriteTarget(capturedUri);
          if (!rewritten) return fullMatch;
          return `URI="${rewritten}"`;
        });
      }

      return line;
    }

    const trimmed = line.trim();
    if (!trimmed) return line;

    const rewritten = rewriteTarget(trimmed);
    return rewritten || line;
  });

  return lines.join("\n");
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = async (request: NextRequest) => {
  if (!isPlayerProxyTokenEnabled()) {
    return withCors(NextResponse.json({ error: "Secure proxy token is not configured" }, { status: 503 }));
  }

  const token = request.nextUrl.searchParams.get(TOKEN_PARAM);
  if (!token) {
    return withCors(NextResponse.json({ error: "Missing token" }, { status: 400 }));
  }

  const payload = decodePlayerProxyToken(token);
  if (!payload) {
    return withCors(NextResponse.json({ error: "Invalid or expired token" }, { status: 403 }));
  }

  const targetUrl = asAbsoluteUrl(payload.target);
  let parsedTarget: URL;
  try {
    parsedTarget = new URL(targetUrl);
  } catch {
    return withCors(NextResponse.json({ error: "Invalid target URL in token" }, { status: 400 }));
  }

  if (!["http:", "https:"].includes(parsedTarget.protocol)) {
    return withCors(NextResponse.json({ error: "Unsupported target protocol" }, { status: 400 }));
  }

  const upstreamHeaders = new Headers();
  upstreamHeaders.set("user-agent", DEFAULT_USER_AGENT);
  const range = request.headers.get("range");
  if (range) upstreamHeaders.set("range", range);
  const requestOrigin = request.headers.get("origin");
  const requestReferer = request.headers.get("referer");
  const fallbackOrigin = request.nextUrl.origin;
  upstreamHeaders.set("origin", requestOrigin || fallbackOrigin);
  upstreamHeaders.set("referer", requestReferer || `${fallbackOrigin}/`);
  const workerKey = process.env.PLAYER_PROXY_WORKER_KEY?.trim();
  if (workerKey) {
    upstreamHeaders.set(WORKER_KEY_HEADER, workerKey);
  }

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, {
      method: "GET",
      headers: upstreamHeaders,
      redirect: "follow",
      cache: "no-store",
    });
  } catch {
    return withCors(NextResponse.json({ error: "Failed to fetch upstream content" }, { status: 502 }));
  }

  const upstreamContentType = upstream.headers.get("content-type") || "";
  const upstreamResponseUrl = upstream.url || targetUrl;
  const shouldRewritePlaylist = isPlaylistLike(upstreamResponseUrl, upstreamContentType);
  const responseHeaders = sanitizeUpstreamHeaders(upstream.headers);

  if (!shouldRewritePlaylist) {
    const passthrough = new NextResponse(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
    return withCors(passthrough);
  }

  const rawPlaylist = await upstream.text();
  const rewrittenPlaylist = rewritePlaylistBody(request, rawPlaylist, upstreamResponseUrl, payload.exp);
  if (!rewrittenPlaylist) {
    return withCors(NextResponse.json({ error: "Failed to rewrite playlist" }, { status: 500 }));
  }

  responseHeaders.set("content-type", "application/vnd.apple.mpegurl");
  responseHeaders.delete("content-length");
  responseHeaders.delete("content-encoding");
  responseHeaders.set("cache-control", "private, no-store, max-age=0");

  const response = new NextResponse(rewrittenPlaylist, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });

  return withCors(response);
};

export const OPTIONS = async () => {
  return withCors(new NextResponse(null, { status: 204 }));
};
