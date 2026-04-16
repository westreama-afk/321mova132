import { NextRequest, NextResponse } from "next/server";
import { encodePlayerStreamUrl } from "@/utils/playerUrlCodec";

/**
 * ─── RIVESTREAM SCRAPER CONFIG ───────────────────────────────────────────────
 */
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
const REQUEST_TIMEOUT_MS = 15000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const DEFAULT_WORKER_PROXY = "https://small-cake-fdee.piracya.workers.dev";

/**
 * ─── TULNEX / VIDRUSH CONSTANTS ──────────────────────────────────────────────
 */
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

/**
 * ─── UTILITIES & CRYPTO ──────────────────────────────────────────────────────
 */
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

const decryptTulnex = async (payload: string): Promise<unknown> => {
  const xorKey = await getTulnexXorKey();
  const sepIdx = payload.indexOf("|");
  if (sepIdx === -1) throw new Error("missing | separator");
  const rcvdHmac = payload.slice(0, sepIdx);
  const encB64 = payload.slice(sepIdx + 1);
  const innerStr = new TextDecoder().decode(tulnexB64ToBuffer(encB64));

  const hmacKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(TULNEX_PI).buffer as ArrayBuffer,
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", hmacKey, new TextEncoder().encode(innerStr));
  if (rcvdHmac !== tulnexBufToHex(sig)) throw new Error("HMAC mismatch");

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

  const aesPlain = new TextDecoder().decode(decBuf);
  const binDecoded = atob(aesPlain)
    .split(" ")
    .map((s) => String.fromCharCode(parseInt(s, 2)))
    .join("");

  const hexBytes = tulnexHexToBytes(binDecoded);
  const out = new Uint8Array(hexBytes.length);
  for (let i = 0; i < hexBytes.length; i++) out[i] = hexBytes[i] ^ xorKey[i % 32];
  return JSON.parse(new TextDecoder().decode(out.buffer));
};

/**
 * ─── DOMAIN LOGIC ────────────────────────────────────────────────────────────
 */
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
  playlist: Array<{ sources: PlaylistSource[] }>;
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
  if (type === "movie") return { type, id };
  const season = params.get("season");
  const episode = params.get("episode");
  if (!isDigits(season) || !isDigits(episode)) return null;
  return { type, id, season, episode };
};

const getWorkerBaseUrl = () =>
  (process.env.PLAYER_PROXY_URL || process.env.NEXT_PUBLIC_PLAYER_PROXY_URL || DEFAULT_WORKER_PROXY).replace(/\/+$/, "");

const buildWorkerM3u8ProxyUrl = (m3u8Url: string, headers: HeaderMap): string => {
  const workerBase = getWorkerBaseUrl();
  const params = new URLSearchParams({ url: m3u8Url, headers: JSON.stringify(headers) });
  const workerKey = process.env.PLAYER_PROXY_WORKER_KEY?.trim();
  if (workerKey) params.set("k", workerKey);
  return `${workerBase}/m3u8-proxy/playlist.m3u8?${params.toString()}`;
};

const buildWorkerMp4ProxyUrl = (mp4Url: string, headers: HeaderMap): string => {
  const workerBase = getWorkerBaseUrl();
  const params = new URLSearchParams({ url: mp4Url, headers: JSON.stringify(headers) });
  const workerKey = process.env.PLAYER_PROXY_WORKER_KEY?.trim();
  if (workerKey) params.set("k", workerKey);
  return `${workerBase}/mp4-proxy?${params.toString()}`;
};

const buildTulnexUrl = (provider: TulnexProviderDef, req: ParsedMediaRequest): string =>
  (req.type === "movie" ? provider.movieUrl : provider.tvUrl)
    .replace("${id}", req.id)
    .replace("${season}", req.season ?? "0")
    .replace("${episode}", req.episode ?? "0");

const extractTulnexStreams = (data: any): { url: string; headers: HeaderMap }[] => {
  const results: { url: string; headers: HeaderMap }[] = [];
  const defaultHeaders: HeaderMap = { Referer: VIDRUSH_REFERER, Origin: "https://player.vidrush.net" };
  const addUrl = (url: string, extraHeaders?: HeaderMap) => {
    if (typeof url === "string" && url.startsWith("http")) {
      results.push({ url, headers: { ...defaultHeaders, ...extraHeaders } });
    }
  };
  if (!data || typeof data !== "object") return results;
  if (typeof data.stream === "string") { addUrl(data.stream); return results; }
  if (Array.isArray(data?.data?.sources)) {
    for (const s of data.data.sources) if (s.file) addUrl(s.file);
  }
  if (Array.isArray(data.streams)) {
    for (const s of data.streams) {
      const u = s.link ?? s.url ?? s.playlist ?? s.streaming_url;
      if (u) addUrl(u, data.headers);
    }
  }
  if (Array.isArray(data?.data?.streams)) {
    for (const s of data.data.streams) {
      const u = s.link ?? s.url ?? s.playlist ?? s.streaming_url;
      if (u) addUrl(u, data.data.headers ?? data.headers);
    }
  }
  for (const field of ["stream_url", "streaming_url", "url", "video_url", "playlist", "m3u8"]) {
    const v = (data as Record<string, unknown>)[field];
    if (typeof v === "string") addUrl(v);
  }
  return results;
};

