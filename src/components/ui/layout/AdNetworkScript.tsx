// Add global declaration for ad loading status
declare global {
  interface Window {
    EverythingIsLife?: (key: string, param: string, num: number) => void;
    __AD_SCRIPTS_LOADED__?: boolean;
    __AD_CHECK_COMPLETE__?: boolean;
    __ADBLOCK_DETECTED__?: boolean;
  }
}
"use client";

import useSupabaseUser from "@/hooks/useSupabaseUser";
import { isPremiumUser } from "@/utils/billing/premium";
import Script from "next/script";

const AdNetworkScript: React.FC = () => {
  const { data: user, isLoading } = useSupabaseUser();
  const isPremium = isPremiumUser(user);

  if (isLoading || isPremium) return null;

  return (
    <>
    <Script id="popup-ad-tag" strategy="afterInteractive" data-cfasync="false">
      {`(function(){try{var s=document.createElement('script');s.dataset.zone='9408521';s.src='https://llvpn.com/tag.min.js';s.onload=function(){window.__AD_SCRIPTS_LOADED__=true};s.onerror=function(){window.__AD_CHECK_COMPLETE__=true;window.__ADBLOCK_DETECTED__=true};document.head.appendChild(s);}catch(e){}})();`}
    </Script>

    <Script
      id="5gvci-ad-tag"
      src="https://5gvci.com/act/files/tag.min.js?z=10775744"
      data-cfasync="false"
      strategy="afterInteractive"
      async
      onLoad={() => {
        (window as any).__AD_SCRIPTS_LOADED__ = true;
      }}
      onError={() => {
        (window as any).__AD_CHECK_COMPLETE__ = true;
        (window as any).__ADBLOCK_DETECTED__ = true;
      }}
    />
    <Script id="ad-loaded-marker" strategy="afterInteractive">
      {`
        setTimeout(function() {
          if (typeof window !== 'undefined' && !window.__AD_SCRIPTS_LOADED__) {
            window.__AD_CHECK_COMPLETE__ = true;
          }
        }, 2000);
      `}
    </Script>    </>
  );
};

export default AdNetworkScript;
