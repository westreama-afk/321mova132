"use client";

import { Button, Card, CardBody, Input, Textarea, addToast } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { RewardAccount, RewardLedgerEntry, RewardRequest, Referral } from "@/types/rewards";
import { REWARD_POINTS_PER_USD, rewardUsdFromPoints } from "@/utils/rewardPayout";

const MIN_REDEMPTION_POINTS = 500;

type RewardsResponse = {
  account: RewardAccount | null;
  ledger: RewardLedgerEntry[];
  referrals: Referral[];
  requests: RewardRequest[];
  referral_link: string | null;
  referral_stats: {
    total: number;
    pending: number;
    verified: number;
    rewarded: number;
  };
};

async function fetchRewards(): Promise<RewardsResponse> {
  const response = await fetch("/api/rewards/me", { credentials: "include" });
  if (!response.ok) throw new Error("Failed to load rewards");
  return response.json();
}

async function createRewardRequest(input: { requested_points: number; requested_value_usd: number; payout_email: string; notes?: string; }): Promise<{ message: string }> {
  const response = await fetch("/api/rewards/requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error ?? "Failed to submit request");
  }
  return response.json();
}

const RewardsPanel = () => {
  const queryClient = useQueryClient();
  const [points, setPoints] = useState("500");
  const [payoutEmail, setPayoutEmail] = useState("");
  const [notes, setNotes] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["rewards-me"],
    queryFn: fetchRewards,
  });

  const payoutPreview = useMemo(() => {
    const p = Math.round(Number(points));
    if (!Number.isFinite(p) || p < MIN_REDEMPTION_POINTS) return null;
    return { points: p, value: rewardUsdFromPoints(p) };
  }, [points]);

  const copyReferralLink = async () => {
    if (!data?.referral_link) return;
    await navigator.clipboard.writeText(data.referral_link);
    addToast({ title: "Referral link copied", color: "success" });
  };

  const mutation = useMutation({
    mutationFn: createRewardRequest,
    onSuccess: async ({ message }) => {
      addToast({ title: message, color: "success" });
      setNotes("");
      await queryClient.invalidateQueries({ queryKey: ["rewards-me"] });
    },
    onError: (error: Error) => addToast({ title: error.message, color: "danger" }),
  });

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">Rewards</h1>
        <p className="text-default-500">Track points, referrals, and submit manual gift card requests.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="border border-default-200"><CardBody><p className="text-sm text-default-500">Points balance</p><p className="text-3xl font-semibold">{data?.account?.points_balance ?? 0}</p></CardBody></Card>
        <Card className="border border-default-200"><CardBody><p className="text-sm text-default-500">Referrals</p><p className="text-3xl font-semibold">{data?.referral_stats.total ?? 0}</p></CardBody></Card>
        <Card className="border border-default-200"><CardBody><p className="text-sm text-default-500">Verified</p><p className="text-3xl font-semibold">{data?.referral_stats.verified ?? 0}</p></CardBody></Card>
        <Card className="border border-default-200"><CardBody><p className="text-sm text-default-500">Referral code</p><p className="text-2xl font-semibold break-all">{data?.account?.referral_code ?? "—"}</p></CardBody></Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card className="border border-default-200">
          <CardBody className="gap-4">
            <h2 className="text-xl font-semibold">Invite friends</h2>
            <p className="text-sm text-default-500">Share your referral link. You earn when they become active.</p>
            <div className="rounded-2xl border border-default-200 bg-default-50 p-4 text-sm break-all text-default-600">{data?.referral_link ?? "Referral link unavailable"}</div>
            <div className="flex gap-2">
              <Button color="primary" onPress={copyReferralLink} isDisabled={!data?.referral_link}>Copy link</Button>
            </div>
            <div className="grid gap-3 md:grid-cols-3 text-sm">
              <div className="rounded-2xl border border-default-200 p-3"><p className="text-default-500">Pending</p><p className="text-xl font-semibold">{data?.referral_stats.pending ?? 0}</p></div>
              <div className="rounded-2xl border border-default-200 p-3"><p className="text-default-500">Verified</p><p className="text-xl font-semibold">{data?.referral_stats.verified ?? 0}</p></div>
              <div className="rounded-2xl border border-default-200 p-3"><p className="text-default-500">Rewarded</p><p className="text-xl font-semibold">{data?.referral_stats.rewarded ?? 0}</p></div>
            </div>
          </CardBody>
        </Card>

        <Card className="border border-default-200">
          <CardBody className="gap-3">
            <h2 className="text-xl font-semibold">How it works</h2>
            <ul className="list-disc space-y-2 pl-5 text-default-500">
              <li>Watch time and referrals earn points.</li>
              <li>Points stay internal until you request a payout.</li>
              <li>Admin reviews requests manually before fulfillment.</li>
              <li>First payouts may take longer for verification.</li>
            </ul>
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card className="border border-default-200">
          <CardBody className="gap-4">
            <h2 className="text-xl font-semibold">Redeem manually</h2>
            <p className="text-sm text-default-500">
              {REWARD_POINTS_PER_USD} points = $1.00. Gift card value is calculated from the points you redeem.
            </p>
            <Input label="Points to redeem" value={points} onValueChange={setPoints} min={MIN_REDEMPTION_POINTS} />
            <p className="text-sm text-default-600">
              Gift card value:{" "}
              <span className="font-semibold text-foreground">
                {payoutPreview ? `$${payoutPreview.value.toFixed(2)}` : "—"}
              </span>
            </p>
            {!payoutPreview && Number.isFinite(Math.round(Number(points))) && Math.round(Number(points)) > 0 && (
              <p className="text-sm text-danger">Minimum redemption is {MIN_REDEMPTION_POINTS} points.</p>
            )}
            <Input label="PayPal email" value={payoutEmail} onValueChange={setPayoutEmail} />
            <Textarea label="Notes" value={notes} onValueChange={setNotes} />
            <Button
              color="primary"
              isLoading={mutation.isPending}
              isDisabled={!payoutPreview || !payoutEmail.trim()}
              onPress={() =>
                payoutPreview &&
                mutation.mutate({
                  requested_points: payoutPreview.points,
                  requested_value_usd: payoutPreview.value,
                  payout_email: payoutEmail.trim(),
                  notes,
                })
              }
            >
              {mutation.isPending ? "Submitting..." : "Submit request"}
            </Button>
          </CardBody>
        </Card>

        <Card className="border border-default-200">
          <CardBody className="gap-4">
            <h2 className="text-xl font-semibold">Recent activity</h2>
            {isLoading ? (
              <p className="text-default-500">Loading...</p>
            ) : (
              <div className="space-y-4 text-sm">
                <div>
                  <p className="mb-2 font-medium">Recent requests</p>
                  <div className="space-y-2 text-default-500">
                    {data?.requests.length ? data.requests.map((request) => (
                      <div key={request.id} className="rounded-xl border border-default-200 p-3">
                        <p>#{request.id} • {request.status}</p>
                        <p>{request.requested_points} points • ${request.requested_value_usd}</p>
                      </div>
                    )) : <p>No requests yet.</p>}
                  </div>
                </div>
                <div>
                  <p className="mb-2 font-medium">Referral history</p>
                  <div className="space-y-2 text-default-500">
                    {data?.referrals.length ? data.referrals.map((referral) => (
                      <div key={referral.id} className="rounded-xl border border-default-200 p-3">
                        <p>{referral.status}</p>
                        <p>{referral.reward_points} pts</p>
                      </div>
                    )) : <p>No referrals yet.</p>}
                  </div>
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <Card className="border border-default-200">
        <CardBody className="gap-4">
          <h2 className="text-xl font-semibold">Reward activity</h2>
          {isLoading ? <p className="text-default-500">Loading...</p> : (
            <div className="grid gap-2 text-sm text-default-500 md:grid-cols-2 lg:grid-cols-3">
              {data?.ledger.length ? data.ledger.map((entry) => (
                <div key={entry.id} className="rounded-xl border border-default-200 p-3">
                  <p className="font-medium">{entry.entry_type}</p>
                  <p>{entry.points > 0 ? "+" : ""}{entry.points} points</p>
                </div>
              )) : <p>No activity yet.</p>}
            </div>
          )}
        </CardBody>
      </Card>
    </section>
  );
};

export default RewardsPanel;
