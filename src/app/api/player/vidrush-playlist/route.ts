import { NextRequest, NextResponse } from "next/server";
import { encodePlayerStreamUrl } from "@/utils/playerUrlCodec";
import { archiveScrapeResponse } from "@/utils/playerScrapeArchive";

// ─── Vidrush / Tulnex provider scraper ───────────────────────────────────────
//
// Source: scraped from player.vidrush.net/assets/index-CELgbrKC.js
//   - Tulnex responses use a 4-layer encryption scheme:
//       1. HMAC-SHA-512 integrity verification (key = PI)
//       2. AES-256-CBC with PBKDF2-SHA-512 derived key (password = HI, salt = per-response)
//       3. Binary-space encoded inner payload (base64 → space-separated binary chars)
//       4. XOR obfuscation with a constant PBKDF2-SHA-256 key (password = DI, salt = FI)
//   - Icefy (`streams.icefy.top`) returns plain JSON, no encryption.

const VIDRUSH_ORIGIN = "https://player.vidrush.net";
const VIDRUSH_REFERER = "https://player.vidrush.net/";
const REQUEST_TIMEOUT_MS = 35_000;
const DEFAULT_WORKER_PROXY = "https://small-cake-fdee.piracya.workers.dev";

// ─── Decryption constants (public-side, from vidrush client bundle) ───────────
const DI = "Sn00pD0g#L1_X0R_M4st3rK3y!2025";
const FI = "xK9!mR2@pL5#nQ8";
const HI = "Sn00pD0g#L3_AES_S3cur3K3y@2025$";
const PI = "Sn00pD0g#L4_HMAC_F1n4lW4ll#2025!";

// ─── Provider definitions ─────────────────────────────────────────────────────
interface ProviderDef {
name: string;
label: string;
encrypted: boolean;
movieUrl: string;
tvUrl: string;
}

const PROVIDERS: ProviderDef[] = [
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
  label: "Prime",
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
  label: "Prime2",
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

// ─── Types ────────────────────────────────────────────────────────────────────
type MediaType = "movie" | "tv";
type ScrapePhase = "live" | "backfill";
type HeaderMap = Record<string, string>;

interface ParsedMediaRequest {
type: MediaType;
id: string;
season?: string;
episode?: string;
}

interface ScrapeRunContext {
phase: ScrapePhase;
attempt: number;
}

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

const parseJsonText = (value: string): unknown => {
try { return JSON.parse(value); } catch { return null; }
};

const archiveProviderResponse = async (
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
},
) => {
try {
  await archiveScrapeResponse({
    family: "vidrush",
    provider,
    phase: runContext.phase,
    attempt: runContext.attempt,
    request: requestParams,
    ...payload,
  });
} catch (e) {
  console.error(`[Vidrush Archive] ${provider} failed:`, e instanceof Error ? e.message : String(e));
}
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const isDigits = (v: string | null): v is string => !!v && /^\d+$/.test(v);

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

const buildProviderUrl = (provider: ProviderDef, req: ParsedMediaRequest): string => {
const template = req.type === "movie" ? provider.movieUrl : provider.tvUrl;
return template
  .replace("${id}", req.id)
  .replace("${season}", req.season ?? "0")
  .replace("${episode}", req.episode ?? "0");
};

const getWorkerBase = () =>
(
  process.env.PLAYER_PROXY_URL ||
  process.env.NEXT_PUBLIC_PLAYER_PROXY_URL ||
  DEFAULT_WORKER_PROXY
).replace(/\/+$/, "");

const buildWorkerProxyUrl = (m3u8Url: string, headers: HeaderMap): string => {
const params = new URLSearchParams({ url: m3u8Url, headers: JSON.stringify(headers) });
const key = process.env.PLAYER_PROXY_WORKER_KEY?.trim();
if (key) params.set("k", key);
return `${getWorkerBase()}/m3u8-proxy/playlist.m3u8?${params.toString()}`;
};

const normalizeHeaders = (raw: unknown): HeaderMap => {
if (!raw || typeof raw !== "object") return {};
const out: HeaderMap = {};
for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
  if (typeof v === "string" && v.trim()) out[k] = v;
}
return out;
};

