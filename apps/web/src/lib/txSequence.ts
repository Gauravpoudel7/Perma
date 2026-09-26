/**
 * The Open flow as one ordered list of transactions behind one wallet
 * approval: tick-array rent, the Pyth post, the mint, the Pyth rent reclaim.
 *
 * Signing them together is what keeps the posted price fresh: the mint lands
 * seconds after the post instead of after a second wallet prompt, so the 60 s
 * staleness limit in `programs/perma/src/oracle.rs` is not spent on the user.
 * The runner is pure (no wallet, no RPC) so the stop/cleanup rules are tested.
 */

export interface SequenceStep<T> {
  /** Shown as "Step N of M: <label>". */
  label: string;
  tx: T;
  /** Runs right before this step is sent. Throw to fail the step without sending it. */
  check?: () => Promise<void>;
  /** Sent even after an earlier step failed, and never the reported failure (rent reclaim). */
  always?: boolean;
}

export interface SequenceResult {
  ok: boolean;
  /** One entry per step: the confirmed signature, or null when failed or skipped. */
  signatures: (string | null)[];
  /** Index of the first failed non-`always` step. */
  failedAt: number | null;
  error: unknown;
  /** An `always` step failed. Nothing the user asked for, but worth one neutral line. */
  cleanupFailed: boolean;
}

/**
 * Send already-signed steps in order. After the first failure only `always`
 * steps still go out; a skipped step is never sent, so a mint can never land
 * without the post it depends on.
 */
export async function runSequence<T>(
  steps: SequenceStep<T>[],
  sendAndConfirm: (tx: T) => Promise<string>,
  onStep?: (index: number, total: number, label: string) => void
): Promise<SequenceResult> {
  const signatures: (string | null)[] = [];
  let failedAt: number | null = null;
  let error: unknown = null;
  let cleanupFailed = false;
  for (const [i, step] of steps.entries()) {
    if (failedAt !== null && !step.always) {
      signatures.push(null);
      continue;
    }
    onStep?.(i, steps.length, step.label);
    try {
      await step.check?.();
      signatures.push(await sendAndConfirm(step.tx));
    } catch (e) {
      signatures.push(null);
      if (step.always) cleanupFailed = true;
      else {
        failedAt = i;
        error = e;
      }
    }
  }
  return { ok: failedAt === null, signatures, failedAt, error, cleanupFailed };
}

/** "Step 2 of 7: Verify the Pyth price". */
export function stepLabel(index: number, total: number, label: string): string {
  return `Step ${index + 1} of ${total}: ${label}`;
}

/**
 * Labels for the Open flow, in send order. `pythTxs` is the post plan's
 * transaction count: every one but the last two uploads VAA bytes, then
 * verify, then post.
 */
export function openStepLabels(o: { rent: boolean; pythTxs: number; side: "short" | "long" }): string[] {
  const labels: string[] = [];
  if (o.rent) labels.push("Create the tick array (one-time rent)");
  for (let i = 0; i < o.pythTxs; i++) {
    labels.push(
      i === o.pythTxs - 1
        ? "Post the Pyth price"
        : i === o.pythTxs - 2
        ? "Verify the Pyth price"
        : "Upload Pyth price data"
    );
  }
  labels.push(o.side === "short" ? "Open the short" : "Open the long");
  if (o.pythTxs > 0) labels.push("Reclaim the Pyth rent");
  return labels;
}

/** A mint that would have landed on a price too old for the program. */
export class StalePriceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StalePriceError";
  }
}

/**
 * The one toast a finished sequence leaves. Success only when every step the
 * user asked for landed; a failed rent reclaim is one neutral sentence, never
 * a success of its own. `errorText` is the mapped program error.
 */
export function sequenceToast(
  result: SequenceResult,
  opts: { successMessage: string; failureMessage: string; errorText: string }
): { variant: "success" | "error"; message: string } {
  const cleanup = result.cleanupFailed ? " Pyth rent was not reclaimed." : "";
  if (result.ok) return { variant: "success", message: `${opts.successMessage}${cleanup}` };
  const sentAnything = result.signatures.some(Boolean);
  return {
    variant: "error",
    message: `${failedPrefix(opts.errorText)} ${sentAnything ? opts.failureMessage : "Nothing was changed."}${cleanup}`,
  };
}

/** "Transaction failed: <copy>." with exactly one period: most error copy already ends in one. */
export function failedPrefix(errorText: string): string {
  return `Transaction failed: ${errorText.replace(/\.+$/, "")}.`;
}
