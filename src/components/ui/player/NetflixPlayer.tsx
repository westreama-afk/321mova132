"use client";

import { ContentType } from "@/types";
import { cn } from "@/utils/helpers";
import { decodePlayerStreamUrl } from "@/utils/playerUrlCodec";
import Hls from "hls.js";
import { useCallback, useEffect, useRef, useState, createElement } from "react";
import { FaPause, FaPlay, FaServer } from "react-icons/fa";
import { IoMdVolumeHigh, IoMdVolumeLow, IoMdVolumeMute } from "react-icons/io";
import { MdClosedCaption, MdClosedCaptionDisabled, MdForward10, MdFullscreen, MdFullscreenExit, MdReplay10, MdSettings } from "react-icons/md";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface PlaylistSource {
  type?: string;
  file?: string;
  label?: string;
  provider?: string;
  default?: boolean;
}

interface PlaylistItem {
  sources?: PlaylistSource[];
}

interface PlaylistResponse {
  playlist?: PlaylistItem[];
}

interface StreamSourceOption {
  file: string;
  label: string;
  provider?: string;
  isDefault?: boolean;
}

interface SubtitleTrack {
  id: number;
  name: string;
  lang: string;
}

interface ExternalSubtitleTrack {
  url: string;
  lang: string;
  label: string;
  format: string;
}

/** External (Wyzie) subtitle IDs start at this offset to avoid clashing with HLS track indices. */
const EXTERNAL_SUB_ID_OFFSET = 1000;

interface QualityLevel {
  id: number;
  label: string;
  height: number;
}

type LocalPlayerEventType = "play" | "pause" | "seeked" | "ended" | "timeupdate";
type SettingsTab = "source" | "quality" | "subtitles" | "speed";

export interface NetflixPlayerProps {
  playlistUrl: string;
  mediaId: string | number;
  mediaType: ContentType;
  season?: number;
  episode?: number;
  startAt?: number;
  className?: string;
  onFatalError?: (message: string) => void;
  openSourceMenuSignal?: number;
  /** Party sync: when version increments, execute action */
  syncSignal?: { action: "play" | "pause" | "seek"; time?: number; version: number };
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

const formatTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
};

const pickHlsSources = (payload: PlaylistResponse): StreamSourceOption[] => {
  if (!Array.isArray(payload.playlist)) return [];
  const collected: StreamSourceOption[] = [];
  for (const item of payload.playlist) {
    if (!Array.isArray(item.sources)) continue;
    for (const source of item.sources) {
      // Accept both HLS and MP4 sources
      if ((source?.type !== "hls" && source?.type !== "mp4") || typeof source.file !== "string" || source.file.length === 0) continue;
      const decodedFile = decodePlayerStreamUrl(source.file);
      if (!decodedFile || decodedFile.length === 0) continue;
      collected.push({
        file: decodedFile,
        label: source.label?.trim() || "Auto",
        provider: source.provider,
        isDefault: Boolean(source.default),
      });
    }
  }
  const seen = new Set<string>();
  return collected.filter((s) => {
    if (seen.has(s.file)) return false;
    seen.add(s.file);
    return true;
  });
};

const HIDE_CONTROLS_MS = 3500;
const NETFLIX_RED = "#E50914";
const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

// ─── Component ─────────────────────────────────────────────────────────────────

