import { env } from "@/utils/env";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tmdbId = searchParams.get("tmdbId");
  const type = searchParams.get("type"); // "movie" | "tv"

  if (!tmdbId || (type !== "movie" && type !== "tv")) {
    return NextResponse.json({ error: "bad params" }, { status: 400 });
  }

  const token = env.NEXT_PUBLIC_TMDB_ACCESS_TOKEN;
  const endpoint = `https://api.themoviedb.org/3/${type}/${tmdbId}/external_ids`;

  try {
    const res = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${token}` },
      next: { revalidate: 86400 }, // cache 24h — IMDB IDs don't change
    });
    if (!res.ok) return NextResponse.json({ imdbId: null });
    const data = (await res.json()) as { imdb_id?: string | null };
    return NextResponse.json({ imdbId: data.imdb_id ?? null });
  } catch {
    return NextResponse.json({ imdbId: null });
  }
}
