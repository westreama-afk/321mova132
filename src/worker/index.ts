// MP4 read-ahead buffering — intercepts /mp4-proxy range requests, fetches
// 8 MB chunks, serves what the browser asked for, and caches the rest so
// subsequent requests within the same chunk are served from memory instantly.

declare let self: ServiceWorkerGlobalScope;

const PREFETCH_BYTES = 8 * 1024 * 1024; // 8 MB per fetch
const MAX_BYTES_PER_URL = 80 * 1024 * 1024; // evict oldest chunks past 80 MB
const MAX_URLS = 4;

interface Chunk {
  start: number;
  end: number; // inclusive, actual fetched end
  data: Uint8Array;
  totalSize: number | null;
}

const store = new Map<string, Chunk[]>();

function parseRange(h: string): { start: number; end: number | null } | null {
  const m = h.match(/bytes=(\d+)-(\d*)/);
  if (!m) return null;
  return { start: parseInt(m[1]), end: m[2] ? parseInt(m[2]) : null };
}

function findChunk(chunks: Chunk[], start: number, end: number): Chunk | null {
  for (const c of chunks) {
    if (c.start <= start && c.end >= end) return c;
  }
  return null;
}

function evict(url: string): void {
  const chunks = store.get(url);
  if (!chunks) return;
  let total = chunks.reduce((s, c) => s + c.data.byteLength, 0);
  while (total > MAX_BYTES_PER_URL && chunks.length > 0) {
    total -= chunks[0].data.byteLength;
    chunks.shift();
  }
  if (chunks.length === 0) store.delete(url);
  if (store.size > MAX_URLS) {
    const oldest = store.keys().next().value;
    if (oldest) store.delete(oldest);
  }
}

self.addEventListener("fetch", (event: FetchEvent) => {
  const url = new URL(event.request.url);
  if (!url.pathname.includes("/mp4-proxy")) return;
  const rangeHeader = event.request.headers.get("range");
  if (!rangeHeader) return;
  event.respondWith(handle(event.request, url.href, rangeHeader));
});

async function handle(req: Request, url: string, rangeHeader: string): Promise<Response> {
  const range = parseRange(rangeHeader);
  if (!range) return fetch(req);

  const reqStart = range.start;
  // browser often omits the end — default to one typical browser chunk ahead
  const reqEnd = range.end ?? reqStart + 1048575;

  const chunks = store.get(url) ?? [];
  const hit = findChunk(chunks, reqStart, reqEnd);
  if (hit) {
    const offset = reqStart - hit.start;
    const length = reqEnd - reqStart + 1;
    const slice = hit.data.slice(offset, offset + length);
    return new Response(slice, {
      status: 206,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Range": `bytes ${reqStart}-${reqEnd}/${hit.totalSize ?? "*"}`,
        "Content-Length": String(slice.byteLength),
        "Accept-Ranges": "bytes",
      },
    });
  }

  // Fetch a larger chunk from network
  const fetchEnd = reqStart + PREFETCH_BYTES - 1;
  const fetchHeaders = new Headers(req.headers);
  fetchHeaders.set("range", `bytes=${reqStart}-${fetchEnd}`);

  let resp: Response;
  try {
    resp = await fetch(new Request(req.url, {
      headers: fetchHeaders,
      mode: req.mode,
      credentials: req.credentials,
    }));
  } catch {
    return fetch(req);
  }

  if (resp.status !== 206 && resp.status !== 200) return resp;

  const contentRange = resp.headers.get("content-range");
  const totalSize = contentRange ? (parseInt(contentRange.split("/")[1]) || null) : null;

  const buf = await resp.arrayBuffer();
  const data = new Uint8Array(buf);
  const actualEnd = reqStart + data.byteLength - 1;

  if (!store.has(url)) store.set(url, []);
  store.get(url)!.push({ start: reqStart, end: actualEnd, data, totalSize });
  evict(url);

  const serveLength = Math.min(reqEnd - reqStart + 1, data.byteLength);
  const slice = data.slice(0, serveLength);
  const serveEnd = reqStart + slice.byteLength - 1;

  return new Response(slice, {
    status: 206,
    headers: {
      "Content-Type": resp.headers.get("content-type") ?? "video/mp4",
      "Content-Range": `bytes ${reqStart}-${serveEnd}/${totalSize ?? "*"}`,
      "Content-Length": String(slice.byteLength),
      "Accept-Ranges": "bytes",
    },
  });
}
