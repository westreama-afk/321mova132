"use client";

import { createClient } from "@/utils/supabase/client";
import { useEffect, useState } from "react";
import { HiDownload } from "react-icons/hi";

interface Props {
  initialCount: number;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

const LiveDownloadCounter: React.FC<Props> = ({ initialCount }) => {
  const [count, setCount] = useState(initialCount);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel("app_downloads_counter")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "app_downloads",
          filter: "id=eq.1",
        },
        (payload) => {
          const newCount = (payload.new as { count: number }).count;
          setCount(newCount);
          setPulse(true);
          setTimeout(() => setPulse(false), 600);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div className="flex items-center justify-center gap-2 text-sm text-foreground/50">
      <HiDownload
        className={`h-4 w-4 transition-all duration-300 ${pulse ? "scale-125 text-primary" : ""}`}
      />
      <span>
        <span
          className={`font-semibold tabular-nums transition-all duration-300 ${pulse ? "text-primary" : "text-foreground/70"}`}
        >
          {formatCount(count)}
        </span>{" "}
        downloads
      </span>
      <span className="flex items-center gap-1">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-500" />
        </span>
        <span className="text-xs text-foreground/40">live</span>
      </span>
    </div>
  );
};

export default LiveDownloadCounter;
