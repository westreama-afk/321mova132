import { NextRequest, NextResponse } from "next/server";
import { StreamedStream } from "@/types/sports";
import { StreamedApiError, fetchStreamedJson } from "@/utils/streamed";

export const dynamic = "force-dynamic";

export const GET = async (request: NextRequest) => {
  const source = request.nextUrl.searchParams.get("source")?.trim().toLowerCase();
  const id = request.nextUrl.searchParams.get("id")?.trim();

  if (!source || !id) {
    return NextResponse.json({ error: "source and id are required" }, { status: 400 });
  }

  try {
    const path = `stream/${encodeURIComponent(source)}/${encodeURIComponent(id)}`;
    const streams = await fetchStreamedJson<StreamedStream[]>(path);

    return NextResponse.json(streams, {
      headers: {
        "cache-control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    const status = error instanceof StreamedApiError ? 502 : 500;
    const message = error instanceof Error ? error.message : "Failed to fetch stream list";

    return NextResponse.json({ error: message }, { status });
  }
};
