"use client";

import { useEffect, useState } from "react";
import useSupabaseUser from "./useSupabaseUser";
import { isPremiumUser } from "@/utils/billing/premium";

// CSS cosmetic filter check.
// uBlock/ABP inject a stylesheet rule: .adsbox { display:none !important }
// This hides any element with that class — no network, no SW, fully reliable.
const checkBaitElement = (): Promise<boolean> => {
  return new Promise((resolve) => {
    const bait = document.createElement("div");
    bait.className = "ads adsbox adsbygoogle ad-banner ad-placement pub_300x250";
    bait.id = "adb_" + Math.random().toString(36).slice(2);
    bait.style.cssText = "width:1px;height:1px;position:absolute;left:-9999px;top:-9999px;";
    document.body.appendChild(bait);
    requestAnimationFrame(() => {
      setTimeout(() => {
        const cs = window.getComputedStyle(bait);
        const blocked =
          bait.offsetHeight === 0 ||
          bait.offsetWidth === 0 ||
          cs.display === "none" ||
          cs.visibility === "hidden";
        bait.remove();
        resolve(blocked);
      }, 250);
    });
  });
};

// Network-level check using fetch() with POST so the Service Worker
// (which only handles GET) is bypassed entirely. uBlock cancels the
// request before any response → fetch rejects → detected. Without
// adblock the server responds (opaque) → fetch resolves → not detected.
const checkFetchBlocked = (url: string): Promise<boolean> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 3500);
    fetch(url, { method: "POST", mode: "no-cors", cache: "no-store" })
      .then(() => { clearTimeout(timer); resolve(false); })
      .catch(() => { clearTimeout(timer); resolve(true); });
  });

// Poll for __ADBLOCK_DETECTED__ set exclusively by onerror handlers in AdNetworkScript.
// llvpn.com and 5gvci.com are in uBlock's own block lists — their onerror fires immediately.
// __AD_SCRIPTS_LOADED__ is intentionally NOT checked here: if one script loads but another
// is blocked, we must still detect it. Only __ADBLOCK_DETECTED__ (set by onerror only) matters.
const checkAdNetworkFlags = (): Promise<boolean> =>
  new Promise((resolve) => {
    const deadline = Date.now() + 4000;
    const poll = () => {
      const w = window as Window & { __ADBLOCK_DETECTED__?: boolean; __AD_SCRIPTS_LOADED__?: boolean };
      if (w.__ADBLOCK_DETECTED__) { resolve(true); return; }
      // At least one ad script loaded cleanly → no adblock, resolve immediately.
      if (w.__AD_SCRIPTS_LOADED__) { resolve(false); return; }
      if (Date.now() >= deadline) { resolve(false); return; }
      setTimeout(poll, 100);
    };
    poll();
  });

const useAdBlockDetector = () => {
  const [isAdBlockDetected, setIsAdBlockDetected] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const { data: user, isLoading: isUserLoading } = useSupabaseUser();
  const isPremium = isPremiumUser(user);

  useEffect(() => {
    // Keep isChecking=true (initial state) while auth loads - player stays gated
    if (isUserLoading) return;

    if (isPremium) {
      setIsAdBlockDetected(false);
      setIsChecking(false);
      return;
    }

    setIsChecking(true);
    let disposed = false;

    const run = async () => {
      let settled = false;
      const settle = (detected: boolean) => {
        if (settled || disposed) return;
        settled = true;
        setIsAdBlockDetected(detected);
        setIsChecking(false);
      };

      const probes = [
        // CSS cosmetic filter — catches any blocker that injects cosmetic rules.
        checkBaitElement(),
        // EasyList / standard blockers: Google ad network domains.
        // POST method bypasses the Workbox SW (which only caches GET).
        checkFetchBlocked(
          "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js",
        ),
        checkFetchBlocked(
          "https://securepubads.g.doubleclick.net/tag/js/gpt.js",
        ),
        // uBlock's own lists block llvpn.com / 5gvci.com (the ad scripts in AdNetworkScript).
        // Their onerror fires immediately on block → __AD_CHECK_COMPLETE__ = true.
        checkAdNetworkFlags(),
      ];

      // First probe to return true wins immediately.
      probes.forEach((p) => p.then((r) => r && settle(true)));
      const results = await Promise.all(probes);
      settle(results.some(Boolean));
    };

    run();

    return () => {
      disposed = true;
    };
  }, [isUserLoading, isPremium]);

  return { isAdBlockDetected, isChecking };
};

export default useAdBlockDetector;
