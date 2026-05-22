import { NextRequest, NextResponse } from "next/server";
import { GET as getPlaylist } from "@/app/api/player/vixsrc-playlist/route";
import { mapPlaylistToVylaSources } from "@/utils/vylaPlayerAdapter";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const normalize = (value?: string | null): string =>
  (value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const source = request.nextUrl.searchParams.get("source");
  const sourceIndex = Number.parseInt(request.nextUrl.searchParams.get("sourceIndex") || "", 10);
  const season = request.nextUrl.searchParams.get("season");
  const episode = request.nextUrl.searchParams.get("episode");
  const type = season ? "tv" : "movie";

  try {
    const playlistUrl = new URL("/api/player/vixsrc-playlist", request.nextUrl.origin);
    playlistUrl.searchParams.set("type", type);
    playlistUrl.searchParams.set("id", id);
    if (type === "tv") {
      playlistUrl.searchParams.set("season", season || "1");
      playlistUrl.searchParams.set("episode", episode || "1");
    }
    const playlistResponse = await getPlaylist(new NextRequest(playlistUrl, { headers: request.headers }));
    if (!playlistResponse.ok) {
      throw new Error(`Playlist request failed with HTTP ${playlistResponse.status}`);
    }

    const sources = mapPlaylistToVylaSources(await playlistResponse.json());

    const requestedSource = Number.isFinite(sourceIndex)
      ? sources[sourceIndex]
      : sources.find((item) => {
        const wanted = normalize(source);
        return wanted === normalize(item.sourceKey)
          || wanted === normalize(item.source)
          || wanted === normalize(item.label)
          || wanted === normalize(item.provider);
      });

    if (!requestedSource) {
      return NextResponse.json({ ok: false, error: "Source unavailable" });
    }

    return NextResponse.json({
      ok: true,
      source: requestedSource.source,
      label: requestedSource.label,
      url: requestedSource.url,
      raw_url: requestedSource.raw_url,
      type: requestedSource.type,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Source fetch failed" },
      { status: 502 },
    );
  }
}
