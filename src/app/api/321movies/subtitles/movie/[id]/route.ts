import { NextResponse } from "next/server";
import { getVylaSubtitles } from "@/utils/vylaPlayerAdapter";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const origin = new URL(request.url).origin;
  try {
    const subtitles = await getVylaSubtitles(origin, { type: "movie", id });
    return NextResponse.json(
      { subtitles },
      { headers: { "cache-control": "no-store, max-age=0" } },
    );
  } catch (error) {
    console.warn(
      `[321moviesSubtitles] Movie ${id} failed:`,
      error instanceof Error ? error.message : String(error),
    );
    return NextResponse.json(
      { subtitles: [], error: error instanceof Error ? error.message : "Subtitle scrape failed" },
      { status: 200, headers: { "cache-control": "no-store, max-age=0" } },
    );
  }
}
