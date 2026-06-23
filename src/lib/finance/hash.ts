// FNV-1a → hex. Stable across imports so duplicate rows collide on the same id,
// making re-imports (CSV or screenshot) idempotent. Not cryptographic — just a
// deterministic content fingerprint.
export function contentHash(parts: (string | number)[]): string {
  let h = 0x811c9dc5
  const s = parts.join('|')
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}
