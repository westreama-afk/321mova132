import { NextRequest, NextResponse } from "next/server";
import { PremiumPlan } from "@/utils/billing/premium";
import { createClient } from "@/utils/supabase/server";
import {
  buildCard2CryptoExternalReference,
  extractCard2CryptoErrorMessage,
  extractCard2CryptoPayment,
  getCard2CryptoApiUrl,
  getCard2CryptoApiKey,
  getCard2CryptoHostedPaymentLink,
  getCard2CryptoPlanPrice,
  isCard2CryptoLiveKey,
  toCard2CryptoAmountCents,
} from "@/utils/billing/card2crypto";

const PAYMENT_CURRENCY = "usd";

const toObject = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const parsePlan = (body: unknown): PremiumPlan | null => {
  const payload = toObject(body);
  if (!payload) return null;
  const { plan } = payload;
  if (plan === "monthly" || plan === "yearly") return plan;
  return null;
};

export const dynamic = "force-dynamic";

export const POST = async (request: NextRequest) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const plan = parsePlan(body);
  if (!plan) {
    return NextResponse.json({ error: "Invalid plan. Use monthly or yearly." }, { status: 400 });
  }

  const apiKey = getCard2CryptoApiKey();
  const fallbackHostedLink = getCard2CryptoHostedPaymentLink(plan);

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const amountUsd = Number(getCard2CryptoPlanPrice(plan).toFixed(2));
  const amountCents = toCard2CryptoAmountCents(amountUsd);
  const externalReference = buildCard2CryptoExternalReference(user.id, plan);
  const returnUrl = new URL("/billing", request.nextUrl.origin);
  const webhookUrl = new URL("/api/billing/card2crypto/webhook", request.nextUrl.origin);
  returnUrl.searchParams.set("checkout", "complete");
  returnUrl.searchParams.set("plan", plan);

  if (!apiKey) {
    if (fallbackHostedLink) {
      return NextResponse.json({
        paymentId: null,
        paymentUrl: fallbackHostedLink,
        plan,
        amountUsd,
        amountCents,
        currency: PAYMENT_CURRENCY,
        mode: "hosted-link-fallback",
      });
    }

    return NextResponse.json(
      {
        error: "Billing is not configured yet. Set CARD2CRYPTO_API_KEY or CARD2CRYPTO_*_PAYMENT_URL.",
      },
      { status: 503 },
    );
  }

  const useDirectPaymentsApi = isCard2CryptoLiveKey(apiKey);
  const endpointPath = useDirectPaymentsApi ? "/payments" : "/payment-links";
  const title = `321 Player Ad-Free ${plan === "yearly" ? "Yearly" : "Monthly"} Plan`;
  const payload = useDirectPaymentsApi
    ? {
        amount: amountCents,
        currency: PAYMENT_CURRENCY,
        title,
        description: title,
        return_url: returnUrl.toString(),
        webhook_url: webhookUrl.toString(),
        metadata: {
          userId: user.id,
          user_id: user.id,
          plan,
          email: user.email || "",
          externalReference,
        },
      }
    : {
        title,
        amount: amountUsd,
        description: title,
        webhook_url: webhookUrl.toString(),
      };

  const response = await fetch(getCard2CryptoApiUrl(endpointPath), {
    method: "POST",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "Idempotency-Key": externalReference,
    },
    body: JSON.stringify(payload),
  });

  const responsePayload = await response.json().catch(() => null);

  if (!response.ok) {
    const upstreamError =
      extractCard2CryptoErrorMessage(responsePayload) ||
      "Failed to create Card2Crypto checkout session";
    if (
      response.status === 403 &&
      upstreamError.toLowerCase().includes("payment link limit reached") &&
      fallbackHostedLink
    ) {
      return NextResponse.json({
        paymentId: null,
        paymentUrl: fallbackHostedLink,
        plan,
        amountUsd,
        amountCents,
        currency: PAYMENT_CURRENCY,
        mode: "hosted-link-fallback",
        warning: "Payment link limit reached, so hosted fallback link was used.",
      });
    }
    if (response.status === 404 && fallbackHostedLink) {
      return NextResponse.json({
        paymentId: null,
        paymentUrl: fallbackHostedLink,
        plan,
        amountUsd,
        amountCents,
        currency: PAYMENT_CURRENCY,
        mode: "hosted-link-fallback",
        warning:
          "Card2Crypto API returned 404, so checkout was routed to hosted payment link fallback.",
      });
    }

    const hint =
      response.status === 404
        ? "Card2Crypto endpoint returned 404. Verify CARD2CRYPTO_API_BASE_URL or set CARD2CRYPTO_*_PAYMENT_URL fallback links."
        : response.status === 403 && upstreamError.toLowerCase().includes("payment link limit reached")
          ? "Delete old links in Card2Crypto dashboard, upgrade plan, or set CARD2CRYPTO_*_PAYMENT_URL fallback links."
          : null;

    return NextResponse.json(
      {
        error: hint ? `${upstreamError} ${hint}` : upstreamError,
      },
      { status: response.status >= 400 && response.status < 600 ? response.status : 502 },
    );
  }

  const payment = extractCard2CryptoPayment(responsePayload);
  if (!payment?.paymentUrl) {
    return NextResponse.json(
      {
        error: "Card2Crypto response did not include a payment URL",
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    paymentId: payment.id,
    paymentUrl: payment.paymentUrl,
    plan,
    amountUsd,
    amountCents,
    currency: PAYMENT_CURRENCY,
    mode: useDirectPaymentsApi ? "api-payments" : "api-payment-links",
  });
};
