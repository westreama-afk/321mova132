import { NextRequest, NextResponse } from "next/server";
import { encodePlayerStreamUrl } from "@/utils/playerUrlCodec";

const SCRAPPER_BASE = "https://scrapper.rivestream.org";
const SCRAPPER_ORIGIN = "https://rivestream.org";
const SCRAPPER_REFERER = "https://rivestream.org/";
const PROVIDERS = ["flowcast", "asiacloud", "primevids", "hindicast", "guru", "ophim"] as const;
const PROVIDER_LABELS: Record<string, string> = {
  flowcast: "FlowCast",
  asiacloud: "AsiaCloud",
  primevids: "PrimeVids",
  hindicast: "HindiCast",
  guru: "Guru",
  ophim: "Ophim",
};
const REQUEST_TIMEOUT_MS = 10000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const DEFAULT_WORKER_PROXY = "https://small-cake-fdee.piracya.workers.dev";

type MediaType = "movie" | "tv";
type HeaderMap = Record<string, string>;

interface PlaylistSource {
  type: "hls";
  file: string;
  label: string;
  default?: boolean;
  provider?: string;
}

interface PlaylistResponse {
  playlist: Array<{
    sources: PlaylistSource[];
  }>;
}

interface ParsedMediaRequest {
  type: MediaType;
  id: string;
  season?: string;
  episode?: string;
}

interface ScrapperSource {
  quality?: string | number;
  url: string;
  source?: string;
  format?: string;
  headers?: HeaderMap | string | null;
}

interface ScrapperResponse {
  data: { sources: ScrapperSource[] } | null;
}

const isDigits = (value: string | null): value is string => !!value && /^\d+$/.test(value);

const parseMediaRequest = (params: URLSearchParams): ParsedMediaRequest | null => {
  const type = params.get("type") as MediaType | null;
  const id = params.get("id");
  if (!type || !isDigits(id)) return null;

  if (type === "movie") {
    return { type, id };
  }

  const season = params.get("season");
  const episode = params.get("episode");
  if (!isDigits(season) || !isDigits(episode)) return null;

  return { type, id, season, episode };
};

const getWorkerBaseUrl = () =>
  (
    process.env.PLAYER_PROXY_URL ||
    process.env.NEXT_PUBLIC_PLAYER_PROXY_URL ||
    DEFAULT_WORKER_PROXY
  ).replace(/\/+$/, "");

const buildWorkerM3u8ProxyUrl = (m3u8Url: string, headers: HeaderMap): string => {
  const workerBase = getWorkerBaseUrl();
  const params = new URLSearchParams({
    url: m3u8Url,
    headers: JSON.stringify(headers),
  });
  const workerKey = process.env.PLAYER_PROXY_WORKER_KEY?.trim();
  if (workerKey) {
    params.set("k", workerKey);
  }
  // Keep a .m3u8 suffix so player libraries reliably detect HLS mode.
  return `${workerBase}/m3u8-proxy/playlist.m3u8?${params.toString()}`;
};

const toPlaylistPayload = (sources: PlaylistSource[]): PlaylistResponse => ({
  playlist: [{ sources }],
});

const parseJsonObject = <T>(value: string | null | undefined): T | null => {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
};

const normalizeHeaders = (headers: HeaderMap | string | null | undefined): HeaderMap => {
  if (!headers) return {};
  const raw =
    typeof headers === "string"
      ? parseJsonObject<Record<string, unknown>>(headers)
      : headers;
  if (!raw || typeof raw !== "object") return {};
  const normalized: HeaderMap = {};
  Object.entries(raw).forEach(([key, value]) => {
    if (typeof value === "string" && value.trim().length > 0) {
      normalized[key] = value;
    }
  });
  return normalized;
};

const dedupeSources = (sources: PlaylistSource[]): PlaylistSource[] => {
  const seen = new Set<string>();
  return sources.filter((s) => {
    if (seen.has(s.file)) return false;
    seen.add(s.file);
    return true;
  });
};

const fetchWithTimeout = async (
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response | null> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
};

