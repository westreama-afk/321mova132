import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

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

  if (!body.requested_points || !body.requested_value_usd || !body.payout_email) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
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

  if (account.points_balance < body.requested_points) {
    return NextResponse.json({ error: "Not enough points" }, { status: 400 });
  }

  const { error: spendError } = await supabase.rpc("increment_reward_account_spent", {
    p_user_id: user.id,
    p_points: body.requested_points,
  });

  if (spendError) {
    return NextResponse.json({ error: spendError.message }, { status: 500 });
  }

  const { error: ledgerError } = await supabase.from("reward_ledger").insert({
    user_id: user.id,
    entry_type: "reward_request_hold",
    points: -body.requested_points,
    metadata: {
      requested_value_usd: body.requested_value_usd,
      payout_email: body.payout_email,
    },
  });

  if (ledgerError) {
    return NextResponse.json({ error: ledgerError.message }, { status: 500 });
  }

  const { error } = await supabase.from("reward_requests").insert({
    user_id: user.id,
    requested_points: body.requested_points,
    requested_value_usd: body.requested_value_usd,
    payout_email: body.payout_email,
    notes: body.notes ?? null,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ message: "Reward request submitted" });
}