const fetchWithTimeout = async (url: string, init: RequestInit, ms: number) => {
const ctrl = new AbortController();
const tid = setTimeout(() => ctrl.abort(), ms);
try {
  return await fetch(url, { ...init, signal: ctrl.signal });
} catch {
  return null;
} finally {
  clearTimeout(tid);
}
};

// ─── 4-layer decryption ───────────────────────────────────────────────────────

/** Base64 string → ArrayBuffer (browser-compatible implementation) */
const b64ToBuffer = (b64: string): ArrayBuffer => {
const str = atob(b64);
const buf = new Uint8Array(str.length);
for (let i = 0; i < str.length; i++) buf[i] = str.charCodeAt(i);
return buf.buffer as ArrayBuffer;
};

const bufToHex = (buf: ArrayBuffer): string =>
Array.from(new Uint8Array(buf))
  .map((b) => b.toString(16).padStart(2, "0"))
  .join("");

const hexToBytes = (hex: string): Uint8Array => {
const out = new Uint8Array(hex.length / 2);
for (let i = 0; i < hex.length; i += 2) out[i / 2] = parseInt(hex.substr(i, 2), 16);
return out;
};

const pbkdf2Key = async (
pwd: string,
salt: string,
iters: number,
len: number,
hash: string,
): Promise<Uint8Array> => {
const pwdBytes = new TextEncoder().encode(pwd);
// Replicate browser TextEncoder(atob(b64)) behaviour exactly:
// atob gives a Latin-1 binary string; TextEncoder re-encodes as UTF-8.
// In Node.js, Buffer.from(str) (utf-8 default) does the same transformation.
const saltBytes = new TextEncoder().encode(salt);
const key = await crypto.subtle.importKey("raw", pwdBytes.buffer as ArrayBuffer, { name: "PBKDF2" }, false, [
  "deriveKey",
]);
const derived = await crypto.subtle.deriveKey(
  { name: "PBKDF2", salt: saltBytes.buffer as ArrayBuffer, iterations: iters, hash },
  key,
  { name: "AES-GCM", length: len * 8 },
  true,
  ["encrypt", "decrypt"],
);
return new Uint8Array(await crypto.subtle.exportKey("raw", derived) as ArrayBuffer);
};

// Cache the constant XOR key across requests (first derivation is ~250 ms).
let cachedXorKey: Uint8Array | null = null;
const getXorKey = (): Promise<Uint8Array> => {
if (cachedXorKey) return Promise.resolve(cachedXorKey);
return pbkdf2Key(DI, FI, 50_000, 32, "SHA-256").then((k) => {
  cachedXorKey = k;
  return k;
});
};

/** Decrypt a tulnex `{v:4, payload}` string to plain JSON object */
const decryptTulnex = async (payload: string): Promise<unknown> => {
const xorKey = await getXorKey();

// Layer 4: HMAC-SHA-512 → extract inner text
const sepIdx = payload.indexOf("|");
if (sepIdx === -1) throw new Error("missing | separator");
const rcvdHmac = payload.slice(0, sepIdx);
const encB64 = payload.slice(sepIdx + 1);
const innerStr = new TextDecoder().decode(b64ToBuffer(encB64));

// Verify HMAC (optional guard; skip on error to stay resilient)
try {
  const msgBuf = new TextEncoder().encode(innerStr);
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(PI).buffer as ArrayBuffer,
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", hmacKey, msgBuf);
  if (rcvdHmac !== bufToHex(sig)) throw new Error("HMAC mismatch");
} catch (e: unknown) {
  if (e instanceof Error && e.message !== "HMAC mismatch") {
    // Crypto error — continue anyway
  } else if (e instanceof Error && e.message === "HMAC mismatch") {
    throw e;
  }
}

// Layer 3: AES-256-CBC with per-response salt
const parts = innerStr.split(".");
if (parts.length !== 3) throw new Error(`unexpected parts: ${parts.length}`);
const [ivB64, saltB64, cipherB64] = parts;
const iv = new Uint8Array(b64ToBuffer(ivB64));
// Replicate: atob(saltB64) gives a Latin-1 string, TextEncoder encodes it as UTF-8
const saltBinaryStr = Buffer.from(saltB64, "base64").toString("binary");
const aesKeyBytes = await pbkdf2Key(HI, saltBinaryStr, 100_000, 32, "SHA-512");
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
  b64ToBuffer(cipherB64),
);
const aesPlain = new TextDecoder().decode(decBuf);

