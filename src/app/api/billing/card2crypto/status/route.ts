import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";
import {
  extractCard2CryptoErrorMessage,
  extractCard2CryptoPayment,
  getCard2CryptoApiUrl,
  getCard2CryptoApiKey,
  isCard2CryptoLiveKey,
  isCard2CryptoPaid,
  parseCard2CryptoExternalReference,
} from "@/utils/billing/card2crypto";
import { extendPremiumExpiry, PremiumPlan } from "@/utils/billing/premium";

const PLAN_DURATIONS_DAYS: Record<PremiumPlan, number> = {
  monthly: 30,
  yearly: 365,
};

const toStringValue = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

const toPlan = (value: unknown): PremiumPlan | null => {
  if (value === "monthly" || value === "yearly") return value;
  return null;
};

const resolveMappedUserAndPlan = (
  metadata: Record<string, unknown>,
  externalReference: string | null,
): { userId: string; plan: PremiumPlan | null } | null => {
  const metadataUserId =
    toStringValue(metadata.userId) || toStringValue(metadata.user_id) || toStringValue(metadata.uid);
  const metadataPlan = toPlan(metadata.plan) || toPlan(metadata.subscription_plan);

  if (metadataUserId) {
    return { userId: metadataUserId, plan: metadataPlan };
  }

  const external = parseCard2CryptoExternalReference(externalReference);
  if (!external) return null;
  return { userId: external.userId, plan: external.plan };
};

export const dynamic = "force-dynamic";

export const GET = async (request: NextRequest) => {
  const apiKey = getCard2CryptoApiKey();
  if (!apiKey) {
    return NextResponse.json(
      { error: "Billing is not configured yet. Please set CARD2CRYPTO_API_KEY." },
      { status: 503 },
    );
  }

  if (!isCard2CryptoLiveKey(apiKey)) {
    return NextResponse.json(
      {
        error:
          "Payment status lookup is only supported for c2c_live_/c2c_test_ API keys. Your current key uses payment-link mode.",
      },
      { status: 400 },
    );
  }

  const paymentId = request.nextUrl.searchParams.get("paymentId")?.trim();
  if (!paymentId) {
    return NextResponse.json({ error: "Missing paymentId" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const fetchPayment = async (path: string) =>
    fetch(getCard2CryptoApiUrl(path), {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });

  const paymentLookupPaths = [
    `/payments/${encodeURIComponent(paymentId)}`,
    `/payments?payment_id=${encodeURIComponent(paymentId)}`,
    `/payments?id=${encodeURIComponent(paymentId)}`,
  ];

  let response: Response | null = null;
  let payload: unknown = null;

  for (const path of paymentLookupPaths) {
    response = await fetchPayment(path);
    payload = await response.json().catch(() => null);

    if (response.ok) break;
    if (response.status !== 404) break;
  }

  if (!response || !response.ok) {
    const upstreamError = extractCard2CryptoErrorMessage(payload) || "Failed to fetch payment status";
    const hint =
      response?.status === 404
        ? "Card2Crypto endpoint returned 404. Verify CARD2CRYPTO_API_BASE_URL with your current docs/dashboard."
        : null;

    return NextResponse.json(
      {
        error: hint ? `${upstreamError} ${hint}` : upstreamError,
      },
      {
        status:
          response && response.status >= 400 && response.status < 600 ? response.status : 502,
      },
    );
  }

  const payment = extractCard2CryptoPayment(payload);
  if (!payment) {
    return NextResponse.json({ error: "Invalid payment response" }, { status: 502 });
  }

  const mapped = resolveMappedUserAndPlan(payment.metadata, payment.externalReference);
  if (mapped && mapped.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const isPaid = isCard2CryptoPaid(null, payment.status);

  if (isPaid && mapped?.plan && mapped.userId === user.id) {
    const admin = createAdminClient();
    const { data: existingUser } = await admin.auth.admin.getUserById(user.id);
    const currentMetadata =
      (existingUser?.user?.user_metadata as Record<string, unknown> | undefined) || {};
    const expiresAt = extendPremiumExpiry(
      currentMetadata.premium_expires_at,
      PLAN_DURATIONS_DAYS[mapped.plan],
    );

    await admin.auth.admin.updateUserById(user.id, {
      user_metadata: {
        ...currentMetadata,
        premium_active: true,
        premium_plan: mapped.plan,
        premium_provider: "card2crypto",
        premium_expires_at: expiresAt,
        premium_payment_id: payment.id,
        premium_updated_at: new Date().toISOString(),
      },
    });
  }

  return NextResponse.json({
    paymentId: payment.id,
    status: payment.status,
    plan: mapped?.plan ?? null,
    isPaid,
  });
};
