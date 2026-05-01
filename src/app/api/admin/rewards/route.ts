import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("is_admin").eq("id", user.id).single();
  if (!profile?.is_admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const status = request.nextUrl.searchParams.get("status");
  const search = request.nextUrl.searchParams.get("search")?.trim().toLowerCase() ?? "";

  const [requestsRes, accountsRes, referralsRes, ledgerRes, profilesRes] = await Promise.all([
    supabase.from("reward_requests").select("*").order("created_at", { ascending: false }).limit(100),
    supabase.from("reward_accounts").select("*").order("updated_at", { ascending: false }).limit(50),
    supabase.from("referrals").select("*").order("created_at", { ascending: false }).limit(100),
    supabase.from("reward_ledger").select("*").order("created_at", { ascending: false }).limit(100),
    supabase.from("profiles").select("id, username").order("username", { ascending: true }).limit(100),
  ]);

  const profileMap = new Map((profilesRes.data ?? []).map((profileRow) => [profileRow.id, profileRow.username]));

  const filteredAccounts = (accountsRes.data ?? []).filter((account) =>
    search ? account.user_id.toLowerCase().includes(search) || account.referral_code.toLowerCase().includes(search) : true,
  );

  const filteredRequests = (requestsRes.data ?? []).filter((item) => {
    const username = profileMap.get(item.user_id)?.toLowerCase() ?? "";
    const matchesStatus = !status || status === "all" || item.status === status;
    const matchesSearch = search
      ? username.includes(search) ||
        item.user_id.toLowerCase().includes(search) ||
        (item.payout_email?.toLowerCase().includes(search) ?? false) ||
        String(item.id).includes(search)
      : true;
    return matchesStatus && matchesSearch;
  });

  const decoratedReferrals = (referralsRes.data ?? []).map((referral) => ({
    ...referral,
    referrer_username: profileMap.get(referral.referrer_id) ?? null,
    referred_username: profileMap.get(referral.referred_id) ?? null,
  }));

  const decoratedLedger = (ledgerRes.data ?? []).map((entry) => ({
    ...entry,
    username: profileMap.get(entry.user_id) ?? null,
  }));

  return NextResponse.json({
    data: filteredRequests,
    summary: {
      total_pending: (requestsRes.data ?? []).filter((item) => item.status === "pending").length,
      total_requests: requestsRes.data?.length ?? 0,
      reward_accounts: filteredAccounts,
      referrals: search
        ? decoratedReferrals.filter((referral) => {
            const referrer = referral.referrer_username?.toLowerCase() ?? "";
            const referred = referral.referred_username?.toLowerCase() ?? "";
            return referrer.includes(search) || referred.includes(search) || referral.referrer_id.toLowerCase().includes(search) || referral.referred_id.toLowerCase().includes(search);
          })
        : decoratedReferrals,
      ledger: search
        ? decoratedLedger.filter((entry) => (entry.username?.toLowerCase() ?? "").includes(search) || entry.user_id.toLowerCase().includes(search) || String(entry.id).includes(search))
        : decoratedLedger,
    },
  });
}
