import { createHmac, timingSafeEqual } from "crypto";
import { env } from "@/utils/env";
import { PremiumPlan } from "./premium";

const DEFAULT_API_BASE_URL = "https://card2crypto.cc";
const API_PREFIX = "/api/v1";
const DEFAULT_MONTHLY_PRICE = 0.00;
const DEFAULT_YEARLY_PRICE = 39.99;

const PAID_STATUSES = new Set(["completed", "complete", "confirmed", "succeeded", "paid"]);
const COMPLETED_EVENTS = new Set([
  "payment.completed",
  "payment.complete",
  "payment.confirmed",
  "payment.succeeded",
  "payment.paid",
]);

export interface Card2CryptoPayment {
  id: string;
  status: string | null;
  paymentUrl: string | null;
  externalReference: string | null;
  metadata: Record<string, unknown>;
  amount: number | null;
  currency: string | null;
}

const toObject = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const toStringOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

const parsePrice = (value: string | undefined, fallback: number): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
};

const toNumberOrNull = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const normalizeBaseUrl = (value: string): string => {
  const stripped = value.replace(/\/+$/, "");
  return stripped.endsWith(API_PREFIX) ? stripped.slice(0, -API_PREFIX.length) : stripped;
};

const secureEquals = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
};

export const getCard2CryptoApiBaseUrl = (): string =>
  normalizeBaseUrl(env.CARD2CRYPTO_API_BASE_URL || DEFAULT_API_BASE_URL);

export const getCard2CryptoApiUrl = (path: string): string =>
  `${getCard2CryptoApiBaseUrl()}${API_PREFIX}${path.startsWith("/") ? path : `/${path}`}`;

export const getCard2CryptoApiKey = (): string => env.CARD2CRYPTO_API_KEY?.trim() || "";

export const isCard2CryptoLiveKey = (key: string): boolean =>
  /^c2c_(live|test)_[a-z0-9]+$/i.test(key.trim());

export const getCard2CryptoPlanPrice = (plan: PremiumPlan): number =>
  plan === "yearly"
    ? parsePrice(env.CARD2CRYPTO_YEARLY_PRICE_USD, DEFAULT_YEARLY_PRICE)
    : parsePrice(env.CARD2CRYPTO_MONTHLY_PRICE_USD, DEFAULT_MONTHLY_PRICE);

export const toCard2CryptoAmountCents = (amountUsd: number): number =>
  Math.max(50, Math.round(amountUsd * 100));

export const getCard2CryptoHostedPaymentLink = (plan: PremiumPlan): string | null => {
  const link =
    plan === "yearly"
      ? env.CARD2CRYPTO_YEARLY_PAYMENT_URL
      : env.CARD2CRYPTO_MONTHLY_PAYMENT_URL;
  return link?.trim() || null;
};

export const buildCard2CryptoExternalReference = (userId: string, plan: PremiumPlan): string =>
  `adfree:${userId}:${plan}:${Date.now()}`;

export const parseCard2CryptoExternalReference = (
  value: string | null,
): { userId: string; plan: PremiumPlan } | null => {
  if (!value) return null;
  const [prefix, userId, plan] = value.split(":");
  if (prefix !== "adfree") return null;
  if (!userId || (plan !== "monthly" && plan !== "yearly")) return null;
  return { userId, plan };
};

export const extractCard2CryptoPayment = (payload: unknown): Card2CryptoPayment | null => {
  const root = toObject(payload);
  if (!root) return null;

  const nestedData = toObject(root.data);
  const paymentNode =
    toObject(root.payment) ||
    toObject(root.paymentLink) ||
    toObject(nestedData?.payment) ||
    toObject(nestedData?.paymentLink) ||
    nestedData ||
    root;
  const metadata = toObject(paymentNode.metadata) || {};
  const id =
    toStringOrNull(paymentNode.id) ||
    toStringOrNull(paymentNode.payment_id) ||
    toStringOrNull(root.id) ||
    toStringOrNull(root.payment_id);

  if (!id) return null;

  return {
    id,
    status: toStringOrNull(paymentNode.status) || toStringOrNull(root.status),
    paymentUrl:
      toStringOrNull(paymentNode.payment_url) ||
      toStringOrNull(paymentNode.checkout_url) ||
      toStringOrNull(paymentNode.url) ||
      toStringOrNull(paymentNode.paymentLink) ||
      toStringOrNull(root.payment_url) ||
      toStringOrNull(root.checkout_url) ||
      toStringOrNull(root.url) ||
      toStringOrNull(toObject(root.paymentLink)?.url),
    externalReference:
      toStringOrNull(paymentNode.external_reference) || toStringOrNull(root.external_reference),
    metadata,
    amount: toNumberOrNull(paymentNode.amount) ?? toNumberOrNull(root.amount),
    currency: toStringOrNull(paymentNode.currency) || toStringOrNull(root.currency),
  };
};

export const extractCard2CryptoErrorMessage = (payload: unknown): string | null => {
  const object = toObject(payload);
  if (!object) return null;

  if (typeof object.error === "string" && object.error.trim().length > 0) return object.error;
  if (typeof object.message === "string" && object.message.trim().length > 0) return object.message;

  const nestedData = toObject(object.data);
  if (nestedData) {
    if (typeof nestedData.error === "string" && nestedData.error.trim().length > 0) {
      return nestedData.error;
    }
    if (typeof nestedData.message === "string" && nestedData.message.trim().length > 0) {
      return nestedData.message;
    }
  }

  const nestedError = toObject(object.error);
  if (nestedError) {
    if (typeof nestedError.message === "string" && nestedError.message.trim().length > 0) {
      return nestedError.message;
    }
    if (typeof nestedError.error === "string" && nestedError.error.trim().length > 0) {
      return nestedError.error;
    }
  }

  return null;
};

export const isCard2CryptoPaid = (eventType: string | null, status: string | null): boolean => {
  if (eventType && COMPLETED_EVENTS.has(eventType.toLowerCase())) return true;
  if (status && PAID_STATUSES.has(status.toLowerCase())) return true;
  return false;
};

export const verifyCard2CryptoSignature = (
  rawBody: string,
  signature: string | null,
  secret: string | undefined,
): boolean => {
  if (!secret) return true;
  if (!signature) return false;

  const digestHex = createHmac("sha256", secret).update(rawBody).digest("hex");
  const digestBase64 = createHmac("sha256", secret).update(rawBody).digest("base64");
  const candidates = new Set([digestHex, `sha256=${digestHex}`, digestBase64, `sha256=${digestBase64}`]);

  const incomingSignatures = signature
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  for (const incoming of incomingSignatures) {
    for (const candidate of candidates) {
      if (secureEquals(incoming, candidate)) return true;
    }
  }

  return false;
};
