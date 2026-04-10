import { FaAndroid } from "react-icons/fa";
import dynamic from "next/dynamic";
const DownloadButton = dynamic(() => import("@/components/sections/Download/DownloadButton"));

const AppDownload = () => {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-primary/20 via-primary/5 to-transparent p-6 md:p-8">
      <div className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-primary/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-10 -left-10 h-40 w-40 rounded-full bg-primary/5 blur-2xl" />

      <div className="relative flex flex-col items-center gap-6 text-center md:flex-row md:text-left">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-primary/20 ring-1 ring-primary/30">
          <FaAndroid className="h-8 w-8 text-primary" />
        </div>

        <div className="flex flex-1 flex-col gap-1">
          <h2 className="text-xl font-bold text-foreground md:text-2xl">
            Get the Android App
          </h2>
          <p className="text-sm text-foreground/60">
            Download the 321movies Android app for the best streaming experience on your device.
             fast, and always up to date working for both phone and tv.
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-center gap-2">
          <DownloadButton />
        </div>
      </div>
    </section>
  );
};

export default AppDownload;
