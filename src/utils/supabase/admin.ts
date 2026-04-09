import { createClient } from "@supabase/supabase-js";
import { Database } from "./types";
import { env } from "../env";

export const createAdminClient = () =>
  createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

