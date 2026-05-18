import { NextRequest, NextResponse } from "next/server";
import { requireAdminRoute } from "@/utils/admin";

const normalizeCode = (value: string) => value.trim().toUpperCase();

export async function POST(request: NextRequest) {
  const adminCheck = await requireAdminRoute();
  if (adminCheck.response) return adminCheck.response;

  const { adminSupabase, user } = adminCheck.context;
  const body = (await request.json()) as {
    code?: string;
    plan?: "monthly" | "yearly";
    duration_days?: number;
    max_redemptions?: number;
    expires_at?: string | null;
  };

  const code = typeof body.code === "string" ? normalizeCode(body.code) : "";
  if (code.length < 4 || code.length > 128) {
    return NextResponse.json({ error: "Invalid code" }, { status: 400 });
  }

  if (body.plan !== "monthly" && body.plan !== "yearly") {
    return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
  }

  const durationDays = Number(body.duration_days);
  const maxRedemptions = Number(body.max_redemptions);

  if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 3650) {
    return NextResponse.json({ error: "Invalid duration" }, { status: 400 });
  }

  if (!Number.isInteger(maxRedemptions) || maxRedemptions < 1 || maxRedemptions > 100000) {
    return NextResponse.json({ error: "Invalid max redemptions" }, { status: 400 });
  }

  let expiresAt: string | null = null;
  if (typeof body.expires_at === "string" && body.expires_at.trim()) {
    const parsed = new Date(body.expires_at);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: "Invalid expiry date" }, { status: 400 });
    }
    expiresAt = parsed.toISOString();
  }

  const { error } = await adminSupabase.from("premium_codes").insert({
    code,
    plan: body.plan,
    duration_days: durationDays,
    max_redemptions: maxRedemptions,
    active: true,
    expires_at: expiresAt,
    created_by: user.id,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ message: "Premium code created" });
}
