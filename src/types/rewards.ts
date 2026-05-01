export type RewardRequestStatus = "pending" | "approved" | "rejected" | "fulfilled";
export type ReferralStatus = "pending" | "verified" | "rewarded";

export type RewardAccount = {
  user_id: string;
  points_balance: number;
  total_points_earned: number;
  total_points_spent: number;
  referral_code: string;
  referred_by: string | null;
  watch_minutes: number;
  referral_count: number;
  created_at: string;
  updated_at: string;
};

export type RewardLedgerEntry = {
  id: number;
  user_id: string;
  entry_type: string;
  points: number;
  reference_id: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
  username?: string | null;
};

export type Referral = {
  id: number;
  referrer_id: string;
  referred_id: string;
  referral_code: string;
  status: ReferralStatus;
  reward_points: number;
  created_at: string;
  verified_at: string | null;
  rewarded_at: string | null;
  referrer_username?: string | null;
  referred_username?: string | null;
};

export type RewardRequest = {
  id: number;
  user_id: string;
  reward_type: string;
  requested_points: number;
  requested_value_usd: number;
  status: RewardRequestStatus;
  notes: string | null;
  admin_notes: string | null;
  payout_email: string | null;
  payout_reference: string | null;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  fulfilled_at: string | null;
  username?: string | null;
};
