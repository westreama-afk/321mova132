"use client";

import { addToast } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type {
  Referral,
  RewardAccount,
  RewardRequest,
  RewardRequestStatus,
} from "@/types/rewards";

type AdminUser = {
  id: string;
  email: string | null;
  created_at: string | null;
  last_sign_in_at: string | null;
  username: string | null;
  is_admin: boolean;
  profile_created_at: string | null;
};

type AdminComment = {
  id: number;
  user_id: string;
  username: string | null;
  user_email: string | null;
  content: string;
  media_id: number;
  media_type: "movie" | "tv";
  created_at: string;
  updated_at: string;
};

type AdminRating = {
  user_id: string;
  username: string | null;
  user_email: string | null;
  media_id: number;
  media_type: "movie" | "tv";
  rating: number;
  created_at: string;
  updated_at: string;
};

type AdminPremiumCode = {
  id: number;
  code: string;
  plan: "monthly" | "yearly";
  duration_days: number;
  max_redemptions: number;
  redemption_count: number;
  active: boolean;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  last_redeemed_by: string | null;
  last_redeemed_at: string | null;
  created_by_username: string | null;
  last_redeemed_by_username: string | null;
};

type AdminPremiumRedemption = {
  id: number;
  code_id: number;
  user_id: string;
  username: string | null;
  user_email: string | null;
  redeemed_at: string;
  applied_plan: "monthly" | "yearly";
  applied_days: number;
};

type AdminPartyRoom = {
  code: string;
  host_id: string | null;
  host_username: string | null;
  host_email: string | null;
  media_id: number;
  media_type: "movie" | "tv";
  media_title: string;
  media_poster: string | null;
  season: number | null;
  episode: number | null;
  created_at: string;
  expires_at: string;
};

type AdminPartyMessage = {
  id: number;
  room_code: string;
  user_id: string | null;
  username: string;
  user_email: string | null;
  content: string;
  created_at: string;
};

type AdminHistory = {
  id: number;
  user_id: string;
  username: string | null;
  user_email: string | null;
  media_id: number;
  type: "movie" | "tv";
  season: number;
  episode: number;
  duration: number;
  last_position: number;
  completed: boolean;
  title: string;
  created_at: string;
  updated_at: string;
};

type AdminWatchlist = {
  user_id: string;
  username: string | null;
  user_email: string | null;
  id: number;
  type: "movie" | "tv";
  title: string;
  vote_average: number;
  created_at: string;
};

type AdminDashboardResponse = {
  data: {
    users: AdminUser[];
    community: {
      comments: AdminComment[];
      ratings: AdminRating[];
    };
    watch: {
      histories: AdminHistory[];
      watchlist: AdminWatchlist[];
    };
    premium: {
      codes: AdminPremiumCode[];
      redemptions: AdminPremiumRedemption[];
    };
    parties: {
      rooms: AdminPartyRoom[];
      messages: AdminPartyMessage[];
    };
    downloads: {
      count: number;
      updated_at: string;
    } | null;
    rewards: {
      requests: RewardRequest[];
      accounts: RewardAccount[];
      referrals: Referral[];
    };
  };
  summary: {
    users_total: number;
    admins_total: number;
    comments_total: number;
    ratings_total: number;
    premium_codes_total: number;
    active_premium_codes_total: number;
    premium_redemptions_total: number;
    party_rooms_total: number;
    active_party_rooms_total: number;
    party_messages_total: number;
    download_count: number;
    histories_total: number;
    watchlist_total: number;
    reward_requests_total: number;
    reward_pending_total: number;
    reward_accounts_total: number;
    referrals_total: number;
  };
};

type RewardsApiResponse = {
  data: RewardRequest[];
  summary: {
    total_pending: number;
    total_requests: number;
    reward_accounts: RewardAccount[];
    referrals: Referral[];
  };
};

type SiteTab =
  | "overview"
  | "users"
  | "community"
  | "premium"
  | "watch"
  | "parties"
  | "downloads"
  | "rewards";

const rewardStatusOptions: Array<{ id: RewardRequestStatus | "all"; label: string }> = [
  { id: "all", label: "All statuses" },
  { id: "pending", label: "Pending" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
  { id: "fulfilled", label: "Fulfilled" },
];

const formatUsd = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value ?? 0);

const formatDateTime = (value?: string | null) => (value ? new Date(value).toLocaleString() : "—");
const formatDateInput = (value?: string | null) => (value ? new Date(value).toISOString().slice(0, 10) : "");
const formatCompactId = (value: string | null | undefined) =>
  value ? `${value.slice(0, 8)}…${value.slice(-4)}` : "—";

const statusClassName = (status: string) => `admin-status-pill ${status.toLowerCase()}`;

async function fetchDashboard(search: string): Promise<AdminDashboardResponse> {
  const params = new URLSearchParams();
  if (search.trim()) params.set("search", search.trim());
  const response = await fetch(
    `/api/admin/dashboard${params.toString() ? `?${params.toString()}` : ""}`,
    { credentials: "include" },
  );
  if (!response.ok) throw new Error("Failed to load admin dashboard");
  return response.json();
}

async function fetchRewardRequests(
  status: RewardRequestStatus | "all",
  search: string,
): Promise<RewardsApiResponse> {
  const params = new URLSearchParams();
  if (status !== "all") params.set("status", status);
  if (search.trim()) params.set("search", search.trim());

  const response = await fetch(
    `/api/admin/rewards${params.toString() ? `?${params.toString()}` : ""}`,
    { credentials: "include" },
  );
  if (!response.ok) throw new Error("Failed to load reward requests");
  return response.json();
}

