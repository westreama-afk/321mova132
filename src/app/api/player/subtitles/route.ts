import { NextRequest, NextResponse } from "next/server";
import { fetchLocalSourcePackSubtitles } from "@/server/sourcePack";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const toSubtitleProxyUrl = (url: string): string => {
  if (url.startsWith("/api/player/subtitle-proxy")) return url;
  return `/api/player/subtitle-proxy?url=${encodeURIComponent(url)}`;
};

export const GET = async (request: NextRequest) => {
  const params = request.nextUrl.searchParams;
  const id = params.get("id");
  const type = params.get("type");
  const season = params.get("season") || "1";
  const episode = params.get("episode") || "1";

  if (!id || (type !== "movie" && type !== "tv")) {
    return NextResponse.json({ error: "Missing id or type" }, { status: 400 });
  }

  try {
    const subtitles = await fetchLocalSourcePackSubtitles({
      type,
      id,
      season,
      episode,
    });

    const tracks = subtitles.map((track) => ({
      url: toSubtitleProxyUrl(track.url),
      lang: track.label,
      label: track.label,
      format: track.format,
      source: track.source,
      isHearingImpaired: false,
    }));

    return NextResponse.json(
      { tracks },
      { headers: { "cache-control": "no-store, max-age=0" } },
    );
  } catch (error) {
    console.warn(
      `[SourcePackSubtitles] ${type} ${id} failed:`,
      error instanceof Error ? error.message : String(error),
    );
    return NextResponse.json(
      { tracks: [] },
      { headers: { "cache-control": "no-store, max-age=0" } },
    );
  }
};
