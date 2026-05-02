import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import {
  REWARD_POINTS_PER_USD,
  rewardUsdFromPoints,
  roundRewardUsd,
} from "@/utils/rewardPayout";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json()) as {
    requested_points?: number;
    requested_value_usd?: number;
    payout_email?: string;
    notes?: string;
  };

  const payoutEmail = typeof body.payout_email === "string" ? body.payout_email.trim() : "";
  const requested_points = Math.round(Number(body.requested_points));
  const requested_value_usd = roundRewardUsd(Number(body.requested_value_usd));

  if (!payoutEmail) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  if (!Number.isFinite(requested_points) || requested_points < 500) {
    return NextResponse.json({ error: "Minimum redemption is 500 points" }, { status: 400 });
  }

  if (!Number.isFinite(requested_value_usd) || requested_value_usd <= 0) {
    return NextResponse.json({ error: "Invalid payout amount" }, { status: 400 });
  }

  const expectedUsd = rewardUsdFromPoints(requested_points);
  if (expectedUsd !== requested_value_usd) {
    return NextResponse.json(
      {
        error: `Points and USD must match the fixed rate (${REWARD_POINTS_PER_USD} points = $1.00).`,
      },
      { status: 400 },
    );
  }

  await supabase.rpc("ensure_reward_account", { p_user_id: user.id });
  const { data: account, error: accountError } = await supabase
    .from("reward_accounts")
    .select("points_balance")
    .eq("user_id", user.id)
    .single();

  if (accountError || !account) {
    return NextResponse.json({ error: accountError?.message ?? "Reward account not found" }, { status: 500 });
  }

  if (account.points_balance < requested_points) {
    return NextResponse.json({ error: "Not enough points" }, { status: 400 });
  }

  const { error: spendError } = await supabase.rpc("increment_reward_account_spent", {
    p_user_id: user.id,
    p_points: requested_points,
  });

  if (spendError) {
    return NextResponse.json({ error: spendError.message }, { status: 500 });
  }

  const { error: ledgerError } = await supabase.from("reward_ledger").insert({
    user_id: user.id,
    entry_type: "reward_request_hold",
    points: -requested_points,
    metadata: {
      requested_value_usd: requested_value_usd,
      payout_email: payoutEmail,
    },
  });

  if (ledgerError) {
    return NextResponse.json({ error: ledgerError.message }, { status: 500 });
  }

  const { error } = await supabase.from("reward_requests").insert({
    user_id: user.id,
    requested_points: requested_points,
    requested_value_usd: requested_value_usd,
    payout_email: payoutEmail,
    notes: body.notes ?? null,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ message: "Reward request submitted" });
}
