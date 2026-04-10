import { NextRequest, NextResponse } from "next/server";
import { encodePlayerStreamUrl } from "@/utils/playerUrlCodec";

// ─── Rivestream scrapper ───────────────────────────────────────────────────────
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

// ─── Tulnex / Vidrush providers ────────────────────────────────────────────────
// Decryption constants extracted from player.vidrush.net/assets/index-CELgbrKC.js
const TULNEX_DI = "Sn00pD0g#L1_X0R_M4st3rK3y!2025";
const TULNEX_FI = "xK9!mR2@pL5#nQ8";
const TULNEX_HI = "Sn00pD0g#L3_AES_S3cur3K3y@2025$";
const TULNEX_PI = "Sn00pD0g#L4_HMAC_F1n4lW4ll#2025!";
const VIDRUSH_REFERER = "https://player.vidrush.net/";

interface TulnexProviderDef {
  name: string;
  label: string;
  encrypted: boolean;
  movieUrl: string;
  tvUrl: string;
}

const TULNEX_PROVIDERS: TulnexProviderDef[] = [
  {
    name: "icefy",
    label: "Icefy",
    encrypted: false,
    movieUrl: "https://streams.icefy.top/movie/${id}",
    tvUrl: "https://streams.icefy.top/tv/${id}/${season}/${episode}",
  },
  {
    name: "hollymoviehd",
    label: "HollyLS",
    encrypted: true,
    movieUrl: "https://api.tulnex.com/provider/hollymoviehd/movie/${id}",
    tvUrl: "https://api.tulnex.com/provider/hollymoviehd/tv/${id}/${season}/${episode}",
  },
  {
    name: "primeshows",
    label: "Primeshows",
    encrypted: true,
    movieUrl: "https://api.tulnex.com/indra/movie/${id}",
    tvUrl: "https://api.tulnex.com/indra/tv/${id}/${season}/${episode}",
  },
  {
    name: "vidzee0",
    label: "Zebi",
    encrypted: true,
    movieUrl: "https://api.tulnex.com/vidzee/movie/${id}?server=0",
    tvUrl: "https://api.tulnex.com/vidzee/tv/${id}/${season}/${episode}?server=0",
  },
  {
    name: "vidzee1",
    label: "Prime",
    encrypted: true,
    movieUrl: "https://api.tulnex.com/vidzee/movie/${id}?server=1",
    tvUrl: "https://api.tulnex.com/vidzee/tv/${id}/${season}/${episode}?server=1",
  },
  {
    name: "allmovies",
    label: "Nexo",
    encrypted: true,
    movieUrl: "https://api.tulnex.com/provider/allmovies/movie/${id}?lang=english",
    tvUrl: "https://api.tulnex.com/provider/allmovies/tv/${id}/${season}/${episode}?lang=english",
  },
];

// Cache constant XOR key (PBKDF2 is slow; derive once per cold start)
let _cachedXorKey: Uint8Array | null = null;

const tulnexB64ToBuffer = (b64: string): ArrayBuffer => {
  const str = atob(b64);
  const buf = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) buf[i] = str.charCodeAt(i);
  return buf.buffer as ArrayBuffer;
};

const tulnexBufToHex = (buf: ArrayBuffer): string =>
  Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const tulnexHexToBytes = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) out[i / 2] = parseInt(hex.substr(i, 2), 16);
  return out;
};

const tulnexPbkdf2Key = async (
  pwd: string,
  salt: string,
  iters: number,
  len: number,
  hash: string,
): Promise<Uint8Array> => {
  const pwdBytes = new TextEncoder().encode(pwd);
  const saltBytes = new TextEncoder().encode(salt);
  const key = await crypto.subtle.importKey("raw", pwdBytes.buffer as ArrayBuffer, { name: "PBKDF2" }, false, ["deriveKey"]);
  const derived = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: saltBytes.buffer as ArrayBuffer, iterations: iters, hash },
    key,
    { name: "AES-GCM", length: len * 8 },
    true,
    ["encrypt", "decrypt"],
  );
  return new Uint8Array(await crypto.subtle.exportKey("raw", derived) as ArrayBuffer);
};

const getTulnexXorKey = (): Promise<Uint8Array> => {
  if (_cachedXorKey) return Promise.resolve(_cachedXorKey);
  return tulnexPbkdf2Key(TULNEX_DI, TULNEX_FI, 50_000, 32, "SHA-256").then((k) => {
    _cachedXorKey = k;
    return k;
  });
};

