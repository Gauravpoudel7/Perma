/** µUSDC / lamports (u64 base units) -> a decimal display string. */
export function formatBaseUnits(amount: bigint, decimals: number, maxFractionDigits = decimals): string {
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const scale = 10n ** BigInt(decimals);
  const whole = abs / scale;
  const frac = abs % scale;
  let fracStr = frac.toString().padStart(decimals, "0");
  if (maxFractionDigits < decimals) fracStr = fracStr.slice(0, maxFractionDigits);
  fracStr = fracStr.replace(/0+$/, "");
  const sign = negative ? "-" : "";
  return fracStr.length > 0 ? `${sign}${whole}.${fracStr}` : `${sign}${whole}`;
}

/** Decimal text -> base units. Anything that is not a plain decimal is 0n, never a throw: it runs during render. */
export function parseToBaseUnits(input: string, decimals: number): bigint {
  const trimmed = input.trim();
  if (!trimmed || !/^\d*\.?\d*$/.test(trimmed)) return 0n;
  const [wholeStr, fracStr = ""] = trimmed.split(".");
  const whole = BigInt(wholeStr || "0");
  const fracPadded = (fracStr + "0".repeat(decimals)).slice(0, decimals);
  return whole * 10n ** BigInt(decimals) + BigInt(fracPadded || "0");
}

export function truncateAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}…${address.slice(-chars)}`;
}

/**
 * Ticket and Portfolio token amounts: SOL to 4 decimals, USDC to 2. A real but
 * tiny amount reads "<0.0001 SOL", never "0 SOL" - a dust position must not
 * look empty.
 */
export function formatTokenAmount(base: bigint, token: "sol" | "usdc"): string {
  const [decimals, digits, unit] = token === "sol" ? [9, 4, "SOL"] : [6, 2, "USDC"];
  const shown = formatBaseUnits(base, decimals, digits);
  if (base > 0n && shown === "0") return `<${(10 ** -digits).toFixed(digits)} ${unit}`;
  return `${shown} ${unit}`;
}

/** "0.4 SOL + 52.1 USDC", leaving out a side the range does not use. */
export function formatPair(a: bigint, b: bigint): string {
  const parts = [a > 0n ? formatTokenAmount(a, "sol") : null, b > 0n ? formatTokenAmount(b, "usdc") : null].filter(Boolean);
  return parts.length ? parts.join(" + ") : "0";
}