async function updateRewardRequest(input: {
  id: number;
  status: RewardRequestStatus;
  admin_notes?: string;
  payout_reference?: string;
}): Promise<{ message: string }> {
  const response = await fetch(`/api/admin/rewards/${input.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error ?? "Failed to update request");
  }

  return response.json();
}

async function adjustRewardAccount(input: {
  username: string;
  points: number;
  reason: string;
}): Promise<{ message: string }> {
  const response = await fetch("/api/admin/rewards/adjust", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error ?? "Failed to adjust account");
  }

  return response.json();
}

async function updateAdminUser(input: {
  id: string;
  is_admin?: boolean;
  username?: string;
}): Promise<{ message: string }> {
  const response = await fetch(`/api/admin/users/${input.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error ?? "Failed to update user");
  }

  return response.json();
}

async function deleteComment(commentId: number): Promise<{ message: string }> {
  const response = await fetch(`/api/admin/comments/${commentId}`, {
    method: "DELETE",
    credentials: "include",
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error ?? "Failed to delete comment");
  }

  return response.json();
}

async function createPremiumCode(input: {
  code: string;
  plan: "monthly" | "yearly";
  duration_days: number;
  max_redemptions: number;
  expires_at?: string | null;
}): Promise<{ message: string }> {
  const response = await fetch("/api/admin/premium-codes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error ?? "Failed to create premium code");
  }

  return response.json();
}

