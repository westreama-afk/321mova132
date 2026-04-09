import { env } from "@/utils/env";
import { NextRequest, NextResponse } from "next/server";

const REQUEST_TIMEOUT_MS = 9000;
const MAX_WRAPPER_DEPTH = 3;
const MEDIA_TYPE_PRIORITY = [
  "video/mp4",
  "application/x-mpegurl",
  "application/vnd.apple.mpegurl",
  "video/webm",
] as const;

type AdSlot = "preroll" | "midroll";
type TrackingEventKey =
  | "start"
  | "firstQuartile"
  | "midpoint"
  | "thirdQuartile"
  | "complete"
  | "skip"
  | "closeLinear"
  | "click";

type TrackingEventMap = Partial<Record<TrackingEventKey, string[]>>;

interface ResolvedVastAd {
  mediaUrl: string;
  clickThroughUrl?: string;
  durationSeconds?: number;
  skipOffsetSeconds?: number;
  impressionUrls?: string[];
  errorUrls?: string[];
  clickTrackingUrls?: string[];
  tracking?: TrackingEventMap;
}

interface MediaCandidate {
  url: string;
  type?: string;
  bitrate?: number;
  width?: number;
  height?: number;
}

interface VastRequestHeaders {
  origin?: string;
  referer?: string;
  userAgent?: string;
}

interface VastTrackingData {
  impressionUrls: string[];
  errorUrls: string[];
  clickTrackingUrls: string[];
  tracking: TrackingEventMap;
}

const decodeXmlEntities = (value: string): string =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

const sanitizeXmlValue = (value: string): string =>
  decodeXmlEntities(value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")).trim();

const resolveUrl = (value: string, baseUrl: string): string => {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
};

const parseDurationSeconds = (value?: string): number | undefined => {
  if (!value) return undefined;

  const duration = sanitizeXmlValue(value);
  const match = duration.match(/^(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/);
  if (!match) return undefined;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return undefined;
  }

  return hours * 3600 + minutes * 60 + seconds;
};

const parseClockSeconds = (value?: string): number | undefined => {
  if (!value) return undefined;

  const normalized = sanitizeXmlValue(value);
  const match = normalized.match(/^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (!match) return undefined;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const millis = match[4] ? Number(match[4].padEnd(3, "0")) : 0;
  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes) ||
    !Number.isFinite(seconds) ||
    !Number.isFinite(millis)
  ) {
    return undefined;
  }

  return hours * 3600 + minutes * 60 + seconds + millis / 1000;
};

const parseSkipOffsetSeconds = (value: string, durationSeconds?: number): number | undefined => {
  const normalized = sanitizeXmlValue(value);
  if (!normalized) return undefined;

  if (normalized.endsWith("%")) {
    const percent = Number(normalized.slice(0, -1));
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) return undefined;
    if (!Number.isFinite(durationSeconds) || !durationSeconds || durationSeconds <= 0) return undefined;
    return (durationSeconds * percent) / 100;
  }

  const clockSeconds = parseClockSeconds(normalized);
  if (typeof clockSeconds === "number" && Number.isFinite(clockSeconds)) {
    return Math.max(0, clockSeconds);
  }

  const rawSeconds = Number(normalized);
  if (Number.isFinite(rawSeconds)) return Math.max(0, rawSeconds);

  return undefined;
};

const extractTagValues = (xml: string, tagName: string): string[] => {
  const pattern = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "gi");
  const values: string[] = [];
  let match: RegExpExecArray | null = null;

  while ((match = pattern.exec(xml)) !== null) {
    const value = sanitizeXmlValue(match[1] || "");
    if (value.length > 0) values.push(value);
  }

  return values;
};

const dedupeUrls = (urls: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const url of urls) {
    if (!url || seen.has(url)) continue;
    seen.add(url);
    result.push(url);
  }

  return result;
};

const parseAttributes = (rawAttributes: string): Record<string, string> => {
  const attributes: Record<string, string> = {};
  const attrPattern = /([a-zA-Z0-9:_-]+)\s*=\s*["']([^"']+)["']/g;
  let match: RegExpExecArray | null = null;

  while ((match = attrPattern.exec(rawAttributes)) !== null) {
    attributes[match[1].toLowerCase()] = match[2];
  }

  return attributes;
};

const normalizeTrackingEventName = (eventName: string): TrackingEventKey | null => {
  const normalized = eventName.trim().toLowerCase();
  if (!normalized) return null;

  if (normalized === "start") return "start";
  if (normalized === "firstquartile") return "firstQuartile";
  if (normalized === "midpoint") return "midpoint";
  if (normalized === "thirdquartile") return "thirdQuartile";
  if (normalized === "complete") return "complete";
  if (normalized === "skip") return "skip";
  if (normalized === "closelinear") return "closeLinear";
  if (normalized === "click") return "click";
  return null;
};

