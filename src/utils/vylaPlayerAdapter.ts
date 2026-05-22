import { fetchLocalSourcePackSubtitles } from "@/server/sourcePack";
import { decodePlayerStreamUrl } from "@/utils/playerUrlCodec";

type VylaMediaType = "movie" | "tv";

interface PlaylistSource {
  type?: string;
  file?: string;
  label?: string;
  provider?: string;
}

interface PlaylistResponse {
  playlist?: Array<{ sources?: PlaylistSource[] }>;
}

export interface VylaMediaRequest {
  type: VylaMediaType;
  id: string;
  season?: string;
  episode?: string;
}

export interface VylaSource {
  source: string;
  sourceKey: string;
  label: string;
  provider?: string;
  url: string;
  raw_url: string;
  type: "hls" | "mp4";
  timeout: number;
}

export interface VylaSubtitle {
  file: string;
  url: string;
  label: string;
  lang: string;
  format: string;
  source: string;
  isHearingImpaired: boolean;
}

const STREAMVAULT_PROVIDER_KEYS = new Set([
  "streamvault",
  "flint",
  "copper",
  "platinum",
  "lazuli",
  "citrine",
  "coral",
  "opal",
  "marble",
]);

const normalize = (value?: string): string =>
  (value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

const classifySource = (source: PlaylistSource): { key: string; priority: number } => {
  const provider = normalize(source.provider);
  const label = normalize(source.label);

  if (provider === "movish" || label.includes("novacast")) return { key: "NovaCast", priority: 0 };
  if (provider === "flowcast" || label.includes("flowcast")) return { key: "FlowCast", priority: 1 };
  if (provider === "primevids" || label.includes("primevids")) return { key: "PrimeVids", priority: 2 };
  if (provider === "guru" || label.includes("guru")) return { key: "Guru", priority: 3 };
  if (provider === "vidlink" || label.includes("vidlink")) return { key: "VidLink", priority: 4 };
  if (STREAMVAULT_PROVIDER_KEYS.has(provider)) return { key: "StreamVault", priority: 5 };
  if (label.includes("northstar") || label.includes("aurora") || label.includes("moonbeam")) {
    return { key: "StreamVault", priority: 5 };
  }
  if (provider === "icefy" || label.includes("icefy")) return { key: "Icefy", priority: 6 };
  if (provider === "hollymoviehd" || label.includes("hollyls")) return { key: "HollyLS", priority: 7 };
  if (provider === "primeshows" || label.includes("primeshows")) return { key: "Primeshows", priority: 8 };
  if (provider === "vidzee0" || label.includes("zebi")) return { key: "Zebi", priority: 9 };
  if (provider === "vidzee1" || label === "prime") return { key: "Prime", priority: 10 };
  if (provider === "allmovies" || label.includes("nexo")) return { key: "Nexo", priority: 11 };
  if (provider === "asiacloud" || label.includes("asiacloud")) return { key: "AsiaCloud", priority: 12 };
  if (provider === "hindicast" || label.includes("hindicast")) return { key: "HindiCast", priority: 13 };
  if (provider === "ophim" || label.includes("ophim")) return { key: "Ophim", priority: 14 };

  return {
    key: source.label?.trim() || source.provider?.trim() || "Source",
    priority: 100,
  };
};

const buildPlaylistUrl = (origin: string, request: VylaMediaRequest): string => {
  const params = new URLSearchParams({
    type: request.type,
    id: request.id,
  });

  if (request.type === "tv") {
    params.set("season", request.season || "1");
    params.set("episode", request.episode || "1");
  }

  return `${origin}/api/player/vixsrc-playlist?${params.toString()}`;
};

const toSubtitleProxyUrl = (url: string): string => {
  if (url.startsWith("/api/player/subtitle-proxy")) return url;
  return `/api/player/subtitle-proxy?url=${encodeURIComponent(url)}`;
};

export const getVylaSources = async (
  origin: string,
  request: VylaMediaRequest,
): Promise<VylaSource[]> => {
  const response = await fetch(buildPlaylistUrl(origin, request), {
    cache: "no-store",
    signal: AbortSignal.timeout(45_000),
  });

  if (!response.ok) {
    throw new Error(`Playlist request failed with HTTP ${response.status}`);
  }

  return mapPlaylistToVylaSources((await response.json()) as PlaylistResponse);
};

export const mapPlaylistToVylaSources = (payload: PlaylistResponse): VylaSource[] => {
  const collected: Array<VylaSource & { priority: number; index: number }> = [];

  for (const item of payload.playlist || []) {
    for (const source of item.sources || []) {
      if (!source.file || (source.type !== "hls" && source.type !== "mp4")) continue;

      const decodedUrl = decodePlayerStreamUrl(source.file);
      if (!decodedUrl || !decodedUrl.startsWith("http")) continue;

      const classified = classifySource(source);
      const isMp4 = source.type === "mp4" || /\/mp4-proxy(?:\?|$)|\.mp4(?:\?|$)/i.test(decodedUrl);
      collected.push({
        source: classified.key,
        sourceKey: classified.key,
        label: source.label?.trim() || classified.key,
        provider: source.provider,
        url: decodedUrl,
        raw_url: decodedUrl,
        type: isMp4 ? "mp4" : "hls",
        timeout: 15_000,
        priority: classified.priority,
        index: collected.length,
      });
    }
  }

  const seenUrls = new Set<string>();
  return collected
    .filter((source) => {
      if (seenUrls.has(source.url)) return false;
      seenUrls.add(source.url);
      return true;
    })
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .map(({ priority: _priority, index: _index, ...source }) => source);
};

export const getVylaSubtitles = async (
  _origin: string,
  request: VylaMediaRequest,
): Promise<VylaSubtitle[]> => {
  let sourcePackTracks: Awaited<ReturnType<typeof fetchLocalSourcePackSubtitles>> = [];
  try {
    sourcePackTracks = await fetchLocalSourcePackSubtitles(request);
  } catch (error) {
    console.warn(
      `[VylaSubtitles] Source-pack subtitles unavailable for ${request.type} ${request.id}:`,
      error instanceof Error ? error.message : String(error),
    );
  }

  const merged = [
    ...sourcePackTracks.map((track) => ({
      file: toSubtitleProxyUrl(track.url),
      url: toSubtitleProxyUrl(track.url),
      label: track.label,
      lang: track.label,
      format: track.format,
      source: track.source,
      isHearingImpaired: false,
    })),
  ];

  const seen = new Set<string>();
  return merged.filter((track) => {
    if (!track.url || seen.has(track.url)) return false;
    seen.add(track.url);
    return true;
  });
};
