import path from "node:path";
import { pathToFileURL } from "node:url";

type SourcePackMediaType = "movie" | "tv";
type HeaderMap = Record<string, string>;

interface SourcePackRequest {
  type: SourcePackMediaType;
  id: string;
  season?: string;
  episode?: string;
}

interface SourcePackConfig {
  key: string;
  sourceFile: string;
  label: string;
  timeout: number;
  jitter: number;
  retries: number;
  disabled?: boolean;
  multiBase?: boolean;
}

interface SourcePackModule {
  BASES?: string[];
  CDN_HEADERS?: Array<{ pattern: RegExp; headers: HeaderMap }>;
  HEADERS?: HeaderMap;
  PROXY_HEADERS?: HeaderMap;
  VERIFY_HEADERS?: HeaderMap;
  getDownloads?: (
    id: string,
    season?: string | null,
    episode?: string | null,
  ) => Promise<unknown>;
  getStream?: (
    id: string,
    season?: string | null,
    episode?: string | null,
    baseOrClientIp?: string | null,
    clientIp?: string | null,
  ) => Promise<unknown>;
}

interface SourcePackRawCandidate {
  url?: string;
  headers?: HeaderMap | string | null;
  skipProxy?: boolean;
  quality?: string | number;
  resolution?: string | number;
}

interface SourcePackRawResult {
  url?: string;
  headers?: HeaderMap | string | null;
  skipProxy?: boolean;
  allUrls?: Array<string | SourcePackRawCandidate>;
}

interface LoadedSourcePack {
  configs: SourcePackConfig[];
  modules: Record<string, SourcePackModule>;
}

export interface LocalSourcePackStream {
  provider: string;
  sourceKey: string;
  label: string;
  url: string;
  headers: HeaderMap;
  skipProxy: boolean;
  kind: "hls" | "mp4";
}

export interface LocalSourcePackSubtitle {
  file: string;
  url: string;
  label: string;
  format: string;
  source: string;
}

export interface LocalSourcePackDownload {
  quality: string;
  url: string;
  size: string | null;
  format: string;
  server?: string | number;
  source: string;
}

const SOURCE_PACK_ROOT = path.join(process.cwd(), "src/server/source-pack");
const SOURCE_PACK_CACHE_TTL_MS = 5 * 60 * 1000;
const SOURCE_PACK_SKIP_KEYS = new Set([
  // The app already has its own VidLink integration, and the source-pack copy
  // needs extra WASM/libsodium dependencies that are not required here.
  "vidlink",
]);
const SOURCE_PACK_DOWNLOAD_KEYS = new Set(["02movie", "moviebox"]);

const SOURCE_PACK_ORDER: Record<string, number> = {
  vidzee: 1,
  meowtv: 2,
  flixhq: 3,
  cinesu: 4,
  icefy: 5,
  vidrock: 6,
  vixsrc: 7,
  videasy: 8,
  "02movie": 9,
  cinezo: 10,
  vidfun: 11,
  fsharetv: 12,
  vidapi: 13,
  fsonic: 14,
};

const SUBTITLE_BASES = [
  "https://sub.vdrk.site/v1",
  "https://sub.vdrk.site/v2",
  "https://fed-subs.pstream.mov",
];

const UA_LIST = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
];

let loadedSourcePack: Promise<LoadedSourcePack> | null = null;
const sourceCache = new Map<string, { ts: number; value: unknown }>();

const toFileImportUrl = (relativePath: string) =>
  pathToFileURL(path.join(SOURCE_PACK_ROOT, relativePath)).href;

const getUA = () => UA_LIST[Math.floor(Math.random() * UA_LIST.length)];

const runtimeImport = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<unknown>;

