/**
 * Unit Tests for Message Queue with Exponential Backoff
 *
 * Tests retry logic, exponential backoff timing, max retries, and max backoff ceiling.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// MessageQueue implementation (inline for testing)
// Implements exponential backoff retry pattern used by Alfred's channel adapters.
// ---------------------------------------------------------------------------

interface MessageQueueOptions {
  /** Maximum number of retry attempts (default: 5) */
  maxRetries?: number;
  /** Initial backoff in milliseconds (default: 1000) */
  initialBackoffMs?: number;
  /** Maximum backoff ceiling in milliseconds (default: 60000) */
  maxBackoffMs?: number;
  /** Backoff multiplier (default: 2) */
  backoffMultiplier?: number;
}

interface SendResult {
  success: boolean;
  attempts: number;
  totalWaitMs: number;
  error?: string;
}

class MessageQueue {
  private maxRetries: number;
  private initialBackoffMs: number;
  private maxBackoffMs: number;
  private backoffMultiplier: number;

  constructor(options: MessageQueueOptions = {}) {
    this.maxRetries = options.maxRetries ?? 5;
    this.initialBackoffMs = options.initialBackoffMs ?? 1000;
    this.maxBackoffMs = options.maxBackoffMs ?? 60000;
    this.backoffMultiplier = options.backoffMultiplier ?? 2;
  }

  /**
   * Calculate backoff duration for a given attempt number (0-based).
   */
  getBackoff(attempt: number): number {
    const backoff = this.initialBackoffMs * Math.pow(this.backoffMultiplier, attempt);
    return Math.min(backoff, this.maxBackoffMs);
  }

