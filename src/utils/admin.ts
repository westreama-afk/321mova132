import type { User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";

export type AdminRouteContext = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  adminSupabase: ReturnType<typeof createAdminClient>;
  user: User;
  profile: {
    username: string;
    is_admin: boolean;
  };
};

type AdminRouteResult =
  | { context: AdminRouteContext; response?: never }
  | { context?: never; response: NextResponse };

export async function requireAdminRoute(): Promise<AdminRouteResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("username, is_admin")
    .eq("id", user.id)
    .single();

  if (profileError || !profile?.is_admin) {
    return {
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return {
    context: {
      supabase,
      adminSupabase: createAdminClient(),
      user,
      profile: {
        username: profile.username,
        is_admin: true,
      },
    },
  };
}