async function updatePremiumCode(input: {
  id: number;
  active?: boolean;
  expires_at?: string | null;
  max_redemptions?: number;
}): Promise<{ message: string }> {
  const response = await fetch(`/api/admin/premium-codes/${input.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error ?? "Failed to update premium code");
  }

  return response.json();
}

async function deletePartyRoom(code: string): Promise<{ message: string }> {
  const response = await fetch(`/api/admin/party-rooms/${code}`, {
    method: "DELETE",
    credentials: "include",
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error ?? "Failed to delete party room");
  }

  return response.json();
}

const AdminPanel = () => {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<SiteTab>("overview");

  const [rewardStatus, setRewardStatus] = useState<RewardRequestStatus | "all">("all");
  const [selectedRewardId, setSelectedRewardId] = useState<number | null>(null);
  const [adminNotes, setAdminNotes] = useState("");
  const [payoutReference, setPayoutReference] = useState("");
  const [adjustUsername, setAdjustUsername] = useState("");
  const [adjustPoints, setAdjustPoints] = useState("0");
  const [adjustReason, setAdjustReason] = useState("");

  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [userEditUsername, setUserEditUsername] = useState("");
  const [userEditAdmin, setUserEditAdmin] = useState(false);

  const [premiumCode, setPremiumCode] = useState("");
  const [premiumPlan, setPremiumPlan] = useState<"monthly" | "yearly">("monthly");
  const [premiumDays, setPremiumDays] = useState("30");
  const [premiumMaxRedemptions, setPremiumMaxRedemptions] = useState("1");
  const [premiumExpiresAt, setPremiumExpiresAt] = useState("");

  const { data: dashboardData, isLoading, isFetching } = useQuery({
    queryKey: ["admin-dashboard", search],
    queryFn: () => fetchDashboard(search),
  });

  const { data: rewardsData } = useQuery({
    queryKey: ["admin-reward-requests", rewardStatus, search],
    queryFn: () => fetchRewardRequests(rewardStatus, search),
  });

  const summary = dashboardData?.summary;
  const rewardsSummary = rewardsData?.summary;

  const selectedRewardRequest = useMemo(
    () => rewardsData?.data.find((request) => request.id === selectedRewardId) ?? null,
    [rewardsData, selectedRewardId],
  );

  const selectedUser = useMemo(
    () => dashboardData?.data.users.find((user) => user.id === selectedUserId) ?? null,
    [dashboardData, selectedUserId],
  );

  const derived = useMemo(() => {
    const rewardAccounts = dashboardData?.data.rewards.accounts ?? [];
    const rewardRequests = rewardsData?.data ?? [];
    const comments = dashboardData?.data.community.comments ?? [];
    const ratings = dashboardData?.data.community.ratings ?? [];
    const histories = dashboardData?.data.watch.histories ?? [];
    const premiumCodes = dashboardData?.data.premium.codes ?? [];
    const premiumRedemptions = dashboardData?.data.premium.redemptions ?? [];

    return {
      rewardPointsBalance: rewardAccounts.reduce((sum, account) => sum + account.points_balance, 0),
      rewardPointsEarned: rewardAccounts.reduce(
        (sum, account) => sum + account.total_points_earned,
        0,
      ),
      rewardRequestedUsd: rewardRequests.reduce(
        (sum, request) => sum + Number(request.requested_value_usd ?? 0),
        0,
      ),
      averageRating:
        ratings.length > 0
          ? Number(
              (
                ratings.reduce((sum, rating) => sum + Number(rating.rating ?? 0), 0) /
                ratings.length
              ).toFixed(1),
            )
          : 0,
      totalCommentWords: comments.reduce(
        (sum, comment) => sum + comment.content.trim().split(/\s+/).filter(Boolean).length,
        0,
      ),
      completedHistories: histories.filter((history) => history.completed).length,
      activePremiumCodes: premiumCodes.filter((code) => code.active).length,
      redeemedPremiumUsers: new Set(premiumRedemptions.map((redemption) => redemption.user_id)).size,
    };
  }, [dashboardData, rewardsData]);

  const rewardMutation = useMutation({
    mutationFn: updateRewardRequest,
    onSuccess: async ({ message }) => {
      addToast({ title: message, color: "success" });
      setAdminNotes("");
      setPayoutReference("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-reward-requests"] }),
      ]);
    },
    onError: (error: Error) => addToast({ title: error.message, color: "danger" }),
  });

  const adjustMutation = useMutation({
    mutationFn: adjustRewardAccount,
    onSuccess: async ({ message }) => {
      addToast({ title: message, color: "success" });
      setAdjustUsername("");
      setAdjustPoints("0");
      setAdjustReason("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-reward-requests"] }),
      ]);
    },
    onError: (error: Error) => addToast({ title: error.message, color: "danger" }),
  });

  const userMutation = useMutation({
    mutationFn: updateAdminUser,
    onSuccess: async ({ message }) => {
      addToast({ title: message, color: "success" });
      await queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] });
    },
    onError: (error: Error) => addToast({ title: error.message, color: "danger" }),
  });

  const commentDeleteMutation = useMutation({
    mutationFn: deleteComment,
    onSuccess: async ({ message }) => {
      addToast({ title: message, color: "success" });
      await queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] });
    },
    onError: (error: Error) => addToast({ title: error.message, color: "danger" }),
  });

  const premiumCreateMutation = useMutation({
    mutationFn: createPremiumCode,
    onSuccess: async ({ message }) => {
      addToast({ title: message, color: "success" });
      setPremiumCode("");
      setPremiumPlan("monthly");
      setPremiumDays("30");
      setPremiumMaxRedemptions("1");
      setPremiumExpiresAt("");
      await queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] });
    },
    onError: (error: Error) => addToast({ title: error.message, color: "danger" }),
  });

  const premiumUpdateMutation = useMutation({
    mutationFn: updatePremiumCode,
    onSuccess: async ({ message }) => {
      addToast({ title: message, color: "success" });
      await queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] });
    },
    onError: (error: Error) => addToast({ title: error.message, color: "danger" }),
  });

  const partyDeleteMutation = useMutation({
    mutationFn: deletePartyRoom,
    onSuccess: async ({ message }) => {
      addToast({ title: message, color: "success" });
      await queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] });
    },
    onError: (error: Error) => addToast({ title: error.message, color: "danger" }),
  });

  const handleRewardAction = (nextStatus: RewardRequestStatus) => {
    if (!selectedRewardRequest) return;

    rewardMutation.mutate({
      id: selectedRewardRequest.id,
      status: nextStatus,
      admin_notes: adminNotes.trim() || undefined,
      payout_reference: payoutReference.trim() || undefined,
    });
  };

  return (
    <section className="container-fluid px-3 px-lg-4 py-4 py-lg-5 admin-bootstrap-shell">
      <div className="row g-4">
        <div className="col-12">
          <div className="card border-0 rounded-4 admin-bootstrap-hero">
            <div className="card-body p-4 p-lg-5">
              <div className="row g-4 align-items-end">
                <div className="col-lg-8">
                  <span className="badge text-bg-primary rounded-pill px-3 py-2 mb-3">
                    Admin Console
                  </span>
                  <h1 className="display-6 fw-bold mb-3">Control center for the platform</h1>
                  <p className="lead admin-muted mb-0">
                    Manage users, community, premium codes, parties, watch activity, downloads,
                    and rewards from one control surface.
                  </p>
                </div>
                <div className="col-lg-4">
                  <div className="row g-3">
                    <div className="col-6">
                      <div className="card rounded-4 admin-metric-card h-100">
                        <div className="card-body">
                          <div className="text-uppercase small admin-muted mb-2">Total Users</div>
                          <div className="admin-kpi-value">{summary?.users_total ?? 0}</div>
                        </div>
                      </div>
                    </div>
                    <div className="col-6">
                      <div className="card rounded-4 admin-metric-card h-100">
                        <div className="card-body">
                          <div className="text-uppercase small admin-muted mb-2">Pending Rewards</div>
                          <div className="admin-kpi-value">{summary?.reward_pending_total ?? 0}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="col-12">
          <div className="row g-3">
            <div className="col-6 col-xl-3">
              <div className="card rounded-4 h-100 admin-metric-card">
                <div className="card-body">
                  <div className="text-uppercase small admin-muted mb-2">Admins</div>
                  <div className="admin-kpi-value">{summary?.admins_total ?? 0}</div>
                  <div className="small admin-muted mt-2">Profiles with admin access</div>
                </div>
              </div>
            </div>
            <div className="col-6 col-xl-3">
              <div className="card rounded-4 h-100 admin-metric-card">
                <div className="card-body">
                  <div className="text-uppercase small admin-muted mb-2">Downloads</div>
                  <div className="admin-kpi-value">{summary?.download_count ?? 0}</div>
                  <div className="small admin-muted mt-2">App download clicks tracked</div>
                </div>
              </div>
            </div>
            <div className="col-6 col-xl-3">
              <div className="card rounded-4 h-100 admin-metric-card">
                <div className="card-body">
                  <div className="text-uppercase small admin-muted mb-2">Comments</div>
                  <div className="admin-kpi-value">{summary?.comments_total ?? 0}</div>
                  <div className="small admin-muted mt-2">Community discussion rows</div>
                </div>
              </div>
            </div>
            <div className="col-6 col-xl-3">
              <div className="card rounded-4 h-100 admin-metric-card">
                <div className="card-body">
                  <div className="text-uppercase small admin-muted mb-2">Active Codes</div>
                  <div className="admin-kpi-value">{summary?.active_premium_codes_total ?? 0}</div>
                  <div className="small admin-muted mt-2">Redeemable premium codes</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="col-12">
          <div className="card rounded-4">
            <div className="card-body p-4">
              <div className="row g-3 align-items-end">
                <div className="col-lg-7">
                  <label htmlFor="admin-search" className="form-label fw-semibold">
                    Global search
                  </label>
                  <input
                    id="admin-search"
                    className="form-control form-control-lg"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search users, emails, IDs, or related admin data"
                  />
                </div>
                <div className="col-lg-5">
                  <div className="small admin-muted">
                    {isFetching ? "Refreshing data..." : "Service-role backed site administration"}
                  </div>
                  <div className="d-flex flex-wrap gap-2 mt-2">
                    {(
                      [
                        ["overview", "Overview"],
                        ["users", "Users"],
                        ["community", "Community"],
                        ["premium", "Premium"],
                        ["watch", "Watch / Library"],
                        ["parties", "Parties"],
                        ["downloads", "Downloads"],
                        ["rewards", "Rewards"],
                      ] as Array<[SiteTab, string]>
                    ).map(([tab, label]) => (
                      <button
                        key={tab}
                        type="button"
                        className={`btn ${activeTab === tab ? "btn-primary" : "btn-outline-primary"}`}
                        onClick={() => setActiveTab(tab)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {activeTab === "overview" && (
          <div className="col-12">
            <div className="row g-4">
              <div className="col-lg-6">
                <div className="card rounded-4 h-100">
                  <div className="card-header px-4 py-3">
                    <h2 className="h5 mb-0">Platform Snapshot</h2>
                  </div>
                  <div className="card-body p-4">
                    <div className="row g-3">
                      <div className="col-sm-6">
                        <div className="admin-note-box p-3 h-100">
                          <div className="small text-uppercase fw-semibold admin-muted mb-2">Community</div>
                          <div className="fs-3 fw-bold">{summary?.comments_total ?? 0}</div>
                          <div className="small admin-muted">
                            comments · {summary?.ratings_total ?? 0} ratings · avg {derived.averageRating}
                          </div>
                        </div>
                      </div>
                      <div className="col-sm-6">
                        <div className="admin-note-box p-3 h-100">
                          <div className="small text-uppercase fw-semibold admin-muted mb-2">Watch Activity</div>
                          <div className="fs-3 fw-bold">{summary?.histories_total ?? 0}</div>
                          <div className="small admin-muted">
                            histories · {derived.completedHistories} completed
                          </div>
                        </div>
                      </div>
                      <div className="col-sm-6">
                        <div className="admin-note-box p-3 h-100">
                          <div className="small text-uppercase fw-semibold admin-muted mb-2">Premium</div>
                          <div className="fs-3 fw-bold">{derived.activePremiumCodes}</div>
                          <div className="small admin-muted">
                            active codes · {derived.redeemedPremiumUsers} redeemers
                          </div>
                        </div>
                      </div>
                      <div className="col-sm-6">
                        <div className="admin-note-box p-3 h-100">
                          <div className="small text-uppercase fw-semibold admin-muted mb-2">Rewards</div>
                          <div className="fs-3 fw-bold">{derived.rewardPointsBalance}</div>
                          <div className="small admin-muted">
                            points live · {formatUsd(derived.rewardRequestedUsd)} requested
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="col-lg-6">
                <div className="card rounded-4 h-100">
                  <div className="card-header px-4 py-3">
                    <h2 className="h5 mb-0">Latest Signals</h2>
                  </div>
                  <div className="card-body p-4">
                    <div className="d-flex justify-content-between py-2 border-bottom">
                      <span className="admin-muted">Latest download update</span>
                      <span className="fw-semibold">
                        {formatDateTime(dashboardData?.data.downloads?.updated_at)}
                      </span>
                    </div>
                    <div className="d-flex justify-content-between py-2 border-bottom">
                      <span className="admin-muted">Latest party room</span>
                      <span className="fw-semibold">
                        {formatDateTime(dashboardData?.data.parties.rooms[0]?.created_at)}
                      </span>
                    </div>
                    <div className="d-flex justify-content-between py-2 border-bottom">
                      <span className="admin-muted">Latest premium redemption</span>
                      <span className="fw-semibold">
                        {formatDateTime(dashboardData?.data.premium.redemptions[0]?.redeemed_at)}
                      </span>
                    </div>
                    <div className="d-flex justify-content-between py-2">
                      <span className="admin-muted">Latest reward request</span>
                      <span className="fw-semibold">
                        {formatDateTime(rewardsData?.data[0]?.created_at)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "users" && (
          <>
            <div className="col-12 col-xl-8">
              <div className="card rounded-4">
                <div className="card-header px-4 py-3">
                  <h2 className="h5 mb-0">Users</h2>
                </div>
                <div className="card-body p-0">
                  <div className="admin-table-wrap">
                    <table className="table table-hover align-middle mb-0">
                      <thead className="table-light">
                        <tr>
                          <th>User</th>
                          <th>Role</th>
                          <th>Created</th>
                          <th>Last Sign In</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dashboardData?.data.users.length ? (
                          dashboardData.data.users.map((user) => (
                            <tr
                              key={user.id}
                              role="button"
                              className={selectedUserId === user.id ? "table-primary" : undefined}
                              onClick={() => {
                                setSelectedUserId(user.id);
                                setUserEditUsername(user.username ?? "");
                                setUserEditAdmin(user.is_admin);
                              }}
                            >
                              <td>
                                <div className="fw-semibold">{user.username ?? "No username"}</div>
                                <div className="small admin-muted">{user.email ?? formatCompactId(user.id)}</div>
                              </td>
                              <td>
                                <span className={`admin-status-pill ${user.is_admin ? "approved" : "pending"}`}>
                                  {user.is_admin ? "admin" : "member"}
                                </span>
                              </td>
                              <td>{formatDateTime(user.created_at)}</td>
                              <td>{formatDateTime(user.last_sign_in_at)}</td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={4} className="text-center py-5 admin-muted">
                              No users found.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
            <div className="col-12 col-xl-4">
              <div className="card rounded-4">
                <div className="card-header px-4 py-3">
                  <h2 className="h5 mb-0">User Editor</h2>
                </div>
                <div className="card-body p-4">
                  {selectedUser ? (
                    <>
                      <div className="admin-note-box p-3 mb-3">
                        <div className="fw-semibold">{selectedUser.email ?? "No email"}</div>
                        <div className="small admin-muted">{formatCompactId(selectedUser.id)}</div>
                      </div>
                      <div className="mb-3">
                        <label className="form-label fw-semibold" htmlFor="user-username">
                          Username
                        </label>
                        <input
                          id="user-username"
                          className="form-control"
                          value={userEditUsername}
                          onChange={(event) => setUserEditUsername(event.target.value)}
                        />
                      </div>
                      <div className="form-check mb-3">
                        <input
                          id="user-admin"
                          className="form-check-input"
                          type="checkbox"
                          checked={userEditAdmin}
                          onChange={(event) => setUserEditAdmin(event.target.checked)}
                        />
                        <label htmlFor="user-admin" className="form-check-label">
                          Admin access
                        </label>
                      </div>
                      <button
                        type="button"
                        className="btn btn-primary w-100"
                        disabled={userMutation.isPending}
                        onClick={() =>
                          userMutation.mutate({
                            id: selectedUser.id,
                            username: userEditUsername.trim(),
                            is_admin: userEditAdmin,
                          })
                        }
                      >
                        {userMutation.isPending ? "Saving..." : "Save user"}
                      </button>
                    </>
                  ) : (
                    <p className="admin-muted mb-0">Select a user to edit role and username.</p>
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        {activeTab === "community" && (
          <>
            <div className="col-12">
              <div className="row g-4">
                <div className="col-xl-7">
                  <div className="card rounded-4">
                    <div className="card-header px-4 py-3">
                      <h2 className="h5 mb-0">Comments</h2>
                    </div>
                    <div className="card-body p-0">
                      <div className="admin-table-wrap">
                        <table className="table table-hover align-middle mb-0">
                          <thead className="table-light">
                            <tr>
                              <th>User</th>
                              <th>Media</th>
                              <th>Comment</th>
                              <th>Created</th>
                              <th></th>
                            </tr>
                          </thead>
                          <tbody>
                            {dashboardData?.data.community.comments.length ? (
                              dashboardData.data.community.comments.map((comment) => (
                                <tr key={comment.id}>
                                  <td>
                                    <div>{comment.username ?? "Unknown user"}</div>
                                    <div className="small admin-muted">{comment.user_email ?? formatCompactId(comment.user_id)}</div>
                                  </td>
                                  <td>
                                    {comment.media_type} #{comment.media_id}
                                  </td>
                                  <td style={{ minWidth: 260 }}>{comment.content}</td>
                                  <td>{formatDateTime(comment.created_at)}</td>
                                  <td className="text-end">
                                    <button
                                      type="button"
                                      className="btn btn-sm btn-outline-danger"
                                      disabled={commentDeleteMutation.isPending}
                                      onClick={() => commentDeleteMutation.mutate(comment.id)}
                                    >
                                      Delete
                                    </button>
                                  </td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td colSpan={5} className="text-center py-5 admin-muted">
                                  No comments found.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="col-xl-5">
                  <div className="card rounded-4">
                    <div className="card-header px-4 py-3">
                      <h2 className="h5 mb-0">Ratings</h2>
                    </div>
                    <div className="card-body p-0">
                      <div className="admin-table-wrap">
                        <table className="table table-hover align-middle mb-0">
                          <thead className="table-light">
                            <tr>
                              <th>User</th>
                              <th>Media</th>
                              <th>Rating</th>
                              <th>Updated</th>
                            </tr>
                          </thead>
                          <tbody>
                            {dashboardData?.data.community.ratings.length ? (
                              dashboardData.data.community.ratings.map((rating) => (
                                <tr key={`${rating.user_id}-${rating.media_id}-${rating.media_type}`}>
                                  <td>
                                    <div>{rating.username ?? "Unknown user"}</div>
                                    <div className="small admin-muted">{rating.user_email ?? formatCompactId(rating.user_id)}</div>
                                  </td>
                                  <td>
                                    {rating.media_type} #{rating.media_id}
                                  </td>
                                  <td className="fw-semibold">{rating.rating}/10</td>
                                  <td>{formatDateTime(rating.updated_at)}</td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td colSpan={4} className="text-center py-5 admin-muted">
                                  No ratings found.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {activeTab === "premium" && (
          <>
            <div className="col-12 col-xl-4">
              <div className="card rounded-4">
                <div className="card-header px-4 py-3">
                  <h2 className="h5 mb-0">Create Premium Code</h2>
                </div>
                <div className="card-body p-4">
                  <div className="mb-3">
                    <label className="form-label fw-semibold">Code</label>
                    <input
                      className="form-control"
                      value={premiumCode}
                      onChange={(event) => setPremiumCode(event.target.value.toUpperCase())}
                      placeholder="MTH-XXXX-YYYY"
                    />
                  </div>
                  <div className="row g-3">
                    <div className="col-md-6">
                      <label className="form-label fw-semibold">Plan</label>
                      <select
                        className="form-select"
                        value={premiumPlan}
                        onChange={(event) => setPremiumPlan(event.target.value as "monthly" | "yearly")}
                      >
                        <option value="monthly">Monthly</option>
                        <option value="yearly">Yearly</option>
                      </select>
                    </div>
                    <div className="col-md-6">
                      <label className="form-label fw-semibold">Days</label>
                      <input
                        className="form-control"
                        value={premiumDays}
                        onChange={(event) => setPremiumDays(event.target.value)}
                      />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label fw-semibold">Max redemptions</label>
                      <input
                        className="form-control"
                        value={premiumMaxRedemptions}
                        onChange={(event) => setPremiumMaxRedemptions(event.target.value)}
                      />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label fw-semibold">Expiry date</label>
                      <input
                        className="form-control"
                        type="date"
                        value={premiumExpiresAt}
                        onChange={(event) => setPremiumExpiresAt(event.target.value)}
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary w-100 mt-3"
                    disabled={premiumCreateMutation.isPending}
                    onClick={() =>
                      premiumCreateMutation.mutate({
                        code: premiumCode,
                        plan: premiumPlan,
                        duration_days: Number(premiumDays),
                        max_redemptions: Number(premiumMaxRedemptions),
                        expires_at: premiumExpiresAt ? new Date(premiumExpiresAt).toISOString() : null,
                      })
                    }
                  >
                    {premiumCreateMutation.isPending ? "Creating..." : "Create code"}
                  </button>
                </div>
              </div>
            </div>
            <div className="col-12 col-xl-8">
              <div className="card rounded-4">
                <div className="card-header px-4 py-3">
                  <h2 className="h5 mb-0">Premium Codes</h2>
                </div>
                <div className="card-body p-0">
                  <div className="admin-table-wrap">
                    <table className="table table-hover align-middle mb-0">
                      <thead className="table-light">
                        <tr>
                          <th>Code</th>
                          <th>Plan</th>
                          <th>Usage</th>
                          <th>Status</th>
                          <th>Expires</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {dashboardData?.data.premium.codes.length ? (
                          dashboardData.data.premium.codes.map((code) => (
                            <tr key={code.id}>
                              <td className="fw-semibold">{code.code}</td>
                              <td>{code.plan}</td>
                              <td>
                                {code.redemption_count}/{code.max_redemptions}
                              </td>
                              <td>
                                <span className={`admin-status-pill ${code.active ? "approved" : "rejected"}`}>
                                  {code.active ? "active" : "inactive"}
                                </span>
                              </td>
                              <td>{formatDateTime(code.expires_at)}</td>
                              <td className="text-end">
                                <button
                                  type="button"
                                  className={`btn btn-sm ${code.active ? "btn-outline-danger" : "btn-outline-success"}`}
                                  disabled={premiumUpdateMutation.isPending}
                                  onClick={() =>
                                    premiumUpdateMutation.mutate({
                                      id: code.id,
                                      active: !code.active,
                                    })
                                  }
                                >
                                  {code.active ? "Disable" : "Enable"}
                                </button>
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={6} className="text-center py-5 admin-muted">
                              No premium codes found.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
            <div className="col-12">
              <div className="card rounded-4">
                <div className="card-header px-4 py-3">
                  <h2 className="h5 mb-0">Recent Redemptions</h2>
                </div>
                <div className="card-body p-0">
                  <div className="admin-table-wrap">
                    <table className="table table-hover align-middle mb-0">
                      <thead className="table-light">
                        <tr>
                          <th>User</th>
                          <th>Code ID</th>
                          <th>Plan</th>
                          <th>Days</th>
                          <th>Redeemed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dashboardData?.data.premium.redemptions.length ? (
                          dashboardData.data.premium.redemptions.map((redemption) => (
                            <tr key={redemption.id}>
                              <td>
                                <div>{redemption.username ?? "Unknown user"}</div>
                                <div className="small admin-muted">{redemption.user_email ?? formatCompactId(redemption.user_id)}</div>
                              </td>
                              <td>{redemption.code_id}</td>
                              <td>{redemption.applied_plan}</td>
                              <td>{redemption.applied_days}</td>
                              <td>{formatDateTime(redemption.redeemed_at)}</td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={5} className="text-center py-5 admin-muted">
                              No premium redemptions found.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {activeTab === "watch" && (
          <div className="col-12">
            <div className="row g-4">
              <div className="col-xl-8">
                <div className="card rounded-4">
                  <div className="card-header px-4 py-3">
                    <h2 className="h5 mb-0">Recent Watch Histories</h2>
                  </div>
                  <div className="card-body p-0">
                    <div className="admin-table-wrap">
                      <table className="table table-hover align-middle mb-0">
                        <thead className="table-light">
                          <tr>
                            <th>User</th>
                            <th>Title</th>
                            <th>Type</th>
                            <th>Progress</th>
                            <th>Completed</th>
                            <th>Updated</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dashboardData?.data.watch.histories.length ? (
                            dashboardData.data.watch.histories.map((history) => (
                              <tr key={history.id}>
                                <td>
                                  <div>{history.username ?? "Unknown user"}</div>
                                  <div className="small admin-muted">{history.user_email ?? formatCompactId(history.user_id)}</div>
                                </td>
                                <td style={{ minWidth: 240 }}>{history.title}</td>
                                <td>
                                  {history.type}
                                  {history.type === "tv" ? ` S${history.season}E${history.episode}` : ""}
                                </td>
                                <td>
                                  {Math.round(history.last_position)}/{Math.round(history.duration)}
                                </td>
                                <td>{history.completed ? "Yes" : "No"}</td>
                                <td>{formatDateTime(history.updated_at)}</td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={6} className="text-center py-5 admin-muted">
                                No watch history found.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
              <div className="col-xl-4">
                <div className="card rounded-4">
                  <div className="card-header px-4 py-3">
                    <h2 className="h5 mb-0">Recent Watchlist Entries</h2>
                  </div>
                  <div className="card-body p-0">
                    <div className="admin-table-wrap">
                      <table className="table table-hover align-middle mb-0">
                        <thead className="table-light">
                          <tr>
                            <th>User</th>
                            <th>Title</th>
                            <th>Type</th>
                            <th>Added</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dashboardData?.data.watch.watchlist.length ? (
                            dashboardData.data.watch.watchlist.map((item) => (
                              <tr key={`${item.user_id}-${item.id}-${item.type}`}>
                                <td>
                                  <div>{item.username ?? "Unknown user"}</div>
                                  <div className="small admin-muted">{item.user_email ?? formatCompactId(item.user_id)}</div>
                                </td>
                                <td style={{ minWidth: 180 }}>{item.title}</td>
                                <td>{item.type}</td>
                                <td>{formatDateTime(item.created_at)}</td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={4} className="text-center py-5 admin-muted">
                                No watchlist entries found.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "parties" && (
          <>
            <div className="col-12 col-xl-7">
              <div className="card rounded-4">
                <div className="card-header px-4 py-3">
                  <h2 className="h5 mb-0">Party Rooms</h2>
                </div>
                <div className="card-body p-0">
                  <div className="admin-table-wrap">
                    <table className="table table-hover align-middle mb-0">
                      <thead className="table-light">
                        <tr>
                          <th>Room</th>
                          <th>Host</th>
                          <th>Media</th>
                          <th>Expires</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {dashboardData?.data.parties.rooms.length ? (
                          dashboardData.data.parties.rooms.map((room) => (
                            <tr key={room.code}>
                              <td className="fw-semibold">{room.code}</td>
                              <td>
                                <div>{room.host_username ?? "Unknown host"}</div>
                                <div className="small admin-muted">{room.host_email ?? formatCompactId(room.host_id)}</div>
                              </td>
                              <td style={{ minWidth: 220 }}>{room.media_title}</td>
                              <td>{formatDateTime(room.expires_at)}</td>
                              <td className="text-end">
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline-danger"
                                  disabled={partyDeleteMutation.isPending}
                                  onClick={() => partyDeleteMutation.mutate(room.code)}
                                >
                                  Delete
                                </button>
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={5} className="text-center py-5 admin-muted">
                              No party rooms found.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
            <div className="col-12 col-xl-5">
              <div className="card rounded-4">
                <div className="card-header px-4 py-3">
                  <h2 className="h5 mb-0">Recent Party Messages</h2>
                </div>
                <div className="card-body p-0">
                  <div className="admin-table-wrap">
                    <table className="table table-hover align-middle mb-0">
                      <thead className="table-light">
                        <tr>
                          <th>Room</th>
                          <th>User</th>
                          <th>Message</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dashboardData?.data.parties.messages.length ? (
                          dashboardData.data.parties.messages.map((message) => (
                            <tr key={message.id}>
                              <td>{message.room_code}</td>
                              <td>
                                <div>{message.username}</div>
                                <div className="small admin-muted">{message.user_email ?? "Guest/legacy"}</div>
                              </td>
                              <td style={{ minWidth: 240 }}>{message.content}</td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={3} className="text-center py-5 admin-muted">
                              No party messages found.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {activeTab === "downloads" && (
          <div className="col-12">
            <div className="row g-4">
              <div className="col-lg-4">
                <div className="card rounded-4 h-100">
                  <div className="card-body p-4">
                    <div className="text-uppercase small admin-muted mb-2">Total Downloads</div>
                    <div className="admin-kpi-value">{summary?.download_count ?? 0}</div>
                    <div className="small admin-muted mt-2">
                      Updated {formatDateTime(dashboardData?.data.downloads?.updated_at)}
                    </div>
                  </div>
                </div>
              </div>
              <div className="col-lg-8">
                <div className="card rounded-4 h-100">
                  <div className="card-header px-4 py-3">
                    <h2 className="h5 mb-0">Download Tracking</h2>
                  </div>
                  <div className="card-body p-4">
                    <p className="admin-muted mb-0">
                      This repo currently tracks downloads as a singleton counter in
                      `app_downloads`. The admin panel exposes it as read-only because there is no
                      safe manual override endpoint yet.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "rewards" && (
          <>
            <div className="col-12 col-xl-8">
              <div className="card rounded-4">
                <div className="card-header px-4 py-3">
                  <div className="d-flex flex-wrap align-items-center justify-content-between gap-2">
                    <h2 className="h5 mb-0">Reward Requests</h2>
                    <select
                      className="form-select w-auto"
                      value={rewardStatus}
                      onChange={(event) => setRewardStatus(event.target.value as RewardRequestStatus | "all")}
                    >
                      {rewardStatusOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="card-body p-0">
                  <div className="admin-table-wrap">
                    <table className="table table-hover align-middle mb-0">
                      <thead className="table-light">
                        <tr>
                          <th>Request</th>
                          <th>User</th>
                          <th>Status</th>
                          <th>Points</th>
                          <th>USD</th>
                          <th>Created</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rewardsData?.data.length ? (
                          rewardsData.data.map((request) => (
                            <tr
                              key={request.id}
                              role="button"
                              className={selectedRewardId === request.id ? "table-primary" : undefined}
                              onClick={() => setSelectedRewardId(request.id)}
                            >
                              <td className="fw-semibold">#{request.id}</td>
                              <td>
                                <div>{request.username ?? "Unknown user"}</div>
                                <div className="small admin-muted">{formatCompactId(request.user_id)}</div>
                              </td>
                              <td>
                                <span className={statusClassName(request.status)}>{request.status}</span>
                              </td>
                              <td>{request.requested_points}</td>
                              <td>{formatUsd(Number(request.requested_value_usd))}</td>
                              <td>{formatDateTime(request.created_at)}</td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={6} className="text-center py-5 admin-muted">
                              No reward requests found.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="card rounded-4 mt-4">
                <div className="card-header px-4 py-3">
                  <h2 className="h5 mb-0">Reward Accounts</h2>
                </div>
                <div className="card-body p-0">
                  <div className="admin-table-wrap">
                    <table className="table table-hover align-middle mb-0">
                      <thead className="table-light">
                        <tr>
                          <th>User</th>
                          <th>Referral Code</th>
                          <th>Balance</th>
                          <th>Earned</th>
                          <th>Spent</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rewardsSummary?.reward_accounts.length ? (
                          rewardsSummary.reward_accounts.map((account) => (
                            <tr key={account.user_id}>
                              <td>
                                <div>{account.username ?? "Unknown user"}</div>
                                <div className="small admin-muted">{formatCompactId(account.user_id)}</div>
                              </td>
                              <td className="fw-semibold">{account.referral_code}</td>
                              <td>{account.points_balance}</td>
                              <td>{account.total_points_earned}</td>
                              <td>{account.total_points_spent}</td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={5} className="text-center py-5 admin-muted">
                              No reward accounts found.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>

            <div className="col-12 col-xl-4">
              <div className="card rounded-4">
                <div className="card-header px-4 py-3">
                  <h2 className="h5 mb-0">Reward Review</h2>
                </div>
                <div className="card-body p-4">
                  {selectedRewardRequest ? (
                    <>
                      <div className="admin-note-box p-3 mb-3">
                        <div className="fw-semibold">Request #{selectedRewardRequest.id}</div>
                        <div className="small admin-muted">
                          {selectedRewardRequest.username ?? "Unknown user"} ·{" "}
                          {formatCompactId(selectedRewardRequest.user_id)}
                        </div>
                        <div className="small mt-2">
                          {selectedRewardRequest.requested_points} points ·{" "}
                          {formatUsd(Number(selectedRewardRequest.requested_value_usd))}
                        </div>
                      </div>
                      <div className="mb-3">
                        <label className="form-label fw-semibold">Payout reference</label>
                        <input
                          className="form-control"
                          value={payoutReference}
                          onChange={(event) => setPayoutReference(event.target.value)}
                        />
                      </div>
                      <div className="mb-3">
                        <label className="form-label fw-semibold">Admin notes</label>
                        <textarea
                          className="form-control"
                          rows={4}
                          value={adminNotes}
                          onChange={(event) => setAdminNotes(event.target.value)}
                        />
                      </div>
                      <div className="d-grid gap-2">
                        <button
                          type="button"
                          className="btn btn-success"
                          disabled={rewardMutation.isPending}
                          onClick={() => handleRewardAction("approved")}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          className="btn btn-outline-danger"
                          disabled={rewardMutation.isPending}
                          onClick={() => handleRewardAction("rejected")}
                        >
                          Reject
                        </button>
                        <button
                          type="button"
                          className="btn btn-outline-primary"
                          disabled={rewardMutation.isPending}
                          onClick={() => handleRewardAction("fulfilled")}
                        >
                          Mark fulfilled
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="admin-muted mb-0">Select a reward request to review it.</p>
                  )}
                </div>
              </div>

              <div className="card rounded-4 mt-4">
                <div className="card-header px-4 py-3">
                  <h2 className="h5 mb-0">Manual Adjustment</h2>
                </div>
                <div className="card-body p-4">
                  <div className="mb-3">
                    <label className="form-label fw-semibold">Username</label>
                    <input
                      className="form-control"
                      value={adjustUsername}
                      onChange={(event) => setAdjustUsername(event.target.value)}
                    />
                  </div>
                  <div className="mb-3">
                    <label className="form-label fw-semibold">Points (+/-)</label>
                    <input
                      className="form-control"
                      value={adjustPoints}
                      onChange={(event) => setAdjustPoints(event.target.value)}
                    />
                  </div>
                  <div className="mb-3">
                    <label className="form-label fw-semibold">Reason</label>
                    <textarea
                      className="form-control"
                      rows={4}
                      value={adjustReason}
                      onChange={(event) => setAdjustReason(event.target.value)}
                    />
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary w-100"
                    disabled={adjustMutation.isPending}
                    onClick={() =>
                      adjustMutation.mutate({
                        username: adjustUsername.trim(),
                        points: Number(adjustPoints),
                        reason: adjustReason.trim(),
                      })
                    }
                  >
                    {adjustMutation.isPending ? "Applying..." : "Apply adjustment"}
                  </button>
                </div>
              </div>

              <div className="card rounded-4 mt-4">
                <div className="card-header px-4 py-3">
                  <h2 className="h5 mb-0">Reward Snapshot</h2>
                </div>
                <div className="card-body p-4">
                  <div className="d-flex justify-content-between py-2 border-bottom">
                    <span className="admin-muted">Pending requests</span>
                    <span className="fw-semibold">{rewardsSummary?.total_pending ?? 0}</span>
                  </div>
                  <div className="d-flex justify-content-between py-2 border-bottom">
                    <span className="admin-muted">Total points live</span>
                    <span className="fw-semibold">{derived.rewardPointsBalance}</span>
                  </div>
                  <div className="d-flex justify-content-between py-2 border-bottom">
                    <span className="admin-muted">Points earned</span>
                    <span className="fw-semibold">{derived.rewardPointsEarned}</span>
                  </div>
                  <div className="d-flex justify-content-between py-2">
                    <span className="admin-muted">Requested USD</span>
                    <span className="fw-semibold">{formatUsd(derived.rewardRequestedUsd)}</span>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {isLoading && (
          <div className="col-12">
            <div className="card rounded-4">
              <div className="card-body p-4 admin-muted">Loading admin dashboard...</div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

export default AdminPanel;
