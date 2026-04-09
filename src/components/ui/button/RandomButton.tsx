"use client";

import { tmdb } from "@/api/tmdb";
import { Button, Tooltip } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { PiShuffleBold } from "react-icons/pi";

const RandomButton: React.FC = () => {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const goRandom = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      // Randomly pick movies or TV shows
      const isMovie = Math.random() < 0.5;
      // Pick a random page from the first 20 popular pages (400 candidates)
      const page = Math.floor(Math.random() * 20) + 1;

      let id: number | undefined;
      if (isMovie) {
        const res = await tmdb.movies.popular({ page });
        const results = res.results.filter((m) => m.poster_path);
        if (results.length > 0) {
          id = results[Math.floor(Math.random() * results.length)].id;
        }
      } else {
        const res = await tmdb.tvShows.popular({ page });
        const results = res.results.filter((t) => t.poster_path);
        if (results.length > 0) {
          id = results[Math.floor(Math.random() * results.length)].id;
        }
      }

      if (id) {
        router.push(isMovie ? `/movie/${id}` : `/tv/${id}`);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [loading, router]);

  return (
    <Tooltip content="Random movie or show" placement="left">
      <Button
        isIconOnly
        variant="light"
        className="p-2"
        onPress={goRandom}
        isLoading={loading}
        aria-label="Random movie or show"
      >
        {!loading && <PiShuffleBold className="size-full" />}
      </Button>
    </Tooltip>
  );
};

export default RandomButton;
