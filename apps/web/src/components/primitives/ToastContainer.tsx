"use client";

import { Toast } from "./Toast";
import { useToastStore } from "../../store/useToastStore";

/** Bottom-right toast stack, per APP-SHELL.md. Lifecycle lives in `store/useToastStore.ts`. */
export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-[calc(var(--shell-banner-h)+var(--shell-tabbar-h)+1rem)] right-4 z-50 flex flex-col gap-2 md:bottom-[calc(var(--shell-banner-h)+1rem)]">
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} />
      ))}
    </div>
  );
}
