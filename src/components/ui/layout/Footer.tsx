"use client";

import { siteConfig } from "@/config/site";
import { cn } from "@/utils/helpers";
import { BreadcrumbItem, Breadcrumbs } from "@heroui/react";
import { usePathname } from "next/navigation";

interface FooterProps {
  className?: string;
}

const Footer: React.FC<FooterProps> = ({ className }) => {
  const pathName = usePathname();

  return (
    <footer
      className={cn(
        "bottom-0 flex w-full flex-col items-center justify-center gap-2 p-2 text-center",
        className,
      )}
    >
      <h6>{siteConfig.description}</h6>
      <Breadcrumbs
        separator="."
        itemClasses={{
          separator: "px-2",
        }}
      >
        {siteConfig.navItems.map(({ label, href }) => (
          <BreadcrumbItem key={href} isCurrent={pathName === href} href={href}>
            {label}
          </BreadcrumbItem>
        ))}
      </Breadcrumbs>
      <p>(c) 2026 321movies</p>
    </footer>
  );
};

export default Footer;