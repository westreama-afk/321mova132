import { NextRequest, NextResponse } from "next/server";
import { PostgrestError } from "@supabase/supabase-js";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";
import { extendPremiumExpiry, PremiumPlan } from "@/utils/billing/premium";

interface RedeemPayload {
  code?: unknown;
}

interface RedeemRpcRow {
  code_id: number;
  plan: string;
  duration_days: number;
}

interface RedeemResult {
  codeId: number;
  plan: PremiumPlan;
  durationDays: number;
}

type RedeemDirectResult =
  | { success: true; value: RedeemResult }
  | { success: false; error: string; status: number };

const toObject = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const normalizeCode = (value: string): string => value.trim().toUpperCase();

const toPlan = (value: unknown): PremiumPlan | null => {
  if (value === "monthly" || value === "yearly") return value;
  return null;
};

const mapRedeemError = (
  error: Pick<PostgrestError, "message" | "code" | "details" | "hint"> | null,
): { status: number; error: string } => {
  const normalized = (error?.message || "").toUpperCase();
  const details = (error?.details || "").toUpperCase();
  const hint = (error?.hint || "").toUpperCase();
  const code = (error?.code || "").toUpperCase();

  if (normalized.includes("AUTH_REQUIRED")) {
    return { status: 401, error: "You must be signed in to redeem a code." };
  }
  if (normalized.includes("INVALID_CODE")) {
    return { status: 400, error: "Please enter a valid premium code." };
  }
  if (normalized.includes("CODE_NOT_FOUND")) {
    return { status: 404, error: "This premium code is invalid." };
  }
  if (normalized.includes("CODE_EXPIRED")) {
    return { status: 410, error: "This premium code has expired." };
  }
  if (normalized.includes("CODE_ALREADY_REDEEMED")) {
    return { status: 409, error: "You have already redeemed this premium code." };
  }
  if (normalized.includes("CODE_REDEMPTION_LIMIT_REACHED")) {
    return { status: 409, error: "This premium code has reached its redemption limit." };
  }
  if (code === "23505" || normalized.includes("PREMIUM_CODE_REDEMPTIONS_UNIQUE_USER_CODE")) {
    return { status: 409, error: "You have already redeemed this premium code." };
  }
  if (
    normalized.includes("REDEEM_PREMIUM_CODE") &&
    (normalized.includes("DOES NOT EXIST") || normalized.includes("UNDEFINED FUNCTION"))
  ) {
    return {
      status: 500,
      error:
        "Redeem SQL function is missing. Run the latest premium code SQL migration in Supabase.",
    };
  }
  if (
    code === "42702" ||
    normalized.includes("AMBIGUOUS") ||
    details.includes("COULD REFER TO EITHER") ||
    hint.includes("QUALIFY")
  ) {
    return {
      status: 500,
      error:
        "Redeem SQL function has a column ambiguity bug. Run the latest premium code SQL fix migration.",
    };
  }

  return { status: 500, error: "Could not redeem premium code right now." };
};

const shouldFallbackToDirectRedeem = (
  error: Pick<PostgrestError, "message" | "code" | "details" | "hint"> | null,
): boolean => {
  const message = (error?.message || "").toUpperCase();
  const details = (error?.details || "").toUpperCase();
  const code = (error?.code || "").toUpperCase();

  return (
    code === "42702" ||
    message.includes("COLUMN REFERENCE") ||
    message.includes("AMBIGUOUS") ||
    details.includes("COULD REFER TO EITHER")
  );
};