const extractTrackingEvents = (xml: string, baseUrl: string): TrackingEventMap => {
  const pattern = /<Tracking\b([^>]*)>([\s\S]*?)<\/Tracking>/gi;
  const tracking: TrackingEventMap = {};
  let match: RegExpExecArray | null = null;

  while ((match = pattern.exec(xml)) !== null) {
    const attributes = parseAttributes(match[1] || "");
    const eventKey = normalizeTrackingEventName(attributes.event || "");
    if (!eventKey) continue;

    const rawUrl = sanitizeXmlValue(match[2] || "");
    if (!rawUrl) continue;

    const resolvedUrl = resolveUrl(rawUrl, baseUrl);
    const current = tracking[eventKey] ?? [];
    current.push(resolvedUrl);
    tracking[eventKey] = current;
  }

  for (const key of Object.keys(tracking) as TrackingEventKey[]) {
    tracking[key] = dedupeUrls(tracking[key] || []);
  }

  return tracking;
};

const mergeTrackingMaps = (base: TrackingEventMap, extra: TrackingEventMap): TrackingEventMap => {
  const merged: TrackingEventMap = { ...base };

  const keys = new Set<TrackingEventKey>([
    ...(Object.keys(base) as TrackingEventKey[]),
    ...(Object.keys(extra) as TrackingEventKey[]),
  ]);

  for (const key of keys) {
    const urls = dedupeUrls([...(base[key] || []), ...(extra[key] || [])]);
    if (urls.length) merged[key] = urls;
  }

  return merged;
};

const extractVastTrackingData = (xml: string, baseUrl: string): VastTrackingData => {
  const impressionUrls = dedupeUrls(
    extractTagValues(xml, "Impression")
      .map((url) => resolveUrl(url, baseUrl))
      .filter((url) => url.length > 0),
  );
  const errorUrls = dedupeUrls(
    extractTagValues(xml, "Error")
      .map((url) => resolveUrl(url, baseUrl))
      .filter((url) => url.length > 0),
  );
  const clickTrackingUrls = dedupeUrls(
    extractTagValues(xml, "ClickTracking")
      .map((url) => resolveUrl(url, baseUrl))
      .filter((url) => url.length > 0),
  );
  const tracking = extractTrackingEvents(xml, baseUrl);

  return {
    impressionUrls,
    errorUrls,
    clickTrackingUrls,
    tracking,
  };
};

const extractSkipOffsetSeconds = (xml: string, durationSeconds?: number): number | undefined => {
  const linearPattern = /<Linear\b([^>]*)>/gi;
  let linearMatch: RegExpExecArray | null = null;

  while ((linearMatch = linearPattern.exec(xml)) !== null) {
    const attributes = parseAttributes(linearMatch[1] || "");
    const rawSkipOffset = attributes.skipoffset;
    if (!rawSkipOffset) continue;

    const skipOffsetSeconds = parseSkipOffsetSeconds(rawSkipOffset, durationSeconds);
    if (typeof skipOffsetSeconds === "number" && Number.isFinite(skipOffsetSeconds)) {
      return skipOffsetSeconds;
    }
  }

  return undefined;
};

const extractMediaCandidates = (xml: string, baseUrl: string): MediaCandidate[] => {
  const pattern = /<MediaFile\b([^>]*)>([\s\S]*?)<\/MediaFile>/gi;
  const candidates: MediaCandidate[] = [];
  let match: RegExpExecArray | null = null;

  while ((match = pattern.exec(xml)) !== null) {
    const attributes = parseAttributes(match[1] || "");
    const rawUrl = sanitizeXmlValue(match[2] || "");
    if (!rawUrl) continue;

    candidates.push({
      url: resolveUrl(rawUrl, baseUrl),
      type: attributes.type?.toLowerCase(),
      bitrate: Number(attributes.bitrate || attributes.minbitrate || 0) || undefined,
      width: Number(attributes.width || 0) || undefined,
      height: Number(attributes.height || 0) || undefined,
    });
  }

  return candidates;
};

const rankMediaCandidate = (candidate: MediaCandidate): number => {
  let score = 0;

  const type = candidate.type?.toLowerCase();
  if (type) {
    const exactTypeIndex = MEDIA_TYPE_PRIORITY.indexOf(type as (typeof MEDIA_TYPE_PRIORITY)[number]);
    if (exactTypeIndex >= 0) score += 200 - exactTypeIndex * 20;
    if (type.includes("mp4")) score += 20;
    if (type.includes("mpegurl")) score += 15;
  }

  if (candidate.url.toLowerCase().includes(".mp4")) score += 20;
  if (candidate.url.toLowerCase().includes(".m3u8")) score += 15;
  if (typeof candidate.bitrate === "number") score += Math.min(candidate.bitrate / 100, 20);
  if (typeof candidate.width === "number" && typeof candidate.height === "number") {
    score += Math.min((candidate.width * candidate.height) / 100000, 15);
  }

  return score;
};

