import { Metadata, NextPage } from "next";
import { cache, Suspense } from "react";
import dynamic from "next/dynamic";
import { createClient } from "@/utils/supabase/server";
import { siteConfig } from "@/config/site";

const UnauthorizedNotice = dynamic(() => import("@/components/ui/notice/Unauthorized"));
const AdminPanel = dynamic(() => import("@/components/sections/Admin/AdminPanel"));

export const metadata: Metadata = {
  title: `Admin | ${siteConfig.name}`,
};

const getAdminContext = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { user: null, isAdmin: false };

  const { data: profile } = await supabase.from("profiles").select("is_admin").eq("id", user.id).single();

  return { user, isAdmin: Boolean(profile?.is_admin) };
});

const AdminPage: NextPage = async () => {
  const { user, isAdmin } = await getAdminContext();

  return (
    <Suspense>
      {!user || !isAdmin ? (
        <UnauthorizedNotice
          title="Admin access required"
          description="Sign in with an admin account to manage reward requests and payout reviews."
        />
      ) : (
        <AdminPanel />
      )}
    </Suspense>
  );
};

export default AdminPage;