const redeemCodeDirect = async (
  admin: ReturnType<typeof createAdminClient>,
  code: string,
  userId: string,
): Promise<RedeemDirectResult> => {
  const fetchByCode = async (exactCode: string) =>
    admin
      .from("premium_codes")
      .select("id, code, plan, duration_days, max_redemptions, redemption_count, active, expires_at")
      .eq("code", exactCode)
      .maybeSingle();

  let codeLookup = await fetchByCode(code);
  if (!codeLookup.data && !codeLookup.error) {
    codeLookup = await fetchByCode(code.toUpperCase());
  }

  if (codeLookup.error) {
    return { success: false, status: 500, error: "Could not read premium codes table." };
  }

  const codeRow = codeLookup.data;
  if (!codeRow || !codeRow.active) {
    return { success: false, status: 404, error: "This premium code is invalid." };
  }

  const plan = toPlan(codeRow.plan);
  if (!plan) {
    return { success: false, status: 500, error: "Premium code has an invalid plan value." };
  }

  if (typeof codeRow.duration_days !== "number" || codeRow.duration_days < 1) {
    return { success: false, status: 500, error: "Premium code has an invalid duration value." };
  }

  if (codeRow.expires_at) {
    const expiresAt = new Date(codeRow.expires_at);
    if (!Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() <= Date.now()) {
      return { success: false, status: 410, error: "This premium code has expired." };
    }
  }

  const redeemedCheck = await admin
    .from("premium_code_redemptions")
    .select("id")
    .eq("code_id", codeRow.id)
    .eq("user_id", userId)
    .maybeSingle();

  if (redeemedCheck.error) {
    return { success: false, status: 500, error: "Could not validate redemption history." };
  }

  if (redeemedCheck.data) {
    return { success: false, status: 409, error: "You have already redeemed this premium code." };
  }

  if (codeRow.redemption_count >= codeRow.max_redemptions) {
    return { success: false, status: 409, error: "This premium code has reached its redemption limit." };
  }

  const redemptionInsert = await admin.from("premium_code_redemptions").insert({
    code_id: codeRow.id,
    user_id: userId,
    applied_plan: plan,
    applied_days: codeRow.duration_days,
  });

  if (redemptionInsert.error) {
    const duplicate =
      redemptionInsert.error.code === "23505" ||
      redemptionInsert.error.message.toUpperCase().includes("PREMIUM_CODE_REDEMPTIONS_UNIQUE_USER_CODE");
    return {
      success: false,
      status: duplicate ? 409 : 500,
      error: duplicate
        ? "You have already redeemed this premium code."
        : "Could not store redemption record.",
    };
  }

  const nextRedemptionCount = codeRow.redemption_count + 1;
  const setInactive = nextRedemptionCount >= codeRow.max_redemptions;

  const updateCode = await admin
    .from("premium_codes")
    .update({
      redemption_count: nextRedemptionCount,
      last_redeemed_by: userId,
      last_redeemed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      active: setInactive ? false : codeRow.active,
    })
    .eq("id", codeRow.id);

  if (updateCode.error) {
    return { success: false, status: 500, error: "Could not update premium code usage count." };
  }

  return {
    success: true,
    value: {
      codeId: codeRow.id,
      plan,
      durationDays: codeRow.duration_days,
    },
  };
};

export const dynamic = "force-dynamic";

export const POST = async (request: NextRequest) => {
  let body: RedeemPayload;
  try {
    body = (await request.json()) as RedeemPayload;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const rawCode = typeof body?.code === "string" ? body.code : "";
  const code = normalizeCode(rawCode);
  if (code.length < 4 || code.length > 128) {
    return NextResponse.json({ error: "Please enter a valid premium code." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: rpcData, error: rpcError } = await admin.rpc("redeem_premium_code", {
    p_code: code,
    p_user_id: user.id,
  });

  let redeemResult: RedeemResult | null = null;

  if (rpcError) {
    if (shouldFallbackToDirectRedeem(rpcError)) {
      const fallback = await redeemCodeDirect(admin, code, user.id);
      if (!fallback.success) {
        return NextResponse.json({ error: fallback.error }, { status: fallback.status });
      }
      redeemResult = fallback.value;
    } else {
      const mapped = mapRedeemError(rpcError);
      return NextResponse.json({ error: mapped.error }, { status: mapped.status });
    }
  } else {
    const row = Array.isArray(rpcData) ? (rpcData[0] as RedeemRpcRow | undefined) : undefined;
    const plan = toPlan(row?.plan);
    const durationDays =
      typeof row?.duration_days === "number" && Number.isFinite(row.duration_days)
        ? row.duration_days
        : null;

    if (!row || !plan || !durationDays || durationDays < 1) {
      return NextResponse.json({ error: "Redeemed code returned invalid data." }, { status: 500 });
    }

    redeemResult = {
      codeId: row.code_id,
      plan,
      durationDays,
    };
  }

  if (!redeemResult) {
    const mapped = mapRedeemError(rpcError);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }

  const { data: existingUser, error: existingUserError } = await admin.auth.admin.getUserById(user.id);
  if (existingUserError || !existingUser?.user) {
    return NextResponse.json(
      { error: "Could not load account data for premium activation." },
      { status: existingUserError ? 500 : 404 },
    );
  }

  const currentMetadata = toObject(existingUser.user.user_metadata) || {};
  const expiresAt = extendPremiumExpiry(currentMetadata.premium_expires_at, redeemResult.durationDays);

  const nextMetadata = {
    ...currentMetadata,
    premium_active: true,
    premium_plan: redeemResult.plan,
    premium_provider: "premium_code",
    premium_expires_at: expiresAt,
    premium_payment_id: `code:${redeemResult.codeId}`,
    premium_updated_at: new Date().toISOString(),
    premium_code_id: redeemResult.codeId,
  };

  const { error: updateError } = await admin.auth.admin.updateUserById(user.id, {
    user_metadata: nextMetadata,
  });

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    plan: redeemResult.plan,
    durationDays: redeemResult.durationDays,
    expiresAt,
  });
};
