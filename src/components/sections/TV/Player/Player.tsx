import { siteConfig } from "@/config/site";
import { cn } from "@/utils/helpers";
import { getTvShowPlayers } from "@/utils/players";
import { Card, Skeleton } from "@heroui/react";
import { useDisclosure, useDocumentTitle, useIdle, useLocalStorage } from "@mantine/hooks";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { parseAsInteger, useQueryState } from "nuqs";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Episode, TvShowDetails } from "tmdb-ts";
import useBreakpoints from "@/hooks/useBreakpoints";
import { ADS_WARNING_STORAGE_KEY, SpacingClasses } from "@/utils/constants";
import { usePlayerEvents } from "@/hooks/usePlayerEvents";
import useSupabaseUser from "@/hooks/useSupabaseUser";
import useAdBlockDetector from "@/hooks/useAdBlockDetector";
import { isPremiumUser } from "@/utils/billing/premium";
import { createPartyRoom } from "@/actions/party";
const AdsWarning = dynamic(() => import("@/components/ui/overlay/AdsWarning"));
const PlayerAccessNotice = dynamic(() => import("@/components/ui/overlay/PlayerAccessNotice"));
const HlsJsonPlayer = dynamic(() => import("@/components/ui/player/HlsJsonPlayer"));
const NetflixPlayer = dynamic(() => import("@/components/ui/player/NetflixPlayer"));
const TvShowPlayerHeader = dynamic(() => import("./Header"));
const TvShowPlayerSourceSelection = dynamic(() => import("./SourceSelection"));
const TvShowPlayerEpisodeSelection = dynamic(() => import("./EpisodeSelection"));

const AUTO_NEXT_STORAGE_KEY = "TV_PLAYER_AUTO_NEXT_ENABLED";
const AUTO_NEXT_TRIGGER_REMAINING_SECONDS = 90;
const AUTO_NEXT_FALLBACK_DELAY_SECONDS = 5;

export interface TvShowPlayerProps {
  tv: TvShowDetails;
  id: number;
  seriesName: string;
  seasonName: string;
  episode: Episode;
  episodes: Episode[];
  nextEpisodeNumber: number | null;
  prevEpisodeNumber: number | null;
  startAt?: number;
}

