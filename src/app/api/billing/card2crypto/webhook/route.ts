import { NextRequest, NextResponse } from "next/server";
import { env } from "@/utils/env";
import { createAdminClient } from "@/utils/supabase/admin";
import { extendPremiumExpiry, PremiumPlan } from "@/utils/billing/premium";
import {
  extractCard2CryptoPayment,
  isCard2CryptoPaid,
  parseCard2CryptoExternalReference,
  verifyCard2CryptoSignature,
} from "@/utils/billing/card2crypto";

const PLAN_DURATIONS_DAYS: Record<PremiumPlan, number> = {
  monthly: 30,
  yearly: 365,
};

const toObject = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const toStringValue = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

const toPlan = (value: unknown): PremiumPlan | null => {
  if (value === "monthly" || value === "yearly") return value;
  return null;
};

const getEventType = (payload: unknown): string | null => {
  const object = toObject(payload);
  if (!object) return null;

  return (
    toStringValue(object.event) ||
    toStringValue(object.event_type) ||
    toStringValue(object.type) ||
    toStringValue(object.name) ||
    null
  );
};

const resolveUserIdAndPlan = (
  payload: unknown,
  fallbackExternalReference: string | null,
): { userId: string; plan: PremiumPlan } | null => {
  const object = toObject(payload);
  const data = toObject(object?.data);
  const metadata =
    toObject(object?.metadata) || toObject(data?.metadata) || toObject(data?.payment_metadata);

  const metadataUserId =
    toStringValue(metadata?.userId) || toStringValue(metadata?.user_id) || toStringValue(metadata?.uid);
  const metadataPlan = toPlan(metadata?.plan) || toPlan(metadata?.subscription_plan);

  if (metadataUserId && metadataPlan) {
    return { userId: metadataUserId, plan: metadataPlan };
  }

  const externalReference =
    toStringValue(data?.external_reference) ||
    toStringValue(object?.external_reference) ||
    fallbackExternalReference;

  return parseCard2CryptoExternalReference(externalReference);
};

export const dynamic = "force-dynamic";

export const POST = async (request: NextRequest) => {
  const rawBody = await request.text();
  const signature = request.headers.get("x-card2crypto-signature");
  const verified = verifyCard2CryptoSignature(rawBody, signature, env.CARD2CRYPTO_WEBHOOK_SECRET);

  if (!verified) {
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const eventType = getEventType(payload);
  const nestedPayload = toObject(payload)?.data;
  const payment = extractCard2CryptoPayment(payload) || extractCard2CryptoPayment(nestedPayload);

  if (!payment) {
    return NextResponse.json({ received: true, ignored: true, reason: "No payment in payload" });
  }

  if (!isCard2CryptoPaid(eventType, payment.status)) {
    return NextResponse.json({
      received: true,
      ignored: true,
      reason: "Event is not a completed payment",
    });
  }

  const resolved = resolveUserIdAndPlan(payload, payment.externalReference);
  if (!resolved) {
    return NextResponse.json({
      received: true,
      ignored: true,
      reason: "Missing user mapping in payment payload",
    });
  }

  const admin = createAdminClient();
  const { data: existingUser, error: existingUserError } = await admin.auth.admin.getUserById(
    resolved.userId,
  );

  if (existingUserError || !existingUser?.user) {
    return NextResponse.json(
      { error: "User not found for completed payment" },
      { status: existingUserError ? 500 : 404 },
    );
  }

  const currentMetadata = toObject(existingUser.user.user_metadata) || {};
  const expiresAt = extendPremiumExpiry(
    currentMetadata.premium_expires_at,
    PLAN_DURATIONS_DAYS[resolved.plan],
  );

  const nextMetadata = {
    ...currentMetadata,
    premium_active: true,
    premium_plan: resolved.plan,
    premium_provider: "card2crypto",
    premium_expires_at: expiresAt,
    premium_payment_id: payment.id,
    premium_updated_at: new Date().toISOString(),
  };

  const { error: updateError } = await admin.auth.admin.updateUserById(resolved.userId, {
    user_metadata: nextMetadata,
  });

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({
    received: true,
    processed: true,
    userId: resolved.userId,
    plan: resolved.plan,
    expiresAt,
  });
};
