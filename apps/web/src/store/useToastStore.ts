import { create } from "zustand";
import type { ToastData } from "../components/primitives/Toast";

/**
 * Toast lifecycle: UI state, not chain-derived, so it lives beside — never
 * inside — `useChainStore`.
 *
 * A confirmation that never leaves is noise that eventually covers the ticket,
 * so terminal toasts expire on their own and the stack is capped. A *pending*
 * toast never expires: it is replaced in place by `useSendPermaTx` when the
 * transaction resolves, and a "Confirm in your wallet" that vanished while the
 * wallet was still open would be a lie about the state of the send.
 */

/** Errors outlive successes: the user may need to read one twice. */
export const TOAST_TIMEOUT_MS = { success: 6_000, error: 12_000 } as const;
/** Oldest are dropped first; three is what fits above the banner on a phone. */
export const MAX_TOASTS = 3;

interface ToastStoreState {
  toasts: ToastData[];
  push: (t: Omit<ToastData, "id">) => string;
  update: (id: string, patch: Partial<ToastData>) => void;
  dismiss: (id: string) => void;
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();

function clearTimer(id: string) {
  const handle = timers.get(id);
  if (handle !== undefined) {
    clearTimeout(handle);
    timers.delete(id);
  }
}

export const useToastStore = create<ToastStoreState>((set, get) => {
  function schedule(id: string, variant: ToastData["variant"]) {
    clearTimer(id);
    if (variant === "pending") return;
    timers.set(
      id,
      setTimeout(() => get().dismiss(id), TOAST_TIMEOUT_MS[variant])
    );
  }

  return {
    toasts: [],
    push: (t) => {
      const id = crypto.randomUUID();
      set((s) => {
        const next = [...s.toasts, { ...t, id }];
        for (const dropped of next.slice(0, Math.max(0, next.length - MAX_TOASTS))) {
          clearTimer(dropped.id);
        }
        return { toasts: next.slice(-MAX_TOASTS) };
      });
      schedule(id, t.variant);
      return id;
    },
    update: (id, patch) => {
      set((s) => ({
        toasts: s.toasts.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      }));
      // A pending toast becoming success/error starts its clock here — that is
      // the path every transaction takes.
      if (patch.variant) schedule(id, patch.variant);
    },
    dismiss: (id) => {
      clearTimer(id);
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    },
  };
});
