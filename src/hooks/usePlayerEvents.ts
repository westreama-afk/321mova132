import { syncHistory } from "@/actions/histories";
import { ContentType } from "@/types";
import { diff } from "@/utils/helpers";
import { useDocumentVisibility } from "@mantine/hooks";
import { useEffect, useRef, useState } from "react";
import useSupabaseUser from "./useSupabaseUser";

export type PlayerEventType = "play" | "pause" | "seeked" | "ended" | "timeupdate";

export interface BasePlayerEventEnvelope<T> {
  type: "PLAYER_EVENT" | "MEDIA_DATA";
  data: T;
}

export interface VidlinkEventData {
  event: PlayerEventType;
  currentTime: number;
  duration: number;
  mtmdbId: number;
  mediaType: ContentType;
  season?: number;
  episode?: number;
}

export type VidlinkPlayerMessage = BasePlayerEventEnvelope<VidlinkEventData>;

export interface VidkingEventData {
  event: PlayerEventType;
  currentTime: number;
  duration: number;
  id: string | number;
  mediaType: ContentType;
  season?: number;
  episode?: number;
  progress?: number;
}

export type VidkingPlayerMessage = BasePlayerEventEnvelope<VidkingEventData>;

export interface UnifiedPlayerEventData {
  event: PlayerEventType;
  currentTime: number;
  duration: number;
  mediaId: string | number;
  mediaType: ContentType;
  season?: number;
  episode?: number;
  progress?: number;
  activeWatchSeconds?: number;
}

export interface PlayerAdapter<RawMessage extends BasePlayerEventEnvelope<any>> {
  origin: `https://${string}`;
  parse: (raw: RawMessage) => UnifiedPlayerEventData | null;
}

export type AdapterMap = Record<string, PlayerAdapter<any>>;

export const playerAdapters = {
  vidlink: {
    origin: "https://vidlink.pro",
    parse: (raw) => {
      if (raw.type !== "PLAYER_EVENT") return null;
      const d = raw.data;
      return { ...d, mediaId: d.mtmdbId };
    },
  } satisfies PlayerAdapter<VidlinkPlayerMessage>,
  vidking: {
    origin: "https://www.vidking.net",
    parse: (raw) => {
      if (raw.type !== "PLAYER_EVENT") return null;
      const d = raw.data;
      return { ...d, mediaId: d.id };
    },
  } satisfies PlayerAdapter<VidkingPlayerMessage>,
} as const satisfies AdapterMap;

