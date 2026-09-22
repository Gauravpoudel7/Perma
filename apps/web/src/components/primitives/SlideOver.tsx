"use client";

import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from "react";

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The one slide-over in PERMA (APP-SHELL: "No Pop-ups... use slide-over
 * panels"). Solid-alpha scrim, right-anchored panel, 1px left border, no
 * radius on the edge, no shadow. Esc and scrim click close it; Tab wraps
 * inside it; the first focus goes to `initialFocusRef`. Returning focus to
 * whatever opened it is the caller's job, because only the caller has that
 * element. Used by the Trade ReviewSheet and the Portfolio PositionDetail.
 *
 * The panel stops where AppShell's fixed bottom chrome starts — the Prototype
 * banner at every width, plus the tab bar below `md` — so the footer's actions
 * are always fully on screen. Padding the panel instead (the pre-U8 approach)
 * left Cancel/Confirm under the banner on desktop and under the tab bar on
 * phones.
 */
export function SlideOver({
  open,
  title,
  subtitle,
  onClose,
  initialFocusRef,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  initialFocusRef?: RefObject<HTMLElement>;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const target = initialFocusRef?.current ?? panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    target?.focus();
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose, initialFocusRef]);

  function trapTab(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab" || !panelRef.current) return;
    const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70" onClick={onClose} role="presentation">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="slide-over-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={trapTab}
        className="fixed right-0 top-0 bottom-[calc(var(--shell-banner-h)+var(--shell-tabbar-h)+env(safe-area-inset-bottom,0px))] flex w-full flex-col border-l border-border bg-surface sm:w-[400px] md:bottom-[calc(var(--shell-banner-h)+env(safe-area-inset-bottom,0px))]"
      >
        <div className="shrink-0 border-b border-border px-6 py-4">
          <h2 id="slide-over-title" className="text-h4 text-text-primary">
            {title}
          </h2>
          {subtitle && <p className="text-body-sm mt-1 text-text-muted">{subtitle}</p>}
        </div>
        {/* min-h-0: a flex child must be allowed to shrink before overflow-y does anything. */}
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-6">{children}</div>
        {footer && <div className="flex shrink-0 gap-3 border-t border-border px-6 py-4">{footer}</div>}
      </div>
    </div>
  );
}

/** Caption label over a mono (default) or sans value, with an optional mono hint line. */
export function SlideOverRow({
  label,
  value,
  hint,
  mono = true,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-caption text-text-muted">{label}</dt>
      <dd className={`mt-1 text-text-primary ${mono ? "text-mono-md tabular-nums" : "text-body-md"}`}>{value}</dd>
      {hint && <dd className="text-mono-sm tabular-nums mt-1 text-text-muted">{hint}</dd>}
    </div>
  );
}