// Layer 2: binary-space decode (yI)
const binDecoded = atob(aesPlain)
  .split(" ")
  .map((s) => String.fromCharCode(parseInt(s, 2)))
  .join("");

// Layer 1: XOR with constant PBKDF2 key (vI)
const hexBytes = hexToBytes(binDecoded);
const out = new Uint8Array(hexBytes.length);
for (let i = 0; i < hexBytes.length; i++) out[i] = hexBytes[i] ^ xorKey[i % 32];
return JSON.parse(new TextDecoder().decode(out.buffer));
};

// ─── Stream URL extraction ────────────────────────────────────────────────────

const isM3u8 = (url: string) =>
url.includes(".m3u8") ||
url.includes("m3u8-proxy") ||
url.includes("/master") ||
url.includes("/playlist");

/** Unwrap a proxy URL (proxy.xxx/m3u8-proxy?url=...&headers=...) to get raw stream + headers */
const unwrapProxyUrl = (
url: string,
): { rawUrl: string; headers: HeaderMap } | null => {
try {
  const parsed = new URL(url);
  const inner = parsed.searchParams.get("url");
  if (!inner) return null;
  const rawUrl = decodeURIComponent(inner);
  let headers: HeaderMap = {};
  const rawHeaders = parsed.searchParams.get("headers");
  if (rawHeaders) {
    try {
      headers = normalizeHeaders(JSON.parse(decodeURIComponent(rawHeaders)));
    } catch {
      /* ignore */
    }
  }
  return { rawUrl, headers };
} catch {
  return null;
}
};

/** Given any stream URL candidate, return a worker-proxied m3u8 URL or null */
const wrapStreamUrl = (
streamUrl: string,
fallbackHeaders: HeaderMap,
): string | null => {
if (!streamUrl || !streamUrl.startsWith("http")) return null;

let finalUrl = streamUrl;
let headers: HeaderMap = { ...fallbackHeaders };

// Unwrap third-party proxy URLs and re-proxy through our worker
if (
  streamUrl.includes("m3u8-proxy") ||
  streamUrl.includes("proxy?url=") ||
  streamUrl.includes("/proxy/")
) {
  const unwrapped = unwrapProxyUrl(streamUrl);
  if (unwrapped) {
    finalUrl = unwrapped.rawUrl;
    headers = { ...headers, ...unwrapped.headers };
  }
}

if (!isM3u8(finalUrl) && !finalUrl.includes("tripplestream") && !finalUrl.includes("goodstream")) {
  // Accept known stream CDN domains even without .m3u8 extension
  if (
    !finalUrl.includes("tripplestream") &&
    !finalUrl.includes("/gs/") &&
    !finalUrl.includes("icefy")
  ) {
    return null;
  }
}

return buildWorkerProxyUrl(finalUrl, headers);
};

