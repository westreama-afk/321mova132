"use client";

import SectionTitle from "@/components/ui/other/SectionTitle";
import { StreamedMatch, StreamedMatchSource, StreamedSport, StreamedStream } from "@/types/sports";
import { cn } from "@/utils/helpers";
import { Spinner } from "@heroui/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { IoRadioOutline, IoRefresh } from "react-icons/io5";

const STREAMED_BASE_URL = "https://streamed.pk";
const MATCH_POLL_INTERVAL_MS = 60000;

const FALLBACK_SPORTS: StreamedSport[] = [
  { id: "all", name: "All Sports" },
  { id: "football", name: "Football" },
  { id: "basketball", name: "Basketball" },
  { id: "american-football", name: "American Football" },
  { id: "fight", name: "Fight" },
  { id: "motor-sports", name: "Motor Sports" },
  { id: "tennis", name: "Tennis" },
];

const matchTimeFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const formatMatchTime = (timestamp: number): string => {
  try {
    return matchTimeFormatter.format(new Date(timestamp));
  } catch {
    return "Unknown time";
  }
};

const buildBadgeUrl = (badge?: string): string | null => {
  if (!badge) return null;
  return `${STREAMED_BASE_URL}/api/images/badge/${encodeURIComponent(badge)}.webp`;
};

const buildPosterUrl = (poster?: string): string | null => {
  if (!poster) return null;
  const normalizedPoster = poster.endsWith(".webp") ? poster : `${poster}.webp`;
  if (poster.startsWith("http://") || poster.startsWith("https://")) return poster;
  if (normalizedPoster.startsWith("/")) return `${STREAMED_BASE_URL}${normalizedPoster}`;
  return `${STREAMED_BASE_URL}/${normalizedPoster}`;
};

const isSameSource = (
  source: StreamedMatchSource | null,
  target: StreamedMatchSource | null,
): boolean => {
  if (!source || !target) return false;
  return source.id === target.id && source.source === target.source;
};

