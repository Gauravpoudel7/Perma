"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** WIREFRAMES.md Layout 1: Trade / Portfolio / Vault / Docs. */
const ITEMS = [
  { href: "/trade", label: "Trade" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/vault", label: "Vault" },
];

/**
 * Collapses to an icon-rail below `md` purely via Tailwind breakpoints (no
 * JS/resize-listener state) so it never causes an SSR/hydration mismatch.
 * A fixed w-48 rail at 390px viewport width left too little room for the
 * main content and caused real horizontal page overflow — caught by
 * Playwright's mobile-viewport pass, not visible in a desktop-only review.
 */
export function Sidenav({ collapsed = false }: { collapsed?: boolean }) {
  const pathname = usePathname();
  return (
    <nav
      className={`flex flex-col gap-1 border-r border-border bg-bg p-2 md:p-4 ${
        collapsed ? "w-16 items-center" : "w-14 items-center md:w-48 md:items-stretch"
      }`}
      aria-label="Primary"
    >
      {ITEMS.map((item) => {
        const active = pathname?.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            title={item.label}
            className={`transition-brand focus-ring rounded-md px-3 py-2 text-body-md ${
              active
                ? "bg-surface text-text-primary"
                : "text-text-muted hover:text-text-primary"
            }`}
          >
            <span aria-hidden={!collapsed} className={collapsed ? "" : "md:hidden"}>
              {item.label.slice(0, 1)}
            </span>
            <span className={collapsed ? "sr-only" : "hidden md:inline"}>{item.label}</span>
          </Link>
        );
      })}
      <a
        href="https://github.com/Gauravpoudel7/Perma"
        target="_blank"
        rel="noreferrer"
        title="Docs"
        className="transition-brand focus-ring mt-auto rounded-md px-3 py-2 text-body-sm text-text-muted hover:text-text-primary"
      >
        <span aria-hidden={!collapsed} className={collapsed ? "" : "md:hidden"}>
          D
        </span>
        <span className={collapsed ? "sr-only" : "hidden md:inline"}>Docs</span>
      </a>
    </nav>
  );
}
