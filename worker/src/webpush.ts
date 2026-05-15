// Web Push (RFC 8030 + RFC 8291 aes128gcm) + VAPID (RFC 8292) for Cloudflare
// Workers. Implemented against Web Crypto so there are no Node dependencies.
//
// References:
//   https://datatracker.ietf.org/doc/html/rfc8291  payload encryption
//   https://datatracker.ietf.org/doc/html/rfc8188  aes128gcm content encoding
//   https://datatracker.ietf.org/doc/html/rfc8292  VAPID

export interface PushSubscription {
  endpoint: string
  p256dh: string // base64url, 65-byte uncompressed P-256 public key
  auth: string   // base64url, 16-byte auth secret
}

export interface VapidKeys {
  publicKey: string  // base64url
  privateKey: string // base64url
  subject: string    // mailto: or https:
}

const TEXT = new TextEncoder()

export async function sendPush(
  subscription: PushSubscription,
  payload: string,
  vapid: VapidKeys,
  ttlSeconds = 60 * 30
): Promise<Response> {
  const url = new URL(subscription.endpoint)
  const audience = `${url.protocol}//${url.host}`

  const body = await encryptPayload(payload, subscription)
  const jwt = await vapidJwt(audience, vapid)

  return fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${jwt}, k=${vapid.publicKey}`,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(ttlSeconds)
    },
    body
  })
}

// ─── Payload encryption ───────────────────────────────────────────────────

async function encryptPayload(
  payload: string,
  sub: PushSubscription
): Promise<Uint8Array<ArrayBuffer>> {
  const plaintext = TEXT.encode(payload)

  const uaPublic = b64urlDecode(sub.p256dh)             // 65 bytes
  const authSecret = b64urlDecode(sub.auth)             // 16 bytes
  const salt = crypto.getRandomValues(new Uint8Array(16))

  // Ephemeral ECDH P-256 keypair, one per send.
  const asKeypair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  )
  const asPublicRaw = new Uint8Array(
    await crypto.subtle.exportKey('raw', asKeypair.publicKey)
  ) // 65 bytes uncompressed

  const uaPublicKey = await crypto.subtle.importKey(
    'raw',
    uaPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  )

  const ecdhBits = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'ECDH', public: uaPublicKey },
      asKeypair.privateKey,
      256
    )
  )

  // Step 1: PRK_key = HKDF(authSecret, ecdh, "WebPush: info\0" || ua_pub || as_pub, 32)
  const keyInfo = concat(
    TEXT.encode('WebPush: info\0'),
    uaPublic,
    asPublicRaw
  )
  const prkKey = await hkdf(authSecret, ecdhBits, keyInfo, 32)

  // Step 2: derive CEK (16) and nonce (12) from PRK_key with salt.
  const cek = await hkdf(salt, prkKey, toArrayBufferView(TEXT.encode('Content-Encoding: aes128gcm\0')), 16)
  const nonce = await hkdf(salt, prkKey, toArrayBufferView(TEXT.encode('Content-Encoding: nonce\0')), 12)

  // RFC 8291 §4: append 0x02 padding delimiter then encrypt with AES-128-GCM.
  const padded = concat(plaintext, new Uint8Array([0x02]))
  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt'])
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, padded)
  ) as Uint8Array<ArrayBuffer>

  // RFC 8188 header: salt(16) || rs(4, big-endian) || idlen(1) || keyid(idlen)
  const rs = new Uint8Array(4)
  new DataView(rs.buffer).setUint32(0, 4096, false)
  const header = concat(salt, rs, new Uint8Array([asPublicRaw.length]), asPublicRaw)
  return concat(header, ciphertext)
}

async function hkdf(
  salt: BufferSource,
  ikm: BufferSource,
  info: BufferSource,
  length: number
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    key,
    length * 8
  )
  return new Uint8Array(bits)
}

// ─── VAPID JWT (ES256) ────────────────────────────────────────────────────

async function vapidJwt(audience: string, vapid: VapidKeys): Promise<string> {
  const header = { typ: 'JWT', alg: 'ES256' }
  const payload = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 12,
    sub: vapid.subject
  }
  const unsigned = `${b64urlEncode(TEXT.encode(JSON.stringify(header)))}.${b64urlEncode(
    TEXT.encode(JSON.stringify(payload))
  )}`

  const privateKey = await importVapidPrivateKey(vapid.privateKey, vapid.publicKey)
  const sigDer = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, TEXT.encode(unsigned))
  )
  return `${unsigned}.${b64urlEncode(sigDer)}`
}

// VAPID private keys are 32-byte raw P-256 scalars (base64url). Web Crypto
// only imports JWK or PKCS8 for ECDSA, so we wrap the raw scalar + public key
// into a JWK.
async function importVapidPrivateKey(
  privateB64: string,
  publicB64: string
): Promise<CryptoKey> {
  const priv = b64urlDecode(privateB64) // 32 bytes
  const pub = b64urlDecode(publicB64)   // 65 bytes, leading 0x04
  if (pub.length !== 65 || pub[0] !== 0x04) {
    throw new Error('VAPID public key must be 65 bytes uncompressed P-256')
  }
  const x = pub.slice(1, 33)
  const y = pub.slice(33, 65)
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    d: b64urlEncode(priv),
    x: b64urlEncode(x),
    y: b64urlEncode(y),
    ext: true
  }
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
}

// ─── base64url helpers ────────────────────────────────────────────────────

export function b64urlDecode(input: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (input.length % 4)) % 4)
  const b64 = (input + pad).replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function b64urlEncode(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  let len = 0
  for (const p of parts) len += p.length
  const out = new Uint8Array(len)
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.length
  }
  return out
}

// `TextEncoder.encode` returns `Uint8Array<ArrayBufferLike>` under TS 5.9's
// stricter lib; copy into a fresh ArrayBuffer-backed array so Web Crypto's
// `BufferSource` parameter (which insists on `ArrayBuffer`) accepts it.
function toArrayBufferView(view: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(view.length)
  out.set(view)
  return out
}
