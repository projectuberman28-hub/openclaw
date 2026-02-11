/**
 * @alfred/core - SSRF Guard
 *
 * Prevents Server-Side Request Forgery by blocking requests to private IP ranges.
 * Performs DNS resolution before fetch to catch DNS rebinding attacks.
 *
 * Allowed exceptions (local services):
 *   - localhost:11434  (Ollama)
 *   - 127.0.0.1:18789 (Alfred Gateway)
 *   - localhost:8888   (SearXNG)
 */

import { resolve as dnsResolve } from 'node:dns/promises';
import { isIP } from 'node:net';

// ---------------------------------------------------------------------------
// Allowed local service exceptions
// ---------------------------------------------------------------------------

interface AllowedService {
  host: string;
  port: number;
}

const ALLOWED_LOCAL_SERVICES: AllowedService[] = [
  { host: 'localhost', port: 11434 },   // Ollama
  { host: '127.0.0.1', port: 18789 },   // Alfred Gateway
  { host: 'localhost', port: 8888 },     // SearXNG
];

// ---------------------------------------------------------------------------
// Private IP range checks
// ---------------------------------------------------------------------------

/**
 * Check if an IPv4 address is in a private range.
 */
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p!) || p! < 0 || p! > 255)) {
    return false;
  }

  const [a, b] = parts as [number, number, number, number];

  // 127.0.0.0/8 - Loopback
  if (a === 127) return true;

  // 10.0.0.0/8 - Private
  if (a === 10) return true;

  // 172.16.0.0/12 - Private
  if (a === 172 && b >= 16 && b <= 31) return true;

  // 192.168.0.0/16 - Private
  if (a === 192 && b === 168) return true;

  // 169.254.0.0/16 - Link-local
  if (a === 169 && b === 254) return true;

  // 0.0.0.0
  if (a === 0 && b === 0 && parts[2] === 0 && parts[3] === 0) return true;

  return false;
}

/**
 * Check if an IPv6 address is in a private range.
 */
function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase().trim();

  // ::1 - Loopback
  if (normalized === '::1') return true;

  // fe80: - Link-local
  if (normalized.startsWith('fe80:')) return true;

  // fc00:/fd - Unique local
  if (normalized.startsWith('fc00:') || normalized.startsWith('fd')) return true;

  // :: - Unspecified
  if (normalized === '::') return true;

  // IPv4-mapped IPv6: ::ffff:x.x.x.x
  if (normalized.startsWith('::ffff:')) {
    const v4Part = normalized.slice('::ffff:'.length);
    if (isIP(v4Part) === 4) {
      return isPrivateIPv4(v4Part);
    }
  }

  return false;
}

/**
 * Check if an IP address (v4 or v6) is private.
 */
export function isPrivateIP(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPrivateIPv4(ip);
  if (version === 6) return isPrivateIPv6(ip);

  // Not a valid IP — treat as unsafe
  return true;
}

/**
 * Check whether a host+port combination matches an allowed local service.
 */
function isAllowedException(host: string, port: number): boolean {
  return ALLOWED_LOCAL_SERVICES.some(
    (svc) =>
      (svc.host === host || (host === '127.0.0.1' && svc.host === 'localhost') || (host === 'localhost' && svc.host === '127.0.0.1')) &&
      svc.port === port,
  );
}

/**
 * Resolve a hostname to its IP addresses via DNS.
 * Returns the resolved IPs or the original string if it's already an IP.
 */
async function resolveHost(hostname: string): Promise<string[]> {
  // Already an IP literal
  if (isIP(hostname)) {
    return [hostname];
  }

  try {
    const addresses = await dnsResolve(hostname);
    return addresses;
  } catch {
    // DNS resolution failed — could be a non-existent host or network issue
    return [];
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check if a URL is safe to fetch (not targeting private infrastructure).
 *
 * Performs DNS resolution to detect DNS rebinding attacks where a public
 * hostname resolves to a private IP.
 */
export async function isUrlSafe(urlStr: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return false;
  }

  const hostname = parsed.hostname;
  const port = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80;

  // Check allowed exceptions first
  if (isAllowedException(hostname, port)) {
    return true;
  }

  // Resolve DNS to catch rebinding
  const ips = await resolveHost(hostname);

  if (ips.length === 0) {
    // Could not resolve — block by default for safety
    return false;
  }

  // All resolved IPs must be non-private
  for (const ip of ips) {
    if (isPrivateIP(ip)) {
      return false;
    }
  }

  return true;
}

/**
 * A guarded fetch wrapper that blocks requests to private IP ranges.
 *
 * @throws Error if the URL targets a private IP (SSRF attempt).
 */
export async function guardFetch(
  urlStr: string,
  options?: RequestInit,
): Promise<Response> {
  const safe = await isUrlSafe(urlStr);

  if (!safe) {
    throw new SSRFBlockedError(urlStr);
  }

  return fetch(urlStr, options);
}

/**
 * Custom error for SSRF-blocked requests.
 */
export class SSRFBlockedError extends Error {
  public readonly url: string;

  constructor(url: string) {
    super(`SSRF blocked: request to "${url}" targets a private or unresolvable address`);
    this.name = 'SSRFBlockedError';
    this.url = url;
  }
}
