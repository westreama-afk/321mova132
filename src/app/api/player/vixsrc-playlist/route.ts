import { NextRequest, NextResponse } from "next/server";
import { encodePlayerStreamUrl } from "@/utils/playerUrlCodec";
import {
  archiveScrapeResponse,
  clearScrapeBackfill,
  getCachedPlaylist,
  saveCachedPlaylist,
  scheduleScrapeBackfill,
} from "@/utils/playerScrapeArchive";
import nacl from "tweetnacl";

/**
 * ─── MOVISH CONFIG ───────────────────────────────────────────────────────────
 */
const MOVISH_ORIGIN = "https://movish.net";
const MOVISH_REFERER = "https://movish.net/";

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
const BACKFILL_PRIORITY_PROVIDERS = ["flowcast", "primevids", "guru"] as const;
const MAX_BACKFILL_ATTEMPTS = 3;

/**
 * ─── TULNEX / VIDRUSH CONSTANTS ──────────────────────────────────────────────
 */
const TULNEX_DI = "Sn00pD0g#L1_X0R_M4st3rK3y!2025";
const TULNEX_FI = "xK9!mR2@pL5#nQ8";
const TULNEX_HI = "Sn00pD0g#L3_AES_S3cur3K3y@2025$";
const TULNEX_PI = "Sn00pD0g#L4_HMAC_F1n4lW4ll#2025!";
const VIDRUSH_REFERER = "https://player.vidrush.net/";
const VIDLINK_ORIGIN = "https://vidlink.pro";

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

const VIDLINK_SECRETBOX_KEY = Buffer.from("c75136c5668bbfe65a7ecad431a745db68b5f381555b38d8f6c699449cf11fcd", "hex");
const VIDLINK_SECRETBOX_NONCE = new Uint8Array(24);

