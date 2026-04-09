"use client";

import { createPartyRoom } from "@/actions/party";
import { tmdb } from "@/api/tmdb";
import useSupabaseUser from "@/hooks/useSupabaseUser";
import { ContentType } from "@/types";
import { Button, Input, Spinner, Image, Chip } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Movie, TV } from "tmdb-ts/dist/types";
import { useDebouncedValue } from "@mantine/hooks";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/utils/helpers";

type SearchResult = { id: number; title: string; poster_path: string | null; type: ContentType; release_date?: string };

export default function CreatePartyPage() {
  const router = useRouter();
  const { data: user, isLoading: isUserLoading } = useSupabaseUser();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [season, setSeason] = useState("");
  const [episode, setEpisode] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const [debouncedQuery] = useDebouncedValue(query, 350);

  const { data: results = [], isFetching } = useQuery({
    queryKey: ["party-search", debouncedQuery],
    queryFn: async () => {
      if (!debouncedQuery.trim()) return [];
      const [movies, tvShows] = await Promise.all([
        tmdb.search.movies({ query: debouncedQuery }),
        tmdb.search.tvShows({ query: debouncedQuery }),
      ]);
      const movieResults: SearchResult[] = (movies.results ?? []).slice(0, 5).map((m: Movie) => ({
        id: m.id,
        title: m.title,
        poster_path: m.poster_path,
        type: "movie" as ContentType,
        release_date: m.release_date,
      }));
      const tvResults: SearchResult[] = (tvShows.results ?? []).slice(0, 5).map((t: TV) => ({
        id: t.id,
        title: t.name,
        poster_path: t.poster_path,
        type: "tv" as ContentType,
        release_date: t.first_air_date,
      }));
      return [...movieResults, ...tvResults];
    },
    enabled: debouncedQuery.trim().length > 1,
    staleTime: 1000 * 30,
  });

  const handleCreate = async () => {
    if (!selected) return;
    setCreating(true);
    setError("");

    const s = selected.type === "tv" ? (parseInt(season) || 1) : undefined;
    const e = selected.type === "tv" ? (parseInt(episode) || 1) : undefined;

    const res = await createPartyRoom({
      mediaId: selected.id,
      mediaType: selected.type,
      mediaTitle: selected.title,
      mediaPoster: selected.poster_path
        ? `https://image.tmdb.org/t/p/w185${selected.poster_path}`
        : undefined,
      season: s,
      episode: e,
    });

    if (!res.success || !res.data) {
      setError(res.message ?? "Failed to create room.");
      setCreating(false);
      return;
    }

    router.push(`/party/${res.data.code}`);
  };

  if (isUserLoading) return <Spinner size="lg" className="absolute-center" variant="simple" />;

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 px-4">
        <p className="text-lg font-semibold">Sign in to create a watch party</p>
        <Button color="primary" onPress={() => router.push("/auth")}>Sign In</Button>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-10 flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Create a Watch Party</h1>
        <p className="text-default-500 text-sm mt-1">Search for a movie or TV show to watch together.</p>
      </div>

      <Input
        placeholder="Search movies or TV shows..."
        value={query}
        onValueChange={(v) => { setQuery(v); setSelected(null); }}
        isClearable
        onClear={() => { setQuery(""); setSelected(null); }}
        endContent={isFetching ? <Spinner size="sm" variant="simple" /> : null}
      />

      {/* Search results */}
      {!selected && results.length > 0 && (
        <div className="flex flex-col gap-2">
          {results.map((r) => (
            <button
              key={`${r.type}-${r.id}`}
              onClick={() => { setSelected(r); setQuery(""); }}
              className={cn(
                "flex items-center gap-3 p-3 rounded-xl border border-default-200",
                "hover:bg-default-100 text-left transition-colors",
              )}
            >
              {r.poster_path ? (
                <Image
                  src={`https://image.tmdb.org/t/p/w92${r.poster_path}`}
                  alt={r.title}
                  width={40}
                  height={60}
                  className="rounded-md object-cover flex-shrink-0"
                />
              ) : (
                <div className="w-10 h-15 bg-default-200 rounded-md flex-shrink-0" />
              )}
              <div className="flex flex-col gap-1 min-w-0">
                <span className="font-medium truncate">{r.title}</span>
                <div className="flex items-center gap-2">
                  <Chip size="sm" variant="flat" color={r.type === "movie" ? "primary" : "secondary"}>
                    {r.type === "movie" ? "Movie" : "TV"}
                  </Chip>
                  {r.release_date && (
                    <span className="text-xs text-default-400">{r.release_date.slice(0, 4)}</span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Selected media */}
      {selected && (
        <div className="flex items-center gap-3 p-3 rounded-xl border border-primary-400 bg-primary-50/10">
          {selected.poster_path && (
            <Image
              src={`https://image.tmdb.org/t/p/w92${selected.poster_path}`}
              alt={selected.title}
              width={40}
              height={60}
              className="rounded-md object-cover flex-shrink-0"
            />
          )}
          <div className="flex-1 min-w-0">
            <p className="font-semibold truncate">{selected.title}</p>
            <Chip size="sm" variant="flat" color={selected.type === "movie" ? "primary" : "secondary"}>
              {selected.type === "movie" ? "Movie" : "TV"}
            </Chip>
          </div>
          <Button size="sm" variant="light" onPress={() => setSelected(null)}>Change</Button>
        </div>
      )}

      {/* TV season/episode */}
      {selected?.type === "tv" && (
        <div className="flex gap-3">
          <Input
            label="Season"
            type="number"
            min={1}
            value={season}
            onValueChange={setSeason}
            placeholder="1"
          />
          <Input
            label="Episode"
            type="number"
            min={1}
            value={episode}
            onValueChange={setEpisode}
            placeholder="1"
          />
        </div>
      )}

      {error && <p className="text-danger-500 text-sm">{error}</p>}

      <Button
        color="primary"
        size="lg"
        isDisabled={!selected || creating}
        isLoading={creating}
        onPress={handleCreate}
      >
        Create Room
      </Button>
    </div>
  );
}
