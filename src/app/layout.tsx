import type { Metadata, Viewport } from "next";
import { siteConfig } from "@/config/site";
import { Poppins } from "@/utils/fonts";
import "../styles/globals.css";
import "../styles/lightbox.css";
import "vidstack/styles/defaults.css";
import "vidstack/styles/community-skin/video.css";
import "../styles/vidstack-overrides.css";
import Providers from "./providers";
import TopNavbar from "@/components/ui/layout/TopNavbar";
import BottomNavbar from "@/components/ui/layout/BottomNavbar";
import Sidebar from "@/components/ui/layout/Sidebar";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Analytics } from "@vercel/analytics/next";
import { cn } from "@/utils/helpers";
import { IS_PRODUCTION, SpacingClasses } from "@/utils/constants";
import dynamic from "next/dynamic";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { Suspense } from "react";

const Disclaimer = dynamic(() => import("@/components/ui/overlay/Disclaimer"));
const AdNetworkScript = dynamic(() => import("@/components/ui/layout/AdNetworkScript"));
import { env } from "@/utils/env";
import Script from "next/script";

export const metadata: Metadata = {
  title: siteConfig.name,
  applicationName: siteConfig.name,
  description: siteConfig.description,
  manifest: "/manifest.json",
  icons: {
    icon: siteConfig.favicon,
  },
  twitter: {
    card: "summary",
    title: {
      default: siteConfig.name,
      template: siteConfig.name,
    },
    description: siteConfig.description,
  },
  openGraph: {
    type: "website",
    siteName: siteConfig.name,
    title: {
      default: siteConfig.name,
      template: siteConfig.name,
    },
    description: siteConfig.description,
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFFFFF" },
    { media: "(prefers-color-scheme: dark)", color: "#0D0C0F" },
  ],
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html suppressHydrationWarning lang="en">
      <body className={cn("bg-background min-h-dvh antialiased select-none", Poppins.className)}>
        <Script id="localhost-sw-reset" strategy="beforeInteractive">
          {`(function () {
            try {
              var host = window.location.hostname;
              var isLocal = host === "localhost" || host === "127.0.0.1";
              if (!isLocal) return;

              var resetKey = "__LOCAL_SW_RESET_DONE__";
              if (sessionStorage.getItem(resetKey) === "1") return;
              sessionStorage.setItem(resetKey, "1");

              var ops = [];
              if ("serviceWorker" in navigator) {
                ops.push(
                  navigator.serviceWorker.getRegistrations().then(function (regs) {
                    return Promise.all(
                      regs.map(function (reg) {
                        return reg.unregister();
                      }),
                    );
                  }),
                );
              }

              if ("caches" in window) {
                ops.push(
                  caches.keys().then(function (keys) {
                    return Promise.all(
                      keys.map(function (key) {
                        return caches.delete(key);
                      }),
                    );
                  }),
                );
              }

              Promise.allSettled(ops).finally(function () {
                window.location.reload();
              });
            } catch (error) {}
          })();`}
        </Script>
        <Script id="sw-registration" strategy="beforeInteractive">
          {`(function () {
            try {
              if ('serviceWorker' in navigator) {
                navigator.serviceWorker.register('/sw.js', { scope: '/' })
                  .then(function(reg) {
                    console.log('Service Worker registered successfully');
                  })
                  .catch(function(err) {
                    console.log('Service Worker registration failed:', err);
                  });
              }
            } catch (error) {
              console.log('Service Worker registration error:', error);
            }
          })();`}
        </Script>
        <Suspense>
          <NuqsAdapter>
            <Providers>
              {IS_PRODUCTION && <Disclaimer />}
              <TopNavbar />
              <Sidebar>
                <main className={cn("container mx-auto max-w-full", SpacingClasses.main)}>
                  {children}
                </main>
              </Sidebar>
              <BottomNavbar />
              <AdNetworkScript />
            </Providers>
          </NuqsAdapter>
        </Suspense>
        <SpeedInsights debug={false} />
        <Analytics debug={false} />

        {env.NEXT_PUBLIC_GA_MEASUREMENT_ID && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${env.NEXT_PUBLIC_GA_MEASUREMENT_ID}`}
              strategy="afterInteractive"
            />
            <Script id="google-analytics" strategy="afterInteractive">
              {`
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${env.NEXT_PUBLIC_GA_MEASUREMENT_ID}');
              `}
            </Script>
          </>
        )}

        {/* Old pop ad script disabled
        <Script async strategy="afterInteractive" src="//acscdn.com/script/aclib.js" />
        <Script data-cfasync="false" strategy="lazyOnload" id="adcash">
          {`
            aclib.runPop({
              zoneId: '9033646',
            });
          `}
        </Script>
        */}

      </body>
    </html>
  );
}
