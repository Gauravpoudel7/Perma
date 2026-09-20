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

export function parseToBaseUnits(input: string, decimals: number): bigint {
  const trimmed = input.trim();
  if (!trimmed) return 0n;
  const [wholeStr, fracStr = ""] = trimmed.split(".");
  const whole = BigInt(wholeStr || "0");
  const fracPadded = (fracStr + "0".repeat(decimals)).slice(0, decimals);
  return whole * 10n ** BigInt(decimals) + BigInt(fracPadded || "0");
}

export function truncateAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}…${address.slice(-chars)}`;
}
