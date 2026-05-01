"use client";

import { Button, Card, CardBody, Chip, Input, Select, SelectItem, Textarea, addToast } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { RewardAccount, Referral, RewardRequest, RewardRequestStatus, RewardLedgerEntry } from "@/types/rewards";

type AdminRewardsResponse = {
  data: RewardRequest[];
  summary: {
    total_pending: number;
    total_requests: number;
    reward_accounts: RewardAccount[];
    referrals: Referral[];
    ledger: RewardLedgerEntry[];
  };
};

const statusOptions: { id: RewardRequestStatus | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "pending", label: "Pending" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
  { id: "fulfilled", label: "Fulfilled" },
];

async function fetchRewardRequests(status: RewardRequestStatus | "all", search: string): Promise<AdminRewardsResponse> {
  const params = new URLSearchParams();
  if (status !== "all") params.set("status", status);
  if (search.trim()) params.set("search", search.trim());
  const response = await fetch(`/api/admin/rewards${params.toString() ? `?${params.toString()}` : ""}`, { credentials: "include" });
  if (!response.ok) throw new Error("Failed to load reward requests");
  return response.json();
}

async function updateRewardRequest(input: { id: number; status: RewardRequestStatus; admin_notes?: string; payout_reference?: string; }): Promise<{ message: string }> {
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

async function adjustRewardAccount(input: { username: string; points: number; reason: string }): Promise<{ message: string }> {
  const response = await fetch(`/api/admin/rewards/adjust`, {
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

const AdminPanel = () => {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<RewardRequestStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [adminNotes, setAdminNotes] = useState("");
  const [payoutReference, setPayoutReference] = useState("");
  const [adjustUsername, setAdjustUsername] = useState("");
  const [adjustPoints, setAdjustPoints] = useState("0");
  const [adjustReason, setAdjustReason] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["admin-reward-requests", status, search],
    queryFn: () => fetchRewardRequests(status, search),
  });

  const selectedRequest = useMemo(() => data?.data.find((request) => request.id === selectedId) ?? null, [data, selectedId]);
  const totalPoints = data?.summary.reward_accounts.reduce((sum, account) => sum + account.points_balance, 0) ?? 0;

  const mutation = useMutation({
    mutationFn: updateRewardRequest,
    onSuccess: async ({ message }) => {
      addToast({ title: message, color: "success" });
      setAdminNotes("");
      setPayoutReference("");
      await queryClient.invalidateQueries({ queryKey: ["admin-reward-requests"] });
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
      await queryClient.invalidateQueries({ queryKey: ["admin-reward-requests"] });
    },
    onError: (error: Error) => addToast({ title: error.message, color: "danger" }),
  });

  const summary = data?.summary;

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">Rewards Admin Panel</h1>
        <p className="text-default-500">Review reward requests, adjust balances, and manage manual gift card payouts.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="border border-default-200"><CardBody><p className="text-sm text-default-500">Pending requests</p><p className="text-3xl font-semibold">{summary?.total_pending ?? 0}</p></CardBody></Card>
        <Card className="border border-default-200"><CardBody><p className="text-sm text-default-500">Total requests</p><p className="text-3xl font-semibold">{summary?.total_requests ?? 0}</p></CardBody></Card>
        <Card className="border border-default-200"><CardBody><p className="text-sm text-default-500">Tracked accounts</p><p className="text-3xl font-semibold">{summary?.reward_accounts.length ?? 0}</p></CardBody></Card>
        <Card className="border border-default-200"><CardBody><p className="text-sm text-default-500">Total points</p><p className="text-3xl font-semibold">{totalPoints}</p></CardBody></Card>
      </div>

      <Card className="border border-default-200">
        <CardBody className="gap-3">
          <h2 className="text-xl font-semibold">Search users or requests</h2>
          <Input label="Search by username, referral code, payout email, or request ID" value={search} onValueChange={setSearch} />
        </CardBody>
      </Card>

      <Card className="border border-default-200">
        <CardBody className="gap-3">
          <h2 className="text-xl font-semibold">Recent referrals</h2>
          <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3 text-sm text-default-500">
            {(summary?.referrals ?? []).slice(0, 6).map((referral) => (
              <div key={referral.id} className="rounded-xl border border-default-200 p-3">
                <p className="font-medium">{referral.status}</p>
                <p className="break-all"><span className="font-semibold">Referrer:</span> {referral.referrer_username ?? referral.referrer_id}</p>
                <p className="break-all"><span className="font-semibold">Referred:</span> {referral.referred_username ?? referral.referred_id}</p>
                <p>{referral.reward_points} pts</p>
              </div>
            ))}
            {!summary?.referrals.length && <p>No referrals found.</p>}
          </div>
        </CardBody>
      </Card>

      <Card className="border border-default-200">
        <CardBody className="gap-3">
          <h2 className="text-xl font-semibold">Manual balance adjustment</h2>
          <div className="grid gap-3 md:grid-cols-3">
            <Input label="Username" value={adjustUsername} onValueChange={setAdjustUsername} />
            <Input label="Points (+/-)" value={adjustPoints} onValueChange={setAdjustPoints} />
            <Input label="Reason" value={adjustReason} onValueChange={setAdjustReason} />
          </div>
          <Button color="primary" isLoading={adjustMutation.isPending} onPress={() => adjustMutation.mutate({ username: adjustUsername, points: Number(adjustPoints), reason: adjustReason })}>
            Apply adjustment
          </Button>
        </CardBody>
      </Card>

      <div className="flex flex-wrap gap-3">
        <Select aria-label="Filter reward requests" selectedKeys={[status]} className="max-w-xs" onSelectionChange={(keys) => { const value = Array.from(keys)[0] as RewardRequestStatus | "all" | undefined; if (value) setStatus(value); }}>
          {statusOptions.map((option) => <SelectItem key={option.id}>{option.label}</SelectItem>)}
        </Select>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Card className="border border-default-200">
          <CardBody className="gap-4">
            {isLoading ? <p className="text-default-500">Loading requests...</p> : data?.data.length ? data.data.map((request) => (
              <button key={request.id} type="button" className={`rounded-2xl border p-4 text-left transition ${selectedId === request.id ? "border-primary bg-primary/10" : "border-default-200"}`} onClick={() => setSelectedId(request.id)}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">Request #{request.id}</p>
                    <p className="text-sm text-default-500">{request.username ?? request.user_id} • {request.requested_points} points • ${request.requested_value_usd}</p>
                  </div>
                  <Chip color={request.status === "pending" ? "warning" : request.status === "rejected" ? "danger" : "success"}>{request.status}</Chip>
                </div>
                <p className="mt-2 text-sm text-default-500">Submitted {new Date(request.created_at).toLocaleString()}</p>
              </button>
            )) : <p className="text-default-500">No reward requests found.</p>}
          </CardBody>
        </Card>

        <Card className="border border-default-200">
          <CardBody className="gap-4">
            <div>
              <h2 className="text-xl font-semibold">Request details</h2>
              <p className="text-sm text-default-500">Select a request to review it.</p>
            </div>
            {selectedRequest ? (
              <div className="space-y-4">
                <div className="space-y-2 text-sm">
                  <p><span className="font-semibold">User:</span> {selectedRequest.username ?? selectedRequest.user_id}</p>
                  <p><span className="font-semibold">Type:</span> {selectedRequest.reward_type}</p>
                  <p><span className="font-semibold">Points:</span> {selectedRequest.requested_points}</p>
                  <p><span className="font-semibold">Value:</span> ${selectedRequest.requested_value_usd}</p>
                  <p><span className="font-semibold">Payout email:</span> {selectedRequest.payout_email ?? "—"}</p>
                  <p><span className="font-semibold">Notes:</span> {selectedRequest.notes ?? "—"}</p>
                  <p><span className="font-semibold">Admin notes:</span> {selectedRequest.admin_notes ?? "—"}</p>
                </div>
                <Input label="Payout reference" value={payoutReference} onValueChange={setPayoutReference} placeholder="Internal gift card code or processing reference" />
                <Textarea label="Admin notes" value={adminNotes} onValueChange={setAdminNotes} placeholder="Add review notes before approving or rejecting" />
                <div className="flex flex-wrap gap-2">
                  <Button color="success" isLoading={mutation.isPending} onPress={() => mutation.mutate({ id: selectedRequest.id, status: "approved", admin_notes: adminNotes, payout_reference: payoutReference })}>Approve</Button>
                  <Button color="danger" variant="flat" isLoading={mutation.isPending} onPress={() => mutation.mutate({ id: selectedRequest.id, status: "rejected", admin_notes: adminNotes, payout_reference: payoutReference })}>Reject</Button>
                  <Button color="primary" variant="flat" isLoading={mutation.isPending} onPress={() => mutation.mutate({ id: selectedRequest.id, status: "fulfilled", admin_notes: adminNotes, payout_reference: payoutReference })}>Mark fulfilled</Button>
                </div>
              </div>
            ) : (
              <p className="text-default-500">Choose a request from the list to view details.</p>
            )}
          </CardBody>
        </Card>
      </div>
    </section>
  );
};

export default AdminPanel;
