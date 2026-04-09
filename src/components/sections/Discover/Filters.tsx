import GenresSelect from "@/components/ui/input/GenresSelect";
import ContentTypeSelection from "@/components/ui/other/ContentTypeSelection";
import useDiscoverFilters from "@/hooks/useDiscoverFilters";
import { DiscoverMoviesFetchQueryType, DISCOVER_SORT_OPTIONS, DiscoverSortOption } from "@/types/movie";
import { Select, SelectItem, Button, Input } from "@heroui/react";

const MIN_RATING_OPTIONS = [
  { value: "0", label: "Any Rating" },
  { value: "5", label: "5+ ★" },
  { value: "6", label: "6+ ★" },
  { value: "7", label: "7+ ★" },
  { value: "8", label: "8+ ★" },
  { value: "9", label: "9+ ★" },
];

const DiscoverFilters = () => {
  const {
    types, content, genres, queryType,
    sortBy, year, minRating,
    setQueryType, setGenres, setSortBy, setYear, setMinRating, resetFilters,
  } = useDiscoverFilters();

  return (
    <div className="flex w-full flex-col items-center gap-3">
      <ContentTypeSelection className="mb-3 justify-center" />
      <div className="flex w-full flex-wrap justify-center gap-3">
        <Select
          disallowEmptySelection
          selectionMode="single"
          size="sm"
          label="Type"
          placeholder="Select type"
          className="max-w-[180px]"
          selectedKeys={[queryType]}
          onChange={({ target }) => {
            setQueryType(target.value as DiscoverMoviesFetchQueryType);
            setGenres(null);
          }}
          value={queryType}
        >
          {types.map(({ name, key }) => (
            <SelectItem key={key}>{name}</SelectItem>
          ))}
        </Select>
        <GenresSelect
          type={content}
          selectedKeys={genres}
          onGenreChange={(genres) => {
            setGenres(genres);
            setQueryType("discover");
          }}
        />
      </div>
      <div className="flex w-full flex-wrap justify-center gap-3">
        <Select
          disallowEmptySelection
          selectionMode="single"
          size="sm"
          label="Sort By"
          className="max-w-[160px]"
          selectedKeys={[sortBy]}
          onChange={({ target }) => setSortBy(target.value as DiscoverSortOption)}
        >
          {DISCOVER_SORT_OPTIONS.map(({ value, label }) => (
            <SelectItem key={value}>{label}</SelectItem>
          ))}
        </Select>
        <Input
          type="number"
          size="sm"
          label="Year"
          placeholder="Any"
          className="max-w-[100px]"
          min={1888}
          max={new Date().getFullYear()}
          value={year > 0 ? String(year) : ""}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            if (!e.target.value) return void setYear(null);
            const yr = new Date().getFullYear();
            if (v >= 1888 && v <= yr) void setYear(v);
          }}
        />
        <Select
          disallowEmptySelection
          selectionMode="single"
          size="sm"
          label="Min Rating"
          className="max-w-[130px]"
          selectedKeys={[String(minRating)]}
          onChange={({ target }) => {
            const v = parseInt(target.value, 10);
            void setMinRating(v > 0 ? v : null);
          }}
        >
          {MIN_RATING_OPTIONS.map(({ value, label }) => (
            <SelectItem key={value}>{label}</SelectItem>
          ))}
        </Select>
      </div>
      <Button size="sm" onPress={resetFilters}>
        Reset Filters
      </Button>
    </div>
  );
};

export default DiscoverFilters;
