import { NextRequest, NextResponse } from "next/server";

const ALLOWED_HOST = "sub.wyzie.io";

export const dynamic = "force-dynamic";

const srtToVtt = (srt: string): string => {
  const normalized = srt.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const body = normalized
    // SRT timestamp: 00:00:00,000 → VTT: 00:00:00.000
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2")
    // Strip pure numeric cue sequence numbers (SRT-only)
    .replace(/^\d+\n/gm, "");
  return `WEBVTT\n\n${body.trim()}\n`;
};

export const GET = async (request: NextRequest) => {
  const raw = request.nextUrl.searchParams.get("url");
  if (!raw) return new NextResponse("Missing url", { status: 400 });

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return new NextResponse("Invalid url", { status: 400 });
  }

  if (url.hostname !== ALLOWED_HOST) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  try {
    const upstream = await fetch(url.toString(), {
      headers: { Accept: "*/*", "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(10_000),
    });

    const content = await upstream.text();
    const isVtt = content.trimStart().startsWith("WEBVTT");
    const vttContent = isVtt ? content : srtToVtt(content);

    return new NextResponse(vttContent, {
      status: upstream.status,
      headers: {
        "content-type": "text/vtt; charset=utf-8",
        "cache-control": "public, max-age=3600",
        "access-control-allow-origin": "*",
      },
    });
  } catch {
    return new NextResponse("Failed to fetch subtitle", { status: 502 });
  }
};
