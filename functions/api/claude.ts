/*
 * Cloudflare Pages Function — proxies Anthropic Messages API.
 *
 * The ANTHROPIC_API_KEY env var is only available in this server-side
 * function, never bundled into the SPA. Stream mode pipes the upstream SSE
 * body through unchanged so the client can render Claude's reply token-by-token.
 */

interface Env {
  ANTHROPIC_API_KEY: string
}

interface ChatBody {
  prompt: string
  system?: string
  stream?: boolean
  max_tokens?: number
}

const MODEL = 'claude-sonnet-4-20250514'

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  let body: ChatBody
  try {
    body = await ctx.request.json<ChatBody>()
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }
  if (!body?.prompt) return new Response('Missing prompt', { status: 400 })
  if (!ctx.env.ANTHROPIC_API_KEY) {
    return new Response('ANTHROPIC_API_KEY not configured', { status: 500 })
  }

  const stream = !!body.stream
  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ctx.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: body.max_tokens ?? 256,
      system: body.system,
      stream,
      messages: [{ role: 'user', content: body.prompt }]
    })
  })

  if (!upstream.ok) {
    const text = await upstream.text()
    return new Response(`Anthropic ${upstream.status}: ${text}`, { status: 502 })
  }

  if (stream) {
    // Pipe SSE bytes straight through. No buffering, no transformation —
    // the client parses `content_block_delta` events itself.
    return new Response(upstream.body, {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        'x-accel-buffering': 'no'
      }
    })
  }

  const json = (await upstream.json()) as {
    content?: Array<{ type: string; text?: string }>
  }
  const text =
    json.content
      ?.filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('') ?? ''
  return Response.json({ text })
}
