import { NextRequest, NextResponse } from "next/server";

const WYZIE_API_KEY = process.env.WYZIE_API_KEY ?? "";
const WYZIE_BASE = "https://sub.wyzie.io";

interface WyzieSubtitle {
  id: string;
  url: string;
  flagUrl: string;
  format: string;
  encoding: string;
  display: string;
  language: string;
  media: string;
  isHearingImpaired: boolean;
  source: string;
  release: string;
  releases: string[];
  fileName: string;
}

export interface SubtitleTrackResponse {
  url: string;
  lang: string;
  label: string;
  format: string;
  isHearingImpaired: boolean;
}

export const GET = async (request: NextRequest) => {
  const params = request.nextUrl.searchParams;
  const tmdbId = params.get("id");
  const type = params.get("type"); // "movie" | "tv"
  const season = params.get("season");
  const episode = params.get("episode");

  if (!tmdbId || !type) {
    return NextResponse.json({ error: "Missing id or type" }, { status: 400 });
  }

  if (!WYZIE_API_KEY) {
    return NextResponse.json({ tracks: [] });
  }

  try {
    const searchParams = new URLSearchParams({
      id: tmdbId,
      key: WYZIE_API_KEY,
    });

    if (type === "tv" && season && episode) {
      searchParams.set("season", season);
      searchParams.set("episode", episode);
    }

    const response = await fetch(`${WYZIE_BASE}/search?${searchParams.toString()}`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 21600 }, // cache 6h — subtitle lists rarely change
    });

    if (!response.ok) {
      return NextResponse.json({ tracks: [] });
    }

    const data: WyzieSubtitle[] = await response.json();

    if (!Array.isArray(data)) {
      return NextResponse.json({ tracks: [] });
    }

    // Deduplicate: keep best subtitle per language (prefer non-HI, srt format)
    const byLang = new Map<string, WyzieSubtitle>();
    for (const sub of data) {
      if (!sub.url || !sub.language) continue;
      const existing = byLang.get(sub.language);
      if (!existing) {
        byLang.set(sub.language, sub);
        continue;
      }
      // Prefer non-HI over HI
      if (existing.isHearingImpaired && !sub.isHearingImpaired) {
        byLang.set(sub.language, sub);
        continue;
      }
      // Prefer vtt over srt (Chrome requires WebVTT for <track> elements)
      if (existing.format !== "vtt" && sub.format === "vtt") {
        byLang.set(sub.language, sub);
      }
    }

    const tracks: SubtitleTrackResponse[] = Array.from(byLang.values()).map((sub) => ({
      url: `/api/player/subtitle-proxy?url=${encodeURIComponent(sub.url)}`,
      lang: sub.language,
      label: sub.display || sub.language,
      format: sub.format,
      isHearingImpaired: sub.isHearingImpaired,
    }));

    // Sort: English first, then alphabetical by label
    tracks.sort((a, b) => {
      if (a.lang === "en" && b.lang !== "en") return -1;
      if (b.lang === "en" && a.lang !== "en") return 1;
      return a.label.localeCompare(b.label);
    });

    return NextResponse.json(
      { tracks },
      { headers: { "cache-control": "public, s-maxage=21600, stale-while-revalidate=3600" } },
    );
  } catch {
    return NextResponse.json({ tracks: [] });
  }
};
