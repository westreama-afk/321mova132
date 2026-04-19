import { NextRequest, NextResponse } from "next/server";
import { encodePlayerStreamUrl } from "@/utils/playerUrlCodec";

const REQUEST_TIMEOUT_MS = 35000;
const DEFAULT_WORKER_PROXY = "https://small-cake-fdee.piracya.workers.dev";
const VIDRUSH_REFERER = "https://player.vidrush.net/";
const VIDRUSH_ORIGIN = "https://player.vidrush.net";
const DI = "Sn00pD0g#L1_X0R_M4st3rK3y!2025";
const FI = "xK9!mR2@pL5#nQ8";
const HI = "Sn00pD0g#L3_AES_S3cur3K3y@2025$";
const PI = "Sn00pD0g#L4_HMAC_F1n4lW4ll#2025!";

type MediaType = "movie" | "tv";
type HeaderMap = Record<string, string>;
type ParsedReq = { type: MediaType; id: string; season?: string; episode?: string };
type PlaylistSource = { type: "hls"; file: string; label: string; default?: boolean; provider?: string };

const isDigits = (v: string | null): v is string => !!v && /^\d+$/.test(v);
const parseReq = (p: URLSearchParams): ParsedReq | null => {
  const type = p.get("type") as MediaType | null;
  const id = p.get("id");
  if (!type || !isDigits(id)) return null;
  if (type === "movie") return { type, id };
  const season = p.get("season");
  const episode = p.get("episode");
  if (!isDigits(season) || !isDigits(episode)) return null;
  return { type, id, season, episode };
};
const getWorkerBase = () => (process.env.PLAYER_PROXY_URL || process.env.NEXT_PUBLIC_PLAYER_PROXY_URL || DEFAULT_WORKER_PROXY).replace(/\/+$/, "");
const buildWorkerProxy = (url: string, headers: HeaderMap) => {
  const params = new URLSearchParams({ url, headers: JSON.stringify(headers) });
  const key = process.env.PLAYER_PROXY_WORKER_KEY?.trim();
  if (key) params.set("k", key);
  const endpoint = /\.mp4($|\?)/i.test(url) ? "mp4-proxy" : "m3u8-proxy/playlist.m3u8";
  return `${getWorkerBase()}/${endpoint}?${params.toString()}`;
};
const fetchWithTimeout = async (url: string, init: RequestInit) => {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), REQUEST_TIMEOUT_MS);
  try { return await fetch(url, { ...init, signal: c.signal }); } catch { return null; } finally { clearTimeout(t); }
};

