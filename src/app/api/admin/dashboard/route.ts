import { NextRequest, NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { requireAdminRoute } from "@/utils/admin";

type AuthUserSummary = {
  id: string;
  email: string | null;
  created_at: string | null;
  last_sign_in_at: string | null;
};

export async function GET(request: NextRequest) {
  const adminCheck = await requireAdminRoute();
  if (adminCheck.response) return adminCheck.response;

  const { adminSupabase } = adminCheck.context;
  const search = request.nextUrl.searchParams.get("search")?.trim().toLowerCase() ?? "";

  const [
    usersRes,
    profilesRes,
    commentsRes,
    ratingsRes,
    historiesRes,
    watchlistRes,
    premiumCodesRes,
    premiumRedemptionsRes,
    partyRoomsRes,
    partyMessagesRes,
    downloadsRes,
    rewardRequestsRes,
    rewardAccountsRes,
    referralsRes,
  ] = await Promise.all([
    adminSupabase.auth.admin.listUsers({ page: 1, perPage: 100 }),
    adminSupabase
      .from("profiles")
      .select("id, username, is_admin, created_at")
      .order("created_at", { ascending: false })
      .limit(200),
    adminSupabase
      .from("comments")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200),
    adminSupabase
      .from("ratings")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(200),
    adminSupabase
      .from("histories")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(200),
    adminSupabase
      .from("watchlist")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200),
    adminSupabase
      .from("premium_codes")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200),
    adminSupabase
      .from("premium_code_redemptions")
      .select("*")
      .order("redeemed_at", { ascending: false })
      .limit(200),
    adminSupabase
      .from("party_rooms")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100),
    adminSupabase
      .from("party_messages")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200),
    adminSupabase.from("app_downloads").select("*").limit(1).maybeSingle(),
    adminSupabase
      .from("reward_requests")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100),
    adminSupabase
      .from("reward_accounts")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(100),
    adminSupabase
      .from("referrals")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const authUsers = (
    "data" in usersRes && usersRes.data?.users
      ? usersRes.data.users
      : []
  ) as User[];

  const authUsersSummaries: AuthUserSummary[] = authUsers.map((user) => ({
    id: user.id,
    email: user.email ?? null,
    created_at: user.created_at ?? null,
    last_sign_in_at: user.last_sign_in_at ?? null,
  }));

  const profileMap = new Map(
    (profilesRes.data ?? []).map((profile) => [profile.id, profile.username]),
  );
  const authUserMap = new Map(authUsersSummaries.map((user) => [user.id, user]));

  const users = authUsersSummaries
    .map((authUser) => {
      const profile = (profilesRes.data ?? []).find((row) => row.id === authUser.id);
      return {
        id: authUser.id,
        email: authUser.email,
        created_at: authUser.created_at,
        last_sign_in_at: authUser.last_sign_in_at,
        username: profile?.username ?? null,
        is_admin: Boolean(profile?.is_admin),
        profile_created_at: profile?.created_at ?? null,
      };
    })
    .filter((user) => {
      if (!search) return true;
      return (
        user.id.toLowerCase().includes(search) ||
        (user.email?.toLowerCase().includes(search) ?? false) ||
        (user.username?.toLowerCase().includes(search) ?? false)
      );
    });

  const comments = (commentsRes.data ?? []).map((comment) => ({
    ...comment,
    username: profileMap.get(comment.user_id) ?? null,
    user_email: authUserMap.get(comment.user_id)?.email ?? null,
  }));

  const ratings = (ratingsRes.data ?? []).map((rating) => ({
    ...rating,
    username: profileMap.get(rating.user_id) ?? null,
    user_email: authUserMap.get(rating.user_id)?.email ?? null,
  }));

  const histories = (historiesRes.data ?? []).map((history) => ({
    ...history,
    username: profileMap.get(history.user_id) ?? null,
    user_email: authUserMap.get(history.user_id)?.email ?? null,
  }));

  const watchlist = (watchlistRes.data ?? []).map((item) => ({
    ...item,
    username: profileMap.get(item.user_id) ?? null,
    user_email: authUserMap.get(item.user_id)?.email ?? null,
  }));

  const premiumCodes = (premiumCodesRes.data ?? []).map((code) => ({
    ...code,
    created_by_username: code.created_by ? profileMap.get(code.created_by) ?? null : null,
    last_redeemed_by_username: code.last_redeemed_by
      ? profileMap.get(code.last_redeemed_by) ?? null
      : null,
  }));

  const premiumRedemptions = (premiumRedemptionsRes.data ?? []).map((redemption) => ({
    ...redemption,
    username: profileMap.get(redemption.user_id) ?? null,
    user_email: authUserMap.get(redemption.user_id)?.email ?? null,
  }));

  const partyRooms = (partyRoomsRes.data ?? []).map((room) => ({
    ...room,
    host_username: room.host_id ? profileMap.get(room.host_id) ?? null : null,
    host_email: room.host_id ? authUserMap.get(room.host_id)?.email ?? null : null,
  }));

  const partyMessages = (partyMessagesRes.data ?? []).map((message) => ({
    ...message,
    user_email: message.user_id ? authUserMap.get(message.user_id)?.email ?? null : null,
  }));

  const rewardAccounts = (rewardAccountsRes.data ?? []).map((account) => ({
    ...account,
    username: profileMap.get(account.user_id) ?? null,
    referred_by_username: account.referred_by
      ? profileMap.get(account.referred_by) ?? null
      : null,
  }));

  const rewardRequests = (rewardRequestsRes.data ?? []).map((requestRow) => ({
    ...requestRow,
    username: profileMap.get(requestRow.user_id) ?? null,
  }));

  const referrals = (referralsRes.data ?? []).map((referral) => ({
    ...referral,
    referrer_username: profileMap.get(referral.referrer_id) ?? null,
    referred_username: profileMap.get(referral.referred_id) ?? null,
  }));

  return NextResponse.json({
    data: {
      users,
      community: {
        comments,
        ratings,
      },
      watch: {
        histories,
        watchlist,
      },
      premium: {
        codes: premiumCodes,
        redemptions: premiumRedemptions,
      },
      parties: {
        rooms: partyRooms,
        messages: partyMessages,
      },
      downloads: downloadsRes.data
        ? {
            count: downloadsRes.data.count,
            updated_at: downloadsRes.data.updated_at,
          }
        : null,
      rewards: {
        requests: rewardRequests,
        accounts: rewardAccounts,
        referrals,
      },
    },
    summary: {
      users_total: users.length,
      admins_total: users.filter((user) => user.is_admin).length,
      comments_total: comments.length,
      ratings_total: ratings.length,
      premium_codes_total: premiumCodes.length,
      active_premium_codes_total: premiumCodes.filter((code) => code.active).length,
      premium_redemptions_total: premiumRedemptions.length,
      party_rooms_total: partyRooms.length,
      active_party_rooms_total: partyRooms.filter(
        (room) => new Date(room.expires_at).getTime() > Date.now(),
      ).length,
      party_messages_total: partyMessages.length,
      download_count: downloadsRes.data?.count ?? 0,
      histories_total: histories.length,
      watchlist_total: watchlist.length,
      reward_requests_total: rewardRequests.length,
      reward_pending_total: rewardRequests.filter((requestRow) => requestRow.status === "pending")
        .length,
      reward_accounts_total: rewardAccounts.length,
      referrals_total: referrals.length,
    },
  });
}
