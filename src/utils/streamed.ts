const STREAMED_API_BASE_URL = "https://streamed.pk/api";
const STREAMED_TIMEOUT_MS = 10000;

const STREAMED_HEADERS = {
  accept: "application/json",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  referer: "https://streamed.pk/docs",
  origin: "https://streamed.pk",
} as const;

export class StreamedApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "StreamedApiError";
    this.status = status;
  }
}

export const buildStreamedApiUrl = (path: string, query?: URLSearchParams): string => {
  const url = new URL(path, `${STREAMED_API_BASE_URL}/`);
  if (query) {
    query.forEach((value, key) => {
      url.searchParams.set(key, value);
    });
  }

  return url.toString();
};

export const fetchStreamedJson = async <T>(path: string, query?: URLSearchParams): Promise<T> => {
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), STREAMED_TIMEOUT_MS);

  try {
    const response = await fetch(buildStreamedApiUrl(path, query), {
      cache: "no-store",
      headers: STREAMED_HEADERS,
      signal: abortController.signal,
    });

    if (!response.ok) {
      throw new StreamedApiError(`Streamed upstream failed (${response.status})`, response.status);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeoutId);
  }
};
