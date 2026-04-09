import { env } from "@/utils/env";
import { PremiumPlan } from "./premium";

const DEFAULT_API_BASE_URL = "https://api.sellauth.com/v1";
const DEFAULT_MONTHLY_PRICE = 4.99;
const DEFAULT_YEARLY_PRICE = 39.99;
const DEFAULT_CHECKOUT_MODE = "hosted";

interface SellAuthCartItem {
  productId: number;
  variantId?: number;
  quantity: number;
}

export interface SellAuthCheckoutResponse {
  invoiceId: string | null;
  invoiceUrl: string | null;
  checkoutUrl: string | null;
}

type SellAuthCheckoutMode = "api" | "hosted";

const toObject = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const toStringOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const toNumberOrNull = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const parsePrice = (value: string | undefined, fallback: number): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
};

const normalizeBaseUrl = (value: string): string => value.replace(/\/+$/, "");

const toInvoicePaidStatus = (value: unknown): boolean => {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "completed" ||
    normalized === "paid" ||
    normalized === "complete" ||
    normalized === "succeeded"
  );
};

export const getSellAuthApiBaseUrl = (): string =>
  normalizeBaseUrl(env.SELLAUTH_API_BASE_URL || DEFAULT_API_BASE_URL);

export const getSellAuthApiUrl = (path: string): string =>
  `${getSellAuthApiBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;

export const getSellAuthApiKey = (): string => env.SELLAUTH_API_KEY?.trim() || "";

export const getSellAuthShopId = (): string => env.SELLAUTH_SHOP_ID?.trim() || "";

export const getSellAuthPlanPrice = (plan: PremiumPlan): number =>
  plan === "yearly"
    ? parsePrice(env.SELLAUTH_YEARLY_PRICE_USD, DEFAULT_YEARLY_PRICE)
    : parsePrice(env.SELLAUTH_MONTHLY_PRICE_USD, DEFAULT_MONTHLY_PRICE);

export const getSellAuthCheckoutMode = (): SellAuthCheckoutMode => {
  const configured = (env.SELLAUTH_CHECKOUT_MODE || DEFAULT_CHECKOUT_MODE).trim().toLowerCase();
  return configured === "api" ? "api" : "hosted";
};

export const getSellAuthHostedCheckoutUrl = (plan: PremiumPlan): string | null => {
  const value =
    plan === "yearly"
      ? env.SELLAUTH_YEARLY_CHECKOUT_URL
      : env.SELLAUTH_MONTHLY_CHECKOUT_URL;
  const normalized = value?.trim() || "";
  return normalized.length > 0 ? normalized : null;
};

const toIntegerString = (value: string | undefined): string | null => {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return String(parsed);
};

const getProductAndVariantForPlan = (
  plan: PremiumPlan,
): { productId: number; variantId?: number } | null => {
  const productValue =
    plan === "yearly" ? env.SELLAUTH_YEARLY_PRODUCT_ID : env.SELLAUTH_MONTHLY_PRODUCT_ID;
  const variantValue =
    plan === "yearly" ? env.SELLAUTH_YEARLY_VARIANT_ID : env.SELLAUTH_MONTHLY_VARIANT_ID;

  const productId = toIntegerString(productValue);
  if (!productId) return null;

  const variantId = toIntegerString(variantValue);
  return {
    productId: Number(productId),
    variantId: variantId ? Number(variantId) : undefined,
  };
};

export const buildSellAuthCartForPlan = (plan: PremiumPlan): SellAuthCartItem[] | null => {
  const target = getProductAndVariantForPlan(plan);
  if (!target) return null;

  return [
    {
      productId: target.productId,
      ...(target.variantId ? { variantId: target.variantId } : {}),
      quantity: 1,
    },
  ];
};

export const extractSellAuthCheckout = (payload: unknown): SellAuthCheckoutResponse | null => {
  const root = toObject(payload);
  if (!root) return null;

  const nestedData = toObject(root.data);
  const invoiceId =
    toStringOrNull(root.invoice_id) ||
    toStringOrNull(root.invoiceId) ||
    toStringOrNull(nestedData?.invoice_id) ||
    toStringOrNull(nestedData?.invoiceId) ||
    (toNumberOrNull(root.invoice_id) !== null ? String(toNumberOrNull(root.invoice_id)) : null) ||
    (toNumberOrNull(nestedData?.invoice_id) !== null
      ? String(toNumberOrNull(nestedData?.invoice_id))
      : null);

  const invoiceUrl =
    toStringOrNull(root.invoice_url) ||
    toStringOrNull(root.invoiceUrl) ||
    toStringOrNull(nestedData?.invoice_url) ||
    toStringOrNull(nestedData?.invoiceUrl);

  const checkoutUrl =
    toStringOrNull(root.url) || toStringOrNull(nestedData?.url) || toStringOrNull(root.checkout_url);

  return {
    invoiceId,
    invoiceUrl,
    checkoutUrl,
  };
};

export const extractSellAuthErrorMessage = (payload: unknown): string | null => {
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

  return null;
};

export const extractSellAuthInvoice = (payload: unknown): Record<string, unknown> | null => {
  const root = toObject(payload);
  if (!root) return null;

  if (toStringOrNull(root.id) || toNumberOrNull(root.id) !== null) return root;

  const nestedData = toObject(root.data);
  if (!nestedData) return null;

  if (toStringOrNull(nestedData.id) || toNumberOrNull(nestedData.id) !== null) return nestedData;

  const nestedInvoice = toObject(nestedData.invoice);
  if (!nestedInvoice) return null;

  if (toStringOrNull(nestedInvoice.id) || toNumberOrNull(nestedInvoice.id) !== null) {
    return nestedInvoice;
  }

  return null;
};

export const getSellAuthInvoiceId = (invoice: Record<string, unknown>): string | null => {
  const stringId = toStringOrNull(invoice.id);
  if (stringId) return stringId;
  const numericId = toNumberOrNull(invoice.id);
  return numericId === null ? null : String(numericId);
};

export const isSellAuthInvoicePaid = (invoice: Record<string, unknown>): boolean => {
  const completedAt = toStringOrNull(invoice.completed_at) || toStringOrNull(invoice.completedAt);
  if (completedAt) return true;

  if (toInvoicePaidStatus(invoice.status)) return true;

  const paidAmount =
    toNumberOrNull(invoice.paid_usd) ||
    toNumberOrNull(invoice.paidUsd) ||
    toNumberOrNull(invoice.paid_total) ||
    toNumberOrNull(invoice.paidTotal);
  if (typeof paidAmount === "number" && paidAmount > 0) return true;

  const items = Array.isArray(invoice.items) ? invoice.items : [];
  if (items.length === 0) return false;
  const completedItems = items.filter((item) => toInvoicePaidStatus(toObject(item)?.status));
  return completedItems.length > 0;
};