/** Extract stream URLs from the raw API response (pre or post decryption) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const extractStreams = (data: any, label: string, headers: HeaderMap): PlaylistSource[] => {
const sources: PlaylistSource[] = [];
const seen = new Set<string>();

const addSource = (url: string, labelOverride?: string) => {
  const proxied = wrapStreamUrl(url, headers);
  if (!proxied || seen.has(proxied)) return;
  seen.add(proxied);
  sources.push({ type: "hls", file: proxied, label: labelOverride ?? label });
};

if (!data || typeof data !== "object") return sources;

// Format A: { stream: "url" }  (Icefy)
if (typeof data.stream === "string" && data.stream.includes("http")) {
  addSource(data.stream);
  return sources;
}

// Format B: { data: { sources: [{file, type, label}] } }  (hollymoviehd)
if (Array.isArray(data?.data?.sources)) {
  for (const s of data.data.sources as { file?: string; type?: string; label?: string }[]) {
    if (typeof s.file === "string" && s.file.includes("http")) {
      addSource(s.file, s.label ? `${label} ${s.label}` : label);
    }
  }
}

// Format C: { streams: [{url|link|playlist|streaming_url}] }  (vidzee)
if (Array.isArray(data.streams)) {
  for (const s of data.streams as Record<string, string>[]) {
    const url = s.link ?? s.url ?? s.playlist ?? s.streaming_url;
    if (typeof url === "string" && url.includes("http")) addSource(url);
  }
}

// Format D: { data: { streams: [...] } }
if (Array.isArray(data?.data?.streams)) {
  for (const s of data.data.streams as Record<string, string>[]) {
    const url = s.link ?? s.url ?? s.playlist ?? s.streaming_url;
    if (typeof url === "string" && url.includes("http")) addSource(url);
  }
}

// Format E: direct URL fields
for (const field of ["stream_url", "streaming_url", "url", "video_url", "playlist", "m3u8"] as const) {
  const val = data[field];
  if (typeof val === "string" && val.includes("http")) addSource(val);
}

// Format F: nested data.stream.playlist
if (typeof data?.data?.stream?.playlist === "string") {
  addSource(data.data.stream.playlist);
}
if (typeof data?.data?.data?.stream?.playlist === "string") {
  addSource(data.data.data.stream.playlist);
}

return sources;
};

// ─── Per-provider fetcher ─────────────────────────────────────────────────────
const fetchProviderSources = async (
provider: ProviderDef,
req: ParsedMediaRequest,
runContext: ScrapeRunContext,
): Promise<PlaylistSource[]> => {
const url = buildProviderUrl(provider, req);
const defaultHeaders: HeaderMap = {
  Referer: VIDRUSH_REFERER,
  Origin: VIDRUSH_ORIGIN,
};

try {
  const res = await fetchWithTimeout(
    url,
    {
      cache: "no-store",
      headers: { Accept: "application/json, */*", Referer: VIDRUSH_REFERER },
    },
    REQUEST_TIMEOUT_MS,
  );
  if (!res?.ok) {
    const responseText = res ? await res.text().catch(() => "") : null;
    await archiveProviderResponse(provider.name, req, runContext, {
      url,
      status: res?.status ?? null,
      ok: false,
      sourceCount: 0,
      error: res ? `HTTP ${res.status}` : "timeout",
      responseBody: responseText ? parseJsonText(responseText) : null,
      responseText,
    });
    return [];
  }

  const responseText = await res.text();
  const json = parseJsonText(responseText) as any;

  let data = json;
  if (provider.encrypted && json?.v === 4 && typeof json.payload === "string") {
    data = await decryptTulnex(json.payload);
  }

  const sources = extractStreams(data, provider.label, defaultHeaders);
  await archiveProviderResponse(provider.name, req, runContext, {
    url,
    status: res.status,
    ok: true,
    sourceCount: sources.length,
    responseBody: json,
    responseText,
  });
  return sources;
} catch (e) {
  await archiveProviderResponse(provider.name, req, runContext, {
    url,
    status: null,
    ok: false,
    sourceCount: 0,
    error: e instanceof Error ? e.message : String(e),
  });
  return [];
}
};

const dedupe = (sources: PlaylistSource[]): PlaylistSource[] => {
const seen = new Set<string>();
return sources.filter((s) => {
  if (seen.has(s.file)) return false;
  seen.add(s.file);
  return true;
});
};

const toPlaylist = (sources: PlaylistSource[]): PlaylistResponse => ({
playlist: [{ sources }],
});

// ─── Route ────────────────────────────────────────────────────────────────────
export const dynamic = "force-dynamic";

export const GET = async (request: NextRequest) => {
const { searchParams } = request.nextUrl;
const req = parseMediaRequest(searchParams);
if (!req) return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });

const runContext: ScrapeRunContext = {
  phase: searchParams.get("backfill") === "1" ? "backfill" : "live",
  attempt: Number.parseInt(searchParams.get("attempt") || "0", 10) || 0,
};

const results = await Promise.allSettled(PROVIDERS.map((p) => fetchProviderSources(p, req, runContext)));

const all: PlaylistSource[] = [];
for (const r of results) {
  if (r.status === "fulfilled") all.push(...r.value);
}

const ordered = dedupe(all).map((s, i) => ({ ...s, default: i === 0 }));

if (!ordered.length) {
  return NextResponse.json({ error: "No playable sources found" }, { status: 502 });
}

const encoded = ordered.map((s) => ({ ...s, file: encodePlayerStreamUrl(s.file) }));

return NextResponse.json(toPlaylist(encoded), {
  headers: { "cache-control": "no-store, max-age=0" },
});
};
