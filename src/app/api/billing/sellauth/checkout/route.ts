import { NextRequest, NextResponse } from "next/server";
import { PremiumPlan } from "@/utils/billing/premium";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  buildSellAuthCartForPlan,
  extractSellAuthCheckout,
  extractSellAuthErrorMessage,
  getSellAuthApiKey,
  getSellAuthApiUrl,
  getSellAuthCheckoutMode,
  getSellAuthHostedCheckoutUrl,
  getSellAuthPlanPrice,
  getSellAuthShopId,
} from "@/utils/billing/sellauth";

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

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const amountUsd = Number(getSellAuthPlanPrice(plan).toFixed(2));
  const checkoutMode = getSellAuthCheckoutMode();
  const hostedCheckoutUrl = getSellAuthHostedCheckoutUrl(plan);

  if (checkoutMode === "hosted") {
    if (!hostedCheckoutUrl) {
      return NextResponse.json(
        {
          error:
            "Hosted SellAuth checkout is enabled, but SELLAUTH_*_CHECKOUT_URL is not set for this plan.",
        },
        { status: 503 },
      );
    }

    const admin = createAdminClient();
    const currentMetadata = toObject(user.user_metadata) || {};
    const nextMetadata = {
      ...currentMetadata,
      premium_pending_provider: "sellauth_hosted",
      premium_pending_plan: plan,
      premium_pending_invoice_id: null,
      premium_pending_checkout_url: hostedCheckoutUrl,
      premium_pending_updated_at: new Date().toISOString(),
    };

    await admin.auth.admin.updateUserById(user.id, {
      user_metadata: nextMetadata,
    });

    return NextResponse.json({
      checkoutUrl: hostedCheckoutUrl,
      invoiceId: null,
      plan,
      amountUsd,
      mode: "sellauth-hosted",
    });
  }

  const apiKey = getSellAuthApiKey();
  const shopId = getSellAuthShopId();
  const cart = buildSellAuthCartForPlan(plan);

  if (!apiKey || !shopId || !cart) {
    return NextResponse.json(
      {
        error:
          "SellAuth API checkout is not configured. Set SELLAUTH_API_KEY, SELLAUTH_SHOP_ID, and product IDs, or switch to hosted mode.",
      },
      { status: 503 },
    );
  }
  const requestPayload: Record<string, unknown> = {
    cart,
    ...(user.email ? { email: user.email } : {}),
  };

  const response = await fetch(getSellAuthApiUrl(`/shops/${encodeURIComponent(shopId)}/checkout`), {
    method: "POST",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(requestPayload),
  });

  const responsePayload = await response.json().catch(() => null);
  if (!response.ok) {
    const upstreamError = extractSellAuthErrorMessage(responsePayload) || "Failed to create checkout";
    return NextResponse.json(
      {
        error: upstreamError,
      },
      { status: response.status >= 400 && response.status < 600 ? response.status : 502 },
    );
  }

  const checkout = extractSellAuthCheckout(responsePayload);
  const checkoutUrl = checkout?.checkoutUrl || checkout?.invoiceUrl;
  if (!checkoutUrl) {
    return NextResponse.json(
      {
        error: "SellAuth response did not include a checkout URL",
      },
      { status: 502 },
    );
  }

  const admin = createAdminClient();
  const currentMetadata = toObject(user.user_metadata) || {};
  const nextMetadata = {
    ...currentMetadata,
    premium_pending_provider: "sellauth",
    premium_pending_plan: plan,
    premium_pending_invoice_id: checkout?.invoiceId,
    premium_pending_checkout_url: checkoutUrl,
    premium_pending_updated_at: new Date().toISOString(),
  };

  await admin.auth.admin.updateUserById(user.id, {
    user_metadata: nextMetadata,
  });

  return NextResponse.json({
    checkoutUrl,
    invoiceId: checkout?.invoiceId ?? null,
    plan,
    amountUsd,
    mode: "sellauth",
  });
};