const pickBestMediaUrl = (xml: string, baseUrl: string): string | null => {
  const candidates = extractMediaCandidates(xml, baseUrl);
  if (candidates.length > 0) {
    const best = [...candidates].sort((a, b) => rankMediaCandidate(b) - rankMediaCandidate(a))[0];
    return best?.url || null;
  }

  const directMatch = xml.match(/https?:\/\/[^"'\s]+(?:\.mp4|\.m3u8|\.webm)(?:\?[^"'\s]*)?/i)?.[0];
  return directMatch ? resolveUrl(directMatch, baseUrl) : null;
};

const fetchTextWithTimeout = async (url: string, requestHeaders?: VastRequestHeaders): Promise<string | null> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      accept: "application/xml,text/xml,text/plain,*/*",
    };

    if (requestHeaders?.origin) headers.origin = requestHeaders.origin;
    if (requestHeaders?.referer) headers.referer = requestHeaders.referer;
    if (requestHeaders?.userAgent) headers["user-agent"] = requestHeaders.userAgent;

    const response = await fetch(url, {
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
      headers,
    });

    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
};

const resolveVastAd = async (
  sourceUrl: string,
  depth = 0,
  requestHeaders?: VastRequestHeaders,
): Promise<ResolvedVastAd | null> => {
  if (depth > MAX_WRAPPER_DEPTH) return null;

  const xml = await fetchTextWithTimeout(sourceUrl, requestHeaders);
  if (!xml || xml.trim().length === 0) return null;

  const trackingData = extractVastTrackingData(xml, sourceUrl);

  const mediaUrl = pickBestMediaUrl(xml, sourceUrl);
  if (mediaUrl) {
    const clickThrough = extractTagValues(xml, "ClickThrough")[0];
    const durationSeconds = parseDurationSeconds(extractTagValues(xml, "Duration")[0]);
    const skipOffsetSeconds = extractSkipOffsetSeconds(xml, durationSeconds);

    return {
      mediaUrl,
      clickThroughUrl: clickThrough ? resolveUrl(clickThrough, sourceUrl) : undefined,
      durationSeconds,
      skipOffsetSeconds,
      impressionUrls: trackingData.impressionUrls,
      errorUrls: trackingData.errorUrls,
      clickTrackingUrls: trackingData.clickTrackingUrls,
      tracking: trackingData.tracking,
    };
  }

  const wrapperUrls = extractTagValues(xml, "VASTAdTagURI")
    .map((url) => resolveUrl(url, sourceUrl))
    .filter((url) => url.length > 0);

  for (const wrapperUrl of wrapperUrls) {
    const resolved = await resolveVastAd(wrapperUrl, depth + 1, requestHeaders);
    if (resolved) {
      return {
        ...resolved,
        impressionUrls: dedupeUrls([
          ...(trackingData.impressionUrls || []),
          ...(resolved.impressionUrls || []),
        ]),
        errorUrls: dedupeUrls([...(trackingData.errorUrls || []), ...(resolved.errorUrls || [])]),
        clickTrackingUrls: dedupeUrls([
          ...(trackingData.clickTrackingUrls || []),
          ...(resolved.clickTrackingUrls || []),
        ]),
        tracking: mergeTrackingMaps(trackingData.tracking, resolved.tracking || {}),
      };
    }
  }

  return null;
};

const getVastUrlForSlot = (slot: AdSlot): string | undefined => {
  const shared = env.PLAYER_VAST_URL;

  if (slot === "midroll") {
    return env.PLAYER_VAST_MIDROLL_URL || shared || env.PLAYER_VAST_PREROLL_URL;
  }

  return env.PLAYER_VAST_PREROLL_URL || shared || env.PLAYER_VAST_MIDROLL_URL;
};

export const dynamic = "force-dynamic";

export const GET = async (request: NextRequest) => {
  const rawSlot = request.nextUrl.searchParams.get("slot");
  const slot: AdSlot = rawSlot === "midroll" ? "midroll" : "preroll";
  const vastUrl = getVastUrlForSlot(slot);
  const originHeader = request.headers.get("origin") || request.nextUrl.origin;
  const refererHeader = request.headers.get("referer") || `${originHeader.replace(/\/+$/, "")}/`;
  const userAgentHeader =
    request.headers.get("user-agent") ||
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

  if (!vastUrl) {
    return NextResponse.json(
      { enabled: false, slot },
      { headers: { "cache-control": "no-store, max-age=0" } },
    );
  }

  const resolved = await resolveVastAd(vastUrl, 0, {
    origin: originHeader,
    referer: refererHeader,
    userAgent: userAgentHeader,
  });
  if (!resolved) {
    return NextResponse.json(
      { enabled: false, slot },
      { headers: { "cache-control": "no-store, max-age=0" } },
    );
  }

  return NextResponse.json(
    {
      enabled: true,
      slot,
      mediaUrl: resolved.mediaUrl,
      clickThroughUrl: resolved.clickThroughUrl,
      durationSeconds: resolved.durationSeconds,
      skipOffsetSeconds: resolved.skipOffsetSeconds,
      impressionUrls: resolved.impressionUrls || [],
      errorUrls: resolved.errorUrls || [],
      clickTrackingUrls: resolved.clickTrackingUrls || [],
      tracking: resolved.tracking || {},
    },
    {
      headers: {
        "cache-control": "no-store, max-age=0",
      },
    },
  );
};
