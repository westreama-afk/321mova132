import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("is_admin").eq("id", user.id).single();
  if (!profile?.is_admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const rewardRequestId = Number(id);
  if (!Number.isFinite(rewardRequestId)) return NextResponse.json({ error: "Invalid request id" }, { status: 400 });

  const body = (await request.json()) as { status?: "approved" | "rejected" | "fulfilled"; admin_notes?: string; payout_reference?: string; };
  if (!body.status) return NextResponse.json({ error: "Status is required" }, { status: 400 });

  const { data: requestRow } = await supabase.from("reward_requests").select("*").eq("id", rewardRequestId).single();
  if (!requestRow) return NextResponse.json({ error: "Reward request not found" }, { status: 404 });

  if (requestRow.status === "fulfilled") {
    return NextResponse.json({ error: "Request is already fulfilled" }, { status: 400 });
  }

  const updatePayload: Record<string, string | null> = {
    status: body.status,
    admin_notes: body.admin_notes?.trim() ? body.admin_notes.trim() : null,
    reviewed_at: new Date().toISOString(),
    reviewed_by: user.id,
    payout_reference: body.payout_reference?.trim() ? body.payout_reference.trim() : null,
  };

  if (body.status === "fulfilled") updatePayload.fulfilled_at = new Date().toISOString();

  const { error } = await supabase.from("reward_requests").update(updatePayload).eq("id", rewardRequestId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (body.status === "rejected") {
    await supabase.rpc("increment_reward_account_balance", { p_user_id: requestRow.user_id, p_points: requestRow.requested_points });
    await supabase.from("reward_ledger").insert({
      user_id: requestRow.user_id,
      entry_type: "reward_request_refund",
      points: requestRow.requested_points,
      reference_id: rewardRequestId,
      metadata: { admin_notes: body.admin_notes ?? null },
    });
  }

  if (body.status === "fulfilled") {
    await supabase.from("reward_ledger").insert({
      user_id: requestRow.user_id,
      entry_type: "reward_redeemed",
      points: 0,
      reference_id: rewardRequestId,
      metadata: { payout_reference: body.payout_reference ?? null, reward_type: requestRow.reward_type },
    });
  }

  return NextResponse.json({ message: "Reward request updated" });
}
