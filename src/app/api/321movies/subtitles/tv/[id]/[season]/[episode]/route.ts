import { NextResponse } from "next/server";
import { getVylaSubtitles } from "@/utils/vylaPlayerAdapter";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; season: string; episode: string }> },
) {
  const { id, season, episode } = await params;
  const origin = new URL(request.url).origin;
  const subtitles = await getVylaSubtitles(origin, {
    type: "tv",
    id,
    season,
    episode,
  });
  return NextResponse.json({ subtitles });
}