const buildProviderUrl = (provider: string, requestParams: ParsedMediaRequest): string => {
  const url = new URL(`${SCRAPPER_BASE}/api/provider`);
  url.searchParams.set("provider", provider);
  url.searchParams.set("id", requestParams.id);
  if (requestParams.type === "tv") {
    url.searchParams.set("season", requestParams.season!);
    url.searchParams.set("episode", requestParams.episode!);
  }
  return url.toString();
};

const normalizeScrapperSource = (
  source: ScrapperSource,
): { url: string; headers: HeaderMap } | null => {
  if (typeof source.url !== "string" || source.url.length === 0) return null;

  let directUrl = source.url;
  const mergedHeaders: HeaderMap = {};

  // Unwrap pre-proxied URLs (e.g. proxy.valhallastream.dpdns.org/proxy?url=...&headers=...)
  try {
    const parsed = new URL(source.url);
    const wrapped = parsed.searchParams.get("url");
    if (wrapped) {
      directUrl = decodeURIComponent(wrapped);
      const wrappedHeaders = parseJsonObject<Record<string, unknown>>(
        decodeURIComponent(parsed.searchParams.get("headers") || ""),
      );
      Object.assign(mergedHeaders, normalizeHeaders(wrappedHeaders as HeaderMap));
    }
  } catch {
    // keep original url
  }

  Object.assign(mergedHeaders, normalizeHeaders(source.headers));

  if (!mergedHeaders.Referer && !mergedHeaders.referer) {
    mergedHeaders.Referer = SCRAPPER_REFERER;
    mergedHeaders.Origin = SCRAPPER_ORIGIN;
  }

  return { url: directUrl, headers: mergedHeaders };
};

const fetchProviderSources = async (
  provider: string,
  requestParams: ParsedMediaRequest,
): Promise<PlaylistSource[]> => {
  try {
    const url = buildProviderUrl(provider, requestParams);
    const response = await fetchWithTimeout(
      url,
      {
        cache: "no-store",
        headers: {
          "user-agent": USER_AGENT,
          accept: "application/json, text/plain, */*",
          referer: SCRAPPER_REFERER,
          origin: SCRAPPER_ORIGIN,
        },
      },
      REQUEST_TIMEOUT_MS,
    );

    if (!response?.ok) return [];

    const payload = (await response.json()) as ScrapperResponse;
    if (!Array.isArray(payload?.data?.sources)) return [];

    const sources: PlaylistSource[] = [];

    for (const source of payload.data.sources) {
      // The player only processes type="hls" sources — skip mp4 and other formats
      if (source.format !== "hls") continue;

      const normalized = normalizeScrapperSource(source);
      if (!normalized) continue;

      const qualityStr =
        source.quality != null
          ? typeof source.quality === "number"
            ? `${source.quality}p`
            : String(source.quality)
          : "";
      const baseLabel = PROVIDER_LABELS[provider] ?? provider;
      const label = qualityStr ? `${baseLabel} ${qualityStr}` : baseLabel;

      sources.push({
        type: "hls",
        file: buildWorkerM3u8ProxyUrl(normalized.url, normalized.headers),
        label,
        provider,
      });
    }

    return sources;
  } catch {
    return [];
  }
};

export const dynamic = "force-dynamic";

export const GET = async (request: NextRequest) => {
  const requestParams = parseMediaRequest(request.nextUrl.searchParams);
  if (!requestParams) {
    return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
  }

  const results = await Promise.allSettled(
    PROVIDERS.map((provider) => fetchProviderSources(provider, requestParams)),
  );

  const providerOrder = (provider: string | undefined) => {
    if (provider === "guru") return 0;
    if (provider === "asiacloud") return 2;
    return 1;
  };

  const allSources: PlaylistSource[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      allSources.push(...result.value);
    }
  }

  const orderedSources = dedupeSources(
    allSources.slice().sort((a, b) => providerOrder(a.provider) - providerOrder(b.provider)),
  ).map((source, index) => ({
    ...source,
    default: index === 0,
  }));

  if (!orderedSources.length) {
    return NextResponse.json({ error: "Failed to resolve any playable source" }, { status: 502 });
  }

  const encodedSources = orderedSources.map((source) => ({
    ...source,
    file: encodePlayerStreamUrl(source.file),
  }));

  return NextResponse.json(toPlaylistPayload(encodedSources), {
    headers: {
      "cache-control": "no-store, max-age=0",
    },
  });
};
