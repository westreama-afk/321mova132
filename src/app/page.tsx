import { NextPage } from "next";
import dynamic from "next/dynamic";
const ContinueWatching = dynamic(() => import("@/components/sections/Home/ContinueWatching"));
const HomePageList = dynamic(() => import("@/components/sections/Home/List"));
const AppDownload = dynamic(() => import("@/components/sections/Home/AppDownload"));

const sponsorUrl =
  "https://www.g2g.com/categories/cursor-ai-accounts/offer/G1777483927730ME?region_id=0f76ac42-3267-4d77-9fba-f9d9d719dac9&seller=VIPAI";

const sponsorBanners = [
  {
    src: "/300x150.png",
    alt: "Sponsor banner 300x150",
    width: 300,
    height: 150,
    className: "h-[150px] w-[300px]",
  },
  {
    src: "/300x200.png",
    alt: "Sponsor banner 300x200",
    width: 300,
    height: 200,
    className: "h-[200px] w-[300px]",
  },
];

const HomePage: NextPage = () => {
  return (
    <div className="flex flex-col gap-3 md:gap-8">
      <ContinueWatching />
      <AppDownload />

      <section className="flex justify-center px-2">
        <a
          href={sponsorUrl}
          target="_blank"
          rel="noreferrer"
          className="block overflow-hidden rounded-xl border border-white/10 transition-transform hover:scale-[1.01]"
          aria-label="Visit sponsor offer"
        >
          <img
            src="/300x150.png"
            alt="Sponsor banner"
            width={300}
            height={150}
            className="h-[150px] w-[300px] object-cover"
            loading="lazy"
          />
        </a>
      </section>

      <div className="flex flex-col gap-4">
        <HomePageList />
      </div>
    </div>
  );
};

export default HomePage;
