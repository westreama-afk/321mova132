/** Points redeemed per $1 USD (e.g. 100 ⇒ 500 pts = $5.00). */
export const REWARD_POINTS_PER_USD = 100;

export function rewardUsdFromPoints(points: number): number {
  return Math.round((points / REWARD_POINTS_PER_USD) * 100) / 100;
}

export function roundRewardUsd(usd: number): number {
  return Math.round(usd * 100) / 100;
}
