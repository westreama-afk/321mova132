import { NextRequest, NextResponse } from "next/server";
import { GET as getPlaylist } from "@/app/api/player/vixsrc-playlist/route";
import { mapPlaylistToVylaSources } from "@/utils/vylaPlayerAdapter";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  const season = request.nextUrl.searchParams.get("season") || "1";
  const episode = request.nextUrl.searchParams.get("episode") || "1";

  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  try {
    const playlistUrl = new URL("/api/player/vixsrc-playlist", request.nextUrl.origin);
    playlistUrl.searchParams.set("type", "tv");
    playlistUrl.searchParams.set("id", id);
    playlistUrl.searchParams.set("season", season);
    playlistUrl.searchParams.set("episode", episode);
    const playlistResponse = await getPlaylist(new NextRequest(playlistUrl, { headers: request.headers }));
    if (!playlistResponse.ok) {
      throw new Error(`Playlist request failed with HTTP ${playlistResponse.status}`);
    }

    const sources = mapPlaylistToVylaSources(await playlistResponse.json());
    return NextResponse.json(
      { sources, subtitles: [], meta: { id, type: "tv", season, episode } },
      { headers: { "cache-control": "no-store, max-age=0" } },
    );
  } catch (error) {
    return NextResponse.json(
      { sources: [], subtitles: [], error: error instanceof Error ? error.message : "Source fetch failed" },
      { status: 502, headers: { "cache-control": "no-store, max-age=0" } },
    );
  }
}
