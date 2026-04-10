import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const dynamic = "force-dynamic";

const APK_URL = "http://r2.piracy.cloud/app/321movies1.2.apk";

export const GET = async () => {
  try {
    const supabase = await createClient();
    await supabase.rpc("increment_download_count");
  } catch {
    // Non-fatal — still redirect even if the counter fails
  }

  return NextResponse.redirect(APK_URL, { status: 302 });
};
