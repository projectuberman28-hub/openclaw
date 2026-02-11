/**
 * E2E Tests for Fallback Chain
 *
 * Tests chain execution, failover logic, HTTP status handling, and callbacks.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  FallbackChain,
  FallbackChainError,
  HttpError,
  isHttpFailoverEligible,
} from '@alfred/fallback/chain';
import type { FallbackProvider } from '@alfred/fallback/chain';

// Suppress pino logging in tests
vi.mock('pino', () => ({
  default: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('FallbackChain', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Helper: create mock providers
  // ---------------------------------------------------------------------------
  function makeProvider(
    name: string,
    priority: number,
    opts?: {
      available?: boolean;
      result?: string;
      error?: Error;
      delayMs?: number;
    },
  ): FallbackProvider<string> {
    return {
      name,
      priority,
      isAvailable: vi.fn().mockResolvedValue(opts?.available ?? true),
      execute: vi.fn().mockImplementation(async () => {
        if (opts?.delayMs) {
          await new Promise((r) => setTimeout(r, opts.delayMs));
        }
        if (opts?.error) throw opts.error;
        return opts?.result ?? `result-from-${name}`;
      }),
    };
  }

  // ---------------------------------------------------------------------------
  // Chain tries providers in order
  // ---------------------------------------------------------------------------
  describe('Provider ordering', () => {
    it('tries providers in priority order (lower = first)', async () => {
      const p1 = makeProvider('First', 1, { result: 'p1-result' });
      const p2 = makeProvider('Second', 2, { result: 'p2-result' });
      const p3 = makeProvider('Third', 3, { result: 'p3-result' });

      const chain = new FallbackChain({
        providers: [p3, p1, p2], // passed out of order
      });

      const { result, provider } = await chain.execute('input');

      expect(result).toBe('p1-result');
      expect(provider).toBe('First');
      // p1 was tried; p2 and p3 were not
      expect(p1.execute).toHaveBeenCalledTimes(1);
      expect(p2.execute).not.toHaveBeenCalled();
      expect(p3.execute).not.toHaveBeenCalled();
    });

    it('skips unavailable providers', async () => {
      const p1 = makeProvider('Unavailable', 1, { available: false });
      const p2 = makeProvider('Available', 2, { result: 'p2' });

      const chain = new FallbackChain({ providers: [p1, p2] });
      const { result, provider } = await chain.execute('input');

      expect(provider).toBe('Available');
      expect(result).toBe('p2');
    });

    it('getProviderNames returns names sorted by priority', () => {
      const chain = new FallbackChain({
        providers: [
          makeProvider('C', 3),
          makeProvider('A', 1),
          makeProvider('B', 2),
        ],
      });

      expect(chain.getProviderNames()).toEqual(['A', 'B', 'C']);
    });
  });

  // ---------------------------------------------------------------------------
  // HTTP 400 triggers failover
  // ---------------------------------------------------------------------------
  describe('HTTP 400 triggers failover', () => {
    it('falls back on HTTP 400 Bad Request', async () => {
      const p1 = makeProvider('BadReq', 1, {
        error: new HttpError('Bad Request', 400),
      });
      const p2 = makeProvider('Backup', 2, { result: 'backup-result' });

      const chain = new FallbackChain({ providers: [p1, p2] });
      const { result, provider, attempts } = await chain.execute('input');

      expect(provider).toBe('Backup');
      expect(result).toBe('backup-result');
      expect(attempts.length).toBe(2);
      expect(attempts[0].success).toBe(false);
      expect(attempts[1].success).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // HTTP 401/403 does NOT trigger failover (stops immediately)
  // ---------------------------------------------------------------------------
  describe('HTTP 401/403 stops chain', () => {
    it('stops immediately on HTTP 401 Unauthorized', async () => {
      const p1 = makeProvider('AuthFail', 1, {
        error: new HttpError('Unauthorized', 401),
      });
      const p2 = makeProvider('Never', 2);

      const chain = new FallbackChain({ providers: [p1, p2] });

      await expect(chain.execute('input')).rejects.toThrow(FallbackChainError);
      expect(p2.execute).not.toHaveBeenCalled();
    });

    it('stops immediately on HTTP 403 Forbidden', async () => {
      const p1 = makeProvider('Forbidden', 1, {
        error: new HttpError('Forbidden', 403),
      });
      const p2 = makeProvider('Never', 2);

      const chain = new FallbackChain({ providers: [p1, p2] });

      await expect(chain.execute('input')).rejects.toThrow(FallbackChainError);
      expect(p2.execute).not.toHaveBeenCalled();
    });

    it('error includes attempts history', async () => {
      const p1 = makeProvider('AuthFail', 1, {
        error: new HttpError('Unauthorized', 401),
      });
      const p2 = makeProvider('Never', 2);
      const chain = new FallbackChain({ providers: [p1, p2] });

      try {
        await chain.execute('input');
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(FallbackChainError);
        const fce = err as FallbackChainError;
        expect(fce.attempts.length).toBe(1);
        expect(fce.attempts[0].provider).toBe('AuthFail');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Timeout triggers failover
  // ---------------------------------------------------------------------------
  describe('Timeout triggers failover', () => {
    it('falls back when provider times out', async () => {
      const p1 = makeProvider('Slow', 1, { delayMs: 5000 });
      const p2 = makeProvider('Fast', 2, { result: 'fast-result' });

      const chain = new FallbackChain({
        providers: [p1, p2],
        timeoutMs: 100,
      });

      const { provider, result } = await chain.execute('input');
      expect(provider).toBe('Fast');
      expect(result).toBe('fast-result');
    }, 10000);
  });

  // ---------------------------------------------------------------------------
  // 5xx triggers failover
  // ---------------------------------------------------------------------------
  describe('5xx triggers failover', () => {
    it('falls back on HTTP 500', async () => {
      const p1 = makeProvider('ServerErr', 1, {
        error: new HttpError('Internal Server Error', 500),
      });
      const p2 = makeProvider('Backup', 2, { result: 'backup' });

      const chain = new FallbackChain({ providers: [p1, p2] });
      const { provider } = await chain.execute('input');
      expect(provider).toBe('Backup');
    });

    it('falls back on HTTP 502', async () => {
      const p1 = makeProvider('Gateway', 1, {
        error: new HttpError('Bad Gateway', 502),
      });
      const p2 = makeProvider('Fallback', 2, { result: 'ok' });

      const chain = new FallbackChain({ providers: [p1, p2] });
      const { provider } = await chain.execute('input');
      expect(provider).toBe('Fallback');
    });

    it('falls back on HTTP 503', async () => {
      const p1 = makeProvider('Unavail', 1, {
        error: new HttpError('Service Unavailable', 503),
      });
      const p2 = makeProvider('Backup', 2, { result: 'ok' });

      const chain = new FallbackChain({ providers: [p1, p2] });
      const { provider } = await chain.execute('input');
      expect(provider).toBe('Backup');
    });
  });

  // ---------------------------------------------------------------------------
  // All providers fail returns error with all attempts
  // ---------------------------------------------------------------------------
  describe('All providers fail', () => {
    it('throws FallbackChainError when all providers fail', async () => {
      const p1 = makeProvider('Fail1', 1, {
        error: new HttpError('Bad Request', 400),
      });
      const p2 = makeProvider('Fail2', 2, { error: new Error('Broken') });

      const chain = new FallbackChain({ providers: [p1, p2] });

      try {
        await chain.execute('input');
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(FallbackChainError);
        const fce = err as FallbackChainError;
        expect(fce.attempts.length).toBe(2);
        expect(fce.attempts[0].provider).toBe('Fail1');
        expect(fce.attempts[0].success).toBe(false);
        expect(fce.attempts[1].provider).toBe('Fail2');
        expect(fce.attempts[1].success).toBe(false);
        expect(fce.message).toContain('All 2 providers failed');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // onFallback callback fired
  // ---------------------------------------------------------------------------
  describe('onFallback callback', () => {
    it('fires onFallback when falling back between providers', async () => {
      const callback = vi.fn();

      const p1 = makeProvider('Primary', 1, {
        error: new HttpError('Error', 500),
      });
      const p2 = makeProvider('Secondary', 2, { result: 'ok' });

      const chain = new FallbackChain({
        providers: [p1, p2],
        onFallback: callback,
      });

      await chain.execute('input');

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith('Primary', 'Secondary', expect.any(String));
    });

    it('fires onFallback for unavailable providers too', async () => {
      const callback = vi.fn();

      const p1 = makeProvider('Down', 1, { available: false });
      const p2 = makeProvider('Up', 2, { result: 'ok' });

      const chain = new FallbackChain({
        providers: [p1, p2],
        onFallback: callback,
      });

      await chain.execute('input');

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith('Down', 'Up', 'Provider unavailable');
    });

    it('does not fire onFallback when first provider succeeds', async () => {
      const callback = vi.fn();

      const p1 = makeProvider('Good', 1, { result: 'ok' });
      const p2 = makeProvider('Never', 2);

      const chain = new FallbackChain({
        providers: [p1, p2],
        onFallback: callback,
      });

      await chain.execute('input');
      expect(callback).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // isHttpFailoverEligible
  // ---------------------------------------------------------------------------
  describe('isHttpFailoverEligible', () => {
    it('returns true for 400', () => expect(isHttpFailoverEligible(400)).toBe(true));
    it('returns true for 408', () => expect(isHttpFailoverEligible(408)).toBe(true));
    it('returns true for 429', () => expect(isHttpFailoverEligible(429)).toBe(true));
    it('returns true for 500', () => expect(isHttpFailoverEligible(500)).toBe(true));
    it('returns true for 502', () => expect(isHttpFailoverEligible(502)).toBe(true));
    it('returns true for 503', () => expect(isHttpFailoverEligible(503)).toBe(true));
    it('returns true for 0 (network)', () => expect(isHttpFailoverEligible(0)).toBe(true));
    it('returns false for 401', () => expect(isHttpFailoverEligible(401)).toBe(false));
    it('returns false for 403', () => expect(isHttpFailoverEligible(403)).toBe(false));
    it('returns false for 404', () => expect(isHttpFailoverEligible(404)).toBe(false));
  });
});