const NetflixPlayer: React.FC<NetflixPlayerProps> = ({
  playlistUrl,
  mediaId,
  mediaType,
  season,
  episode,
  startAt,
  className,
  onFatalError,
  openSourceMenuSignal,
  syncSignal,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEmittedTimeRef = useRef<number>(-1);
  const startAtAppliedRef = useRef(false);
  const progressDragRef = useRef(false);
  const preferredSubtitleIdRef = useRef<number>(-1);
  const playbackSpeedRef = useRef(1);

  const [sources, setSources] = useState<StreamSourceOption[]>([]);
  const [activeSourceIndex, setActiveSourceIndex] = useState(0);
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>([]);
  const [activeSubtitleId, setActiveSubtitleId] = useState<number>(-1);
  const [qualityLevels, setQualityLevels] = useState<QualityLevel[]>([]);
  const [activeQualityLevel, setActiveQualityLevel] = useState<number>(-1);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("source");
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seekFeedback, setSeekFeedback] = useState<{
    direction: "forward" | "backward";
    visible: boolean;
  }>({ direction: "forward", visible: false });
  const [currentSubtitleCue, setCurrentSubtitleCue] = useState<string | null>(null);
  const cueCleanupRef = useRef<(() => void) | null>(null);
  const [externalSubtitles, setExternalSubtitles] = useState<ExternalSubtitleTrack[]>([]);
  const externalTrackElementsRef = useRef<HTMLTrackElement[]>([]);

  // ── Subtitle helpers ──────────────────────────────────────────────────────────

  const applySubtitle = useCallback((id: number) => {
    preferredSubtitleIdRef.current = id;
    setActiveSubtitleId(id);
    const hls = hlsRef.current;
    const video = videoRef.current;

    if (id >= EXTERNAL_SUB_ID_OFFSET) {
      // External subtitle selected — disable all HLS tracks
      if (hls) hls.subtitleTrack = -1;
      if (video) {
        setTimeout(() => {
          for (let i = 0; i < video.textTracks.length; i++) {
            const externalIdx = i - (video.textTracks.length - externalTrackElementsRef.current.length);
            video.textTracks[i].mode = (externalIdx >= 0 && externalIdx === id - EXTERNAL_SUB_ID_OFFSET) ? "hidden" : "disabled";
          }
        }, 0);
      }
    } else {
      // HLS or native subtitle — disable all external tracks
      if (hls) hls.subtitleTrack = id;
      if (video) {
        setTimeout(() => {
          for (let i = 0; i < video.textTracks.length; i++) {
            video.textTracks[i].mode = i === id ? "hidden" : "disabled";
          }
        }, 0);
      }
    }
  }, []);

  // ── Event emission ────────────────────────────────────────────────────────────

  const emitEvent = useCallback(
    (eventType: LocalPlayerEventType) => {
      const video = videoRef.current;
      const ct = video?.currentTime ?? 0;
      const d = video?.duration ?? 0;
      window.postMessage(
        {
          type: "LOCAL_PLAYER_EVENT",
          data: {
            event: eventType,
            currentTime: ct,
            duration: d,
            mediaId,
            mediaType,
            season,
            episode,
            progress: d > 0 ? ct / d : 0,
          },
        },
        "*",
      );
    },
    [mediaId, mediaType, season, episode],
  );

  // ── HLS loading ───────────────────────────────────────────────────────────────

  const loadSource = useCallback(
    (url: string) => {
      const video = videoRef.current;
      if (!video) return;

      hlsRef.current?.destroy();
      hlsRef.current = null;
      startAtAppliedRef.current = false;
      setSubtitleTracks([]);
      setActiveSubtitleId(-1);
      setQualityLevels([]);
      setActiveQualityLevel(-1);
      setIsLoading(true);
      setError(null);

      const applyStartAt = () => {
        if (startAt && startAt > 0 && !startAtAppliedRef.current) {
          video.currentTime = startAt;
          startAtAppliedRef.current = true;
        }
      };

      // Decode URL first to check actual format (handle "enc:" prefix)
      const decodedUrl = decodePlayerStreamUrl(url);
      const isMp4 = decodedUrl.toLowerCase().endsWith(".mp4");

      if (isMp4) {
        // For MP4, Vidstack media-player handles it natively
        // Just reset state and let the media-player element handle playback
        applyStartAt();
        setIsLoading(false);
        setQualityLevels([{ id: 0, label: "Source", height: 0 }]);
        return;
      }

      if (Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true, maxBufferLength: 30 });
        hlsRef.current = hls;
        hls.subtitleDisplay = false; // We render cues ourselves
        hls.loadSource(decodedUrl);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
          // Populate quality levels from HLS manifest
          const byHeight = new Map<number, number>();
          data.levels.forEach((lvl, i) => {
            const h = lvl.height || 0;
            if (!byHeight.has(h)) byHeight.set(h, i);
          });
          const levels: QualityLevel[] = [{ id: -1, label: "Auto", height: 0 }];
          Array.from(byHeight.entries())
            .sort((a, b) => b[0] - a[0])
            .forEach(([h, id]) => {
              levels.push({ id, label: h > 0 ? `${h}p` : "Source", height: h });
            });
          setQualityLevels(levels);
          // Restore playback speed on source switch
          video.playbackRate = playbackSpeedRef.current;
          setIsLoading(false);
          applyStartAt();
          void video.play().catch(() => {});
        });

        // ── Auto-detect subtitle tracks ──────────────────────────────────────
        hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, (_, data) => {
          const tracks: SubtitleTrack[] = data.subtitleTracks.map((t, i) => ({
            id: i,
            name: t.name || t.lang || `Track ${i + 1}`,
            lang: t.lang || "",
          }));
          setSubtitleTracks(tracks);

          // Re-apply preferred subtitle if one was set before source switch
          const preferred = preferredSubtitleIdRef.current;
          if (preferred >= 0 && preferred < tracks.length) {
            hls.subtitleTrack = preferred;
            setActiveSubtitleId(preferred);
          }
        });

        hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, (_, data) => {
          setActiveSubtitleId(data.id);
        });

        hls.on(Hls.Events.ERROR, (_, data) => {
          if (!data.fatal) return;
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            hls.startLoad();
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError();
          } else {
            setError("Stream failed to load.");
            onFatalError?.("Fatal HLS error");
          }
        });
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        // Safari native HLS
        video.src = decodedUrl;
        applyStartAt();
        setIsLoading(false);

        // Detect native text tracks once metadata is available
        const onLoaded = () => {
          const tracks: SubtitleTrack[] = [];
          for (let i = 0; i < video.textTracks.length; i++) {
            const t = video.textTracks[i];
            if (t.kind === "subtitles" || t.kind === "captions") {
              tracks.push({ id: i, name: t.label || t.language || `Track ${i + 1}`, lang: t.language });
              t.mode = "disabled";
            }
          }
          setSubtitleTracks(tracks);
          const preferred = preferredSubtitleIdRef.current;
          if (preferred >= 0 && preferred < tracks.length) {
            video.textTracks[preferred].mode = "showing";
            setActiveSubtitleId(preferred);
          }
          video.removeEventListener("loadedmetadata", onLoaded);
        };
        video.addEventListener("loadedmetadata", onLoaded);
        void video.play().catch(() => {});
      } else {
        setError("HLS is not supported in this browser.");
        onFatalError?.("HLS not supported");
      }
    },
    [startAt, onFatalError],
  );

  // ── Fetch playlist ────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    setSources([]);
    setActiveSourceIndex(0);
    setIsLoading(true);
    setError(null);

    fetch(playlistUrl)
      .then((res) => res.json())
      .then((payload: PlaylistResponse) => {
        if (cancelled) return;
        const parsed = pickHlsSources(payload);
        if (parsed.length === 0) {
          setError("No streams are available right now.");
          onFatalError?.("No streams");
          return;
        }
        setSources(parsed);
        const defaultIdx = parsed.findIndex((s) => s.isDefault);
        const idx = defaultIdx >= 0 ? defaultIdx : 0;
        setActiveSourceIndex(idx);
        loadSource(parsed[idx].file);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Could not load stream sources.");
        onFatalError?.("Fetch failed");
      });

    return () => { cancelled = true; };
  }, [playlistUrl, loadSource, onFatalError]);

  // ── Fetch external subtitles (Wyzie) ──────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    setExternalSubtitles([]);

    const subParams = new URLSearchParams({
      id: String(mediaId),
      type: mediaType === "movie" ? "movie" : "tv",
    });
    if (mediaType === "tv" && season) subParams.set("season", String(season));
    if (mediaType === "tv" && episode) subParams.set("episode", String(episode));

    fetch(`/api/player/subtitles?${subParams.toString()}`)
      .then((res) => res.json())
      .then((data: { tracks?: ExternalSubtitleTrack[] }) => {
        if (cancelled || !Array.isArray(data?.tracks)) return;
        setExternalSubtitles(data.tracks);
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [mediaId, mediaType, season, episode]);

  // ── Attach external <track> elements to the video ─────────────────────────────

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Remove previously attached external tracks
    for (const el of externalTrackElementsRef.current) {
      video.removeChild(el);
    }
    externalTrackElementsRef.current = [];

    for (const ext of externalSubtitles) {
      const track = document.createElement("track");
      track.kind = "subtitles";
      track.label = ext.label;
      track.srclang = ext.lang;
      track.src = ext.url;
      track.default = false;
      video.appendChild(track);
      // Set mode to disabled so it loads but doesn't render
      const idx = video.textTracks.length - 1;
      if (video.textTracks[idx]) video.textTracks[idx].mode = "disabled";
      externalTrackElementsRef.current.push(track);
    }

    return () => {
      for (const el of externalTrackElementsRef.current) {
        try { video.removeChild(el); } catch { /* already removed */ }
      }
      externalTrackElementsRef.current = [];
    };
  }, [externalSubtitles]);

  // ── Source switching ──────────────────────────────────────────────────────────

  const switchSource = useCallback(
    (index: number) => {
      if (index < 0 || index >= sources.length) return;
      setActiveSourceIndex(index);
      loadSource(sources[index].file);
      setSettingsOpen(false);
    },
    [sources, loadSource],
  );

  const setQuality = useCallback((levelId: number) => {
    const hls = hlsRef.current;
    if (hls) hls.currentLevel = levelId; // -1 re-enables ABR auto
    setActiveQualityLevel(levelId);
    setSettingsOpen(false);
  }, []);

  const changeSpeed = useCallback((rate: number) => {
    const video = videoRef.current;
    if (video) video.playbackRate = rate;
    setPlaybackSpeed(rate);
    playbackSpeedRef.current = rate;
  }, []);

  // Open settings (source tab) when external signal fires
  useEffect(() => {
    if (typeof openSourceMenuSignal === "number" && openSourceMenuSignal > 0) {
      setSettingsTab("source");
      setSettingsOpen((prev) => !prev);
    }
  }, [openSourceMenuSignal]);

  // Party sync: apply incoming play/pause/seek from host
  useEffect(() => {
    if (!syncSignal?.version) return;
    const video = videoRef.current;
    if (!video) return;
    if (syncSignal.action === "seek" && typeof syncSignal.time === "number") {
      video.currentTime = syncSignal.time;
    } else if (syncSignal.action === "play") {
      void video.play().catch(() => {});
    } else if (syncSignal.action === "pause") {
      video.pause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncSignal?.version]);

  // ── Cleanup ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      hlsRef.current?.destroy();
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  // ── Fullscreen listener ───────────────────────────────────────────────────────

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // ── Controls idle hide ────────────────────────────────────────────────────────

  const resetHideTimer = useCallback(() => {
    setShowControls(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (!settingsOpen) setShowControls(false);
    }, HIDE_CONTROLS_MS);
  }, [settingsOpen]);

  useEffect(() => {
    // Keep controls visible while settings panel is open
    if (settingsOpen) {
      setShowControls(true);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    }
  }, [settingsOpen]);

  // ── Custom subtitle cue renderer ──────────────────────────────────────────────

  useEffect(() => {
    cueCleanupRef.current?.();
    cueCleanupRef.current = null;
    setCurrentSubtitleCue(null);
    if (activeSubtitleId < 0) return;

    const tryAttach = () => {
      const video = videoRef.current;
      if (!video) return false;
      let track: TextTrack | null = null;
      if (activeSubtitleId >= EXTERNAL_SUB_ID_OFFSET) {
        const el = externalTrackElementsRef.current[activeSubtitleId - EXTERNAL_SUB_ID_OFFSET];
        track = el?.track ?? null;
      } else {
        track = video.textTracks[activeSubtitleId] ?? null;
      }
      if (!track) return false;
      track.mode = "hidden";
      const onCueChange = () => {
        const cues = track.activeCues;
        if (!cues || cues.length === 0) { setCurrentSubtitleCue(null); return; }
        const text = Array.from(cues)
          .map((c) => (c as VTTCue).text.replace(/<[^>]+>/g, "").trim())
          .filter(Boolean)
          .join("\n");
        setCurrentSubtitleCue(text || null);
      };
      track.addEventListener("cuechange", onCueChange);
      cueCleanupRef.current = () => track.removeEventListener("cuechange", onCueChange);
      return true;
    };

    if (!tryAttach()) {
      const timer = setTimeout(tryAttach, 500);
      cueCleanupRef.current = () => clearTimeout(timer);
    }

    return () => {
      cueCleanupRef.current?.();
      cueCleanupRef.current = null;
    };
  }, [activeSubtitleId]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const video = videoRef.current;
      if (!video) return;
      if ((e.target as HTMLElement).tagName === "INPUT") return;

      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          video.paused ? void video.play() : video.pause();
          resetHideTimer();
          break;
        case "ArrowLeft":
          e.preventDefault();
          video.currentTime = Math.max(0, video.currentTime - 10);
          emitEvent("seeked");
          setSeekFeedback({ direction: "backward", visible: true });
          setTimeout(() => setSeekFeedback((p) => ({ ...p, visible: false })), 700);
          resetHideTimer();
          break;
        case "ArrowRight":
          e.preventDefault();
          video.currentTime = Math.min(video.duration || 0, video.currentTime + 10);
          emitEvent("seeked");
          setSeekFeedback({ direction: "forward", visible: true });
          setTimeout(() => setSeekFeedback((p) => ({ ...p, visible: false })), 700);
          resetHideTimer();
          break;
        case "ArrowUp":
          e.preventDefault();
          video.volume = Math.min(1, video.volume + 0.1);
          setVolume(video.volume);
          resetHideTimer();
          break;
        case "ArrowDown":
          e.preventDefault();
          video.volume = Math.max(0, video.volume - 0.1);
          setVolume(video.volume);
          resetHideTimer();
          break;
        case "m":
          video.muted = !video.muted;
          setIsMuted(video.muted);
          break;
        case "f":
          e.preventDefault();
          document.fullscreenElement
            ? void document.exitFullscreen()
            : void containerRef.current?.requestFullscreen();
          break;
        case "c":
          // Cycle subtitle tracks: off → track 0 → track 1 → ... → off
          if (subtitleTracks.length === 0) break;
          if (activeSubtitleId < 0) {
            applySubtitle(0);
          } else if (activeSubtitleId < subtitleTracks.length - 1) {
            applySubtitle(activeSubtitleId + 1);
          } else {
            applySubtitle(-1);
          }
          break;
        case "Escape":
          setSettingsOpen(false);
          break;
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [emitEvent, resetHideTimer, subtitleTracks, activeSubtitleId, applySubtitle]);

  // ── Video event handlers ──────────────────────────────────────────────────────

  const handlePlay = useCallback(() => { setIsPlaying(true); emitEvent("play"); }, [emitEvent]);
  const handlePause = useCallback(() => { setIsPlaying(false); emitEvent("pause"); }, [emitEvent]);
  const handleEnded = useCallback(() => { setIsPlaying(false); emitEvent("ended"); }, [emitEvent]);
  const handleWaiting = useCallback(() => setIsLoading(true), []);
  const handleCanPlay = useCallback(() => setIsLoading(false), []);

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video || progressDragRef.current) return;
    setCurrentTime(video.currentTime);
    if (video.buffered.length > 0) setBufferedEnd(video.buffered.end(video.buffered.length - 1));
    if (Math.abs(video.currentTime - lastEmittedTimeRef.current) >= 1) {
      lastEmittedTimeRef.current = video.currentTime;
      emitEvent("timeupdate");
    }
  }, [emitEvent]);

  const handleLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setDuration(video.duration);
    if (startAt && startAt > 0 && !startAtAppliedRef.current) {
      video.currentTime = startAt;
      startAtAppliedRef.current = true;
    }
  }, [startAt]);

  // ── Controls actions ──────────────────────────────────────────────────────────

  const togglePlayPause = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.paused ? void video.play() : video.pause();
    resetHideTimer();
  }, [resetHideTimer]);

  const skip = useCallback(
    (seconds: number) => {
      const video = videoRef.current;
      if (!video) return;
      video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + seconds));
      emitEvent("seeked");
      setSeekFeedback({ direction: seconds > 0 ? "forward" : "backward", visible: true });
      setTimeout(() => setSeekFeedback((p) => ({ ...p, visible: false })), 700);
      resetHideTimer();
    },
    [emitEvent, resetHideTimer],
  );

  const getRatioFromClientX = useCallback((clientX: number, el: HTMLElement): number => {
    const rect = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }, []);

  const seekToRatio = useCallback(
    (ratio: number) => {
      const video = videoRef.current;
      if (!video || !duration) return;
      const t = ratio * duration;
      video.currentTime = t;
      setCurrentTime(t);
      emitEvent("seeked");
    },
    [duration, emitEvent],
  );

  const handleProgressMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      progressDragRef.current = true;
      seekToRatio(getRatioFromClientX(e.clientX, e.currentTarget));
      const onMove = (ev: MouseEvent) => {
        if (!progressDragRef.current) return;
        const bar = document.getElementById("nfx-progress-bar");
        if (bar) seekToRatio(getRatioFromClientX(ev.clientX, bar as HTMLElement));
      };
      const onUp = () => {
        progressDragRef.current = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      resetHideTimer();
    },
    [getRatioFromClientX, seekToRatio, resetHideTimer],
  );

  // Touch seek support
  const handleProgressTouchStart = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      const touch = e.touches[0];
      if (!touch) return;
      progressDragRef.current = true;
      seekToRatio(getRatioFromClientX(touch.clientX, e.currentTarget));
    },
    [getRatioFromClientX, seekToRatio],
  );

  const handleProgressTouchMove = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      const touch = e.touches[0];
      if (!touch || !progressDragRef.current) return;
      seekToRatio(getRatioFromClientX(touch.clientX, e.currentTarget));
    },
    [getRatioFromClientX, seekToRatio],
  );

  const handleProgressTouchEnd = useCallback(() => {
    progressDragRef.current = false;
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
  }, []);

  const setVolumeLevel = useCallback((v: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = v;
    setVolume(v);
    if (v === 0) { video.muted = true; setIsMuted(true); }
    else if (video.muted) { video.muted = false; setIsMuted(false); }
  }, []);

  const handleVolumeMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    setVolumeLevel(getRatioFromClientX(e.clientX, e.currentTarget));
    const onMove = (ev: MouseEvent) => {
      const bar = document.getElementById("nfx-volume-bar");
      if (bar) setVolumeLevel(getRatioFromClientX(ev.clientX, bar));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [setVolumeLevel, getRatioFromClientX]);

  const toggleFullscreen = useCallback(() => {
    document.fullscreenElement
      ? void document.exitFullscreen()
      : void containerRef.current?.requestFullscreen();
  }, []);

  // ── Derived values ────────────────────────────────────────────────────────────

  const progressFraction = duration > 0 ? currentTime / duration : 0;
  const bufferedFraction = duration > 0 ? bufferedEnd / duration : 0;
  const hoverFraction = hoverX !== null ? hoverX : null;
  const hoverTime = hoverFraction !== null && duration > 0 ? hoverFraction * duration : null;
  const VolumeIcon = isMuted || volume === 0 ? IoMdVolumeMute : volume < 0.5 ? IoMdVolumeLow : IoMdVolumeHigh;
  const controlsActive = showControls || !isPlaying;
  const hasSubtitles = subtitleTracks.length > 0 || externalSubtitles.length > 0;

  // Build combined subtitle track list for the menu
  const allSubtitleTracks: SubtitleTrack[] = [
    ...subtitleTracks,
    ...externalSubtitles.map((ext, i) => ({
      id: EXTERNAL_SUB_ID_OFFSET + i,
      name: ext.label,
      lang: ext.lang,
    })),
  ];

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div
      ref={containerRef}
      className={cn("group relative overflow-hidden bg-black select-none", className)}
      onMouseMove={resetHideTimer}
      onMouseEnter={resetHideTimer}
      onTouchStart={resetHideTimer}
      style={{ cursor: controlsActive ? "default" : "none" }}
    >
      {/* ── Video ── */}
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-contain"
        onPlay={handlePlay}
        onPause={handlePause}
        onTimeUpdate={handleTimeUpdate}
        onEnded={handleEnded}
        onWaiting={handleWaiting}
        onCanPlay={handleCanPlay}
        onLoadedMetadata={handleLoadedMetadata}
        onError={(e) => {
          const video = e.currentTarget;
          const code = video.error?.code;
          const msg = code === 1 ? "Aborted" : code === 2 ? "Network error" : code === 3 ? "Decoding failed" : code === 4 ? "Format not supported" : "Unknown error";
          setError(`Video error: ${msg}`);
        }}
        playsInline
        crossOrigin="anonymous"
        preload="auto"
      />

      {/* ── Loading spinner ── */}
      {isLoading && !error && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <div className="relative h-16 w-16">
            <div className="absolute inset-0 animate-spin rounded-full border-[3px] border-white/10 border-t-white" />
            <div className="absolute inset-2 animate-spin rounded-full border-[3px] border-white/5 border-t-white/40" style={{ animationDuration: "1.5s", animationDirection: "reverse" }} />
          </div>
        </div>
      )}

      {/* ── Error state ── */}
      {error && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-black/90 text-white">
          <div className="flex flex-col items-center gap-3 px-6 text-center">
            <div className="h-12 w-12 rounded-full border-2 border-white/20 flex items-center justify-center text-2xl">!</div>
            <p className="text-sm font-medium text-white/80">{error}</p>
          </div>
          {sources.length > 1 && (
            <button
              type="button"
              className="mt-1 rounded-md px-6 py-2 text-sm font-bold text-white transition hover:brightness-110"
              style={{ backgroundColor: NETFLIX_RED }}
              onClick={() => switchSource(activeSourceIndex + 1 < sources.length ? activeSourceIndex + 1 : 0)}
            >
              Try next source
            </button>
          )}
        </div>
      )}

      {/* ── Seek feedback ── */}
      {seekFeedback.visible && (
        <div
          className={cn(
            "pointer-events-none absolute top-1/2 z-20 -translate-y-1/2 flex flex-col items-center gap-1 rounded-full bg-black/40 px-7 py-5 text-white backdrop-blur-sm ring-1 ring-white/10",
            seekFeedback.direction === "backward" ? "left-[10%]" : "right-[10%]",
          )}
        >
          {seekFeedback.direction === "backward" ? <MdReplay10 size={42} /> : <MdForward10 size={42} />}
          <span className="text-xs font-semibold tracking-wide opacity-80">10s</span>
        </div>
      )}

      {/* ── Active subtitle cue ── */}
      {currentSubtitleCue && activeSubtitleId >= 0 && !error && (
        <div className="pointer-events-none absolute inset-x-0 bottom-20 z-[35] flex justify-center px-8">
          <div className="max-w-2xl rounded bg-black/80 px-4 py-1.5 text-center text-white shadow-lg">
            {currentSubtitleCue.split("\n").map((line, i) => (
              <p key={i} className="text-sm font-medium leading-snug drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] sm:text-base">{line}</p>
            ))}
          </div>
        </div>
      )}

      {/* ── Settings panel (source + subtitles) ── */}
      {settingsOpen && (
        <div
          className="absolute inset-x-0 bottom-[4.5rem] z-40 flex justify-end px-4 sm:px-6"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="w-full max-w-[260px] overflow-hidden rounded-2xl border border-white/[0.08] bg-[#141414]/97 shadow-2xl backdrop-blur-xl ring-1 ring-white/5">
            {/* Tabs */}
            <div className="flex border-b border-white/[0.08]">
              {(["source", "quality", "subtitles", "speed"] as SettingsTab[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setSettingsTab(tab)}
                  className={cn(
                    "flex-1 py-2 text-[10px] font-semibold uppercase tracking-widest transition",
                    settingsTab === tab ? "text-white" : "text-white/35 hover:text-white/60",
                  )}
                  style={settingsTab === tab ? { borderBottom: `2px solid ${NETFLIX_RED}`, marginBottom: -1 } : undefined}
                >
                  {tab === "source" ? "Source" : tab === "quality" ? "Quality" : tab === "subtitles" ? "Subs" : "Speed"}
                  {tab === "subtitles" && hasSubtitles && (
                    <span className="ml-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white/10 text-[8px] font-bold">
                      {allSubtitleTracks.length}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Content */}
            <div className="max-h-64 overflow-y-auto p-1.5 scrollbar-thin">
              {settingsTab === "source" && sources.map((src, idx) => (
                <button
                  key={src.file}
                  type="button"
                  onClick={() => switchSource(idx)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition",
                    idx === activeSourceIndex ? "text-white" : "text-white/60 hover:bg-white/[0.06] hover:text-white",
                  )}
                  style={idx === activeSourceIndex ? { backgroundColor: `${NETFLIX_RED}22` } : undefined}
                >
                  <FaServer size={10} className="shrink-0 opacity-50" />
                  <span className="flex-1 truncate font-medium">{src.label}</span>
                  {idx === activeSourceIndex && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: NETFLIX_RED }} />
                  )}
                </button>
              ))}

              {settingsTab === "quality" && (
                <>
                  {qualityLevels.length <= 1 ? (
                    <p className="px-3 py-4 text-center text-xs text-white/30">No quality levels detected</p>
                  ) : (
                    qualityLevels.map((ql) => (
                      <button
                        key={ql.id}
                        type="button"
                        onClick={() => setQuality(ql.id)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition",
                          activeQualityLevel === ql.id ? "text-white" : "text-white/60 hover:bg-white/[0.06] hover:text-white",
                        )}
                        style={activeQualityLevel === ql.id ? { backgroundColor: `${NETFLIX_RED}22` } : undefined}
                      >
                        <span className="flex-1 font-medium">{ql.label}</span>
                        {activeQualityLevel === ql.id && (
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: NETFLIX_RED }} />
                        )}
                      </button>
                    ))
                  )}
                </>
              )}

              {settingsTab === "subtitles" && (
                <>
                  <button
                    type="button"
                    onClick={() => applySubtitle(-1)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition",
                      activeSubtitleId === -1 ? "text-white" : "text-white/60 hover:bg-white/[0.06] hover:text-white",
                    )}
                    style={activeSubtitleId === -1 ? { backgroundColor: `${NETFLIX_RED}22` } : undefined}
                  >
                    <MdClosedCaptionDisabled size={13} className="shrink-0 opacity-50" />
                    <span className="flex-1 font-medium">Off</span>
                    {activeSubtitleId === -1 && (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: NETFLIX_RED }} />
                    )}
                  </button>
                  {hasSubtitles ? allSubtitleTracks.map((track) => (
                    <button
                      key={track.id}
                      type="button"
                      onClick={() => applySubtitle(track.id)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition",
                        activeSubtitleId === track.id ? "text-white" : "text-white/60 hover:bg-white/[0.06] hover:text-white",
                      )}
                      style={activeSubtitleId === track.id ? { backgroundColor: `${NETFLIX_RED}22` } : undefined}
                    >
                      <MdClosedCaption size={13} className="shrink-0 opacity-50" />
                      <span className="flex-1 truncate font-medium">{track.name}</span>
                      {track.lang && <span className="shrink-0 rounded bg-white/10 px-1 py-0.5 text-[9px] uppercase tracking-wide text-white/40">{track.lang}</span>}
                      {activeSubtitleId === track.id && (
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: NETFLIX_RED }} />
                      )}
                    </button>
                  )) : (
                    <p className="px-3 py-4 text-center text-xs text-white/30">
                      No subtitle tracks detected
                    </p>
                  )}
                </>
              )}

              {settingsTab === "speed" && PLAYBACK_SPEEDS.map((rate) => (
                <button
                  key={rate}
                  type="button"
                  onClick={() => changeSpeed(rate)}
                  className={cn(
                    "flex w-full items-center rounded-xl px-3 py-2.5 text-left text-sm transition",
                    playbackSpeed === rate ? "text-white" : "text-white/60 hover:bg-white/[0.06] hover:text-white",
                  )}
                  style={playbackSpeed === rate ? { backgroundColor: `${NETFLIX_RED}22` } : undefined}
                >
                  <span className="flex-1 font-medium">{rate === 1 ? "Normal (1×)" : `${rate}×`}</span>
                  {playbackSpeed === rate && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: NETFLIX_RED }} />
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Controls overlay ── */}
      <div
        className={cn(
          "absolute inset-0 z-30 flex flex-col justify-end transition-opacity duration-300",
          controlsActive ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
        onClick={() => {
          if (settingsOpen) {
            setSettingsOpen(false);
          } else {
            togglePlayPause();
          }
        }}
        onDoubleClick={toggleFullscreen}
      >
        {/* Top gradient */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/60 to-transparent" />
        {/* Bottom gradient */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />

        {/* Control bar */}
          <div
            className="relative z-10 flex flex-col gap-3 px-4 pb-4 sm:px-5 sm:pb-5"
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
          {/* ── Progress bar ── */}
          <div
            id="nfx-progress-bar"
            role="slider"
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progressFraction * 100)}
            className="group/bar relative flex h-5 w-full cursor-pointer items-center"
            onMouseDown={handleProgressMouseDown}
            onTouchStart={handleProgressTouchStart}
            onTouchMove={handleProgressTouchMove}
            onTouchEnd={handleProgressTouchEnd}
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setHoverX(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
            }}
            onMouseLeave={() => setHoverX(null)}
          >
            {/* Track */}
            <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/20 transition-all duration-150 group-hover/bar:h-[5px]">
              <div className="absolute inset-y-0 left-0 rounded-full bg-white/25" style={{ width: `${bufferedFraction * 100}%` }} />
              <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${progressFraction * 100}%`, backgroundColor: NETFLIX_RED }} />
            </div>
            {/* Thumb */}
            <div
              className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-lg opacity-0 transition-opacity group-hover/bar:opacity-100"
              style={{ left: `${progressFraction * 100}%`, backgroundColor: NETFLIX_RED }}
            />
            {/* Hover time tooltip */}
            {hoverTime !== null && (
              <div
                className="pointer-events-none absolute bottom-6 -translate-x-1/2 rounded-md bg-black/80 px-2 py-1 text-xs font-semibold text-white shadow-md backdrop-blur ring-1 ring-white/10"
                style={{ left: `${(hoverFraction ?? 0) * 100}%` }}
              >
                {formatTime(hoverTime)}
              </div>
            )}
          </div>

          {/* ── Buttons row ── */}
          <div className="flex items-center gap-1 text-white sm:gap-2">
            {/* Play / Pause */}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); togglePlayPause(); }}
              className="rounded-full p-1.5 transition hover:bg-white/10 active:scale-95"
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? <FaPause size={16} /> : <FaPlay size={16} />}
            </button>

            {/* Skip back */}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); skip(-10); }}
              className="rounded-full p-1 transition hover:bg-white/10 active:scale-95"
              aria-label="Rewind 10 seconds"
            >
              <MdReplay10 size={22} />
            </button>

            {/* Skip forward */}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); skip(10); }}
              className="rounded-full p-1 transition hover:bg-white/10 active:scale-95"
              aria-label="Forward 10 seconds"
            >
              <MdForward10 size={22} />
            </button>

            {/* Volume */}
            <div className="group/vol flex items-center gap-1">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); toggleMute(); }}
                className="rounded-full p-1 transition hover:bg-white/10"
                aria-label={isMuted ? "Unmute" : "Mute"}
              >
                <VolumeIcon size={19} />
              </button>
              <div className="w-0 overflow-hidden transition-all duration-200 group-hover/vol:w-20 group-focus-within/vol:w-20">
                <div
                  id="nfx-volume-bar"
                  role="slider"
                  aria-label="Volume"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round((isMuted ? 0 : volume) * 100)}
                  className="group/vbar relative flex h-5 w-20 cursor-pointer items-center"
                  onMouseDown={handleVolumeMouseDown}
                >
                  <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/30 transition-all duration-150 group-hover/vbar:h-[5px]">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full bg-white"
                      style={{ width: `${(isMuted ? 0 : volume) * 100}%` }}
                    />
                  </div>
                  <div
                    className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-white shadow opacity-0 transition-opacity group-hover/vbar:opacity-100"
                    style={{ left: `${(isMuted ? 0 : volume) * 100}%`, transform: "translateX(-50%) translateY(-50%)" }}
                  />
                </div>
              </div>
            </div>

            {/* Time */}
            <span className="ml-1 shrink-0 tabular-nums text-xs font-medium text-white/70 sm:text-sm">
              {formatTime(currentTime)}
              <span className="mx-0.5 text-white/30">/</span>
              {formatTime(duration)}
            </span>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Settings (Quality / Speed) */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (settingsOpen && (settingsTab === "quality" || settingsTab === "speed")) {
                  setSettingsOpen(false);
                } else {
                  setSettingsTab("quality");
                  setSettingsOpen(true);
                }
                resetHideTimer();
              }}
              className="rounded-full p-1 transition hover:bg-white/10"
              style={settingsOpen && (settingsTab === "quality" || settingsTab === "speed") ? { color: NETFLIX_RED } : { color: "rgba(255,255,255,0.7)" }}
              aria-label="Quality and speed settings"
            >
              <MdSettings size={20} />
            </button>

            {/* CC / Subtitles button */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setSettingsTab("subtitles");
                setSettingsOpen((prev) => settingsTab === "subtitles" ? !prev : true);
                resetHideTimer();
              }}
              className={cn(
                "rounded-full p-1 transition hover:bg-white/10",
                settingsTab === "subtitles" && settingsOpen ? "text-white" : hasSubtitles && activeSubtitleId >= 0 ? "" : "text-white/50",
              )}
              style={settingsTab === "subtitles" && settingsOpen ? { color: NETFLIX_RED } : activeSubtitleId >= 0 && hasSubtitles ? { color: "white" } : undefined}
              aria-label="Subtitles"
              aria-pressed={activeSubtitleId >= 0}
            >
              {activeSubtitleId >= 0 ? <MdClosedCaption size={20} /> : <MdClosedCaptionDisabled size={20} />}
            </button>

            {/* Source selector */}
            {sources.length > 1 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSettingsTab("source");
                  setSettingsOpen((prev) => settingsTab === "source" ? !prev : true);
                  resetHideTimer();
                }}
                className={cn("rounded-full p-1.5 transition hover:bg-white/10")}
                style={settingsTab === "source" && settingsOpen ? { color: NETFLIX_RED } : undefined}
                aria-label="Select stream source"
              >
                <FaServer size={14} />
              </button>
            )}

            {/* Fullscreen */}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}
              className="rounded-full p-1 transition hover:bg-white/10"
              aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            >
              {isFullscreen ? <MdFullscreenExit size={22} /> : <MdFullscreen size={22} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

NetflixPlayer.displayName = "NetflixPlayer";

export default NetflixPlayer;