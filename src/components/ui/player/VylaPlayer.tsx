"use client";

import { ContentType } from "@/types";
import { cn } from "@/utils/helpers";
import { useEffect, useMemo, useRef } from "react";

type SyncSignal = { action: "play" | "pause" | "seek"; time?: number; version: number };

export interface VylaPlayerProps {
  playlistUrl: string;
  mediaId: string | number;
  mediaType: ContentType;
  season?: number;
  episode?: number;
  startAt?: number;
  className?: string;
  onFatalError?: (message: string) => void;
  openSourceMenuSignal?: number;
  syncSignal?: SyncSignal;
  backdropUrl?: string;
  title?: string;
  subtitle?: string;
}

const VylaPlayer: React.FC<VylaPlayerProps> = ({
  playlistUrl: _playlistUrl,
  mediaId,
  mediaType,
  season,
  episode,
  startAt,
  className,
  onFatalError,
  openSourceMenuSignal,
  syncSignal,
  backdropUrl: _backdropUrl,
  title: _title,
  subtitle: _subtitle,
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const src = useMemo(() => {
    const params = new URLSearchParams({ id: String(mediaId) });

    if (mediaType === "tv") {
      params.set("season", String(season || 1));
      params.set("episode", String(episode || 1));
    }

    if (typeof startAt === "number" && Number.isFinite(startAt) && startAt > 0) {
      params.set("startAt", String(Math.floor(startAt)));
    }

    return `/321movies/index.html?${params.toString()}`;
  }, [episode, mediaId, mediaType, season, startAt]);

  useEffect(() => {
    if (!openSourceMenuSignal) return;
    iframeRef.current?.contentWindow?.postMessage({ type: "VYLA_OPEN_SOURCE_MENU" }, window.location.origin);
  }, [openSourceMenuSignal]);

  useEffect(() => {
    if (!syncSignal?.version) return;
    iframeRef.current?.contentWindow?.postMessage(
      {
        type: "VYLA_PLAYER_SYNC",
        action: syncSignal.action,
        time: syncSignal.time,
      },
      window.location.origin,
    );
  }, [syncSignal?.version]);

  useEffect(() => {
    if (!onFatalError) return;

    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (!event.data || event.data.type !== "VYLA_PLAYER_FATAL_ERROR") return;
      onFatalError(event.data.message || "321movies player error");
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onFatalError]);

  return (
    <iframe
      ref={iframeRef}
      allow="autoplay; fullscreen; picture-in-picture"
      allowFullScreen
      className={cn("border-0 bg-black", className)}
      src={src}
      title="321movies Player"
    />
  );
};

VylaPlayer.displayName = "VylaPlayer";

export default VylaPlayer;
