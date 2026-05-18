import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/utils/admin";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const adminCheck = await requireAdminRoute();
  if (adminCheck.response) return adminCheck.response;

  const { adminSupabase } = adminCheck.context;
  const { id } = await params;
  const commentId = Number(id);

  if (!Number.isFinite(commentId)) {
    return NextResponse.json({ error: "Invalid comment id" }, { status: 400 });
  }

  const { error } = await adminSupabase.from("comments").delete().eq("id", commentId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ message: "Comment deleted" });
}
