"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** WIREFRAMES.md Layout 1: Trade / Portfolio / Vault / Docs. */
const ITEMS = [
  { href: "/trade", label: "Trade" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/vault", label: "Vault" },
];

export function Sidenav({ collapsed = false }: { collapsed?: boolean }) {
  const pathname = usePathname();
  return (
    <nav
      className={`flex flex-col gap-1 border-r border-border bg-bg p-4 ${
        collapsed ? "w-16 items-center" : "w-48"
      }`}
      aria-label="Primary"
    >
      {ITEMS.map((item) => {
        const active = pathname?.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`transition-brand focus-ring rounded-md px-3 py-2 text-body-md ${
              active
                ? "bg-surface text-text-primary"
                : "text-text-muted hover:text-text-primary"
            }`}
          >
            {collapsed ? item.label.slice(0, 1) : item.label}
          </Link>
        );
      })}
      <a
        href="https://github.com/Gauravpoudel7/Perma"
        target="_blank"
        rel="noreferrer"
        className="transition-brand focus-ring mt-auto rounded-md px-3 py-2 text-body-sm text-text-muted hover:text-text-primary"
      >
        {collapsed ? "D" : "Docs"}
      </a>
    </nav>
  );
}
