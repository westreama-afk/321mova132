import { NextResponse } from "next/server";

const FALLBACK_SOURCES = [
  "NovaCast",
  "FlowCast",
  "PrimeVids",
  "Guru",
  "VidLink",
  "StreamVault",
  "Icefy",
  "HollyLS",
  "Primeshows",
  "Zebi",
  "Prime",
  "Nexo",
  "AsiaCloud",
  "HindiCast",
  "Ophim",
];

export function GET() {
  const bySource = Object.fromEntries(
    FALLBACK_SOURCES.map((source) => [
      source,
      {
        movie: `/api/test/155?source=${encodeURIComponent(source)}`,
        tv: `/api/test/1396?source=${encodeURIComponent(source)}&season=1&episode=1`,
      },
    ]),
  );

  return NextResponse.json({ tests: { bySource } });
}
