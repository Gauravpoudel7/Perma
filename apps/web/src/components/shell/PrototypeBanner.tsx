/**
 * COPY-DECK.md §1: mandatory, verbatim, non-dismissible, "persistent bar in
 * shell visible without scrolling on every route." Fixed to the viewport
 * bottom so it can never scroll out of view; `AppShell` reserves matching
 * bottom padding on the main content area. Never abbreviated, never
 * paraphrased, never collapsed into a tooltip, never styled as decoration.
 */
const BANNER_TEXT =
  "Prototype. Not audited. Single pool. Not production mainnet risk capital.";

export const BANNER_HEIGHT_PX = 40;

export function PrototypeBanner() {
  return (
    <div
      role="note"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-bg px-4 py-2 text-center"
      style={{ paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom, 0px))" }}
    >
      <p className="text-caption text-text-muted">{BANNER_TEXT}</p>
    </div>
  );
}