const b64ToBuffer = (b64: string): ArrayBuffer => { const str = atob(b64); const out = new Uint8Array(str.length); for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i); return out.buffer as ArrayBuffer; };
const bufToHex = (buf: ArrayBuffer): string => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
const hexToBytes = (hex: string): Uint8Array => { const out = new Uint8Array(hex.length / 2); for (let i = 0; i < hex.length; i += 2) out[i / 2] = parseInt(hex.substr(i, 2), 16); return out; };
const pbkdf2Key = async (pwd: string, salt: string, iters: number, len: number, hash: string): Promise<Uint8Array> => {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pwd).buffer as ArrayBuffer, { name: "PBKDF2" }, false, ["deriveKey"]);
  const derived = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: new TextEncoder().encode(salt).buffer as ArrayBuffer, iterations: iters, hash }, key, { name: "AES-GCM", length: len * 8 }, true, ["encrypt", "decrypt"]);
  return new Uint8Array(await crypto.subtle.exportKey("raw", derived) as ArrayBuffer);
};
let cachedXorKey: Uint8Array | null = null;
const getXorKey = (): Promise<Uint8Array> => cachedXorKey ? Promise.resolve(cachedXorKey) : pbkdf2Key(DI, FI, 50000, 32, "SHA-256").then((k) => (cachedXorKey = k));
const decryptTulnex = async (payload: string): Promise<any> => {
  const sep = payload.indexOf("|"); if (sep === -1) throw new Error("invalid payload");
  const rcvdHmac = payload.slice(0, sep); const innerStr = new TextDecoder().decode(b64ToBuffer(payload.slice(sep + 1)));
  const hmacKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(PI).buffer as ArrayBuffer, { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", hmacKey, new TextEncoder().encode(innerStr)); if (rcvdHmac !== bufToHex(sig)) throw new Error("hmac mismatch");
  const [ivB64, saltB64, cipherB64] = innerStr.split(".");
  const aesKey = await pbkdf2Key(HI, Buffer.from(saltB64, "base64").toString("binary"), 100000, 32, "SHA-512");
  const cryptoKey = await crypto.subtle.importKey("raw", aesKey.buffer as ArrayBuffer, { name: "AES-CBC" }, false, ["decrypt"]);
  const dec = await crypto.subtle.decrypt({ name: "AES-CBC", iv: new Uint8Array(b64ToBuffer(ivB64)) }, cryptoKey, b64ToBuffer(cipherB64));
  const hex = atob(new TextDecoder().decode(dec)).split(" ").map((s) => String.fromCharCode(parseInt(s, 2))).join("");
  const bytes = hexToBytes(hex); const key = await getXorKey(); const out = new Uint8Array(bytes.length); for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ key[i % 32];
  return JSON.parse(new TextDecoder().decode(out.buffer));
};

const normalizeHeaders = (raw: unknown): HeaderMap => !raw || typeof raw !== "object" ? {} : Object.entries(raw as Record<string, unknown>).reduce((a, [k, v]) => (typeof v === "string" && v ? { ...a, [k]: v } : a), {} as HeaderMap);
const buildUrl = (req: ParsedReq) => req.type === "movie" ? `https://api.tulnex.com/provider/vidlink/movie/${req.id}` : `https://api.tulnex.com/provider/vidlink/tv/${req.id}/${req.season}/${req.episode}`;
const extractStreams = (data: any): Array<{ url: string; headers: HeaderMap }> => {
  const baseHeaders: HeaderMap = { Referer: VIDRUSH_REFERER, Origin: VIDRUSH_ORIGIN };
  const found: Array<{ url: string; headers: HeaderMap }> = []; const add = (u?: string, h?: HeaderMap) => { if (typeof u === "string" && u.startsWith("http")) found.push({ url: u, headers: { ...baseHeaders, ...(h || {}) } }); };
  if (!data || typeof data !== "object") return found;
  if (typeof data.stream === "string") add(data.stream, normalizeHeaders(data.headers));
  if (Array.isArray(data?.data?.sources)) for (const s of data.data.sources) add(s?.file, normalizeHeaders(s?.headers ?? data?.data?.headers ?? data?.headers));
  if (Array.isArray(data.streams)) for (const s of data.streams) add(s?.link ?? s?.url ?? s?.playlist ?? s?.streaming_url, normalizeHeaders(data.headers));
  if (Array.isArray(data?.data?.streams)) for (const s of data.data.streams) add(s?.link ?? s?.url ?? s?.playlist ?? s?.streaming_url, normalizeHeaders(data?.data?.headers ?? data?.headers));
  ["stream_url", "streaming_url", "url", "video_url", "playlist", "m3u8"].forEach((f) => add(data[f], normalizeHeaders(data.headers)));
  return found;
};

export const dynamic = "force-dynamic";
export const GET = async (request: NextRequest) => {
  const req = parseReq(request.nextUrl.searchParams);
  if (!req) return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
  const res = await fetchWithTimeout(buildUrl(req), { cache: "no-store", headers: { Accept: "application/json, */*", Referer: VIDRUSH_REFERER } });
  if (!res?.ok) return NextResponse.json({ error: "No sources found" }, { status: 502 });
  let data: any = await res.json(); if (data?.v === 4 && typeof data?.payload === "string") data = await decryptTulnex(data.payload);
  const deduped = Array.from(new Map(extractStreams(data).map((s) => [buildWorkerProxy(s.url, s.headers), s])).values());
  const sources: PlaylistSource[] = deduped.map((s, i) => ({ type: "hls", file: encodePlayerStreamUrl(buildWorkerProxy(s.url, s.headers)), label: "VidLink", provider: "vidlink", default: i === 0 }));
  if (!sources.length) return NextResponse.json({ error: "No sources found" }, { status: 502 });
  return NextResponse.json({ playlist: [{ sources }] }, { headers: { "cache-control": "no-store, max-age=0" } });
};