"use server";

import { createClient } from "@/utils/supabase/server";

export async function incrementDownloadCount(): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("increment_download_count");
  if (error) throw error;
  return data as number;
}

export async function getDownloadCount(): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("app_downloads")
    .select("count")
    .eq("id", 1)
    .single();
  if (error) throw error;
  return (data?.count as number) ?? 0;
}
