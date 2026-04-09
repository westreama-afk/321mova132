import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";
import { extendPremiumExpiry, PremiumPlan } from "@/utils/billing/premium";
import {
  extractSellAuthErrorMessage,
  extractSellAuthInvoice,
  getSellAuthApiKey,
  getSellAuthApiUrl,
  getSellAuthInvoiceId,
  getSellAuthShopId,
  isSellAuthInvoicePaid,
} from "@/utils/billing/sellauth";

const PLAN_DURATIONS_DAYS: Record<PremiumPlan, number> = {
  monthly: 30,
  yearly: 365,
};

const toObject = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const toStringValue = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const toPlan = (value: unknown): PremiumPlan | null => {
  if (value === "monthly" || value === "yearly") return value;
  return null;
};

export const dynamic = "force-dynamic";

export const GET = async (request: NextRequest) => {
  const apiKey = getSellAuthApiKey();
  const shopId = getSellAuthShopId();
  if (!apiKey || !shopId) {
    return NextResponse.json(
      { error: "Billing is not configured yet. Set SELLAUTH_API_KEY and SELLAUTH_SHOP_ID." },
      { status: 503 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const currentMetadata = toObject(user.user_metadata) || {};
  const pendingProvider = toStringValue(currentMetadata.premium_pending_provider);
  const pendingInvoiceId = toStringValue(currentMetadata.premium_pending_invoice_id);
  const pendingPlan = toPlan(currentMetadata.premium_pending_plan);
  const invoiceId = request.nextUrl.searchParams.get("invoiceId")?.trim() || pendingInvoiceId;

  if (!invoiceId) {
    if (pendingProvider === "sellauth_hosted") {
      return NextResponse.json(
        {
          error:
            "Hosted SellAuth checkout does not expose invoice status through this endpoint. Redeem the code you receive after payment.",
        },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Missing invoiceId" }, { status: 400 });
  }

  if (pendingInvoiceId && invoiceId !== pendingInvoiceId) {
    return NextResponse.json(
      { error: "Invoice does not match your latest pending checkout." },
      { status: 403 },
    );
  }

  const response = await fetch(
    getSellAuthApiUrl(`/shops/${encodeURIComponent(shopId)}/invoices/${encodeURIComponent(invoiceId)}`),
    {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    },
  );

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const upstreamError = extractSellAuthErrorMessage(payload) || "Failed to fetch invoice status";
    return NextResponse.json(
      {
        error: upstreamError,
      },
      {
        status: response.status >= 400 && response.status < 600 ? response.status : 502,
      },
    );
  }

  const invoice = extractSellAuthInvoice(payload);
  if (!invoice) {
    return NextResponse.json({ error: "Invalid invoice response" }, { status: 502 });
  }

  const resolvedInvoiceId = getSellAuthInvoiceId(invoice) || invoiceId;
  const isPaid = isSellAuthInvoicePaid(invoice);
  const invoiceStatus = toStringValue(invoice.status) || "unknown";

  if (isPaid && pendingPlan) {
    const admin = createAdminClient();
    const { data: existingUser } = await admin.auth.admin.getUserById(user.id);
    const existingMetadata =
      (existingUser?.user?.user_metadata as Record<string, unknown> | undefined) || {};
    const expiresAt = extendPremiumExpiry(
      existingMetadata.premium_expires_at,
      PLAN_DURATIONS_DAYS[pendingPlan],
    );

    const nextMetadata = {
      ...existingMetadata,
      premium_active: true,
      premium_plan: pendingPlan,
      premium_provider: "sellauth",
      premium_expires_at: expiresAt,
      premium_payment_id: resolvedInvoiceId,
      premium_updated_at: new Date().toISOString(),
      premium_pending_provider: null,
      premium_pending_plan: null,
      premium_pending_invoice_id: null,
      premium_pending_checkout_url: null,
      premium_pending_updated_at: null,
    };

    await admin.auth.admin.updateUserById(user.id, {
      user_metadata: nextMetadata,
    });
  }

  return NextResponse.json({
    invoiceId: resolvedInvoiceId,
    status: invoiceStatus,
    plan: pendingPlan,
    isPaid,
  });
};
