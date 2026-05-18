import { NextRequest, NextResponse } from "next/server";
import { requireAdminRoute } from "@/utils/admin";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const adminCheck = await requireAdminRoute();
  if (adminCheck.response) return adminCheck.response;

  const { adminSupabase } = adminCheck.context;
  const { id } = await params;
  const codeId = Number(id);
  const body = (await request.json()) as {
    active?: boolean;
    expires_at?: string | null;
    max_redemptions?: number;
  };

  if (!Number.isFinite(codeId)) {
    return NextResponse.json({ error: "Invalid code id" }, { status: 400 });
  }

  const updates: Record<string, boolean | number | string | null> = {};

  if (typeof body.active === "boolean") updates.active = body.active;
  if (typeof body.max_redemptions === "number") updates.max_redemptions = body.max_redemptions;

  if (body.expires_at === null) {
    updates.expires_at = null;
  } else if (typeof body.expires_at === "string" && body.expires_at.trim()) {
    const parsed = new Date(body.expires_at);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: "Invalid expiry date" }, { status: 400 });
    }
    updates.expires_at = parsed.toISOString();
  }

  if (!Object.keys(updates).length) {
    return NextResponse.json({ error: "No changes provided" }, { status: 400 });
  }

  const { error } = await adminSupabase.from("premium_codes").update(updates).eq("id", codeId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ message: "Premium code updated" });
}