const encodeVidlinkId = (id: string): string => {
  const expiry = Math.floor(Date.now() / 1000) + 120;
  const expiryBytes = new Uint8Array(4);
  new DataView(expiryBytes.buffer).setUint32(0, expiry, false); // big-endian
  const idBytes = Buffer.from(id, "utf8");
  const msg = new Uint8Array(idBytes.length + 8);
  msg.set(idBytes, 0);
  // 4 zero bytes then 4-byte big-endian expiry timestamp
  msg.set(expiryBytes, idBytes.length + 4);
  const cipher = nacl.secretbox(msg, VIDLINK_SECRETBOX_NONCE, VIDLINK_SECRETBOX_KEY);
  const token = Buffer.concat([Buffer.from(VIDLINK_SECRETBOX_NONCE), Buffer.from(cipher)]);
  return token.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

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
type ScrapePhase = "live" | "backfill";

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

interface ScrapeRunContext {
  phase: ScrapePhase;
  attempt: number;
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

const getVidlinkEnvCookie = () => {
  const raw = (process.env.VIDLINK_COOKIE || "").trim();
  if (raw) return raw;
  const clearance = (process.env.VIDLINK_CF_CLEARANCE || "").trim();
  return clearance ? `cf_clearance=${clearance}` : "";
};

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

const DEFAULT_WORKER_KEY = "j7wYkYhVgQn5x2L6k2M8hVQfD4zN3bP1aR7uT0cXyE6dZX4sW";
const buildWorkerApiProxyUrl = (apiUrl: string, headers: HeaderMap): string => {
  const workerBase = getWorkerBaseUrl();
  const key = process.env.PLAYER_PROXY_WORKER_KEY?.trim() || DEFAULT_WORKER_KEY;
  const params = new URLSearchParams({ url: apiUrl, headers: JSON.stringify(headers), k: key });
  return `${workerBase}/api-proxy?${params.toString()}`;
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

const parseJsonText = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const safeDecodeURIComponent = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const archiveProviderResponse = async (
  family: string,
  provider: string,
  requestParams: ParsedMediaRequest,
  runContext: ScrapeRunContext,
  payload: {
    url: string;
    status: number | null;
    ok: boolean;
    sourceCount: number;
    error?: string | null;
    responseBody?: unknown;
    responseText?: string | null;
    extra?: Record<string, unknown>;
  },
) => {
  try {
    await archiveScrapeResponse({
      family,
      provider,
      phase: runContext.phase,
      attempt: runContext.attempt,
      request: requestParams,
      url: payload.url,
      status: payload.status,
      ok: payload.ok,
      sourceCount: payload.sourceCount,
      error: payload.error,
      responseBody: payload.responseBody,
      responseText: payload.responseText,
      extra: payload.extra,
    });
  } catch (error) {
    console.error(
      `[Archive] ${family}/${provider} failed:`,
      error instanceof Error ? error.message : String(error),
    );
  }
};

const normalizeHeaders = (headers: unknown): HeaderMap => {
  if (!headers) return {};
  const raw =
    typeof headers === "string"
      ? parseJsonText(headers) ?? parseJsonText(safeDecodeURIComponent(headers))
      : headers;
  if (!raw || typeof raw !== "object") return {};
  const normalized: HeaderMap = {};
  Object.entries(raw).forEach(([k, v]) => {
    if (typeof v === "string") normalized[k] = v;
  });
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
      directUrl = safeDecodeURIComponent(wrapped);
      Object.assign(mergedHeaders, normalizeHeaders(parsed.searchParams.get("headers")));
    }
  } catch {}
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
  runContext: ScrapeRunContext,
): Promise<PlaylistSource[]> => {
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
      const responseText = response ? await response.text().catch(() => "") : null;
      await archiveProviderResponse("rive", provider, requestParams, runContext, {
        url: url.toString(),
        status: response?.status ?? null,
        ok: false,
        sourceCount: 0,
        error: response ? `HTTP ${response.status}` : "timeout",
        responseBody: responseText ? parseJsonText(responseText) : null,
        responseText,
      });
      return [];
    }
    const responseText = await response.text();
    const payload = parseJsonText(responseText) as ScrapperResponse | null;
    if (!Array.isArray(payload?.data?.sources)) {
      console.log(`[Rive] ${provider}: No sources array in response`);
      await archiveProviderResponse("rive", provider, requestParams, runContext, {
        url: url.toString(),
        status: response.status,
        ok: false,
        sourceCount: 0,
        error: "No sources array in response",
        responseBody: payload,
        responseText,
      });
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
    await archiveProviderResponse("rive", provider, requestParams, runContext, {
      url: url.toString(),
      status: response.status,
      ok: true,
      sourceCount: validSources.length,
      responseBody: payload,
      responseText,
      extra: { totalSourceCount: payload.data.sources.length },
    });
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
    await archiveProviderResponse("rive", provider, requestParams, runContext, {
      url: `${SCRAPPER_BASE}/api/provider`,
      status: null,
      ok: false,
      sourceCount: 0,
      error: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
};

const fetchTulnexProviderSources = async (
  provider: TulnexProviderDef,
  requestParams: ParsedMediaRequest,
  runContext: ScrapeRunContext,
): Promise<PlaylistSource[]> => {
  const url = buildTulnexUrl(provider, requestParams);
  try {
    const response = await fetchWithTimeout(url, { cache: "no-store", headers: { Referer: VIDRUSH_REFERER } }, 35_000);
    if (!response?.ok) {
      const responseText = response ? await response.text().catch(() => "") : null;
      await archiveProviderResponse("tulnex", provider.name, requestParams, runContext, {
        url,
        status: response?.status ?? null,
        ok: false,
        sourceCount: 0,
        error: response ? `HTTP ${response.status}` : "timeout",
        responseBody: responseText ? parseJsonText(responseText) : null,
        responseText,
      });
      return [];
    }
    const responseText = await response.text();
    const rawPayload = parseJsonText(responseText) as any;
    let data = rawPayload;
    if (provider.encrypted && data?.v === 4) {
      data = await decryptTulnex(data.payload);
    }
    const streams = extractTulnexStreams(data);
    await archiveProviderResponse("tulnex", provider.name, requestParams, runContext, {
      url,
      status: response.status,
      ok: true,
      sourceCount: streams.length,
      responseBody: rawPayload,
      responseText,
      extra: provider.encrypted ? { decryptedBody: data } : undefined,
    });
    return streams.map(({ url: streamUrl, headers }) => ({
      type: "hls",
      file: buildWorkerM3u8ProxyUrl(streamUrl, headers),
      label: provider.label,
      provider: provider.name,
    }));
  } catch (error) {
    await archiveProviderResponse("tulnex", provider.name, requestParams, runContext, {
      url,
      status: null,
      ok: false,
      sourceCount: 0,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
};

const fetchVidlinkSources = async (
  requestParams: ParsedMediaRequest,
  runContext: ScrapeRunContext,
): Promise<PlaylistSource[]> => {
  const token = encodeVidlinkId(requestParams.id);
  const referer = requestParams.type === "movie"
    ? `${VIDLINK_ORIGIN}/movie/${requestParams.id}`
    : `${VIDLINK_ORIGIN}/tv/${requestParams.id}/${requestParams.season}/${requestParams.episode}`;
  const multiLang = 0;
  const apiUrl = requestParams.type === "movie"
    ? `${VIDLINK_ORIGIN}/api/b/movie/${token}?multiLang=${multiLang}`
    : `${VIDLINK_ORIGIN}/api/b/tv/${token}/${requestParams.season}/${requestParams.episode}?multiLang=${multiLang}`;
  console.log(`[VidLink] Requesting direct API for ${requestParams.type} ${requestParams.id} token=${token.slice(0, 20)}... url=${apiUrl.slice(0, 80)}`);
  const defaultHeaders: HeaderMap = { Referer: referer, Origin: VIDLINK_ORIGIN };
  const addStream = (items: Array<{ url: string; headers: HeaderMap }>, url: unknown, headers?: HeaderMap) => {
    if (typeof url !== "string" || !url.startsWith("http")) return;
    items.push({ url, headers: { ...defaultHeaders, ...(headers || {}) } });
  };
  const envCookie = getVidlinkEnvCookie();
  const upstreamHeaders: HeaderMap = {
    accept: "application/json, text/plain, */*",
    "accept-language": "en-US,en;q=0.9",
    origin: VIDLINK_ORIGIN,
    referer,
    "user-agent": USER_AGENT,
  };
  if (envCookie) upstreamHeaders.cookie = envCookie;
  try {
    const proxiedUrl = buildWorkerApiProxyUrl(apiUrl, upstreamHeaders);
    const response = await fetchWithTimeout(proxiedUrl, { cache: "no-store" }, REQUEST_TIMEOUT_MS);
    if (!response?.ok) {
      console.log(`[VidLink] Worker proxy HTTP ${response?.status || "timeout"} for ${requestParams.type} ${requestParams.id}`);
      const responseText = response ? await response.text().catch(() => "") : null;
      await archiveProviderResponse("vidlink", "vidlink", requestParams, runContext, {
        url: proxiedUrl,
        status: response?.status ?? null,
        ok: false,
        sourceCount: 0,
        error: response ? `HTTP ${response.status}` : "timeout",
        responseBody: responseText ? parseJsonText(responseText) : null,
        responseText,
        extra: { apiUrl },
      });
      return [];
    }

    const rawText = await response.text();
    if (!rawText || rawText.trimStart()[0] !== "{") {
      console.log(`[VidLink] Non-JSON response for ${requestParams.type} ${requestParams.id} | status=${response.status} sample=${rawText.slice(0, 200).replace(/\s+/g, " ")}`);
      await archiveProviderResponse("vidlink", "vidlink", requestParams, runContext, {
        url: proxiedUrl,
        status: response.status,
        ok: false,
        sourceCount: 0,
        error: "Non-JSON response",
        responseText: rawText,
        extra: { apiUrl },
      });
      return [];
    }
    let data: any;
    try { data = JSON.parse(rawText); } catch {
      console.log(`[VidLink] JSON parse failed for ${requestParams.type} ${requestParams.id} | sample=${rawText.slice(0, 200).replace(/\s+/g, " ")}`);
      await archiveProviderResponse("vidlink", "vidlink", requestParams, runContext, {
        url: proxiedUrl,
        status: response.status,
        ok: false,
        sourceCount: 0,
        error: "JSON parse failed",
        responseText: rawText,
        extra: { apiUrl },
      });
      return [];
    }
    const streams: Array<{ url: string; headers: HeaderMap }> = [];
    addStream(streams, data?.stream?.playlist ?? data?.stream);
    addStream(streams, data?.url);
    addStream(streams, data?.playlist);
    addStream(streams, data?.m3u8);
    addStream(streams, data?.data?.stream?.playlist ?? data?.data?.stream);
    addStream(streams, data?.data?.url);
    addStream(streams, data?.data?.playlist);
    addStream(streams, data?.data?.m3u8);
    if (Array.isArray(data?.sources)) {
      for (const source of data.sources) addStream(streams, source?.file || source?.url, normalizeHeaders(source?.headers));
    }
    if (Array.isArray(data?.data?.sources)) {
      for (const source of data.data.sources) addStream(streams, source?.file || source?.url, normalizeHeaders(source?.headers));
    }
    if (Array.isArray(data?.streams)) {
      for (const stream of data.streams) addStream(streams, stream?.link || stream?.url || stream?.playlist || stream?.streaming_url, normalizeHeaders(stream?.headers));
    }
    if (Array.isArray(data?.data?.streams)) {
      for (const stream of data.data.streams) addStream(streams, stream?.link || stream?.url || stream?.playlist || stream?.streaming_url, normalizeHeaders(stream?.headers));
    }
    const seen = new Set<string>();
    const mapped = streams
      .filter(({ url }) => !seen.has(url) && seen.add(url))
      .map(({ url, headers }) => {
        let finalUrl = url;
        let upstreamHeaders = headers;

        try {
          const parsed = new URL(url);
          // storm.vodvidl.site is a reverse proxy with its own CF protection that blocks workers.
          // It exposes the real CDN host in ?host= and headers in ?headers=, so we bypass it
          // entirely and go directly to the actual CDN.
          if (parsed.hostname === "storm.vodvidl.site" && parsed.pathname.startsWith("/proxy/")) {
            const host = parsed.searchParams.get("host");
            const embeddedHeaders = parsed.searchParams.get("headers");
            if (host) {
              const proxyPath = parsed.pathname.replace(/^\/proxy\//, "");
              finalUrl = `${host.replace(/\/+$/, "")}/${proxyPath}`;
              upstreamHeaders = normalizeHeaders(embeddedHeaders);
            }
          } else {
            const embedded = parsed.searchParams.get("headers");
            if (embedded) upstreamHeaders = { ...normalizeHeaders(embedded) };
          }
        } catch {}

        const isMp4 = /\.mp4(\?|$)/i.test(finalUrl);
        return {
          type: "hls" as const,
          file: isMp4 ? buildWorkerMp4ProxyUrl(finalUrl, upstreamHeaders) : buildWorkerM3u8ProxyUrl(finalUrl, upstreamHeaders),
          label: "VidLink",
          provider: "vidlink",
        };
      });
    await archiveProviderResponse("vidlink", "vidlink", requestParams, runContext, {
      url: proxiedUrl,
      status: response.status,
      ok: true,
      sourceCount: mapped.length,
      responseBody: data,
      responseText: rawText,
      extra: { apiUrl },
    });
    console.log(`[VidLink] Parsed ${mapped.length} sources for ${requestParams.type} ${requestParams.id}${mapped.length > 0 ? ` | first=${mapped[0].file.slice(0, 120)}` : ""}`);
    return mapped;
  } catch (e) {
    console.log(`[VidLink] Error for ${requestParams.type} ${requestParams.id}:`, e instanceof Error ? e.message : String(e));
    await archiveProviderResponse("vidlink", "vidlink", requestParams, runContext, {
      url: apiUrl,
      status: null,
      ok: false,
      sourceCount: 0,
      error: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
};

const fetchMovishSources = async (
  requestParams: ParsedMediaRequest,
  runContext: ScrapeRunContext,
): Promise<PlaylistSource[]> => {
  const embedUrl = requestParams.type === "movie"
    ? `${MOVISH_ORIGIN}/moviebox-embed/movie/${requestParams.id}`
    : `${MOVISH_ORIGIN}/moviebox-embed/tv/${requestParams.id}/${requestParams.season}/${requestParams.episode}`;

  const fetchHeaders: HeaderMap = {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: MOVISH_REFERER,
    Origin: MOVISH_ORIGIN,
    "User-Agent": USER_AGENT,
  };

  try {
    const proxyUrl = buildWorkerApiProxyUrl(embedUrl, fetchHeaders);
    const res = await fetchWithTimeout(proxyUrl, { cache: "no-store" }, REQUEST_TIMEOUT_MS);
    if (!res?.ok) {
      await archiveProviderResponse("movish", "movish", requestParams, runContext, {
        url: embedUrl,
        status: res?.status ?? null,
        ok: false,
        sourceCount: 0,
        error: res ? `HTTP ${res.status}` : "timeout",
      });
      return [];
    }

    const html = await res.text();
    const videoSrcMatch =
      html.match(/<video[^>]*id=["']moviebox-player["'][^>]*\ssrc=["']([^"']+)["']/i) ??
      html.match(/<video[^>]*\ssrc=["']([^"']+)["'][^>]*id=["']moviebox-player["']/i);

    if (!videoSrcMatch?.[1]) {
      await archiveProviderResponse("movish", "movish", requestParams, runContext, {
        url: embedUrl,
        status: res.status,
        ok: false,
        sourceCount: 0,
        error: "No video src in HTML",
      });
      return [];
    }

    const rawSrc = videoSrcMatch[1];
    let cdnUrl: string;
    try {
      const parsed = new URL(rawSrc.startsWith("http") ? rawSrc : `${MOVISH_ORIGIN}${rawSrc}`);
      const inner = parsed.searchParams.get("url");
      cdnUrl = inner ? decodeURIComponent(inner) : rawSrc;
    } catch {
      cdnUrl = rawSrc;
    }

    if (!cdnUrl.startsWith("http")) {
      await archiveProviderResponse("movish", "movish", requestParams, runContext, {
        url: embedUrl, status: res.status, ok: false, sourceCount: 0, error: `Invalid CDN URL: ${cdnUrl}`,
      });
      return [];
    }

    // Use 123movienow.cc Referer — hakunaymatata.com CDN allowlists this domain
    const streamHeaders: HeaderMap = { Referer: "https://123movienow.cc/", Origin: "https://123movienow.cc" };
    const isMp4 = /\.mp4($|\?)/i.test(cdnUrl);
    const proxiedFile = isMp4
      ? buildWorkerMp4ProxyUrl(cdnUrl, streamHeaders)
      : buildWorkerM3u8ProxyUrl(cdnUrl, streamHeaders);

    await archiveProviderResponse("movish", "movish", requestParams, runContext, {
      url: embedUrl, status: res.status, ok: true, sourceCount: 1,
    });
    console.log(`[Movish] Found ${isMp4 ? "MP4" : "HLS"} for ${requestParams.type} ${requestParams.id}`);
    return [{ type: "hls", file: proxiedFile, label: "NovaCast", provider: "movish" }];
  } catch (e) {
    await archiveProviderResponse("movish", "movish", requestParams, runContext, {
      url: embedUrl, status: null, ok: false, sourceCount: 0,
      error: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
};

const dedupeSources = (sources: PlaylistSource[]): PlaylistSource[] => {
  const seen = new Set<string>();
  return sources.filter(s => !seen.has(s.file) && seen.add(s.file));
};

/**
 * ─── MAIN ROUTE HANDLER ──────────────────────────────────────────────────────
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = async (request: NextRequest) => {
  const { searchParams } = request.nextUrl;
  const requestParams = parseMediaRequest(searchParams);
  const runContext: ScrapeRunContext = {
    phase: searchParams.get("backfill") === "1" ? "backfill" : "live",
    attempt: Number.parseInt(searchParams.get("attempt") || "0", 10) || 0,
  };

  // LOG: Incoming Request
  console.log(`[Rive Response] Incoming: ${searchParams.toString()}`);

  if (!requestParams) {
    console.error("[Rive Response] Error: Invalid Parameters");
    return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
  }

  // Serve from cache for live requests (backfill always scrapes fresh)
  if (runContext.phase === "live") {
    const cached = await getCachedPlaylist(requestParams, 6 * 60 * 60 * 1000).catch(() => null);
    if (cached && cached.length > 0) {
      console.log(`[Rive Response] Cache HIT for ${requestParams.type} (${requestParams.id}) — ${cached.length} sources`);
      const encodedSources = cached.map((s) => ({ ...s, file: encodePlayerStreamUrl(s.file) }));
      return NextResponse.json({ playlist: [{ sources: encodedSources }] }, {
        headers: { "cache-control": "no-store, max-age=0", "x-playlist-cache": "hit" },
      });
    }
  }

  console.log(`[Rive Response] Processing ${requestParams.type} (${requestParams.id})`);

  const [rivResults, tulnexResults, movishResult] = await Promise.all([
    Promise.allSettled(PROVIDERS.map((p) => fetchProviderSources(p, requestParams, runContext))),
    Promise.allSettled(TULNEX_PROVIDERS.map((p) => fetchTulnexProviderSources(p, requestParams, runContext))),
    fetchMovishSources(requestParams, runContext),
  ]);

  const allSources: PlaylistSource[] = [];
  const riveSourceCount: Record<string, number> = {};
  const availablePriorityProviders = new Set<string>();

  // Only log Rive results
  rivResults.forEach((result, idx) => {
    if (result.status === "fulfilled") {
      const sources = result.value;
      const provider = PROVIDERS[idx];
      if (sources.length > 0) {
        riveSourceCount[provider] = sources.length;
        console.log(`[Rive] ${provider}: ${sources.length} sources`);
        if (BACKFILL_PRIORITY_PROVIDERS.includes(provider as (typeof BACKFILL_PRIORITY_PROVIDERS)[number])) {
          availablePriorityProviders.add(provider);
        }
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

  // Add Movish sources (kept separate — excluded from cache due to time-limited signed URLs)
  const movishSources = Array.isArray(movishResult) ? movishResult : [];
  allSources.push(...movishSources);


  if (Object.keys(riveSourceCount).length > 0) {
    console.log(`[Rive] Summary:`, JSON.stringify(riveSourceCount, null, 2));
  }

  const providerOrder = (provider: string | undefined) => {
    // Top Priority: FlowCast
    if (provider === "flowcast") return 0;


    // Second Priority: NovaCast (Movish)
    if (provider === "movish") return 1;

    // Third Priority: PrimeVids
    if (provider === "primevids") return 2;

    // Fourth Priority: Guru
    if (provider === "guru") return 3;

    // Fifth Priority: VidLink
    if (provider === "vidlink") return 4;

    // Everything else (Fallbacks)
    if (provider === "icefy" || provider === "hollymoviehd") return 4;
    if (["primeshows", "vidzee0", "vidzee1", "allmovies"].includes(provider!)) return 5;
    if (["hindicast", "ophim"].includes(provider!)) return 6;
    return provider === "asiacloud" ? 7 : 6;
  };

  const orderedSources = dedupeSources(
    allSources.slice().sort((a, b) => providerOrder(a.provider) - providerOrder(b.provider))
  ).map((source, index) => ({ ...source, default: index === 0 }));

  const missingPriorityProviders = BACKFILL_PRIORITY_PROVIDERS.filter(
    (provider) => !availablePriorityProviders.has(provider),
  );
  const shouldScheduleBackfill = missingPriorityProviders.length > 0 || orderedSources.length === 0;

  try {
    if (shouldScheduleBackfill && runContext.attempt < MAX_BACKFILL_ATTEMPTS) {
      const reason =
        orderedSources.length === 0
          ? "No playable sources found"
          : `Missing priority providers: ${missingPriorityProviders.join(", ")}`;
      await scheduleScrapeBackfill(requestParams, {
        attempts: runContext.attempt,
        missingProviders: missingPriorityProviders,
        reason,
      });
    } else {
      await clearScrapeBackfill(requestParams);
    }
  } catch (error) {
    console.error(
      "[Archive] Backfill queue update failed:",
      error instanceof Error ? error.message : String(error),
    );
  }

  if (!orderedSources.length) {
    console.warn(`[Rive Response] No playable sources found for ID ${requestParams.id}`);
    return NextResponse.json({ error: "No sources found" }, { status: 502 });
  }

  saveCachedPlaylist(requestParams, orderedSources).catch((e) =>
    console.error("[Cache] Save failed:", e instanceof Error ? e.message : String(e)),
  );

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
    headers: { "cache-control": "no-store, max-age=0", "x-playlist-cache": "miss" },
  });
};
