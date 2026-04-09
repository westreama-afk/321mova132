"use client";

import BackButton from "@/components/ui/button/BackButton";
import { siteConfig } from "@/config/site";
import { cn } from "@/utils/helpers";
import { Navbar, NavbarBrand, NavbarContent, NavbarItem } from "@heroui/react";
import { useWindowScroll } from "@mantine/hooks";
import Link from "next/link";
import { usePathname } from "next/navigation";
import FullscreenToggleButton from "../button/FullscreenToggleButton";
import IconButton from "../button/IconButton";
import UserProfileButton from "../button/UserProfileButton";
import SearchInput from "../input/SearchInput";
import ThemeSwitchDropdown from "../input/ThemeSwitchDropdown";
import BrandLogo from "../other/BrandLogo";
import { FaDiscord } from "react-icons/fa6";
import RandomButton from "../button/RandomButton";

const TopNavbar = () => {
  const pathName = usePathname();
  const [{ y }] = useWindowScroll();
  const opacity = Math.min((y / 1000) * 5, 1);
  const hrefs = siteConfig.navItems.map((item) => item.href);
  const show = hrefs.includes(pathName);
  const tv = pathName.includes("/tv/");
  const player = pathName.includes("/player");
  const auth = pathName.includes("/auth");

  if (auth || player) return null;

  return (
    <Navbar
      disableScrollHandler
      isBlurred={false}
      position="sticky"
      maxWidth="full"
      classNames={{ wrapper: "px-2 md:px-4" }}
      className={cn("inset-0 h-min bg-transparent", {
        "bg-background": show,
      })}
    >
      {!show && (
        <div
          className="border-background bg-background absolute inset-0 h-full w-full border-b"
          style={{ opacity: opacity }}
        />
      )}
      <NavbarBrand>
        {show ? <BrandLogo /> : <BackButton href={tv ? "/?content=tv" : "/"} />}
      </NavbarBrand>
      {show && !pathName.startsWith("/search") && (
        <NavbarContent className="hidden w-full max-w-lg gap-2 md:flex" justify="center">
          <NavbarItem className="w-full">
            <Link href="/search" className="w-full">
              <SearchInput
                className="pointer-events-none"
                placeholder="Search your favorite movies..."
              />
            </Link>
          </NavbarItem>
        </NavbarContent>
      )}
      <NavbarContent justify="end" className="min-w-0">
        <NavbarItem className="flex gap-1 max-[380px]:gap-0.5">
          <ThemeSwitchDropdown />
          <RandomButton />
          <IconButton
            tooltip="Discord"
            tooltipProps={{ placement: "left" }}
            className="p-2 max-[380px]:hidden"
            variant="light"
            icon={<FaDiscord className="size-full" />}
            href="https://discord.gg/5CETfHBD7R"
            target="_blank"
            rel="noopener noreferrer"
          />
          <div className="max-[340px]:hidden">
            <FullscreenToggleButton />
          </div>
          <UserProfileButton />
        </NavbarItem>
      </NavbarContent>
    </Navbar>
  );
};

export default TopNavbar;
