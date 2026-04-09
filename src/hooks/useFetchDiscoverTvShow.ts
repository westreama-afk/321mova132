"use client";

import { tmdb } from "@/api/tmdb";
import { DiscoverTvShowsFetchQueryType } from "@/types/movie";
import { TvShowDiscoverResult } from "tmdb-ts/dist/types/discover";

interface FetchDiscoverTvShows {
  page?: number;
  type?: DiscoverTvShowsFetchQueryType;
  genres?: string;
  sortBy?: string;
  year?: number;
  minRating?: number;
}

const useFetchDiscoverTvShows = ({
  page = 1,
  type = "discover",
  genres,
  sortBy = "popularity.desc",
  year,
  minRating,
}: FetchDiscoverTvShows): Promise<TvShowDiscoverResult> => {
  const tvSortBy =
    sortBy === "release_date.desc" ? "first_air_date.desc" :
    sortBy === "release_date.asc" ? "first_air_date.asc" : sortBy;
  const discover = () =>
    tmdb.discover.tvShow({
      page,
      with_genres: genres,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sort_by: tvSortBy as any,
      ...(year ? { first_air_date_year: year } : {}),
      ...(minRating ? { "vote_average.gte": minRating } : {}),
    });
  const todayTrending = () => tmdb.trending.trending("tv", "day", { page: page });
  const thisWeekTrending = () => tmdb.trending.trending("tv", "week", { page: page });
  const popular = () => tmdb.tvShows.popular({ page: page });
  const onTheAir = () => tmdb.tvShows.onTheAir({ page: page });
  const topRated = () => tmdb.tvShows.topRated({ page: page });

  const queryData = {
    discover,
    todayTrending,
    thisWeekTrending,
    popular,
    onTheAir,
    topRated,
  }[type];

  // @ts-expect-error: Property 'adult' is missing in type 'PopularTvShowResult' but required in type 'TV'.
  return queryData();
};

export default useFetchDiscoverTvShows;