/** Decrypt a tulnex {v:4, payload} string — 4-layer scheme from vidrush bundle */
const decryptTulnex = async (payload: string): Promise<unknown> => {
  const xorKey = await getTulnexXorKey();

  const sepIdx = payload.indexOf("|");
  if (sepIdx === -1) throw new Error("missing | separator");
  const rcvdHmac = payload.slice(0, sepIdx);
  const encB64 = payload.slice(sepIdx + 1);
  const innerStr = new TextDecoder().decode(tulnexB64ToBuffer(encB64));

  // HMAC-SHA-512 integrity check
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(TULNEX_PI).buffer as ArrayBuffer,
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", hmacKey, new TextEncoder().encode(innerStr));
  if (rcvdHmac !== tulnexBufToHex(sig)) throw new Error("HMAC mismatch");

  // AES-256-CBC with per-response PBKDF2-SHA-512 derived key
  const parts = innerStr.split(".");
  if (parts.length !== 3) throw new Error(`unexpected parts: ${parts.length}`);
  const [ivB64, saltB64, cipherB64] = parts;
  const iv = new Uint8Array(tulnexB64ToBuffer(ivB64));
  const saltBinaryStr = Buffer.from(saltB64, "base64").toString("binary");
  const aesKeyBytes = await tulnexPbkdf2Key(TULNEX_HI, saltBinaryStr, 100_000, 32, "SHA-512");
  const aesCryptoKey = await crypto.subtle.importKey(
    "raw",
    aesKeyBytes.buffer as ArrayBuffer,
    { name: "AES-CBC" },
    false,
    ["decrypt"],
  );
  const decBuf = await crypto.subtle.decrypt(
    { name: "AES-CBC", iv },
    aesCryptoKey,
    tulnexB64ToBuffer(cipherB64),
  );

  // Binary-space decode
  const aesPlain = new TextDecoder().decode(decBuf);
  const binDecoded = atob(aesPlain)
    .split(" ")
    .map((s) => String.fromCharCode(parseInt(s, 2)))
    .join("");

  // XOR with constant key
  const hexBytes = tulnexHexToBytes(binDecoded);
  const out = new Uint8Array(hexBytes.length);
  for (let i = 0; i < hexBytes.length; i++) out[i] = hexBytes[i] ^ xorKey[i % 32];
  return JSON.parse(new TextDecoder().decode(out.buffer));
};

const buildTulnexUrl = (provider: TulnexProviderDef, req: ParsedMediaRequest): string =>
  (req.type === "movie" ? provider.movieUrl : provider.tvUrl)
    .replace("${id}", req.id)
    .replace("${season}", req.season ?? "0")
    .replace("${episode}", req.episode ?? "0");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const extractTulnexStreams = (data: any, label: string): { url: string; headers: HeaderMap }[] => {
  const results: { url: string; headers: HeaderMap }[] = [];
  const defaultHeaders: HeaderMap = { Referer: VIDRUSH_REFERER, Origin: "https://player.vidrush.net" };

  const addUrl = (url: string, extraHeaders?: HeaderMap) => {
    if (typeof url === "string" && url.startsWith("http")) {
      results.push({ url, headers: { ...defaultHeaders, ...extraHeaders } });
    }
  };

  if (!data || typeof data !== "object") return results;

  // { stream: "url" }  (Icefy)
  if (typeof data.stream === "string") { addUrl(data.stream); return results; }

  // { data: { sources: [{file, type, label}] } }  (hollymoviehd)
  if (Array.isArray(data?.data?.sources)) {
    for (const s of data.data.sources as { file?: string }[]) {
      if (s.file) addUrl(s.file);
    }
  }

  // { streams: [{url|link|playlist|streaming_url}] }
  if (Array.isArray(data.streams)) {
    for (const s of data.streams as Record<string, string>[]) {
      const u = s.link ?? s.url ?? s.playlist ?? s.streaming_url;
      if (u) addUrl(u, data.headers);
    }
  }

  if (Array.isArray(data?.data?.streams)) {
    for (const s of data.data.streams as Record<string, string>[]) {
      const u = s.link ?? s.url ?? s.playlist ?? s.streaming_url;
      if (u) addUrl(u, data.data.headers ?? data.headers);
    }
  }

  // Direct URL fields
  for (const field of ["stream_url", "streaming_url", "url", "video_url", "playlist", "m3u8"]) {
    const v = (data as Record<string, unknown>)[field];
    if (typeof v === "string") addUrl(v);
  }

  if (typeof data?.data?.stream?.playlist === "string") addUrl(data.data.stream.playlist);

  return results;
};

const fetchTulnexProviderSources = async (
  provider: TulnexProviderDef,
  requestParams: ParsedMediaRequest,
): Promise<PlaylistSource[]> => {
  const url = buildTulnexUrl(provider, requestParams);
  try {
    const response = await fetchWithTimeout(
      url,
      { cache: "no-store", headers: { Accept: "application/json, */*", Referer: VIDRUSH_REFERER } },
      35_000,
    );
    if (!response?.ok) return [];

    const json = await response.json();
    let data = json;
    if (provider.encrypted && json?.v === 4 && typeof json.payload === "string") {
      data = await decryptTulnex(json.payload);
    }

    const streams = extractTulnexStreams(data, provider.label);
    return streams.map(({ url: streamUrl, headers }) => ({
      type: "hls" as const,
      file: buildWorkerM3u8ProxyUrl(streamUrl, headers),
      label: provider.label,
      provider: provider.name,
    }));
  } catch {
    return [];
  }
};

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

  const [rivResults, tulnexResults] = await Promise.all([
    Promise.allSettled(PROVIDERS.map((provider) => fetchProviderSources(provider, requestParams))),
    Promise.allSettled(TULNEX_PROVIDERS.map((provider) => fetchTulnexProviderSources(provider, requestParams))),
  ]);

  const providerOrder = (provider: string | undefined) => {
    // Tulnex providers — highest priority
    if (provider === "icefy") return 0;
    if (provider === "hollymoviehd") return 0;
    // Rivestream top-tier
    if (provider === "guru") return 1;
    // Tulnex mid-tier
    if (provider === "primeshows" || provider === "vidzee0" || provider === "vidzee1" || provider === "allmovies") return 2;
    // Rivestream mid-tier
    if (provider === "flowcast" || provider === "primevids" || provider === "hindicast" || provider === "ophim") return 3;
    // Rivestream low
    if (provider === "asiacloud") return 4;
    return 3;
  };

  const results = [...rivResults, ...tulnexResults];

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
