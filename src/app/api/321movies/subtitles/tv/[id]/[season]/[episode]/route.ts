import { NextResponse } from "next/server";
import { getVylaSubtitles } from "@/utils/vylaPlayerAdapter";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; season: string; episode: string }> },
) {
  const { id, season, episode } = await params;
  const origin = new URL(request.url).origin;
  try {
    const subtitles = await getVylaSubtitles(origin, {
      type: "tv",
      id,
      season,
      episode,
    });
    return NextResponse.json(
      { subtitles },
      { headers: { "cache-control": "no-store, max-age=0" } },
    );
  } catch (error) {
    console.warn(
      `[321moviesSubtitles] TV ${id} S${season}E${episode} failed:`,
      error instanceof Error ? error.message : String(error),
    );
    return NextResponse.json(
      { subtitles: [], error: error instanceof Error ? error.message : "Subtitle scrape failed" },
      { status: 200, headers: { "cache-control": "no-store, max-age=0" } },
    );
  }
}
