import { queryClient as q } from "@/app/providers";
import { siteConfig } from "@/config/site";
import { DISCOVER_MOVIES_VALID_QUERY_TYPES, DISCOVER_TVS_VALID_QUERY_TYPES, DISCOVER_SORT_OPTIONS, DiscoverSortOption } from "@/types/movie";
import { parseAsSet } from "@/utils/parsers";
import { useQueryState, parseAsStringLiteral, parseAsInteger } from "nuqs";
import { useCallback, useMemo, useEffect } from "react";

const VALID_CONTENT_TYPES = ["movie", "tv"] as const;
const DEFAULT_QUERY_TYPE = "discover";

const useDiscoverFilters = () => {
  const { movies, tvShows } = siteConfig.queryLists;

  const [genres, setGenres] = useQueryState("genres", parseAsSet.withDefault(new Set([])));
  const [queryType, setQueryType] = useQueryState(
    "type",
    parseAsStringLiteral([
      ...DISCOVER_MOVIES_VALID_QUERY_TYPES,
      ...DISCOVER_TVS_VALID_QUERY_TYPES,
    ]).withDefault(DEFAULT_QUERY_TYPE),
  );
  const [content, setContent] = useQueryState(
    "content",
    parseAsStringLiteral(VALID_CONTENT_TYPES).withDefault("movie"),
  );

  const sortValues = DISCOVER_SORT_OPTIONS.map((o) => o.value) as DiscoverSortOption[];
  const [sortBy, setSortBy] = useQueryState(
    "sort",
    parseAsStringLiteral(sortValues).withDefault("popularity.desc" as DiscoverSortOption),
  );
  const [year, setYear] = useQueryState("year", parseAsInteger.withDefault(0));
  const [minRating, setMinRating] = useQueryState("rating", parseAsInteger.withDefault(0));

  const types = useMemo(
    () => [
      { name: "Discover", key: DEFAULT_QUERY_TYPE },
      ...(content === "movie" ? movies : tvShows).map(({ name, param }) => ({
        name: name.replace(/(Movies|TV Shows)/g, "").trim(),
        key: param,
      })),
    ],
    [content, movies, tvShows],
  );

  const genresString = useMemo(
    () =>
      Array.from(genres)
        .filter((genre) => genre !== "")
        .join(","),
    [genres],
  );

  const resetFilters = useCallback(() => {
    setGenres(null);
    setQueryType(DEFAULT_QUERY_TYPE);
    setSortBy(null);
    setYear(null);
    setMinRating(null);
  }, [setGenres, setQueryType, setSortBy, setYear, setMinRating]);

  const clearQueries = useCallback(() => {
    const queryKeys = ["discover-movies", "discover-tv-shows"];
    queryKeys.forEach((key) => {
      if (!q.isFetching({ queryKey: [key] })) {
        q.removeQueries({ queryKey: [key] });
      }
    });
  }, [q]);

  useEffect(() => {
    clearQueries();
  }, [content, queryType, genresString, sortBy, year, minRating]);

  return {
    types,
    genres,
    queryType,
    content,
    genresString,
    sortBy,
    year,
    minRating,
    setGenres,
    setQueryType,
    setContent,
    setSortBy,
    setYear,
    setMinRating,
    resetFilters,
  };
};

export default useDiscoverFilters;
