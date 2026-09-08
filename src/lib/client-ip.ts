import { Request } from 'express';
import { isIP } from 'net';

function normalizedIp(value: string | undefined): string | null {
  if (!value) return null;
  const address = value.trim().replace(/^::ffff:/, '');
  return isIP(address) ? address : null;
}

/**
 * Resolve the original browser address when Vercel proxies a request to Railway.
 * Prefer Vercel's forwarded address, then the standard forwarding chain, then
 * Express' proxy-aware address as a fallback. The raw address is never stored.
 */
export function getOriginalClientIp(req: Request): string {
  for (const headerName of ['x-vercel-forwarded-for', 'x-forwarded-for']) {
    const header = req.headers[headerName];
    const value = Array.isArray(header) ? header[0] : header;
    for (const candidate of value?.split(',') || []) {
      const address = normalizedIp(candidate);
      if (address) return address;
    }
  }
  return normalizedIp(req.ip) || normalizedIp(req.socket.remoteAddress) || 'unknown';
}
