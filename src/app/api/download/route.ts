import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const dynamic = "force-dynamic";

const APK_URL = "http://r2.piracy.cloud/app/321movies1.3.apk";

async function increment() {
  const supabase = await createClient();
  await supabase.rpc("increment_download_count");
}

// Called by sendBeacon (POST) — just increment, return 204
export const POST = async () => {
  try {
    await increment();
  } catch {
    // Non-fatal
  }
  return new NextResponse(null, { status: 204 });
};

// Fallback for direct navigation (e.g. if sendBeacon unavailable)
export const GET = async () => {
  try {
    await increment();
  } catch {
    // Non-fatal
  }
  return NextResponse.redirect(APK_URL, { status: 302 });
};
