import { NextResponse } from "next/server";
import { getVylaSubtitles } from "@/utils/vylaPlayerAdapter";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const origin = new URL(request.url).origin;
  const subtitles = await getVylaSubtitles(origin, { type: "movie", id });
  return NextResponse.json({ subtitles });
}
