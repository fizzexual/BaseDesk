/** Money is stored as integer cents everywhere. Format only at render time. */

export function formatMoney(cents: number, opts?: { compact?: boolean }): string {
  const dollars = cents / 100;
  if (opts?.compact) {
    if (Math.abs(dollars) >= 1000) {
      const k = dollars / 1000;
      const s = (Math.round(k * 10) / 10).toString();
      return `$${s}k`;
    }
    return `$${Math.round(dollars)}`;
  }
  const hasCents = cents % 100 !== 0;
  return `$${dollars.toLocaleString('en-US', {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

export function parseMoney(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, '');
  if (cleaned === '' || !/^-?\d*\.?\d+$/.test(cleaned)) return null;
  const dollars = Number(cleaned);
  if (!Number.isFinite(dollars)) return null;
  return Math.round(dollars * 100);
}