const LiveSports: React.FC = () => {
  const [sports, setSports] = useState<StreamedSport[]>(FALLBACK_SPORTS);
  const [selectedSport, setSelectedSport] = useState<string>("all");
  const [matches, setMatches] = useState<StreamedMatch[]>([]);
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<StreamedMatchSource | null>(null);
  const [streams, setStreams] = useState<StreamedStream[]>([]);
  const [selectedStreamNo, setSelectedStreamNo] = useState<number | null>(null);
  const [matchesLoading, setMatchesLoading] = useState(true);
  const [streamsLoading, setStreamsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [matchesError, setMatchesError] = useState<string | null>(null);
  const [streamsError, setStreamsError] = useState<string | null>(null);

  const selectedMatch = useMemo(
    () => matches.find((match) => match.id === selectedMatchId) || null,
    [matches, selectedMatchId],
  );

  const selectedStream = useMemo(() => {
    if (!streams.length) return null;
    if (selectedStreamNo === null) return streams[0] || null;
    return streams.find((stream) => stream.streamNo === selectedStreamNo) || streams[0] || null;
  }, [selectedStreamNo, streams]);

  const loadSports = useCallback(async () => {
    try {
      const response = await fetch("/api/sports/list", { cache: "no-store" });
      if (!response.ok) return;

      const payload = (await response.json()) as StreamedSport[];
      if (!Array.isArray(payload) || payload.length === 0) return;

      setSports([{ id: "all", name: "All Sports" }, ...payload]);
    } catch {
      // keep fallback categories
    }
  }, []);

  const loadMatches = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!options?.silent) {
        setMatchesLoading(true);
      }
      setMatchesError(null);

      try {
        const params = new URLSearchParams();
        if (selectedSport !== "all") {
          params.set("sport", selectedSport);
        }

        const query = params.toString();
        const response = await fetch(`/api/sports/live${query ? `?${query}` : ""}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(`Failed to load live matches (${response.status})`);
        }

        const payload = (await response.json()) as StreamedMatch[];
        if (!Array.isArray(payload)) {
          throw new Error("Invalid matches response");
        }

        payload.sort((a, b) => a.date - b.date);
        setMatches(payload);
      } catch (error) {
        setMatches([]);
        setMatchesError(error instanceof Error ? error.message : "Failed to load live matches");
      } finally {
        setMatchesLoading(false);
      }
    },
    [selectedSport],
  );

  const loadStreams = useCallback(async (source: StreamedMatchSource) => {
    setStreamsLoading(true);
    setStreamsError(null);

    try {
      const params = new URLSearchParams({
        source: source.source,
        id: source.id,
      });

      const response = await fetch(`/api/sports/stream?${params.toString()}`, {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`Failed to load streams (${response.status})`);
      }

      const payload = (await response.json()) as StreamedStream[];
      if (!Array.isArray(payload)) {
        throw new Error("Invalid streams response");
      }

      setStreams(payload);
      setSelectedStreamNo((previous) => {
        if (previous !== null && payload.some((stream) => stream.streamNo === previous)) {
          return previous;
        }

        return payload[0]?.streamNo ?? null;
      });
    } catch (error) {
      setStreams([]);
      setSelectedStreamNo(null);
      setStreamsError(error instanceof Error ? error.message : "Failed to load streams");
    } finally {
      setStreamsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSports();
  }, [loadSports]);

  useEffect(() => {
    void loadMatches();
  }, [loadMatches]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void loadMatches({ silent: true });
    }, MATCH_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [loadMatches]);

  useEffect(() => {
    if (!matches.length) {
      setSelectedMatchId(null);
      setSelectedSource(null);
      setStreams([]);
      setSelectedStreamNo(null);
      return;
    }

    const existingMatch = matches.find((match) => match.id === selectedMatchId);
    if (existingMatch) return;

    setSelectedMatchId(matches[0]?.id ?? null);
  }, [matches, selectedMatchId]);

  useEffect(() => {
    if (!selectedMatch || selectedMatch.sources.length === 0) {
      setSelectedSource(null);
      setStreams([]);
      setSelectedStreamNo(null);
      return;
    }

    const hasSelectedSource = selectedMatch.sources.some((source) => isSameSource(source, selectedSource));
    if (!hasSelectedSource) {
      setSelectedSource(selectedMatch.sources[0] || null);
    }
  }, [selectedMatch, selectedSource]);

  useEffect(() => {
    if (!selectedSource) return;
    void loadStreams(selectedSource);
  }, [loadStreams, selectedSource]);

  const onManualRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await loadMatches({ silent: true });
    setIsRefreshing(false);
  }, [loadMatches]);

  return (
    <div className="flex w-full flex-col gap-4 md:gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle size="h4" color="danger">
          Live Sports
        </SectionTitle>
        <button
          type="button"
          onClick={onManualRefresh}
          className={cn(
            "inline-flex min-h-11 items-center gap-2 rounded-xl border border-default-200 bg-content1 px-3 py-2 text-xs font-semibold transition hover:bg-content2 sm:text-sm",
            "max-[360px]:min-h-10 max-[360px]:px-2.5 max-[360px]:text-[11px]",
          )}
        >
          {isRefreshing ? <Spinner size="sm" color="current" /> : <IoRefresh className="size-4" />}
          <span>Refresh</span>
        </button>
      </div>

      <div className="overflow-x-auto">
        <div className="flex w-max min-w-full gap-2 pb-1">
          {sports.map((sport) => {
            const active = selectedSport === sport.id;

            return (
              <button
                key={sport.id}
                type="button"
                onClick={() => setSelectedSport(sport.id)}
                className={cn(
                  "min-h-11 rounded-xl border px-3 py-2 text-xs font-semibold transition sm:text-sm",
                  "max-[360px]:min-h-10 max-[360px]:px-2.5 max-[360px]:text-[11px]",
                  active
                    ? "border-danger-400 bg-danger-500/15 text-danger-300"
                    : "border-default-200 bg-content1 text-foreground/90 hover:bg-content2",
                )}
              >
                {sport.name}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,360px)_1fr]">
        <div className="order-2 space-y-3 xl:order-1">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground/80 max-[360px]:text-xs">
            Live Matches
          </h2>

          {matchesLoading ? (
            <div className="flex h-48 items-center justify-center rounded-xl border border-default-200 bg-content1">
              <Spinner color="danger" />
            </div>
          ) : matchesError ? (
            <div className="rounded-xl border border-danger-500/40 bg-danger-500/10 p-3 text-sm text-danger-200 max-[360px]:text-xs">
              {matchesError}
            </div>
          ) : matches.length === 0 ? (
            <div className="rounded-xl border border-default-200 bg-content1 p-4 text-sm text-foreground/70 max-[360px]:text-xs">
              No live matches available right now for this sport.
            </div>
          ) : (
            <div className="max-h-[70vh] space-y-2 overflow-y-auto pr-1">
              {matches.map((match) => {
                const isActive = match.id === selectedMatchId;
                const homeName = match.teams?.home?.name;
                const awayName = match.teams?.away?.name;
                const homeBadge = buildBadgeUrl(match.teams?.home?.badge);
                const awayBadge = buildBadgeUrl(match.teams?.away?.badge);
                const posterUrl = buildPosterUrl(match.poster);

                return (
                  <button
                    key={match.id}
                    type="button"
                    onClick={() => setSelectedMatchId(match.id)}
                    className={cn(
                      "w-full rounded-xl border p-3 text-left transition",
                      isActive
                        ? "border-danger-400 bg-danger-500/12"
                        : "border-default-200 bg-content1 hover:bg-content2",
                    )}
                  >
                    <div className="flex items-start gap-3">
                      {posterUrl ? (
                        <img
                          src={posterUrl}
                          alt={match.title}
                          loading="lazy"
                          className="hidden h-16 w-24 rounded-lg object-cover sm:block"
                        />
                      ) : null}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-foreground max-[360px]:text-[11px]">
                          {match.title}
                        </p>
                        <p className="mt-1 text-xs text-foreground/70 max-[360px]:text-[10px]">
                          {formatMatchTime(match.date)}
                        </p>
                        <div className="mt-2 flex flex-col gap-1 text-xs text-foreground/85 max-[360px]:text-[10px]">
                          {homeName ? (
                            <span className="flex items-center gap-1.5 truncate">
                              {homeBadge ? (
                                <img
                                  src={homeBadge}
                                  alt={homeName}
                                  loading="lazy"
                                  className="size-4 rounded-full object-cover"
                                />
                              ) : null}
                              {homeName}
                            </span>
                          ) : null}
                          {awayName ? (
                            <span className="flex items-center gap-1.5 truncate">
                              {awayBadge ? (
                                <img
                                  src={awayBadge}
                                  alt={awayName}
                                  loading="lazy"
                                  className="size-4 rounded-full object-cover"
                                />
                              ) : null}
                              {awayName}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="order-1 space-y-3 xl:order-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground/80 max-[360px]:text-xs">
            Watch
          </h2>

          <div className="overflow-hidden rounded-xl border border-default-200 bg-black">
            {selectedStream?.embedUrl ? (
              <iframe
                allowFullScreen
                src={selectedStream.embedUrl}
                title={selectedMatch?.title || "Live Sports Stream"}
                className="aspect-video w-full min-h-[210px] max-[360px]:min-h-[190px]"
              />
            ) : (
              <div className="flex aspect-video min-h-[210px] w-full items-center justify-center p-4 text-center text-sm text-default-300 max-[360px]:min-h-[190px] max-[360px]:text-xs">
                Select a match to load available streams.
              </div>
            )}
          </div>

          {selectedMatch ? (
            <div className="space-y-2 rounded-xl border border-default-200 bg-content1 p-3">
              <p className="truncate text-sm font-semibold text-foreground max-[360px]:text-xs">
                {selectedMatch.title}
              </p>
              <p className="text-xs text-foreground/70 max-[360px]:text-[10px]">
                {formatMatchTime(selectedMatch.date)}
              </p>
              <div className="flex flex-wrap gap-2">
                {selectedMatch.sources.map((source, index) => {
                  const active = isSameSource(source, selectedSource);

                  return (
                    <button
                      key={`${source.source}-${source.id}-${index}`}
                      type="button"
                      onClick={() => setSelectedSource(source)}
                      className={cn(
                        "min-h-11 rounded-lg border px-3 py-2 text-xs font-semibold transition max-[360px]:min-h-10 max-[360px]:text-[11px]",
                        active
                          ? "border-primary-400 bg-primary-500/15 text-primary-300"
                          : "border-default-200 bg-content2 text-foreground/85 hover:bg-content3",
                      )}
                    >
                      {source.source.toUpperCase()}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="space-y-2 rounded-xl border border-default-200 bg-content1 p-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground max-[360px]:text-xs">
              <IoRadioOutline className="text-success-400" />
              <span>Available Streams</span>
            </div>

            {streamsLoading ? (
              <div className="flex min-h-16 items-center justify-center">
                <Spinner size="sm" color="success" />
              </div>
            ) : streamsError ? (
              <div className="rounded-lg border border-danger-500/40 bg-danger-500/10 p-2 text-xs text-danger-200">
                {streamsError}
              </div>
            ) : streams.length === 0 ? (
              <p className="text-xs text-foreground/70 max-[360px]:text-[10px]">No streams returned yet.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {streams.map((stream) => {
                  const active = selectedStreamNo === stream.streamNo;

                  return (
                    <button
                      key={`${stream.id}-${stream.streamNo}`}
                      type="button"
                      onClick={() => setSelectedStreamNo(stream.streamNo)}
                      className={cn(
                        "min-h-11 rounded-lg border px-2 py-2 text-left text-xs transition max-[360px]:min-h-10 max-[360px]:text-[11px]",
                        active
                          ? "border-success-400 bg-success-500/15 text-success-200"
                          : "border-default-200 bg-content2 text-foreground/90 hover:bg-content3",
                      )}
                    >
                      <p className="truncate font-semibold">Stream {stream.streamNo}</p>
                      <p className="truncate text-[10px] text-foreground/70 max-[360px]:text-[9px]">
                        {stream.language || "Unknown"}
                        {stream.hd ? " • HD" : ""}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default LiveSports;
