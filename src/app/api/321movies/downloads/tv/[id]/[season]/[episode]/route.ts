import { NextResponse } from "next/server";
import { fetchLocalSourcePackDownloads } from "@/server/sourcePack";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; season: string; episode: string }> },
) {
  const { id, season, episode } = await params;
  const downloads = await fetchLocalSourcePackDownloads({
    type: "tv",
    id,
    season,
    episode,
  });

  return NextResponse.json(
    { downloads },
    { headers: { "cache-control": "no-store, max-age=0" } },
  );
}
