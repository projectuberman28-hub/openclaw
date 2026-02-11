/**
 * Tests for @alfred/core - SSRF Guard
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isPrivateIP, isUrlSafe } from '@alfred/core/security';

// Mock DNS resolution to control test outcomes
vi.mock('node:dns/promises', () => ({
  resolve: vi.fn(),
}));

describe('SSRF Guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // isPrivateIP - IPv4 private ranges
  // ---------------------------------------------------------------------------
  describe('isPrivateIP IPv4', () => {
    it('blocks 127.x.x.x (loopback)', () => {
      expect(isPrivateIP('127.0.0.1')).toBe(true);
      expect(isPrivateIP('127.0.0.2')).toBe(true);
      expect(isPrivateIP('127.255.255.255')).toBe(true);
    });

    it('blocks 10.x.x.x (private)', () => {
      expect(isPrivateIP('10.0.0.1')).toBe(true);
      expect(isPrivateIP('10.255.255.255')).toBe(true);
    });

    it('blocks 172.16-31.x.x (private)', () => {
      expect(isPrivateIP('172.16.0.1')).toBe(true);
      expect(isPrivateIP('172.31.255.255')).toBe(true);
      // 172.15 and 172.32 should NOT be private
      expect(isPrivateIP('172.15.0.1')).toBe(false);
      expect(isPrivateIP('172.32.0.1')).toBe(false);
    });

    it('blocks 192.168.x.x (private)', () => {
      expect(isPrivateIP('192.168.0.1')).toBe(true);
      expect(isPrivateIP('192.168.255.255')).toBe(true);
    });

    it('blocks 169.254.x.x (link-local)', () => {
      expect(isPrivateIP('169.254.0.1')).toBe(true);
      expect(isPrivateIP('169.254.255.255')).toBe(true);
    });

    it('allows public IPs', () => {
      expect(isPrivateIP('8.8.8.8')).toBe(false);
      expect(isPrivateIP('1.1.1.1')).toBe(false);
      expect(isPrivateIP('93.184.216.34')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // isPrivateIP - IPv6 private ranges
  // ---------------------------------------------------------------------------
  describe('isPrivateIP IPv6', () => {
    it('blocks ::1 (loopback)', () => {
      expect(isPrivateIP('::1')).toBe(true);
    });

    it('blocks fe80:: (link-local)', () => {
      expect(isPrivateIP('fe80::1')).toBe(true);
      expect(isPrivateIP('fe80::abcd:1234')).toBe(true);
    });

    it('blocks fc00:: (unique local)', () => {
      expect(isPrivateIP('fc00::1')).toBe(true);
    });

    it('blocks fd:: (unique local)', () => {
      expect(isPrivateIP('fd12::1')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // isUrlSafe - allowed exceptions
  // ---------------------------------------------------------------------------
  describe('isUrlSafe - allowed local services', () => {
    it('allows Ollama at localhost:11434', async () => {
      const result = await isUrlSafe('http://localhost:11434/api/tags');
      expect(result).toBe(true);
    });

    it('allows Gateway at 127.0.0.1:18789', async () => {
      const result = await isUrlSafe('http://127.0.0.1:18789/health');
      expect(result).toBe(true);
    });

    it('allows SearXNG at localhost:8888', async () => {
      const result = await isUrlSafe('http://localhost:8888/search');
      expect(result).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // isUrlSafe - public URLs
  // ---------------------------------------------------------------------------
  describe('isUrlSafe - public URLs', () => {
    it('allows public URLs when DNS resolves to public IPs', async () => {
      const { resolve } = await import('node:dns/promises');
      vi.mocked(resolve).mockResolvedValue(['93.184.216.34'] as any);

      const result = await isUrlSafe('https://example.com/api');
      expect(result).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // isUrlSafe - blocks private IP URLs
  // ---------------------------------------------------------------------------
  describe('isUrlSafe - blocks private IPs', () => {
    it('blocks URLs targeting 127.x.x.x (non-allowed port)', async () => {
      const result = await isUrlSafe('http://127.0.0.1:9999/secret');
      expect(result).toBe(false);
    });

    it('blocks URLs targeting 10.x.x.x', async () => {
      const result = await isUrlSafe('http://10.0.0.1/admin');
      expect(result).toBe(false);
    });

    it('blocks URLs targeting 192.168.x.x', async () => {
      const result = await isUrlSafe('http://192.168.1.1/router');
      expect(result).toBe(false);
    });

    it('blocks invalid URLs', async () => {
      const result = await isUrlSafe('not-a-valid-url');
      expect(result).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // DNS rebinding prevention
  // ---------------------------------------------------------------------------
  describe('DNS rebinding prevention', () => {
    it('blocks URLs where DNS resolves to a private IP', async () => {
      const { resolve } = await import('node:dns/promises');
      vi.mocked(resolve).mockResolvedValue(['192.168.0.1'] as any);

      const result = await isUrlSafe('https://evil-rebinding-site.com/api');
      expect(result).toBe(false);
    });

    it('blocks URLs that fail DNS resolution', async () => {
      const { resolve } = await import('node:dns/promises');
      vi.mocked(resolve).mockRejectedValue(new Error('DNS lookup failed'));

      const result = await isUrlSafe('https://nonexistent-host.invalid/api');
      expect(result).toBe(false);
    });
  });
});
