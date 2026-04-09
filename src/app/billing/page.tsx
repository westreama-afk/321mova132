import { siteConfig } from "@/config/site";
import { cache, Suspense } from "react";
import dynamic from "next/dynamic";
import { Metadata, NextPage } from "next";
import { createClient } from "@/utils/supabase/server";

const UnauthorizedNotice = dynamic(() => import("@/components/ui/notice/Unauthorized"));
const Card2CryptoCheckout = dynamic(() => import("@/components/sections/Billing/Card2CryptoCheckout"));

export const metadata: Metadata = {
  title: `Ad-Free | ${siteConfig.name}`,
};

const getUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  return { user, error };
});

const BillingPage: NextPage = async () => {
  const { user, error } = await getUser();

  return (
    <Suspense>
      {error || !user ? (
        <UnauthorizedNotice
          title="Sign in to manage ad-free access"
          description="Create an account and choose a plan to remove ads from your player experience."
        />
      ) : (
        <Card2CryptoCheckout />
      )}
    </Suspense>
  );
};

export default BillingPage;

