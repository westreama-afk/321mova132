import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

type MediaType = "movie" | "tv";
type ScrapePhase = "live" | "backfill";

export interface ArchivedMediaRequest {
  type: MediaType;
  id: string;
  season?: string;
  episode?: string;
}

export interface ScrapeArchiveEntry {
  family: string;
  provider: string;
  phase: ScrapePhase;
  attempt: number;
  request: ArchivedMediaRequest;
  url: string;
  status: number | null;
  ok: boolean;
  sourceCount: number;
  error?: string | null;
  responseBody?: unknown;
  responseText?: string | null;
  extra?: Record<string, unknown>;
}

export interface ScrapeBackfillQueueItem {
  requestKey: string;
  request: ArchivedMediaRequest;
  attempts: number;
  dueAt: string;
  createdAt: string;
  updatedAt: string;
  missingProviders: string[];
  reason: string;
}

const ARCHIVE_ROOT = path.join(process.cwd(), "snapshots", "player_scrape_archive");
const QUEUE_FILE = path.join(ARCHIVE_ROOT, "backfill-queue.json");
const CACHE_ROOT = path.join(process.cwd(), "snapshots", "player_scrape_cache");

export interface CachedPlaylistSource {
  type: "hls";
  file: string;
  label: string;
  default?: boolean;
  provider?: string;
}

interface CachedPlaylistEntry {
  cachedAt: string;
  sources: CachedPlaylistSource[];
}

const getCacheFilePath = (request: ArchivedMediaRequest): string =>
  path.join(CACHE_ROOT, `${buildScrapeRequestKey(request)}.json`);

export const saveCachedPlaylist = async (
  request: ArchivedMediaRequest,
  sources: CachedPlaylistSource[],
): Promise<void> => {
  await mkdir(CACHE_ROOT, { recursive: true });
  const entry: CachedPlaylistEntry = { cachedAt: new Date().toISOString(), sources };
  await writeFile(getCacheFilePath(request), JSON.stringify(entry, null, 2));
};

export const getCachedPlaylist = async (
  request: ArchivedMediaRequest,
  maxAgeMs: number,
): Promise<CachedPlaylistSource[] | null> => {
  try {
    const raw = await readFile(getCacheFilePath(request), "utf8");
    const entry = JSON.parse(raw) as CachedPlaylistEntry;
    if (!entry.cachedAt || !Array.isArray(entry.sources)) return null;
    if (Date.now() - Date.parse(entry.cachedAt) > maxAgeMs) return null;
    return entry.sources;
  } catch {
    return null;
  }
};

const sanitizePart = (value: string): string => value.replace(/[^a-zA-Z0-9_-]+/g, "_");

const withRequestKeyParts = (request: ArchivedMediaRequest): string[] => {
  const parts = [request.type, request.id];
  if (request.type === "tv") {
    parts.push(`s${request.season ?? "0"}`, `e${request.episode ?? "0"}`);
  }
  return parts.map(sanitizePart);
};

export const buildScrapeRequestKey = (request: ArchivedMediaRequest): string => withRequestKeyParts(request).join("_");

const getRequestDirectory = (request: ArchivedMediaRequest): string => path.join(ARCHIVE_ROOT, ...withRequestKeyParts(request));

const ensureArchiveRoot = async (): Promise<void> => {
  await mkdir(ARCHIVE_ROOT, { recursive: true });
};

const readQueue = async (): Promise<ScrapeBackfillQueueItem[]> => {
  await ensureArchiveRoot();
  try {
    const raw = await readFile(QUEUE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ScrapeBackfillQueueItem[]) : [];
  } catch {
    return [];
  }
};

const writeQueue = async (items: ScrapeBackfillQueueItem[]): Promise<void> => {
  await ensureArchiveRoot();
  await writeFile(QUEUE_FILE, JSON.stringify(items, null, 2));
};

export const archiveScrapeResponse = async (entry: ScrapeArchiveEntry): Promise<string> => {
  const createdAt = new Date().toISOString();
  const requestDir = getRequestDirectory(entry.request);
  await mkdir(requestDir, { recursive: true });

  const fileName = [
    createdAt.replace(/[:.]/g, "-"),
    sanitizePart(entry.phase),
    sanitizePart(entry.family),
    sanitizePart(entry.provider),
    `attempt${entry.attempt}`,
  ].join("_") + ".json";

  const filePath = path.join(requestDir, fileName);
  const payload = {
    createdAt,
    ...entry,
  };

  await writeFile(filePath, JSON.stringify(payload, null, 2));
  return filePath;
};

export const scheduleScrapeBackfill = async (
  request: ArchivedMediaRequest,
  options: {
    attempts: number;
    delayHours?: number;
    missingProviders: string[];
    reason: string;
  },
): Promise<void> => {
  const items = await readQueue();
  const now = new Date();
  const requestKey = buildScrapeRequestKey(request);
  const dueAt = new Date(now.getTime() + (options.delayHours ?? 6) * 60 * 60 * 1000).toISOString();

  const nextItem: ScrapeBackfillQueueItem = {
    requestKey,
    request,
    attempts: options.attempts,
    dueAt,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    missingProviders: [...new Set(options.missingProviders)].sort(),
    reason: options.reason,
  };

  const existingIndex = items.findIndex((item) => item.requestKey === requestKey);
  if (existingIndex >= 0) {
    nextItem.createdAt = items[existingIndex].createdAt;
    items[existingIndex] = nextItem;
  } else {
    items.push(nextItem);
  }

  await writeQueue(items.sort((a, b) => a.dueAt.localeCompare(b.dueAt)));
};

export const clearScrapeBackfill = async (request: ArchivedMediaRequest): Promise<void> => {
  const requestKey = buildScrapeRequestKey(request);
  const items = await readQueue();
  const nextItems = items.filter((item) => item.requestKey !== requestKey);
  if (nextItems.length === items.length) return;
  await writeQueue(nextItems);
};

export const getDueScrapeBackfills = async (limit: number): Promise<ScrapeBackfillQueueItem[]> => {
  const items = await readQueue();
  const now = Date.now();
  return items.filter((item) => Date.parse(item.dueAt) <= now).slice(0, limit);
};
