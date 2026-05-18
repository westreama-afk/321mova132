import { NextRequest, NextResponse } from "next/server";

const PIRACY_API_BASE = "https://piracy.cloud/api/streams";

type PiracyStream = {
  id: string;
  label: string;
  url: string;
  quality: string | null;
  language: string | null;
  version: string | null;
};

type PiracyResponse = {
  found: boolean;
  streams?: PiracyStream[];
  count?: number;
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");
  const id = searchParams.get("id");
  const season = searchParams.get("season");
  const episode = searchParams.get("episode");

  if (!type || !id) {
    return NextResponse.json({ found: false, error: "missing params" }, { status: 400 });
  }

  let upstream: string;
  if (type === "movie") {
    upstream = `${PIRACY_API_BASE}/movie/${encodeURIComponent(id)}`;
  } else if (type === "tv" && season && episode) {
    upstream = `${PIRACY_API_BASE}/show/${encodeURIComponent(id)}/${encodeURIComponent(season)}/${encodeURIComponent(episode)}`;
  } else {
    return NextResponse.json({ found: false, error: "invalid params" }, { status: 400 });
  }

  try {
    const res = await fetch(upstream, {
      headers: { accept: "application/json" },
      next: { revalidate: 60 * 30 },
    });
    if (!res.ok) {
      return NextResponse.json({ found: false }, { status: 200 });
    }
    const data = (await res.json()) as PiracyResponse;
    const url = data.found && data.streams && data.streams.length > 0 ? data.streams[0].url : null;
    return NextResponse.json(
      { found: Boolean(url), url },
      { headers: { "cache-control": "public, max-age=300, s-maxage=1800" } },
    );
  } catch {
    return NextResponse.json({ found: false }, { status: 200 });
  }
}