interface FmoviezForwardedPlayerMessage { type: "FMOVIEZ_PLAYER_EVENT"; origin: string; data: unknown }
interface LocalPlayerEventData { event: PlayerEventType; currentTime: number; duration: number; mediaId: string | number; mediaType: ContentType; season?: number; episode?: number; progress?: number }
interface LocalPlayerMessage { type: "LOCAL_PLAYER_EVENT"; data: LocalPlayerEventData }
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const safeJsonParse = (value: unknown): unknown => { if (typeof value !== "string") return value; try { return JSON.parse(value); } catch { return null; } };
const isFmoviezForwardedMessage = (value: unknown): value is FmoviezForwardedPlayerMessage => isObject(value) && value.type === "FMOVIEZ_PLAYER_EVENT" && typeof value.origin === "string";
const isLocalPlayerMessage = (value: unknown): value is LocalPlayerMessage => isObject(value) && value.type === "LOCAL_PLAYER_EVENT" && isObject(value.data);
const isEmbedSeekOrigin = (origin: string): boolean => { try { return new URL(origin).hostname.endsWith("embedseek.xyz"); } catch { return false; } };
const asNumber = (value: unknown): number | null => { if (typeof value === "number" && Number.isFinite(value)) return value; if (typeof value === "string" && value.trim().length > 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; } return null; };
const normalizeEventType = (value: unknown): PlayerEventType => { const normalized = String(value ?? "").toLowerCase(); if (normalized.includes("pause")) return "pause"; if (normalized.includes("play")) return "play"; if (normalized.includes("seek")) return "seeked"; if (normalized.includes("end")) return "ended"; return "timeupdate"; };
const parseEmbedSeekEvent = (value: unknown): UnifiedPlayerEventData | null => { const data = safeJsonParse(value); if (!isObject(data)) return null; const currentTime = asNumber(data.currentTime ?? data.time ?? data.position ?? data.progress); if (currentTime === null) return null; return { event: normalizeEventType(data.type ?? data.event), currentTime, duration: asNumber(data.duration ?? data.totalDuration) ?? 0, mediaId: 0, mediaType: "movie" }; };
const parseLocalPlayerEvent = (value: unknown): UnifiedPlayerEventData | null => { if (!isLocalPlayerMessage(value)) return null; const data = value.data; const currentTime = asNumber(data.currentTime) ?? 0; const duration = asNumber(data.duration) ?? 0; const mediaId = data.mediaId ?? 0; const mediaType = data.mediaType === "tv" || data.mediaType === "movie" ? data.mediaType : "movie"; return { event: normalizeEventType(data.event), currentTime, duration, mediaId, mediaType, season: asNumber(data.season) ?? undefined, episode: asNumber(data.episode) ?? undefined, progress: asNumber(data.progress) ?? undefined }; };
export interface UsePlayerEventsOptions { media?: { id: string | number; type: ContentType }; metadata?: { season?: number; episode?: number }; saveHistory?: boolean; trackUiState?: boolean; onPlay?: (data: UnifiedPlayerEventData) => void; onPause?: (data: UnifiedPlayerEventData) => void; onSeeked?: (data: UnifiedPlayerEventData) => void; onEnded?: (data: UnifiedPlayerEventData) => void; onTimeUpdate?: (data: UnifiedPlayerEventData) => void; }
export function usePlayerEvents(options: UsePlayerEventsOptions = {}) {
  const { data: user } = useSupabaseUser();
  const documentState = useDocumentVisibility();
  const { media, metadata, saveHistory, trackUiState = true, onPlay, onPause, onSeeked, onEnded, onTimeUpdate } = options;
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [lastEvent, setLastEvent] = useState<PlayerEventType | null>(null);
  const eventDataRef = useRef<UnifiedPlayerEventData | null>(null);
  const lastCurrentTimeRef = useRef(0);
  const activeWatchSecondsRef = useRef(0);
  const activeWatchBaselineRef = useRef<number | null>(null);
  const normalizePayload = (data: UnifiedPlayerEventData): UnifiedPlayerEventData => ({ ...data, mediaId: media?.id ?? data.mediaId ?? 0, mediaType: media?.type ?? data.mediaType ?? "movie", season: metadata?.season ?? data.season ?? 0, episode: metadata?.episode ?? data.episode ?? 0, activeWatchSeconds: data.activeWatchSeconds ?? activeWatchSecondsRef.current });
  const syncToServer = async (data: UnifiedPlayerEventData, completed?: boolean) => { if (!saveHistory || !user) return; if (diff(data.currentTime, lastCurrentTimeRef.current) <= 5) return; const payload = normalizePayload(data); const { success, message } = await syncHistory(payload, completed); if (success) lastCurrentTimeRef.current = data.currentTime; else console.error("Save history failed:", message); };
  useEffect(() => { if (!saveHistory || !user) return; if (documentState === "visible") return; if (!eventDataRef.current) return; syncToServer(eventDataRef.current); }, [documentState]);
  useEffect(() => { const handleBeforeUnload = () => { if (!saveHistory || !user) return; if (!eventDataRef.current) return; const payload = { ...normalizePayload(eventDataRef.current), completed: eventDataRef.current.event === "ended" }; navigator.sendBeacon("/api/player/save-history", JSON.stringify(payload)); }; const handleMessage = (event: MessageEvent) => { let parsed: UnifiedPlayerEventData | null = null; if (isLocalPlayerMessage(event.data)) parsed = parseLocalPlayerEvent(event.data); else if (isFmoviezForwardedMessage(event.data) && isEmbedSeekOrigin(event.data.origin)) parsed = parseEmbedSeekEvent(event.data.data); else if (isEmbedSeekOrigin(event.origin)) parsed = parseEmbedSeekEvent(event.data); else { const adapter = Object.values(playerAdapters).find((a) => a.origin === event.origin) as PlayerAdapter<any> | undefined; if (!adapter) return; const rawData = safeJsonParse(event.data); if (!rawData) return; parsed = adapter.parse(rawData as any); } if (!parsed) return; const normalized = normalizePayload(parsed); eventDataRef.current = normalized; if (trackUiState) setLastEvent(normalized.event); switch (normalized.event) { case "play": if (trackUiState) setIsPlaying(true); activeWatchBaselineRef.current = Date.now(); onPlay?.(normalized); break; case "pause": if (trackUiState) setIsPlaying(false); if (activeWatchBaselineRef.current) { activeWatchSecondsRef.current += Math.max(0, Math.floor((Date.now() - activeWatchBaselineRef.current) / 1000)); activeWatchBaselineRef.current = null; } normalized.activeWatchSeconds = activeWatchSecondsRef.current; onPause?.(normalized); break; case "ended": if (trackUiState) setIsPlaying(false); if (activeWatchBaselineRef.current) { activeWatchSecondsRef.current += Math.max(0, Math.floor((Date.now() - activeWatchBaselineRef.current) / 1000)); activeWatchBaselineRef.current = null; } normalized.activeWatchSeconds = activeWatchSecondsRef.current; syncToServer(normalized, true); onEnded?.(normalized); break; case "seeked": if (trackUiState) { setCurrentTime(normalized.currentTime); setDuration(normalized.duration); } onSeeked?.(normalized); break; case "timeupdate": if (trackUiState) { setCurrentTime(normalized.currentTime); setDuration(normalized.duration); } if (activeWatchBaselineRef.current) { const elapsed = Math.max(0, Math.floor((Date.now() - activeWatchBaselineRef.current) / 1000)); normalized.activeWatchSeconds = activeWatchSecondsRef.current + elapsed; } onTimeUpdate?.(normalized); break; } }; window.addEventListener("message", handleMessage); window.addEventListener("beforeunload", handleBeforeUnload); return () => { if (eventDataRef.current) handleBeforeUnload(); window.removeEventListener("message", handleMessage); window.removeEventListener("beforeunload", handleBeforeUnload); }; }, []);
  return { isPlaying, currentTime, duration, lastEvent };
}
