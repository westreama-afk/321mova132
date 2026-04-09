"use client";

import { siteConfig } from "@/config/site";
import clsx from "clsx";
import { Link } from "@heroui/link";
import { usePathname } from "next/navigation";
import { Chip } from "@heroui/chip";

const BottomNavbar = () => {
  const pathName = usePathname();
  const hrefs = siteConfig.navItems.map((item) => item.href);
  const show = hrefs.includes(pathName);
  const navItemCount = siteConfig.navItems.length;

  return (
    show && (
      <>
        <div className="pt-20 md:hidden" />
        <div className="fixed bottom-0 left-0 z-50 block h-fit w-full translate-y-px border-t border-secondary-background bg-background pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-1.5 md:hidden">
          <div
            className="mx-auto grid h-full w-full max-w-lg"
            style={{ gridTemplateColumns: `repeat(${navItemCount}, minmax(0, 1fr))` }}
          >
            {siteConfig.navItems.map((item) => {
              const isActive = pathName === item.href;
              return (
                <Link
                  href={item.href}
                  key={item.href}
                  className="flex min-h-[56px] items-center justify-center px-0.5 text-foreground"
                >
                  <div className="flex max-h-[52px] flex-col items-center justify-center gap-0.5">
                    <Chip
                      size="md"
                      variant={isActive ? "solid" : "light"}
                      classNames={{
                        base: "py-[2px] transition-all max-[360px]:px-1.5",
                        content: "size-full",
                      }}
                    >
                      {isActive ? item.activeIcon : item.icon}
                    </Chip>
                    <p
                      className={clsx(
                        "text-[10px] leading-tight max-[360px]:text-[9px]",
                        { "font-bold": isActive },
                      )}
                    >
                      {item.label}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </>
    )
  );
};

export default BottomNavbar;
