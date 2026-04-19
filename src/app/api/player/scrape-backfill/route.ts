import { NextRequest, NextResponse } from "next/server";
import { env } from "@/utils/env";
import { getDueScrapeBackfills, scheduleScrapeBackfill } from "@/utils/playerScrapeArchive";

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const MAX_BACKFILL_ATTEMPTS = 3;

const isAuthorized = (request: NextRequest): boolean => {
  const token = env.PLAYER_SCRAPE_BACKFILL_TOKEN?.trim();
  if (!token) return true;

  const authHeader = request.headers.get("authorization");
  if (authHeader === `Bearer ${token}`) return true;

  return request.nextUrl.searchParams.get("token") === token;
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = async (request: NextRequest) => {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rawLimit = Number.parseInt(request.nextUrl.searchParams.get("limit") || `${DEFAULT_LIMIT}`, 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), MAX_LIMIT) : DEFAULT_LIMIT;
  const dueItems = await getDueScrapeBackfills(limit);

  if (dueItems.length === 0) {
    return NextResponse.json({ processed: 0, results: [] });
  }

  const results: Array<Record<string, unknown>> = [];

  for (const item of dueItems) {
    const params = new URLSearchParams({
      type: item.request.type,
      id: item.request.id,
      backfill: "1",
      attempt: String(item.attempts + 1),
    });
    if (item.request.type === "tv") {
      params.set("season", item.request.season || "0");
      params.set("episode", item.request.episode || "0");
    }

    const replayUrl = new URL(`/api/player/vixsrc-playlist?${params.toString()}`, request.nextUrl.origin);

    try {
      const response = await fetch(replayUrl, {
        method: "GET",
        cache: "no-store",
      });

      results.push({
        requestKey: item.requestKey,
        status: response.status,
        ok: response.ok,
        replayUrl: replayUrl.toString(),
      });

      if (!response.ok && item.attempts + 1 < MAX_BACKFILL_ATTEMPTS) {
        await scheduleScrapeBackfill(item.request, {
          attempts: item.attempts + 1,
          missingProviders: item.missingProviders,
          reason: `Backfill replay HTTP ${response.status}`,
        });
      }
    } catch (error) {
      if (item.attempts + 1 < MAX_BACKFILL_ATTEMPTS) {
        await scheduleScrapeBackfill(item.request, {
          attempts: item.attempts + 1,
          missingProviders: item.missingProviders,
          reason: error instanceof Error ? error.message : String(error),
        });
      }

      results.push({
        requestKey: item.requestKey,
        status: null,
        ok: false,
        replayUrl: replayUrl.toString(),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return NextResponse.json({
    processed: dueItems.length,
    results,
  });
};
