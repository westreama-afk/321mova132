import { Metadata, NextPage } from "next";
import { cache, Suspense } from "react";
import dynamic from "next/dynamic";
import { siteConfig } from "@/config/site";
import { createClient } from "@/utils/supabase/server";

const UnauthorizedNotice = dynamic(() => import("@/components/ui/notice/Unauthorized"));
const RewardsPanel = dynamic(() => import("@/components/sections/Rewards/RewardsPanel"));

export const metadata: Metadata = {
  title: `Rewards | ${siteConfig.name}`,
};

const getUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

const RewardsPage: NextPage = async () => {
  const user = await getUser();

  return (
    <Suspense>
      {!user ? (
        <UnauthorizedNotice
          title="Sign in to view rewards"
          description="Track your points, referrals, and gift card requests in one place."
        />
      ) : (
        <RewardsPanel />
      )}
    </Suspense>
  );
};

export default RewardsPage;