  /**
   * Send a message with retry logic.
   * The `sendFn` is called on each attempt. If it resolves, we succeed.
   * If it rejects, we wait and retry up to maxRetries.
   */
  async send(sendFn: () => Promise<void>): Promise<SendResult> {
    let attempts = 0;
    let totalWaitMs = 0;

    while (attempts <= this.maxRetries) {
      try {
        await sendFn();
        return { success: true, attempts: attempts + 1, totalWaitMs };
      } catch (err: unknown) {
        attempts++;

        if (attempts > this.maxRetries) {
          return {
            success: false,
            attempts,
            totalWaitMs,
            error: err instanceof Error ? err.message : String(err),
          };
        }

        const backoff = this.getBackoff(attempts - 1);
        totalWaitMs += backoff;
        await this.sleep(backoff);
      }
    }

    return {
      success: false,
      attempts,
      totalWaitMs,
      error: 'Max retries exceeded',
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

describe('MessageQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  // Exponential backoff (1s -> 2s -> 4s)
  // ---------------------------------------------------------------------------
  describe('Exponential backoff', () => {
    it('first retry waits 1000ms', () => {
      const queue = new MessageQueue({
        initialBackoffMs: 1000,
        backoffMultiplier: 2,
      });
      expect(queue.getBackoff(0)).toBe(1000);
    });

    it('second retry waits 2000ms', () => {
      const queue = new MessageQueue({
        initialBackoffMs: 1000,
        backoffMultiplier: 2,
      });
      expect(queue.getBackoff(1)).toBe(2000);
    });

    it('third retry waits 4000ms', () => {
      const queue = new MessageQueue({
        initialBackoffMs: 1000,
        backoffMultiplier: 2,
      });
      expect(queue.getBackoff(2)).toBe(4000);
    });

    it('fourth retry waits 8000ms', () => {
      const queue = new MessageQueue({
        initialBackoffMs: 1000,
        backoffMultiplier: 2,
      });
      expect(queue.getBackoff(3)).toBe(8000);
    });

    it('fifth retry waits 16000ms', () => {
      const queue = new MessageQueue({
        initialBackoffMs: 1000,
        backoffMultiplier: 2,
      });
      expect(queue.getBackoff(4)).toBe(16000);
    });
  });

  // ---------------------------------------------------------------------------
  // Max retries (5)
  // ---------------------------------------------------------------------------
  describe('Max retries', () => {
    it('retries up to 5 times by default', async () => {
      const queue = new MessageQueue({ maxRetries: 5, initialBackoffMs: 1 });
      let callCount = 0;
      const sendFn = vi.fn().mockImplementation(async () => {
        callCount++;
        throw new Error('Always fails');
      });

      const resultPromise = queue.send(sendFn);

      // Advance timers to let all retries complete
      for (let i = 0; i < 10; i++) {
        await vi.advanceTimersByTimeAsync(100);
      }

      const result = await resultPromise;
      expect(result.success).toBe(false);
      // 1 initial + 5 retries = 6 total attempts
      expect(result.attempts).toBe(6);
      expect(result.error).toBe('Always fails');
    });

    it('returns success on first attempt when no error', async () => {
      const queue = new MessageQueue({ initialBackoffMs: 1 });
      const sendFn = vi.fn().mockResolvedValue(undefined);

      const result = await queue.send(sendFn);
      expect(result.success).toBe(true);
      expect(result.attempts).toBe(1);
      expect(result.totalWaitMs).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Max backoff (60s)
  // ---------------------------------------------------------------------------
  describe('Max backoff ceiling', () => {
    it('caps backoff at maxBackoffMs', () => {
      const queue = new MessageQueue({
        initialBackoffMs: 1000,
        backoffMultiplier: 2,
        maxBackoffMs: 60000,
      });

      // At attempt 7: 1000 * 2^7 = 128000, should cap at 60000
      expect(queue.getBackoff(7)).toBe(60000);
    });

    it('caps at 60000ms by default', () => {
      const queue = new MessageQueue({
        initialBackoffMs: 1000,
        backoffMultiplier: 2,
      });

      // 1000 * 2^10 = 1024000, way above 60000
      expect(queue.getBackoff(10)).toBe(60000);
    });

    it('custom max backoff is respected', () => {
      const queue = new MessageQueue({
        initialBackoffMs: 100,
        backoffMultiplier: 3,
        maxBackoffMs: 5000,
      });

      // 100 * 3^5 = 24300, should cap at 5000
      expect(queue.getBackoff(5)).toBe(5000);
    });
  });

  // ---------------------------------------------------------------------------
  // Successful send after retry
  // ---------------------------------------------------------------------------
  describe('Successful send after retry', () => {
    it('succeeds on second attempt after one failure', async () => {
      const queue = new MessageQueue({ initialBackoffMs: 1 });
      let attempt = 0;
      const sendFn = vi.fn().mockImplementation(async () => {
        attempt++;
        if (attempt === 1) throw new Error('Temporary failure');
        // Second attempt succeeds
      });

      const resultPromise = queue.send(sendFn);

      // Advance timers to complete the backoff
      await vi.advanceTimersByTimeAsync(10);

      const result = await resultPromise;
      expect(result.success).toBe(true);
      expect(result.attempts).toBe(2);
    });

    it('succeeds on third attempt after two failures', async () => {
      const queue = new MessageQueue({ initialBackoffMs: 1 });
      let attempt = 0;
      const sendFn = vi.fn().mockImplementation(async () => {
        attempt++;
        if (attempt <= 2) throw new Error('Temporary');
      });

      const resultPromise = queue.send(sendFn);

      await vi.advanceTimersByTimeAsync(100);

      const result = await resultPromise;
      expect(result.success).toBe(true);
      expect(result.attempts).toBe(3);
    });

    it('tracks total wait time across retries', async () => {
      const queue = new MessageQueue({
        initialBackoffMs: 100,
        backoffMultiplier: 2,
        maxRetries: 3,
      });

      let attempt = 0;
      const sendFn = vi.fn().mockImplementation(async () => {
        attempt++;
        if (attempt <= 2) throw new Error('fail');
      });

      const resultPromise = queue.send(sendFn);

      // Advance past both backoffs: 100ms + 200ms = 300ms total
      await vi.advanceTimersByTimeAsync(500);

      const result = await resultPromise;
      expect(result.success).toBe(true);
      expect(result.attempts).toBe(3);
      // totalWaitMs = 100 (first backoff) + 200 (second backoff) = 300
      expect(result.totalWaitMs).toBe(300);
    });
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------
  describe('Edge cases', () => {
    it('maxRetries of 0 means only one attempt', async () => {
      const queue = new MessageQueue({ maxRetries: 0, initialBackoffMs: 1 });
      const sendFn = vi.fn().mockRejectedValue(new Error('fail'));

      const result = await queue.send(sendFn);
      expect(result.success).toBe(false);
      expect(result.attempts).toBe(1);
    });

    it('handles non-Error rejections', async () => {
      const queue = new MessageQueue({ maxRetries: 0, initialBackoffMs: 1 });
      const sendFn = vi.fn().mockRejectedValue('string error');

      const result = await queue.send(sendFn);
      expect(result.success).toBe(false);
      expect(result.error).toBe('string error');
    });

    it('backoff of 0 attempt is the initial backoff', () => {
      const queue = new MessageQueue({ initialBackoffMs: 500 });
      expect(queue.getBackoff(0)).toBe(500);
    });
  });
});
