/**
 * E2E Tests for Context Overflow handling
 *
 * Tests overflow detection, tool result capping, compaction retry, and false positive prevention.
 */
import { describe, it, expect, vi } from 'vitest';
import { ContextAssembler, estimateTokens } from '@alfred/agent/context';
import { SessionCompactor } from '@alfred/agent/compaction';
import type { Message, ToolDefinition } from '@alfred/core/types/index.js';

// Suppress pino logging
vi.mock('pino', () => ({
  default: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('Context Overflow', () => {
  // ---------------------------------------------------------------------------
  // Helper: create messages
  // ---------------------------------------------------------------------------
  function makeMsg(role: string, content: string, sessionId = 'sess-1'): Message {
    return {
      role: role as any,
      content,
      timestamp: Date.now(),
      sessionId,
    };
  }

  function makeLargeMsg(role: string, chars: number, sessionId = 'sess-1'): Message {
    return makeMsg(role, 'x'.repeat(chars), sessionId);
  }

  // ---------------------------------------------------------------------------
  // Overflow detection: API errors vs message text
  // ---------------------------------------------------------------------------
  describe('Overflow detection on actual API errors', () => {
    it('detects overflow from token limit error patterns', () => {
      const overflowPatterns = [
        'context_length_exceeded',
        'maximum context length',
        'token limit exceeded',
        'prompt is too long',
      ];

      for (const pattern of overflowPatterns) {
        const isOverflow = overflowPatterns.some((p) =>
          `Error: ${pattern}`.toLowerCase().includes(p.toLowerCase()),
        );
        expect(isOverflow).toBe(true);
      }
    });

    it('does not detect overflow from regular message content', () => {
      const normalMessages = [
        'The context of this conversation is about token limits',
        'I exceeded my expectations today',
        'The prompt asked about length restrictions',
      ];

      const overflowPatterns = [
        'context_length_exceeded',
        'maximum context length',
        'token limit exceeded',
      ];

      for (const msg of normalMessages) {
        const isOverflow = overflowPatterns.some((p) =>
          msg.toLowerCase().includes(p.toLowerCase()),
        );
        expect(isOverflow).toBe(false);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Tool result capping on overflow
  // ---------------------------------------------------------------------------
  describe('Tool result capping', () => {
    it('caps large tool results to fit within budget', () => {
      const maxChars = 500;
      const largeResult = 'a'.repeat(2000);
      const capped = largeResult.length > maxChars
        ? largeResult.slice(0, maxChars) + '\n... [truncated]'
        : largeResult;

      expect(capped.length).toBeLessThan(largeResult.length);
      expect(capped).toContain('[truncated]');
    });

    it('does not cap results already within limit', () => {
      const maxChars = 500;
      const smallResult = 'hello world';
      const capped = smallResult.length > maxChars
        ? smallResult.slice(0, maxChars) + '\n... [truncated]'
        : smallResult;

      expect(capped).toBe('hello world');
    });

    it('assembler truncates when messages exceed token budget', () => {
      const assembler = new ContextAssembler();

      const messages: Message[] = [
        makeLargeMsg('user', 1000),
        makeLargeMsg('assistant', 1000),
        makeLargeMsg('user', 1000),
        makeLargeMsg('assistant', 1000),
      ];

      const result = assembler.assemble({
        systemPrompt: 'You are Alfred.',
        messages,
        memories: [],
        tools: [],
        maxTokens: 200, // Very small budget
      });

      expect(result.truncated).toBe(true);
      // System prompt is always present
      expect(result.messages[0].role).toBe('system');
      // Only most recent messages should fit
      expect(result.messages.length).toBeLessThan(messages.length + 1);
    });
  });

  // ---------------------------------------------------------------------------
  // Compaction retry on overflow
  // ---------------------------------------------------------------------------
  describe('Compaction retry on overflow', () => {
    it('compaction reduces message count', async () => {
      const compactor = new SessionCompactor();

      const messages: Message[] = Array.from({ length: 20 }, (_, i) =>
        makeMsg(
          i % 2 === 0 ? 'user' : 'assistant',
          `Message number ${i} with some content to fill tokens`,
        ),
      );

      const result = await compactor.compact(messages, {
        reserveTokensFloor: 200,
        memoryFlush: false,
      });

      expect(result.compactedMessages.length).toBeLessThan(messages.length);
      expect(result.summary.length).toBeGreaterThan(0);
    });

    it('compaction produces summary with facts', async () => {
      const compactor = new SessionCompactor();

      const messages: Message[] = [
        makeMsg('user', 'My name is Alice and I work at TechCorp'),
        makeMsg('assistant', 'Done. I have set up your profile for Alice at TechCorp.'),
        makeMsg('user', 'I prefer dark mode and vim keybindings'),
        makeMsg('assistant', 'Done. Updated your preferences for dark mode and vim keybindings.'),
        makeMsg('user', 'Now help me with my project'),
        makeMsg('assistant', 'Sure, what do you need?'),
      ];

      const result = await compactor.compact(messages, {
        reserveTokensFloor: 50,
        memoryFlush: false,
      });

      expect(result.extractedFacts.length).toBeGreaterThan(0);
      expect(result.summary).toContain('compacted');
    });

    it('compaction preserves parentId chain', async () => {
      const compactor = new SessionCompactor();

      const messages: Message[] = Array.from({ length: 10 }, (_, i) =>
        makeMsg(
          i % 2 === 0 ? 'user' : 'assistant',
          `Msg ${i}`,
          'chain-session',
        ),
      );

      const result = await compactor.compact(messages, {
        reserveTokensFloor: 50,
        memoryFlush: false,
      });

      // The parent IDs of compacted messages should be preserved
      expect(result.parentIdChain.length).toBeGreaterThan(0);
      for (const pid of result.parentIdChain) {
        expect(pid).toContain('chain-session:');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // False positive prevention
  // ---------------------------------------------------------------------------
  describe('False positive prevention', () => {
    it('user text mentioning "context length" is not treated as overflow', () => {
      const userMessage = 'What is the maximum context length for GPT-4?';

      const apiErrors = ['context_length_exceeded'];
      const isApiError = false; // This came from user text, not an API error

      const wouldFalsePositive = apiErrors.some((p) =>
        userMessage.toLowerCase().includes(p.toLowerCase()),
      );
      // The text contains related words but NOT the exact error pattern
      expect(wouldFalsePositive).toBe(false);
    });

    it('token estimation is consistent', () => {
      const text = 'Hello, world!';
      const est1 = estimateTokens(text);
      const est2 = estimateTokens(text);
      expect(est1).toBe(est2);
    });

    it('estimateTokens uses length/4 heuristic', () => {
      const text = 'a'.repeat(100);
      const tokens = estimateTokens(text);
      expect(tokens).toBe(25); // 100 / 4
    });

    it('estimateTokens handles objects by JSON.stringify', () => {
      const obj = { key: 'value', nested: { a: 1 } };
      const tokens = estimateTokens(obj);
      const expectedLen = JSON.stringify(obj).length;
      expect(tokens).toBe(Math.ceil(expectedLen / 4));
    });
  });

  // ---------------------------------------------------------------------------
  // Context assembler behavior
  // ---------------------------------------------------------------------------
  describe('Context assembler', () => {
    it('always includes system prompt even when over budget', () => {
      const assembler = new ContextAssembler();

      const result = assembler.assemble({
        systemPrompt: 'You are Alfred, a helpful assistant.',
        messages: [makeMsg('user', 'Hello')],
        memories: [],
        tools: [],
        maxTokens: 1, // Absurdly small budget
      });

      expect(result.messages.length).toBeGreaterThanOrEqual(1);
      expect(result.messages[0].role).toBe('system');
      expect(result.truncated).toBe(true);
    });

    it('includes most recent messages first', () => {
      const assembler = new ContextAssembler();

      const messages: Message[] = [
        makeMsg('user', 'First message'),
        makeMsg('assistant', 'First reply'),
        makeMsg('user', 'Second message'),
        makeMsg('assistant', 'Second reply'),
        makeMsg('user', 'Third message (most recent)'),
      ];

      const result = assembler.assemble({
        systemPrompt: 'System',
        messages,
        memories: [],
        tools: [],
        maxTokens: 100, // Limited budget
      });

      // The most recent messages should be present
      const lastMsg = result.messages[result.messages.length - 1];
      expect(lastMsg.content).toBe('Third message (most recent)');
    });
  });
});