const TvShowPlayer: React.FC<TvShowPlayerProps> = ({
  tv,
  id,
  episode,
  episodes,
  startAt,
  ...props
}) => {
  const router = useRouter();
  const [seen] = useLocalStorage<boolean>({
    key: ADS_WARNING_STORAGE_KEY,
    getInitialValueInEffect: false,
  });
  const [isAutoNextEnabled, setIsAutoNextEnabled] = useLocalStorage<boolean>({
    key: AUTO_NEXT_STORAGE_KEY,
    defaultValue: true,
    getInitialValueInEffect: false,
  });

  const { data: user, isLoading: isUserLoading } = useSupabaseUser();
  const isPremium = isPremiumUser(user);

  const { mobile } = useBreakpoints();
  const allPlayers = useMemo(
    () => getTvShowPlayers(id, episode.season_number, episode.episode_number, startAt),
    [episode.episode_number, episode.season_number, id, startAt],
  );
  const { isAdBlockDetected, isChecking: isAdBlockChecking } = useAdBlockDetector();
  const canUse321Player =
    !isUserLoading &&
    (isPremium || (!isAdBlockChecking && !isAdBlockDetected));
  const missing321Requirements = useMemo(() => {
    if (isUserLoading || isAdBlockChecking) return [];
    const missing: string[] = [];
    if (!isPremium && isAdBlockDetected) missing.push("Disable your ad blocker for this site.");
    return missing;
  }, [isAdBlockChecking, isAdBlockDetected, isPremium, isUserLoading]);
  const players = useMemo(() => {
    if (canUse321Player) return allPlayers;

    const filteredPlayers = allPlayers.filter(
      (player) => player.mode !== "playlist_json" && player.mode !== "native_hls",
    );
    return filteredPlayers.length > 0 ? filteredPlayers : allPlayers;
  }, [allPlayers, canUse321Player]);
  const [dismissedPlayerNotice, setDismissedPlayerNotice] = useState(false);

  const idle = useIdle(3000);
  const [sourceOpened, sourceHandlers] = useDisclosure(false);
  const [episodeOpened, episodeHandlers] = useDisclosure(false);
  const [selectedSource, setSelectedSource] = useQueryState<number>(
    "src",
    parseAsInteger.withDefault(0),
  );
  const [streamSourceMenuSignal, setStreamSourceMenuSignal] = useState(0);
  const [partyCreating, setPartyCreating] = useState(false);
  const [autoNextCountdown, setAutoNextCountdown] = useState<number | null>(null);
  const hasAutoNextNavigatedRef = useRef(false);
  const autoNextSuppressedRef = useRef(false);
  const nextEpisodeHrefRef = useRef<string | null>(null);
  const isAutoNextEnabledRef = useRef(true);
  const autoNextCountdownRef = useRef<number | null>(null);

  const nextEpisodeHref = useMemo(() => {
    if (!props.nextEpisodeNumber) return null;
    return `/tv/${id}/${episode.season_number}/${props.nextEpisodeNumber}/player?src=${selectedSource}`;
  }, [episode.season_number, id, props.nextEpisodeNumber, selectedSource]);

  const nextEpisodeName = useMemo(() => {
    if (!props.nextEpisodeNumber) return null;
    return episodes.find((item) => item.episode_number === props.nextEpisodeNumber)?.name || null;
  }, [episodes, props.nextEpisodeNumber]);

  useEffect(() => {
    nextEpisodeHrefRef.current = nextEpisodeHref;
  }, [nextEpisodeHref]);

  useEffect(() => {
    isAutoNextEnabledRef.current = Boolean(isAutoNextEnabled);
  }, [isAutoNextEnabled]);

  useEffect(() => {
    autoNextCountdownRef.current = autoNextCountdown;
  }, [autoNextCountdown]);

  const cancelAutoNext = useCallback(() => {
    autoNextSuppressedRef.current = true;
    autoNextCountdownRef.current = null;
    setAutoNextCountdown(null);
  }, []);

  const goToNextEpisode = useCallback(() => {
    const href = nextEpisodeHrefRef.current;
    if (!href) return;
    if (hasAutoNextNavigatedRef.current) return;

    hasAutoNextNavigatedRef.current = true;
    autoNextCountdownRef.current = null;
    setAutoNextCountdown(null);
    router.push(href);
  }, [router]);

  const maybeStartAutoNext = useCallback((remainingSeconds?: number) => {
    if (hasAutoNextNavigatedRef.current) return;
    if (autoNextSuppressedRef.current) return;
    if (!isAutoNextEnabledRef.current) return;
    if (!nextEpisodeHrefRef.current) return;
    if (autoNextCountdownRef.current !== null) return;

    const rawCountdown =
      typeof remainingSeconds === "number" && Number.isFinite(remainingSeconds)
        ? Math.ceil(remainingSeconds)
        : AUTO_NEXT_FALLBACK_DELAY_SECONDS;
    const nextCountdown = Math.max(
      1,
      Math.min(rawCountdown, AUTO_NEXT_TRIGGER_REMAINING_SECONDS),
    );

    autoNextCountdownRef.current = nextCountdown;
    setAutoNextCountdown(nextCountdown);
  }, []);

  usePlayerEvents({
    saveHistory: true,
    trackUiState: false,
    media: { id, type: "tv" },
    metadata: { season: episode.season_number, episode: episode.episode_number },
    onPlay: cancelAutoNext,
    onTimeUpdate: (data) => {
      const duration = Number(data.duration);
      const currentTime = Number(data.currentTime);
      if (!Number.isFinite(duration) || duration <= 0) return;
      if (!Number.isFinite(currentTime) || currentTime < 0) return;

      const remaining = duration - currentTime;
      if (remaining <= AUTO_NEXT_TRIGGER_REMAINING_SECONDS && remaining > 0) {
        maybeStartAutoNext(remaining);
      }
    },
    onEnded: () => {
      if (autoNextCountdownRef.current !== null) {
        goToNextEpisode();
        return;
      }

      maybeStartAutoNext(AUTO_NEXT_FALLBACK_DELAY_SECONDS);
    },
  });
  useDocumentTitle(
    `Play ${props.seriesName} - ${props.seasonName} - ${episode.name} | ${siteConfig.name}`,
  );

  useEffect(() => {
    setDismissedPlayerNotice(false);
  }, [missing321Requirements.join("|")]);

  useEffect(() => {
    hasAutoNextNavigatedRef.current = false;
    autoNextSuppressedRef.current = false;
    autoNextCountdownRef.current = null;
    setAutoNextCountdown(null);
  }, [episode.episode_number, episode.season_number, id]);

  useEffect(() => {
    if (autoNextCountdown === null) return;
    if (!nextEpisodeHref || !isAutoNextEnabled) {
      autoNextCountdownRef.current = null;
      setAutoNextCountdown(null);
      return;
    }

    if (autoNextCountdown <= 0) {
      goToNextEpisode();
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setAutoNextCountdown((current) => {
        if (current === null) return null;
        return Math.max(current - 1, 0);
      });
    }, 1000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [autoNextCountdown, goToNextEpisode, isAutoNextEnabled, nextEpisodeHref]);

  useEffect(() => {
    if (!players.length) return;
    if (selectedSource < players.length) return;
    void setSelectedSource(0);
  }, [players.length, selectedSource, setSelectedSource]);

  const PLAYER = useMemo(() => players[selectedSource] || players[0], [players, selectedSource]);
  const isPlaylistJsonPlayer = PLAYER.mode === "playlist_json";
  const isNativeHlsPlayer = PLAYER.mode === "native_hls";
  const showServerButton = isPlaylistJsonPlayer || isNativeHlsPlayer;
  const handlePrimaryPlayerError = useCallback(() => {
    const fallbackIndex = players.findIndex((_, index) => index > selectedSource);
    if (fallbackIndex < 0) return;
    void setSelectedSource(fallbackIndex);
  }, [players, selectedSource, setSelectedSource]);
  const handleOpenStreamSourceMenu = useCallback(() => {
    setStreamSourceMenuSignal((value) => value + 1);
  }, []);

  const handleStartParty = useCallback(async () => {
    if (partyCreating) return;
    setPartyCreating(true);
    const res = await createPartyRoom({
      mediaId: id,
      mediaType: "tv",
      mediaTitle: props.seriesName,
      mediaPoster: tv.poster_path
        ? `https://image.tmdb.org/t/p/w185${tv.poster_path}`
        : undefined,
      season: episode.season_number,
      episode: episode.episode_number,
    });
    setPartyCreating(false);
    if (res.success && res.data) router.push(`/party/${res.data.code}`);
  }, [partyCreating, id, tv, episode, props.seriesName, router]);

  return (
    <>
      <AdsWarning />
      <PlayerAccessNotice
        isOpen={missing321Requirements.length > 0 && !dismissedPlayerNotice}
        onClose={() => setDismissedPlayerNotice(true)}
        missingRequirements={missing321Requirements}
      />

      <div className={cn("relative overflow-hidden", SpacingClasses.reset)}>
        <TvShowPlayerHeader
          id={id}
          episode={episode}
          hidden={idle && !mobile}
          selectedSource={selectedSource}
          onOpenSource={sourceHandlers.open}
          onOpenServer={showServerButton ? handleOpenStreamSourceMenu : undefined}
          showServerButton={showServerButton}
          onOpenEpisode={episodeHandlers.open}
          onStartParty={showServerButton ? handleStartParty : undefined}
          partyCreating={partyCreating}
          {...props}
        />

        <Card shadow="md" radius="none" className="relative h-screen overflow-hidden">
          <Skeleton className="absolute h-full w-full" />
          {seen && (
            PLAYER.mode === "playlist_json" ? (
              <HlsJsonPlayer
                key={PLAYER.source}
                playlistUrl={PLAYER.source}
                mediaId={id}
                mediaType="tv"
                disableVastAds={isPremium}
                season={episode.season_number}
                episode={episode.episode_number}
                startAt={startAt}
                onFatalError={handlePrimaryPlayerError}
                className="absolute inset-0 z-10 h-full w-full"
                showFloatingSourceButton={false}
                openSourceMenuSignal={streamSourceMenuSignal}
              />
            ) : PLAYER.mode === "native_hls" ? (
              <NetflixPlayer
                key={PLAYER.source}
                playlistUrl={PLAYER.source}
                mediaId={id}
                mediaType="tv"
                season={episode.season_number}
                episode={episode.episode_number}
                startAt={startAt}
                onFatalError={handlePrimaryPlayerError}
                className="absolute inset-0 z-10 h-full w-full"
                openSourceMenuSignal={streamSourceMenuSignal}
              />
            ) : (
              <iframe
                allowFullScreen
                key={PLAYER.title}
                src={PLAYER.source}
                className={cn("absolute inset-0 z-10 h-full w-full", {
                  "pointer-events-none": idle && !mobile,
                })}
              />
            )
          )}

          {autoNextCountdown !== null && nextEpisodeHref ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-16 z-[10120] flex justify-center px-3 sm:bottom-20">
              <div className="pointer-events-auto flex w-full max-w-lg items-center justify-between gap-3 rounded-xl border border-sky-200/35 bg-[#071022]/92 px-3 py-2 text-white shadow-[0_14px_40px_rgba(0,0,0,0.45)] backdrop-blur">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold sm:text-base">Up next in {autoNextCountdown}s</p>
                  <p className="truncate text-xs text-white/75 sm:text-sm">
                    {nextEpisodeName || `Episode ${props.nextEpisodeNumber}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={cancelAutoNext}
                    className="rounded-lg border border-white/25 px-2.5 py-1.5 text-xs font-semibold text-white/90 transition hover:bg-white/10"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={goToNextEpisode}
                    className="rounded-lg border border-sky-300/50 bg-gradient-to-r from-blue-600 to-cyan-500 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:brightness-110"
                  >
                    Play Now
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </Card>
      </div>

      <TvShowPlayerSourceSelection
        opened={sourceOpened}
        onClose={sourceHandlers.close}
        players={players}
        selectedSource={selectedSource}
        setSelectedSource={setSelectedSource}
      />
      <TvShowPlayerEpisodeSelection
        id={id}
        opened={episodeOpened}
        onClose={episodeHandlers.close}
        episodes={episodes}
      />
    </>
  );
};

export default memo(TvShowPlayer);
