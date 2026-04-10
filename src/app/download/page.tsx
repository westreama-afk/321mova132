import { getDownloadCount } from "@/actions/download";
import { siteConfig } from "@/config/site";
import { Metadata } from "next";
import { FaAndroid } from "react-icons/fa";
import {
  IoCheckmarkCircle,
  IoPhonePortrait,
  IoTv,
  IoFlash,
  IoShield,
  IoSync,
} from "react-icons/io5";
import dynamic from "next/dynamic";
const LiveDownloadCounter = dynamic(() => import("@/components/sections/Download/LiveDownloadCounter"));
const DownloadButton = dynamic(() => import("@/components/sections/Download/DownloadButton"));

export const metadata: Metadata = {
  title: `Download App | ${siteConfig.name}`,
  description: "Download the 321Mova Android app for the best streaming experience on your phone, tablet, Fire TV, and Android TV.",
};

const APP_VERSION = "2.0";

const features = [
  {
    icon: <IoPhonePortrait className="h-5 w-5" />,
    title: "Phone & Tablet",
    description: "Optimized layout for all Android screen sizes.",
  },
  {
    icon: <IoTv className="h-5 w-5" />,
    title: "Android TV & Fire TV",
    description: "Full D-pad remote support — works on Android TV and Amazon Fire TV.",
  },
  {
    icon: <IoFlash className="h-5 w-5" />,
    title: "Fast & Lightweight",
    description: "Snappy performance with minimal battery and data usage.",
  },
  {
    icon: <IoSync className="h-5 w-5" />,
    title: "Always Up to Date",
    description: "Regular updates with new sources and bug fixes.",
  },
  {
    icon: <IoShield className="h-5 w-5" />,
    title: "No Account Needed",
    description: "Start watching immediately — no sign-up required.",
  },
  {
    icon: <IoCheckmarkCircle className="h-5 w-5" />,
    title: "Live Tv & Movies",
    description: "10000 channels available.",
  },
];

const installSteps = [
  "Tap the download button below to get the APK file.",
  'Open your file manager and tap the downloaded file.',
  'If prompted, allow "Install from unknown sources" in your settings.',
  "Tap Install and enjoy 321movies on your device.",
];

const DownloadPage = async () => {
  const initialCount = await getDownloadCount().catch(() => 0);

  return (
    <div className="flex w-full justify-center px-4 py-6">
      <div className="flex w-full max-w-2xl flex-col gap-8">

        {/* Hero */}
        <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-primary/20 via-primary/5 to-transparent p-8 text-center">
          <div className="pointer-events-none absolute -right-10 -top-10 h-56 w-56 rounded-full bg-primary/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-8 -left-8 h-40 w-40 rounded-full bg-primary/5 blur-2xl" />
          <div className="relative flex flex-col items-center gap-5">
            <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-primary/20 ring-2 ring-primary/30">
              <FaAndroid className="h-10 w-10 text-primary" />
            </div>
            <div className="flex flex-col gap-2">
              <h1 className="text-3xl font-bold text-foreground">321Mova for Android</h1>
              <p className="text-foreground/60">
                The best free streaming app for your phone, tablet, and TV.
              </p>
              <p className="text-xs text-foreground/40">Version {APP_VERSION}</p>
            </div>
            <DownloadButton />
            <LiveDownloadCounter initialCount={initialCount} />
          </div>
        </div>

        {/* Features */}
        <div className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-foreground">What&apos;s included</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {features.map((f) => (
              <div
                key={f.title}
                className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/5 p-4"
              >
                <div className="mt-0.5 shrink-0 text-primary">{f.icon}</div>
                <div className="flex flex-col gap-0.5">
                  <p className="text-sm font-semibold text-foreground">{f.title}</p>
                  <p className="text-xs text-foreground/60">{f.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Install guide */}
        <div className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-foreground">How to install</h2>
          <ol className="flex flex-col gap-3">
            {installSteps.map((step, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">
                  {i + 1}
                </span>
                <p className="text-sm text-foreground/70 leading-relaxed">{step}</p>
              </li>
            ))}
          </ol>
        </div>

        {/* Requirements */}
        <div className="rounded-xl border border-white/10 bg-white/5 p-5">
          <h2 className="mb-3 text-sm font-semibold text-foreground">Requirements</h2>
          <ul className="flex flex-col gap-1.5 text-xs text-foreground/60">
            <li>Android 7.0 (Nougat) or higher — API level 24+</li>
            <li>~55 MB free storage</li>
            <li>Active internet connection</li>
            <li>Amazon Fire TV and Android TV supported</li>
          </ul>
        </div>

      </div>
    </div>
  );
};

export default DownloadPage;
