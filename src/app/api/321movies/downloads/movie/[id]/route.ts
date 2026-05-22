import { NextResponse } from "next/server";
import { fetchLocalSourcePackDownloads } from "@/server/sourcePack";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const downloads = await fetchLocalSourcePackDownloads({ type: "movie", id });
  return NextResponse.json(
    { downloads },
    { headers: { "cache-control": "no-store, max-age=0" } },
  );
}
