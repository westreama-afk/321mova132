import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "../env";
import { Database } from "./types";

function isServiceRoleKey(key: string) {
  if (key.startsWith("sb_secret_")) return true;

  const parts = key.split(".");
  if (parts.length !== 3) return false;

  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return payload?.role === "service_role";
  } catch {
    return false;
  }
}

export async function createClient(admin?: boolean) {
  const cookieStore = await cookies();

  const key = admin ? env.SUPABASE_SERVICE_ROLE_KEY : env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (admin && !isServiceRoleKey(key)) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not a service-role key. Use your project's secret/service_role key from the Supabase dashboard.",
    );
  }

  // Create a server's supabase client with newly configured cookie,
  // which could be used to maintain user's session
  return createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch (error) {
          // The `setAll` method was called from a Server Component.
          // This can be ignored if you have middleware refreshing
          // user sessions.
          console.error("Failed to set cookies:", error);
        }
      },
    },
  });
}
