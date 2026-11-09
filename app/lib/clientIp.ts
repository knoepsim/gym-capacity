import type { NextRequest } from 'next/server'

/**
 * Client address of a request. Cloudflare overwrites CF-Connecting-IP with the real address. X-Forwarded-For is only
 * appended to, so its first entry can be faked by the client; it stays as the fallback for setups without Cloudflare.
 */
export function clientIp(request: NextRequest): string | null {
  const value =
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0] ??
    request.headers.get('x-real-ip')
  return value?.trim().slice(0, 64) || null
}
