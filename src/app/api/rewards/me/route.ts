import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await supabase.rpc("ensure_reward_account", { p_user_id: user.id });
  const { data: account } = await supabase
    .from("reward_accounts")
    .select("*")
    .eq("user_id", user.id)
    .single();

  const [ledgerRes, referralsRes, requestsRes] = await Promise.all([
    supabase.from("reward_ledger").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(20),
    supabase.from("referrals").select("*").eq("referrer_id", user.id).order("created_at", { ascending: false }).limit(20),
    supabase.from("reward_requests").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(20),
  ]);

  return NextResponse.json({
    account,
    ledger: ledgerRes.data ?? [],
    referrals: referralsRes.data ?? [],
    requests: requestsRes.data ?? [],
    referral_link: account?.referral_code
      ? `${(process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "")}/auth?form=register&ref=${account.referral_code}` ||
        `/auth?form=register&ref=${account.referral_code}`
      : null,
    referral_stats: {
      total: referralsRes.data?.length ?? 0,
      pending: (referralsRes.data ?? []).filter((referral) => referral.status === "pending").length,
      verified: (referralsRes.data ?? []).filter((referral) => referral.status === "verified").length,
      rewarded: (referralsRes.data ?? []).filter((referral) => referral.status === "rewarded").length,
    },
  });
}
