import { siteConfig } from "@/config/site";
import LiveSports from "@/components/sections/Sports/LiveSports";
import { Metadata, NextPage } from "next/types";

export const metadata: Metadata = {
  title: `Live Sports | ${siteConfig.name}`,
};

const SportsPage: NextPage = () => {
  return (
    <div className="w-full py-1 md:py-2">
      <LiveSports />
    </div>
  );
};

export default SportsPage;