const loadSourcePack = async (): Promise<LoadedSourcePack> => {
  if (loadedSourcePack) return loadedSourcePack;

  loadedSourcePack = (async () => {
    const configModule = (await runtimeImport(toFileImportUrl("config.js"))) as { SOURCES?: SourcePackConfig[] };
    const allConfigs = configModule.SOURCES || [];
    const configs = allConfigs.filter(
      (config) => !config.disabled && !SOURCE_PACK_SKIP_KEYS.has(config.key),
    );
    const moduleConfigs = allConfigs.filter(
      (config) =>
        !SOURCE_PACK_SKIP_KEYS.has(config.key) &&
        (!config.disabled || SOURCE_PACK_DOWNLOAD_KEYS.has(config.key)),
    );

    const entries = await Promise.all(
      moduleConfigs.map(async (config) => {
        const module = (await runtimeImport(toFileImportUrl(`sources/${config.sourceFile}.js`))) as SourcePackModule;
        return [config.key, module] as const;
      }),
    );

    return { configs, modules: Object.fromEntries(entries) };
  })();

  return loadedSourcePack;
};

const jitter = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.random() * ms));

const withTimeout = async <T>(promise: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);

const withRetry = async <T>(fn: () => Promise<T>, attempts: number, delayMs: number): Promise<T | null> => {
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const result = await fn();
      if (result) return result;
    } catch (error) {
      lastError = error;
      if (i < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * (i + 1)));
      }
    }
  }

  if (lastError) throw lastError;
  return null;
};

const getCached = async <T>(key: string, fn: () => Promise<T | null>): Promise<T | null> => {
  const hit = sourceCache.get(key);
  if (hit && Date.now() - hit.ts < SOURCE_PACK_CACHE_TTL_MS) return hit.value as T;

  const value = await fn();
  if (value) sourceCache.set(key, { ts: Date.now(), value });
  return value;
};

const normalizeHeaders = (headers: unknown): HeaderMap => {
  if (!headers) return {};

  let raw: unknown = headers;
  if (typeof raw === "string") {
    const encodedHeaders = raw;
    try {
      raw = JSON.parse(encodedHeaders);
    } catch {
      try {
        raw = JSON.parse(decodeURIComponent(encodedHeaders));
      } catch {
        raw = null;
      }
    }
  }

  if (!raw || typeof raw !== "object") return {};

  const normalized: HeaderMap = {};
  Object.entries(raw).forEach(([key, value]) => {
    if (typeof value === "string") normalized[key] = value;
  });
  return normalized;
};

const getModuleHeaders = (module: SourcePackModule): HeaderMap =>
  normalizeHeaders(module.PROXY_HEADERS || module.VERIFY_HEADERS || module.HEADERS);

const applyCdnHeaders = (module: SourcePackModule, url: string, headers: HeaderMap) => {
  for (const rule of module.CDN_HEADERS || []) {
    if (rule.pattern.test(url)) {
      Object.assign(headers, normalizeHeaders(rule.headers));
      return;
    }
  }
};

