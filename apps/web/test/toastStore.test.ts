import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_TOASTS, TOAST_TIMEOUT_MS, useToastStore } from "../src/store/useToastStore";

const store = () => useToastStore.getState();
const count = () => store().toasts.length;

beforeEach(() => {
  vi.useFakeTimers();
  useToastStore.setState({ toasts: [] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("toast lifecycle", () => {
  it("clears a success toast once its timeout elapses", () => {
    store().push({ variant: "success", message: "Deposit confirmed." });
    vi.advanceTimersByTime(TOAST_TIMEOUT_MS.success - 1);
    expect(count()).toBe(1);
    vi.advanceTimersByTime(1);
    expect(count()).toBe(0);
  });

  it("keeps an error on screen longer than a success", () => {
    store().push({ variant: "error", message: "Transaction failed." });
    vi.advanceTimersByTime(TOAST_TIMEOUT_MS.success);
    expect(count()).toBe(1);
    vi.advanceTimersByTime(TOAST_TIMEOUT_MS.error - TOAST_TIMEOUT_MS.success);
    expect(count()).toBe(0);
  });

  it("never expires a pending toast, and starts the clock when it resolves", () => {
    const id = store().push({ variant: "pending", message: "Confirm in your wallet" });
    vi.advanceTimersByTime(TOAST_TIMEOUT_MS.error * 2);
    expect(count()).toBe(1);

    store().update(id, { variant: "success", message: "Position opened." });
    vi.advanceTimersByTime(TOAST_TIMEOUT_MS.success - 1);
    expect(count()).toBe(1);
    vi.advanceTimersByTime(1);
    expect(count()).toBe(0);
  });

  it("dismisses immediately and does not fire the timer afterwards", () => {
    const id = store().push({ variant: "success", message: "Withdrawal confirmed." });
    store().dismiss(id);
    expect(count()).toBe(0);
    vi.advanceTimersByTime(TOAST_TIMEOUT_MS.error);
    expect(count()).toBe(0);
  });

  it("caps the stack, dropping the oldest", () => {
    for (let i = 0; i < MAX_TOASTS + 2; i++) {
      store().push({ variant: "pending", message: `tx ${i}` });
    }
    expect(count()).toBe(MAX_TOASTS);
    expect(store().toasts[0]?.message).toBe(`tx ${2}`);
  });
});
