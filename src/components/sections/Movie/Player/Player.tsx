import { ADS_WARNING_STORAGE_KEY, SpacingClasses } from "@/utils/constants";
import { siteConfig } from "@/config/site";
import useBreakpoints from "@/hooks/useBreakpoints";
import { cn } from "@/utils/helpers";
import { mutateMovieTitle } from "@/utils/movies";
import { getMoviePlayers } from "@/utils/players";
import { Card, Skeleton } from "@heroui/react";
import { useDisclosure, useDocumentTitle, useIdle, useLocalStorage } from "@mantine/hooks";
import dynamic from "next/dynamic";
import { parseAsInteger, useQueryState } from "nuqs";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MovieDetails } from "tmdb-ts/dist/types/movies";
import { usePlayerEvents } from "@/hooks/usePlayerEvents";
import useSupabaseUser from "@/hooks/useSupabaseUser";
import useAdBlockDetector from "@/hooks/useAdBlockDetector";
import { isPremiumUser } from "@/utils/billing/premium";
import { createPartyRoom } from "@/actions/party";
import { useRouter } from "next/navigation";
const AdsWarning = dynamic(() => import("@/components/ui/overlay/AdsWarning"));
const PlayerAccessNotice = dynamic(() => import("@/components/ui/overlay/PlayerAccessNotice"));
const HlsJsonPlayer = dynamic(() => import("@/components/ui/player/HlsJsonPlayer"));
const NetflixPlayer = dynamic(() => import("@/components/ui/player/NetflixPlayer"));
const MoviePlayerHeader = dynamic(() => import("./Header"));
const MoviePlayerSourceSelection = dynamic(() => import("./SourceSelection"));

interface MoviePlayerProps {
  movie: MovieDetails;
  startAt?: number;
}

const MoviePlayer: React.FC<MoviePlayerProps> = ({ movie, startAt }) => {
  const router = useRouter();
  const [seen] = useLocalStorage<boolean>({
    key: ADS_WARNING_STORAGE_KEY,
    getInitialValueInEffect: false,
  });

  const { data: user, isLoading: isUserLoading } = useSupabaseUser();
  const isPremium = isPremiumUser(user);

  const allPlayers = useMemo(() => getMoviePlayers(movie.id, startAt), [movie.id, startAt]);
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

  const title = mutateMovieTitle(movie);
  const idle = useIdle(3000);
  const { mobile } = useBreakpoints();
  const [opened, handlers] = useDisclosure(false);
  const [selectedSource, setSelectedSource] = useQueryState<number>(
    "src",
    parseAsInteger.withDefault(0),
  );
  const [streamSourceMenuSignal, setStreamSourceMenuSignal] = useState(0);
  const [partyCreating, setPartyCreating] = useState(false);

  usePlayerEvents({ saveHistory: true, trackUiState: false, media: { id: movie.id, type: "movie" } });
  useDocumentTitle(`Play ${title} | ${siteConfig.name}`);

  useEffect(() => {
    setDismissedPlayerNotice(false);
  }, [missing321Requirements.join("|")]);

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
      mediaId: movie.id,
      mediaType: "movie",
      mediaTitle: movie.title,
      mediaPoster: movie.poster_path
        ? `https://image.tmdb.org/t/p/w185${movie.poster_path}`
        : undefined,
    });
    setPartyCreating(false);
    if (res.success && res.data) router.push(`/party/${res.data.code}`);
  }, [partyCreating, movie, router]);

  return (
    <>
      <AdsWarning />
      <PlayerAccessNotice
        isOpen={missing321Requirements.length > 0 && !dismissedPlayerNotice}
        onClose={() => setDismissedPlayerNotice(true)}
        missingRequirements={missing321Requirements}
      />

      <div className={cn("relative overflow-hidden", SpacingClasses.reset)}>
        <MoviePlayerHeader
          id={movie.id}
          movieName={title}
          onOpenSource={handlers.open}
          onOpenServer={showServerButton ? handleOpenStreamSourceMenu : undefined}
          showServerButton={showServerButton}
          hidden={idle && !mobile}
          onStartParty={showServerButton ? handleStartParty : undefined}
          partyCreating={partyCreating}
        />
        <Card shadow="md" radius="none" className="relative h-screen overflow-hidden">
          <Skeleton className="absolute h-full w-full" />
          {seen && (
            PLAYER.mode === "playlist_json" ? (
              <HlsJsonPlayer
                key={PLAYER.source}
                playlistUrl={PLAYER.source}
                mediaId={movie.id}
                mediaType="movie"
                disableVastAds={isPremium}
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
                mediaId={movie.id}
                mediaType="movie"
                startAt={startAt}
                onFatalError={handlePrimaryPlayerError}
                className="absolute inset-0 z-10 h-full w-full"
                openSourceMenuSignal={streamSourceMenuSignal}
                backdropUrl={movie.backdrop_path ? `https://image.tmdb.org/t/p/w1280${movie.backdrop_path}` : undefined}
                title={title}
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
        </Card>
      </div>

      <MoviePlayerSourceSelection
        opened={opened}
        onClose={handlers.close}
        players={players}
        selectedSource={selectedSource}
        setSelectedSource={setSelectedSource}
      />
    </>
  );
};

MoviePlayer.displayName = "MoviePlayer";

export default MoviePlayer;
