import { NextRequest, NextResponse } from "next/server";

const FMOVIEZ_BASE_URL = "https://fmoviez.online";
const EMBEDSEEK_FALLBACK_HOST = "https://321movies.embedseek.xyz";
const REQUEST_TIMEOUT_MS = 12000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const isDigits = (value: string | null): value is string => !!value && /^\d+$/.test(value);

const getTargetUrl = (params: URLSearchParams): string | null => {
  const type = params.get("type");
  const id = params.get("id");

  if (!isDigits(id)) return null;

  if (type === "movie") {
    return `${FMOVIEZ_BASE_URL}/embed/movie/${id}`;
  }

  if (type === "tv") {
    const season = params.get("season");
    const episode = params.get("episode");

    if (!isDigits(season) || !isDigits(episode)) return null;

    return `${FMOVIEZ_BASE_URL}/embed/tv/${id}/${season}/${episode}`;
  }

  return null;
};

const extractIframeSource = (html: string): string | null => {
  const match = html.match(/<iframe[^>]*\ssrc=(["'])(.*?)\1/i);
  return match?.[2] ?? null;
};

const withTrackingHash = (playerUrl: URL, startAt?: number): URL => {
  if (!playerUrl.hostname.endsWith("embedseek.xyz")) return playerUrl;

  const rawHash = playerUrl.hash.startsWith("#") ? playerUrl.hash.slice(1) : playerUrl.hash;
  const parts = rawHash.split("&").filter(Boolean);

  const token = parts.length > 0 && !parts[0].includes("=") ? parts.shift()! : "";
  const params = new URLSearchParams(parts.join("&"));

  params.set("reportCurrentTime", "1");
  if (typeof startAt === "number" && Number.isFinite(startAt) && startAt > 0) {
    params.set("startAt", `${Math.floor(startAt)}`);
  }

  const nextHash = params.toString();
  playerUrl.hash = token ? `${token}${nextHash ? `&${nextHash}` : ""}` : nextHash;

  return playerUrl;
};

const resolveSeekRedirect = async (url: URL, signal: AbortSignal): Promise<URL> => {
  if (url.hostname !== "fmoviez.online" || !url.pathname.startsWith("/embed/seek/")) {
    return url;
  }

  try {
    const redirectResponse = await fetch(url.toString(), {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      signal,
      headers: {
        "user-agent": USER_AGENT,
      },
    });

    const location = redirectResponse.headers.get("location");
    if (location) return new URL(location, url.toString());
  } catch {
    // Fall back to token-based URL below.
  }

  const token = url.pathname.split("/").filter(Boolean).pop();
  if (!token) return url;

  return new URL(`${EMBEDSEEK_FALLBACK_HOST}/#${token}`);
};

const renderError = (message: string) =>
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Player Error</title>
    <style>
      html,body{margin:0;padding:0;width:100%;height:100%;background:#000;color:#fff;font-family:Arial,Helvetica,sans-serif}
      .wrap{display:flex;align-items:center;justify-content:center;height:100%;padding:24px;text-align:center;opacity:.9}
    </style>
  </head>
  <body>
    <div class="wrap">${message}</div>
  </body>
</html>`;

const renderProxy = (source: string) =>
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>FMoviez Proxy Player</title>
    <style>
      html,body{margin:0;padding:0;width:100%;height:100%;background:#000}
      iframe{border:0;width:100%;height:100%}
    </style>
  </head>
  <body>
    <iframe id="player" allowfullscreen loading="eager" referrerpolicy="origin"></iframe>
    <script>
      (function () {
        const iframe = document.getElementById("player");
        iframe.src = ${JSON.stringify(source)};

        window.addEventListener("message", function (event) {
          if (!event || event.source === window.parent) return;
          if (event.data && typeof event.data === "object" && event.data.type === "FMOVIEZ_PLAYER_EVENT") return;

          window.parent.postMessage(
            {
              type: "FMOVIEZ_PLAYER_EVENT",
              origin: event.origin,
              data: event.data
            },
            "*"
          );
        });
      })();
    </script>
  </body>
</html>`;

export const dynamic = "force-dynamic";

export const GET = async (request: NextRequest) => {
  const url = getTargetUrl(request.nextUrl.searchParams);
  if (!url) {
    return new NextResponse(renderError("Invalid proxy parameters."), {
      status: 400,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  const timeout = new AbortController();
  const timeoutId = setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: timeout.signal,
      headers: {
        "user-agent": USER_AGENT,
      },
    });

    if (!response.ok) {
      return new NextResponse(renderError("Unable to load source player."), {
        status: 502,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    const html = await response.text();
    const iframeSource = extractIframeSource(html);
    if (!iframeSource) {
      return new NextResponse(renderError("No embedded player found."), {
        status: 502,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    let resolvedPlayerUrl = new URL(iframeSource, url);
    resolvedPlayerUrl = await resolveSeekRedirect(resolvedPlayerUrl, timeout.signal);

    const startAtParam = request.nextUrl.searchParams.get("startAt");
    const startAt = isDigits(startAtParam) ? Number(startAtParam) : undefined;

    const trackedPlayerUrl = withTrackingHash(resolvedPlayerUrl, startAt);

    return new NextResponse(renderProxy(trackedPlayerUrl.toString()), {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store, max-age=0",
      },
    });
  } catch {
    return new NextResponse(renderError("Failed to initialize player proxy."), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  } finally {
    clearTimeout(timeoutId);
  }
};
