"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** WIREFRAMES.md Layout 1: Trade / Portfolio / Vault / Docs, plus P2 Markets. */
const ITEMS = [
  { href: "/markets", label: "Markets" },
  { href: "/trade", label: "Trade" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/vault", label: "Vault" },
];

/**
 * Desktop / tablet primary navigation, `md` and up. Below `md` it is not
 * rendered visibly at all — `MobileTabBar` takes over — purely via a
 * Tailwind breakpoint (no JS/resize-listener state), so there is never an
 * SSR/hydration mismatch and never two navigations on one screen.
 */
export function Sidenav() {
  const pathname = usePathname();
  return (
    <nav
      className="hidden w-48 flex-col gap-1 border-r border-border bg-bg p-4 md:flex"
      aria-label="Primary"
      data-testid="sidenav"
      style={{ paddingBottom: "calc(var(--shell-banner-h) + 0.5rem)" }}
    >
      {ITEMS.map((item) => {
        const active = pathname?.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`transition-brand focus-ring rounded-md border-l px-3 py-2 text-body-md ${
              active
                ? "border-text-primary bg-surface text-text-primary"
                : "border-transparent text-text-muted hover:text-text-primary"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
      <a
        href="https://github.com/Gauravpoudel7/Perma"
        target="_blank"
        rel="noreferrer"
        className="transition-brand focus-ring mt-auto rounded-md px-3 py-2 text-body-sm text-text-muted hover:text-text-primary"
      >
        Docs
      </a>
    </nav>
  );
}