const cleanUrlAndHeaders = (
  rawUrl: string,
  baseHeaders: HeaderMap,
  candidateHeaders: HeaderMap,
): { url: string; headers: HeaderMap } | null => {
  if (!rawUrl.startsWith("http")) return null;

  const headers = { ...baseHeaders, ...candidateHeaders };
  let url = rawUrl.replace(/^http:\/\//i, "https://");

  try {
    const parsed = new URL(url);
    const embeddedHeaders = parsed.searchParams.get("headers");
    if (embeddedHeaders) Object.assign(headers, normalizeHeaders(embeddedHeaders));
    parsed.searchParams.delete("headers");
    parsed.searchParams.delete("host");
    url = parsed.toString();
  } catch {
    return { url, headers };
  }

  delete headers.Host;
  delete headers.host;
  return { url, headers };
};

const inferKind = (url: string): "hls" | "mp4" => {
  const lowerUrl = url.toLowerCase();
  if (
    lowerUrl.includes(".m3u8") ||
    lowerUrl.includes("mpegurl") ||
    lowerUrl.includes("/playlist/") ||
    lowerUrl.includes("/stream/master/") ||
    lowerUrl.includes("/stream/variant/") ||
    lowerUrl.includes("/master.m3u8") ||
    lowerUrl.includes("/list.m3u8") ||
    lowerUrl.includes("rendition=")
  ) {
    return "hls";
  }

  return "mp4";
};

const normalizeFormat = (value?: string | null): string => {
  const normalized = (value || "").toLowerCase();
  return normalized.includes("srt") ? "srt" : "vtt";
};

const toRawCandidates = (raw: unknown): SourcePackRawCandidate[] => {
  if (!raw) return [];

  const result = raw as SourcePackRawResult;
  if (Array.isArray(result.allUrls)) {
    return result.allUrls
      .map((item) => (typeof item === "string" ? { url: item } : item))
      .filter((item): item is SourcePackRawCandidate => Boolean(item?.url));
  }

  if (typeof raw === "string") return [{ url: raw }];
  if (typeof result.url === "string") {
    return [{ url: result.url, headers: result.headers, skipProxy: result.skipProxy }];
  }

  return [];
};

const fetchSource = async (
  config: SourcePackConfig,
  module: SourcePackModule,
  request: SourcePackRequest,
  clientIp: string | null,
): Promise<unknown | null> => {
  if (typeof module.getStream !== "function") return null;

  const cacheKey = `${config.key}:${request.id}:${request.season || ""}:${request.episode || ""}`;
  const season = request.type === "tv" ? request.season || "1" : null;
  const episode = request.type === "tv" ? request.episode || "1" : null;
  const timeoutMs = Number(config.timeout) || 25_000;
  const retries = Math.max(1, Number(config.retries) || 1);

  if (config.multiBase && Array.isArray(module.BASES)) {
    return withTimeout(
      jitter(config.jitter || 0).then(async () => {
        for (const base of module.BASES || []) {
          const result = await getCached(`${cacheKey}:${base}`, () =>
            withRetry(() => module.getStream!(request.id, season, episode, base, clientIp), retries, 500),
          );
          if (result) return result;
        }
        return null;
      }),
      timeoutMs,
    );
  }

  return withTimeout(
    jitter(config.jitter || 0).then(() =>
      getCached(cacheKey, () =>
        withRetry(() => module.getStream!(request.id, season, episode, clientIp), retries, 1000),
      ),
    ),
    timeoutMs,
  );
};

const mapSource = (
  config: SourcePackConfig,
  module: SourcePackModule,
  raw: unknown,
): LocalSourcePackStream[] => {
  const baseHeaders = getModuleHeaders(module);
  const candidates = toRawCandidates(raw);

  return candidates.flatMap((candidate, index) => {
    if (!candidate.url) return [];

    const normalized = cleanUrlAndHeaders(candidate.url, baseHeaders, normalizeHeaders(candidate.headers));
    if (!normalized) return [];

    applyCdnHeaders(module, normalized.url, normalized.headers);

    const quality = candidate.quality || candidate.resolution;
    const labelSuffix = quality ? ` ${quality}` : candidates.length > 1 ? ` ${index + 1}` : "";

    return [{
      provider: `sourcepack-${config.key}`,
      sourceKey: config.key,
      label: `${config.label}${labelSuffix}`,
      url: normalized.url,
      headers: normalized.headers,
      skipProxy: Boolean(candidate.skipProxy),
      kind: inferKind(normalized.url),
    }];
  });
};

export const sourcePackProviderOrder = (provider?: string): number => {
  const normalized = (provider || "").replace(/^sourcepack-/, "").toLowerCase();
  return SOURCE_PACK_ORDER[normalized] ?? 100;
};

export const fetchLocalSourcePackStreams = async (
  request: SourcePackRequest,
  clientIp: string | null = null,
): Promise<LocalSourcePackStream[]> => {
  if (process.env.PLAYER_SOURCE_PACK_DISABLED === "1") return [];

  const { configs, modules } = await loadSourcePack();
  const results = await Promise.allSettled(
    configs.map(async (config) => {
      const module = modules[config.key];
      const raw = await fetchSource(config, module, request, clientIp);
      return mapSource(config, module, raw);
    }),
  );

  const streams = results.flatMap((result, index) => {
    if (result.status === "fulfilled") return result.value;
    console.warn(
      `[SourcePack] ${configs[index]?.key || "unknown"} failed:`,
      result.reason instanceof Error ? result.reason.message : String(result.reason),
    );
    return [];
  });

  return streams.sort(
    (a, b) => sourcePackProviderOrder(a.provider) - sourcePackProviderOrder(b.provider),
  );
};

const mapSubtitlePayload = (payload: unknown, base: string): LocalSourcePackSubtitle[] => {
  if (base.includes("fed-subs.pstream.mov")) {
    const subtitles = (payload as { subtitles?: Record<string, { subtitle_link?: string; subtitle_name?: string }> })?.subtitles;
    if (!subtitles || typeof subtitles !== "object") return [];

    return Object.entries(subtitles)
      .map(([language, subtitle]) => {
        if (!subtitle?.subtitle_link) return null;
        return {
          file: subtitle.subtitle_link,
          url: subtitle.subtitle_link,
          label: subtitle.subtitle_name || language,
          format: normalizeFormat(subtitle.subtitle_link),
          source: "febbox",
        };
      })
      .filter((subtitle): subtitle is LocalSourcePackSubtitle => subtitle !== null);
  }

  const items = Array.isArray(payload) ? payload : [];
  return items
    .map((item: { label?: string; file?: string; url?: string; type?: string; format?: string }) => {
      const url = item.file || item.url;
      if (!url) return null;
      return {
        file: url,
        url,
        label: item.label || "Subtitle",
        format: normalizeFormat(item.type || item.format || url),
        source: base.includes("/v2") ? "v2" : "v1",
      };
    })
    .filter((subtitle): subtitle is LocalSourcePackSubtitle => subtitle !== null);
};

const fetchSubtitlePath = async (base: string, subtitlePath: string): Promise<LocalSourcePackSubtitle[]> => {
  try {
    const response = await fetch(`${base}${subtitlePath}`, {
      headers: { "User-Agent": getUA() },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      response.body?.cancel();
      return [];
    }

    return mapSubtitlePayload(await response.json(), base);
  } catch {
    return [];
  }
};

export const fetchLocalSourcePackSubtitles = async (
  request: SourcePackRequest,
): Promise<LocalSourcePackSubtitle[]> => {
  const paths = request.type === "tv"
    ? [
      `/tv/${request.id}/${request.season || "1"}/${request.episode || "1"}`,
      `/tv/tt${request.id}/${request.season || "1"}/${request.episode || "1"}`,
    ]
    : [
      `/movie/${request.id}`,
      `/movie/tt${request.id}`,
    ];

  const subtitleRequests = [
    { base: SUBTITLE_BASES[0], path: paths[0] },
    { base: SUBTITLE_BASES[1], path: paths[0] },
    { base: SUBTITLE_BASES[2], path: paths[1] },
  ];

  const results = await Promise.all(subtitleRequests.map(({ base, path }) => fetchSubtitlePath(base, path)));
  const seen = new Set<string>();
  return results.flat().filter((subtitle) => {
    if (!subtitle.url || seen.has(subtitle.url)) return false;
    seen.add(subtitle.url);
    return true;
  });
};

const mapDownload = (download: unknown, source: string): LocalSourcePackDownload | null => {
  if (!download || typeof download !== "object") return null;
  const item = download as {
    quality?: string | number;
    url?: string;
    size?: string | null;
    format?: string;
    server?: string | number;
  };

  if (!item.url || !item.url.startsWith("http")) return null;

  return {
    quality: String(item.quality || "Download"),
    url: item.url,
    size: item.size || null,
    format: item.format || "mp4",
    server: item.server,
    source,
  };
};

export const fetchLocalSourcePackDownloads = async (
  request: SourcePackRequest,
): Promise<LocalSourcePackDownload[]> => {
  if (process.env.PLAYER_SOURCE_PACK_DISABLED === "1") return [];

  const { modules } = await loadSourcePack();
  const season = request.type === "tv" ? request.season || "1" : null;
  const episode = request.type === "tv" ? request.episode || "1" : null;
  const downloadKeys = Array.from(SOURCE_PACK_DOWNLOAD_KEYS);

  const results = await Promise.allSettled(
    downloadKeys.map(async (key) => {
      const getDownloads = modules[key]?.getDownloads;
      if (typeof getDownloads !== "function") return [];
      const raw = await withTimeout(getDownloads(request.id, season, episode), 25_000);
      return Array.isArray(raw) ? raw.map((download) => mapDownload(download, key)).filter(Boolean) : [];
    }),
  );

  const seen = new Set<string>();
  return results
    .flatMap((result) => result.status === "fulfilled" ? result.value : [])
    .filter((download): download is LocalSourcePackDownload => {
      if (!download || seen.has(download.url)) return false;
      seen.add(download.url);
      return true;
    });
};
