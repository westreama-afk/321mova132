import { NextResponse } from "next/server";
import { StreamedSport } from "@/types/sports";
import { StreamedApiError, fetchStreamedJson } from "@/utils/streamed";

export const dynamic = "force-dynamic";

export const GET = async () => {
  try {
    const sports = await fetchStreamedJson<StreamedSport[]>("sports");

    return NextResponse.json(sports, {
      headers: {
        "cache-control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    const status = error instanceof StreamedApiError ? 502 : 500;
    const message = error instanceof Error ? error.message : "Failed to fetch sports list";

    return NextResponse.json({ error: message }, { status });
  }
};
