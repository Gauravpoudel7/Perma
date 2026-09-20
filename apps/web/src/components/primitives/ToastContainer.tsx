"use client";

import { create } from "zustand";
import { Toast, type ToastData } from "./Toast";

/**
 * Bottom-right toast stack, per APP-SHELL.md. A tiny dedicated store rather
 * than putting toast state in useChainStore — toasts are UI lifecycle, not
 * chain-derived data.
 */
interface ToastStoreState {
  toasts: ToastData[];
  push: (t: Omit<ToastData, "id">) => string;
  update: (id: string, patch: Partial<ToastData>) => void;
  dismiss: (id: string) => void;
}

export const useToastStore = create<ToastStoreState>((set) => ({
  toasts: [],
  push: (t) => {
    const id = crypto.randomUUID();
    set((s) => ({ toasts: [...s.toasts, { ...t, id }] }));
    return id;
  },
  update: (id, patch) =>
    set((s) => ({
      toasts: s.toasts.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    })),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} />
      ))}
    </div>
  );
}
