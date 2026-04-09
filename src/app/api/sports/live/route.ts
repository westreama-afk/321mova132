import { NextRequest, NextResponse } from "next/server";
import { StreamedMatch } from "@/types/sports";
import { StreamedApiError, fetchStreamedJson } from "@/utils/streamed";

export const dynamic = "force-dynamic";

export const GET = async (request: NextRequest) => {
  const sport = request.nextUrl.searchParams.get("sport")?.trim().toLowerCase();
  const useSport = Boolean(sport && sport !== "all");

  try {
    const matches = await fetchStreamedJson<StreamedMatch[]>("matches/live");
    const filteredMatches = useSport
      ? matches.filter((match) => match.category?.toLowerCase() === sport)
      : matches;

    return NextResponse.json(filteredMatches, {
      headers: {
        "cache-control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    const status = error instanceof StreamedApiError ? 502 : 500;
    const message = error instanceof Error ? error.message : "Failed to fetch live matches";

    return NextResponse.json({ error: message }, { status });
  }
};
