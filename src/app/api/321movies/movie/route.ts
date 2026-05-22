import { NextRequest, NextResponse } from "next/server";
import { getVylaSources } from "@/utils/vylaPlayerAdapter";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  try {
    const sources = await getVylaSources(request.nextUrl.origin, { type: "movie", id });
    return NextResponse.json(
      { sources, subtitles: [], meta: { id, type: "movie" } },
      { headers: { "cache-control": "no-store, max-age=0" } },
    );
  } catch (error) {
    return NextResponse.json(
      { sources: [], subtitles: [], error: error instanceof Error ? error.message : "Source fetch failed" },
      { status: 502, headers: { "cache-control": "no-store, max-age=0" } },
    );
  }
}
