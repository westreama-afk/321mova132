import { NextRequest, NextResponse } from "next/server";
import { requireAdminRoute } from "@/utils/admin";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const adminCheck = await requireAdminRoute();
  if (adminCheck.response) return adminCheck.response;

  const { adminSupabase, user } = adminCheck.context;
  const { id } = await params;
  const body = (await request.json()) as {
    is_admin?: boolean;
    username?: string;
  };

  if (!id) {
    return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
  }

  const updates: Record<string, string | boolean> = {};

  if (typeof body.is_admin === "boolean") {
    updates.is_admin = body.is_admin;
  }

  if (typeof body.username === "string" && body.username.trim()) {
    updates.username = body.username.trim();
  }

  if (!Object.keys(updates).length) {
    return NextResponse.json({ error: "No changes provided" }, { status: 400 });
  }

  if (id === user.id && body.is_admin === false) {
    return NextResponse.json(
      { error: "You cannot remove your own admin access." },
      { status: 400 },
    );
  }

  const { error } = await adminSupabase.from("profiles").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ message: "User updated" });
}
