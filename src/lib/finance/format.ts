/** Currency formatting helpers. Uses a real minus glyph (−) to match the UI. */
export function money(n: number, opts: { cents?: boolean; signed?: boolean } = {}): string {
  const s = Math.abs(n).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: opts.cents ? 2 : 0,
    maximumFractionDigits: opts.cents ? 2 : 0
  })
  if (opts.signed) return (n < 0 ? '−' : '+') + s
  return (n < 0 ? '−' : '') + s
}
