/*
 * Client wrappers for the Cloudflare Pages Function at /api/claude.
 * The Anthropic API key never lives in the browser — these helpers just
 * forward a prompt and either await JSON or read the SSE stream.
 */

export interface ClaudeRequest {
  prompt: string
  system?: string
  stream?: boolean
  max_tokens?: number
}

/** Non-streaming call. Returns the model's plain text reply. */
export async function callClaude(req: ClaudeRequest): Promise<string> {
  const r = await fetch('/api/claude', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...req, stream: false })
  })
  if (!r.ok) throw new Error(`claude proxy ${r.status}: ${await r.text()}`)
  const body = (await r.json()) as { text?: string; error?: string; detail?: string }
  if (body.error) throw new Error(`${body.error}: ${body.detail ?? ''}`)
  return body.text ?? ''
}

/**
 * Streaming call. Invokes `onDelta` for each incremental text chunk. Resolves
 * with the full concatenated text once the stream closes. The Pages Function
 * pipes Anthropic's SSE through unchanged, so we parse `text_delta` events here.
 */
export async function streamClaude(
  req: ClaudeRequest,
  onDelta: (chunk: string) => void
): Promise<string> {
  const r = await fetch('/api/claude', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...req, stream: true })
  })
  if (!r.ok || !r.body) throw new Error(`claude proxy ${r.status}: ${await r.text()}`)

  const reader = r.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // SSE messages are separated by blank lines.
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''
    for (const part of parts) {
      // Each part is one or more `field: value` lines. We only care about `data:`.
      for (const line of part.split('\n')) {
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        try {
          const evt = JSON.parse(payload) as {
            type: string
            delta?: { type?: string; text?: string }
          }
          if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
            const chunk = evt.delta.text ?? ''
            if (chunk) {
              full += chunk
              onDelta(chunk)
            }
          }
        } catch {
          // Ignore malformed SSE frames — the next one is usually fine.
        }
      }
    }
  }
  return full
}
