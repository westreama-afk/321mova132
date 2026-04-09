"use client";

import { tmdb } from "@/api/tmdb";
import { DiscoverMoviesFetchQueryType } from "@/types/movie";
import { MovieDiscoverResult } from "tmdb-ts/dist/types/discover";

interface FetchDiscoverMovies {
  page?: number;
  type?: DiscoverMoviesFetchQueryType;
  genres?: string;
  sortBy?: string;
  year?: number;
  minRating?: number;
}

const useFetchDiscoverMovies = ({
  page = 1,
  type = "discover",
  genres,
  sortBy = "popularity.desc",
  year,
  minRating,
}: FetchDiscoverMovies): Promise<MovieDiscoverResult> => {
  const discover = () =>
    tmdb.discover.movie({
      page,
      with_genres: genres,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sort_by: sortBy as any,
      ...(year ? { primary_release_year: year } : {}),
      ...(minRating ? { "vote_average.gte": minRating } : {}),
    });
  const todayTrending = () => tmdb.trending.trending("movie", "day", { page: page });
  const thisWeekTrending = () => tmdb.trending.trending("movie", "week", { page: page });
  const popular = () => tmdb.movies.popular({ page: page });
  const nowPlaying = () => tmdb.movies.nowPlaying({ page: page });
  const upcoming = () => tmdb.movies.upcoming({ page: page });
  const topRated = () => tmdb.movies.topRated({ page: page });

  const queryData = {
    discover,
    todayTrending,
    thisWeekTrending,
    popular,
    nowPlaying,
    upcoming,
    topRated,
  }[type];

  return queryData();
};

export default useFetchDiscoverMovies;
