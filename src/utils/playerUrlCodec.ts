const URL_CODEC_PREFIX = "enc:";
const NONCE_LENGTH = 8;

const toBase64Url = (bytes: Uint8Array): string => {
  const base64 =
    typeof Buffer !== "undefined"
      ? Buffer.from(bytes).toString("base64")
      : btoa(String.fromCharCode(...bytes));

  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const fromBase64Url = (value: string): Uint8Array => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = `${normalized}${"=".repeat((4 - (normalized.length % 4)) % 4)}`;

  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(padded, "base64"));
  }

  const binary = atob(padded);
  const output = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    output[i] = binary.charCodeAt(i);
  }
  return output;
};

const getCodecKey = (): string => process.env.NEXT_PUBLIC_PLAYER_URL_CODEC_KEY?.trim() || "";

const createNonce = (): Uint8Array => {
  const nonce = new Uint8Array(NONCE_LENGTH);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(nonce);
    return nonce;
  }

  for (let i = 0; i < nonce.length; i += 1) {
    nonce[i] = Math.floor(Math.random() * 256);
  }

  return nonce;
};

const applyXor = (input: Uint8Array, keyBytes: Uint8Array, nonce: Uint8Array): Uint8Array => {
  const output = new Uint8Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const keyIndex = (i + nonce[i % nonce.length]) % keyBytes.length;
    output[i] = input[i] ^ keyBytes[keyIndex];
  }
  return output;
};

export const encodePlayerStreamUrl = (url: string): string => {
  const key = getCodecKey();
  if (!key) return url;
  if (!url) return url;

  const encoder = new TextEncoder();
  const keyBytes = encoder.encode(key);
  const plainBytes = encoder.encode(url);
  const nonce = createNonce();
  const cipherBytes = applyXor(plainBytes, keyBytes, nonce);

  const payload = new Uint8Array(nonce.length + cipherBytes.length);
  payload.set(nonce, 0);
  payload.set(cipherBytes, nonce.length);

  return `${URL_CODEC_PREFIX}${toBase64Url(payload)}`;
};

export const decodePlayerStreamUrl = (value: string): string => {
  const key = getCodecKey();
  if (!key) return value;
  if (!value || !value.startsWith(URL_CODEC_PREFIX)) return value;

  try {
    const encoded = value.slice(URL_CODEC_PREFIX.length);
    const payload = fromBase64Url(encoded);
    if (payload.length <= NONCE_LENGTH) return value;

    const nonce = payload.slice(0, NONCE_LENGTH);
    const cipherBytes = payload.slice(NONCE_LENGTH);

    const encoder = new TextEncoder();
    const keyBytes = encoder.encode(key);
    const plainBytes = applyXor(cipherBytes, keyBytes, nonce);
    const decoder = new TextDecoder();
    return decoder.decode(plainBytes);
  } catch {
    return value;
  }
};

