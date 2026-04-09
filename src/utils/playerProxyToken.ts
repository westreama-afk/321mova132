import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const TOKEN_VERSION = "v1";
const DEFAULT_PROXY_TOKEN_TTL_SECONDS = 60 * 60 * 6;
const AES_ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

export interface PlayerProxyTokenPayload {
  target: string;
  exp: number;
}

let cachedSecret: string | null = null;
let cachedKey: Buffer | null = null;

const toBase64Url = (value: Buffer): string =>
  value
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

const fromBase64Url = (value: string): Buffer => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const paddingLength = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(`${normalized}${"=".repeat(paddingLength)}`, "base64");
};

const getSecret = (): string | null => {
  const value = process.env.PLAYER_PROXY_TOKEN_SECRET?.trim();
  if (!value) return null;
  return value;
};

const getKey = (): Buffer | null => {
  const secret = getSecret();
  if (!secret) return null;

  if (cachedSecret === secret && cachedKey) {
    return cachedKey;
  }

  cachedSecret = secret;
  cachedKey = createHash("sha256").update(secret).digest();
  return cachedKey;
};

export const isPlayerProxyTokenEnabled = (): boolean => Boolean(getSecret());

export const createPlayerProxyToken = (
  target: string,
  expiresAtUnixSeconds?: number,
): string | null => {
  const key = getKey();
  if (!key) return null;

  const exp =
    typeof expiresAtUnixSeconds === "number" && Number.isFinite(expiresAtUnixSeconds)
      ? Math.floor(expiresAtUnixSeconds)
      : Math.floor(Date.now() / 1000) + DEFAULT_PROXY_TOKEN_TTL_SECONDS;

  const payload: PlayerProxyTokenPayload = {
    target,
    exp,
  };

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(AES_ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `${TOKEN_VERSION}.${toBase64Url(iv)}.${toBase64Url(authTag)}.${toBase64Url(encrypted)}`;
};

export const decodePlayerProxyToken = (token: string): PlayerProxyTokenPayload | null => {
  const key = getKey();
  if (!key || !token) return null;

  const parts = token.split(".");
  if (parts.length !== 4) return null;
  if (parts[0] !== TOKEN_VERSION) return null;

  try {
    const iv = fromBase64Url(parts[1]);
    const authTag = fromBase64Url(parts[2]);
    const encrypted = fromBase64Url(parts[3]);

    const decipher = createDecipheriv(AES_ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
      "utf8",
    );
    const payload = JSON.parse(decrypted) as Partial<PlayerProxyTokenPayload>;

    if (!payload || typeof payload.target !== "string" || payload.target.length === 0) {
      return null;
    }

    if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) {
      return null;
    }

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp <= now) return null;

    return {
      target: payload.target,
      exp: Math.floor(payload.exp),
    };
  } catch {
    return null;
  }
};
