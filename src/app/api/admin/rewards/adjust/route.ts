import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("is_admin").eq("id", user.id).single();
  if (!profile?.is_admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await request.json()) as { username?: string; points?: number; reason?: string };
  const username = body.username?.trim().replace(/^@/, "");
  if (!username || !body.points || !body.reason) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const { data: targetProfile, error: targetError } = await supabase
    .from("profiles")
    .select("id, username")
    .eq("username", username)
    .maybeSingle();

  if (targetError) return NextResponse.json({ error: targetError.message }, { status: 500 });
  if (!targetProfile) return NextResponse.json({ error: "User not found" }, { status: 404 });

  await supabase.rpc("ensure_reward_account", { p_user_id: targetProfile.id });
  await supabase.rpc("increment_reward_account_balance", {
    p_user_id: targetProfile.id,
    p_points: body.points,
  });

  const { error } = await supabase.from("reward_ledger").insert({
    user_id: targetProfile.id,
    entry_type: body.points > 0 ? "admin_bonus" : "admin_adjustment",
    points: body.points,
    metadata: { reason: body.reason, admin_id: user.id, username: targetProfile.username },
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ message: `Adjusted rewards for ${targetProfile.username}` });
}