const fetchWithTimeout = async (url: string, init: RequestInit, timeoutMs: number): Promise<Response | null> => {
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

const normalizeHeaders = (headers: any): HeaderMap => {
  if (!headers) return {};
  const raw = typeof headers === "string" ? JSON.parse(headers) : headers;
  const normalized: HeaderMap = {};
  Object.entries(raw).forEach(([k, v]) => { if (typeof v === "string") normalized[k] = v; });
  return normalized;
};

const normalizeScrapperSource = (source: ScrapperSource): { url: string; headers: HeaderMap } | null => {
  if (typeof source.url !== "string" || source.url.length === 0) return null;
  let directUrl = source.url;
  const mergedHeaders: HeaderMap = {};
  try {
    const parsed = new URL(source.url);
    const wrapped = parsed.searchParams.get("url");
    if (wrapped) {
      directUrl = decodeURIComponent(wrapped);
      Object.assign(mergedHeaders, normalizeHeaders(decodeURIComponent(parsed.searchParams.get("headers") || "")));
    }
  } catch {}
  Object.assign(mergedHeaders, normalizeHeaders(source.headers));
  if (!mergedHeaders.Referer && !mergedHeaders.referer) {
    mergedHeaders.Referer = SCRAPPER_REFERER;
    mergedHeaders.Origin = SCRAPPER_ORIGIN;
  }
  return { url: directUrl, headers: mergedHeaders };
};

const fetchProviderSources = async (provider: string, requestParams: ParsedMediaRequest): Promise<PlaylistSource[]> => {
  try {
    const url = new URL(`${SCRAPPER_BASE}/api/provider`);
    url.searchParams.set("provider", provider);
    url.searchParams.set("id", requestParams.id);
    if (requestParams.type === "tv") {
      url.searchParams.set("season", requestParams.season!);
      url.searchParams.set("episode", requestParams.episode!);
    }
    const response = await fetchWithTimeout(url.toString(), { cache: "no-store", headers: { "user-agent": USER_AGENT, referer: SCRAPPER_REFERER } }, REQUEST_TIMEOUT_MS);
    if (!response?.ok) {
      console.log(`[Rive] ${provider}: HTTP ${response?.status || 'timeout'}`);
      return [];
    }
    const payload = (await response.json()) as ScrapperResponse;
    if (!Array.isArray(payload?.data?.sources)) {
      console.log(`[Rive] ${provider}: No sources array in response`);
      return [];
    }
    // Accept both HLS and MP4 formats
    const validSources = payload.data.sources.filter(s => s.format && ["hls", "mp4"].includes(s.format));
    if (validSources.length === 0 && payload.data.sources.length > 0) {
      const formats = payload.data.sources.map(s => s.format || "undefined").join(", ");
      console.log(`[Rive] ${provider}: 0 valid sources (${payload.data.sources.length} total) - formats: [${formats}]`);
    } else {
      console.log(`[Rive] ${provider}: ${validSources.length} sources (${payload.data.sources.length} total)`);
    }
    return validSources.map(source => {
      const normalized = normalizeScrapperSource(source)!;
      const qualityStr = source.quality ? `${source.quality}p` : "";
      const isHls = source.format === "hls";
      const isMp4 = source.format === "mp4";
      return {
        type: "hls",
        file: isHls 
          ? buildWorkerM3u8ProxyUrl(normalized.url, normalized.headers) 
          : isMp4 
          ? buildWorkerMp4ProxyUrl(normalized.url, normalized.headers)
          : normalized.url,
        label: qualityStr ? `${PROVIDER_LABELS[provider] || provider} ${qualityStr}` : (PROVIDER_LABELS[provider] || provider),
        provider,
      };
    });
  } catch (e) {
    console.log(`[Rive] ${provider}: Error -`, e instanceof Error ? e.message : String(e));
    return [];
  }
};

const fetchTulnexProviderSources = async (provider: TulnexProviderDef, requestParams: ParsedMediaRequest): Promise<PlaylistSource[]> => {
  const url = buildTulnexUrl(provider, requestParams);
  try {
    const response = await fetchWithTimeout(url, { cache: "no-store", headers: { Referer: VIDRUSH_REFERER } }, 35_000);
    if (!response?.ok) return [];
    let data = await response.json();
    if (provider.encrypted && data?.v === 4) {
      data = await decryptTulnex(data.payload);
    }
    const streams = extractTulnexStreams(data);
    return streams.map(({ url: streamUrl, headers }) => ({
      type: "hls",
      file: buildWorkerM3u8ProxyUrl(streamUrl, headers),
      label: provider.label,
      provider: provider.name,
    }));
  } catch { return []; }
};

const dedupeSources = (sources: PlaylistSource[]): PlaylistSource[] => {
  const seen = new Set<string>();
  return sources.filter(s => !seen.has(s.file) && seen.add(s.file));
};

/**
 * ─── MAIN ROUTE HANDLER ──────────────────────────────────────────────────────
 */
export const dynamic = "force-dynamic";

export const GET = async (request: NextRequest) => {
  const { searchParams } = request.nextUrl;
  const requestParams = parseMediaRequest(searchParams);

  // LOG: Incoming Request
  console.log(`[Rive Response] Incoming: ${searchParams.toString()}`);

  if (!requestParams) {
    console.error("[Rive Response] Error: Invalid Parameters");
    return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
  }

  console.log(`[Rive Response] Processing ${requestParams.type} (${requestParams.id})`);

  const [rivResults, tulnexResults] = await Promise.all([
    Promise.allSettled(PROVIDERS.map((p) => fetchProviderSources(p, requestParams))),
    Promise.allSettled(TULNEX_PROVIDERS.map((p) => fetchTulnexProviderSources(p, requestParams))),
  ]);

  const allSources: PlaylistSource[] = [];
  const riveSourceCount: Record<string, number> = {};
  
  // Only log Rive results
  rivResults.forEach((result, idx) => {
    if (result.status === "fulfilled") {
      const sources = result.value;
      const provider = PROVIDERS[idx];
      if (sources.length > 0) {
        riveSourceCount[provider] = sources.length;
        console.log(`[Rive] ${provider}: ${sources.length} sources`);
      }
      allSources.push(...sources);
    } else {
      console.error(`[Rive] ${PROVIDERS[idx]} failed:`, result.reason);
    }
  });

  // Also add Tulnex sources but don't log them
  tulnexResults.forEach((result) => {
    if (result.status === "fulfilled") {
      allSources.push(...result.value);
    }
  });

  if (Object.keys(riveSourceCount).length > 0) {
    console.log(`[Rive] Summary:`, JSON.stringify(riveSourceCount, null, 2));
  }

  const providerOrder = (provider: string | undefined) => {
    // Top Priority: FlowCast
    if (provider === "flowcast") return 0;
    
    // Second Priority: Guru
    if (provider === "primevids") return 1;
    
    // Third Priority: PrimeVids
    if (provider === "guru") return 2;

    // Everything else (Fallbacks)
    if (provider === "icefy" || provider === "hollymoviehd") return 3;
    if (["primeshows", "vidzee0", "vidzee1", "allmovies"].includes(provider!)) return 4;
    if (["hindicast", "ophim"].includes(provider!)) return 5;
    return provider === "asiacloud" ? 6 : 5;
  };

  const orderedSources = dedupeSources(
    allSources.slice().sort((a, b) => providerOrder(a.provider) - providerOrder(b.provider))
  ).map((source, index) => ({ ...source, default: index === 0 }));

  if (!orderedSources.length) {
    console.warn(`[Rive Response] No playable sources found for ID ${requestParams.id}`);
    return NextResponse.json({ error: "No sources found" }, { status: 502 });
  }

  console.log(`[Rive] Success: Found ${orderedSources.length} unique sources from Rive scraper`);
  orderedSources
    .filter(s => PROVIDERS.some(p => s.provider === p))
    .slice(0, 6)
    .forEach((s, i) => {
      console.log(`  [${i}] ${s.label}: ${s.file.substring(0, 100)}...`);
    });

  const encodedSources = orderedSources.map((s) => ({
    ...s,
    file: encodePlayerStreamUrl(s.file),
  }));

  const response = { playlist: [{ sources: encodedSources }] };

  return NextResponse.json(response, {
    headers: { "cache-control": "no-store, max-age=0" },
  });
};