import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/utils/admin";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const adminCheck = await requireAdminRoute();
  if (adminCheck.response) return adminCheck.response;

  const { adminSupabase } = adminCheck.context;
  const { code } = await params;

  if (!code) {
    return NextResponse.json({ error: "Invalid room code" }, { status: 400 });
  }

  const { error } = await adminSupabase.from("party_rooms").delete().eq("code", code);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ message: "Party room deleted" });
}
