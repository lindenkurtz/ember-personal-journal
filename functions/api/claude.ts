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
  // Optional base64 images for vision (e.g. parsing a screenshot of a
  // transaction list). Sonnet 4.6 downscales each to ~1600 tokens max.
  images?: { media_type: string; data: string }[]
}

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }

const MODEL = 'claude-sonnet-4-6'

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  try {
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
    // Plain string content unless images are attached, in which case build a
    // content-block array (images first, then the text prompt).
    const content: string | ContentBlock[] = body.images?.length
      ? [
          ...body.images.map(
            (img): ContentBlock => ({ type: 'image', source: { type: 'base64', media_type: img.media_type, data: img.data } })
          ),
          { type: 'text', text: body.prompt }
        ]
      : body.prompt
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
        messages: [{ role: 'user', content }]
      })
    })

    if (!upstream.ok) {
      // Return 200 with a JSON error envelope — Cloudflare's edge replaces 5xx
      // bodies from proxied zones with its branded error page, hiding the real
      // upstream error from the client.
      const text = await upstream.text()
      console.error('anthropic upstream', upstream.status, text)
      return Response.json(
        { error: `anthropic ${upstream.status}`, detail: text },
        { status: 200 }
      )
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
  } catch (e) {
    console.error('claude proxy crash', e)
    return Response.json({ error: 'proxy_crash', detail: String(e) }, { status: 200 })
  }
}
