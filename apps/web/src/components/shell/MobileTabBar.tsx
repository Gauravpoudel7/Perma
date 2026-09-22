"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Thumb order: the thing you came to do first, the catalogue last. Same strings as the Sidenav. */
const ITEMS = [
  { href: "/trade", label: "Trade" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/vault", label: "Vault" },
  { href: "/markets", label: "Markets" },
];

/**
 * Phone primary navigation (<md). AppShell stacks it directly above the
 * Prototype banner inside one fixed bottom wrapper, so the banner stays
 * bottom-most, is never covered, and no height constant has to guess how
 * many lines the banner wrapped to (MOBILE-U5-RESEARCH §3).
 * Text labels only — PERMA ships no icon set. Solid background, 1px rule;
 * no blur, no shadow. Hidden from `md` up, where the Sidenav takes over;
 * the two are never rendered visibly together.
 */
export function MobileTabBar() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      data-testid="mobile-tabbar"
      className="flex border-t border-border bg-bg md:hidden"
      style={{ height: "var(--shell-tabbar-h)" }}
    >
      {ITEMS.map((item) => {
        const active = pathname?.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`transition-brand focus-ring -mt-px flex min-h-[44px] flex-1 items-center justify-center border-t text-body-sm ${
              active ? "border-text-primary text-text-primary" : "border-transparent text-text-muted"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
