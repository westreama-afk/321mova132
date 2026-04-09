import type { User } from "@supabase/supabase-js";

export type PremiumPlan = "monthly" | "yearly";

interface PremiumMetadata {
  premium_active?: unknown;
  premium_expires_at?: unknown;
  premium_plan?: unknown;
}

const toObject = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const toBoolean = (value: unknown): boolean | null => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
  }
  return null;
};

const toDate = (value: unknown): Date | null => {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
};

const toPremiumPlan = (value: unknown): PremiumPlan | null => {
  if (typeof value !== "string") return null;
  if (value === "monthly" || value === "yearly") return value;
  return null;
};

export const getPremiumStatusFromMetadata = (metadata: unknown) => {
  const parsed = (toObject(metadata) ?? {}) as PremiumMetadata;
  const activeFlag = toBoolean(parsed.premium_active);
  const expiresAtDate = toDate(parsed.premium_expires_at);
  const now = Date.now();
  const expiryIsValid = Boolean(expiresAtDate && expiresAtDate.getTime() > now);

  const isPremium = activeFlag === false ? false : expiryIsValid || activeFlag === true;

  return {
    isPremium,
    plan: toPremiumPlan(parsed.premium_plan),
    expiresAt: expiresAtDate?.toISOString() ?? null,
  };
};

export const isPremiumUser = (
  user: Pick<User, "user_metadata"> | null | undefined,
): boolean => {
  if (!user) return false;
  return getPremiumStatusFromMetadata(user.user_metadata).isPremium;
};

export const extendPremiumExpiry = (
  currentExpiry: unknown,
  durationDays: number,
  now: Date = new Date(),
): string => {
  const currentDate = toDate(currentExpiry);
  const baseTime = Math.max(now.getTime(), currentDate?.getTime() ?? 0);
  const durationMs = Math.max(1, durationDays) * 24 * 60 * 60 * 1000;
  return new Date(baseTime + durationMs).toISOString();
};

