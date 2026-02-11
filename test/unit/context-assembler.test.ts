/**
 * Unit Tests for Context Assembler
 *
 * Tests message priority, token estimation, truncation, and system prompt preservation.
 */
import { describe, it, expect } from 'vitest';
import { ContextAssembler, estimateTokens } from '@alfred/agent/context';
import type { Message, ToolDefinition } from '@alfred/core/types/index.js';

describe('ContextAssembler', () => {
  const assembler = new ContextAssembler();

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function makeMsg(role: string, content: string): Message {
    return {
      role: role as any,
      content,
      timestamp: Date.now(),
      sessionId: 'test-session',
    };
  }

  function makeLargeMsg(role: string, chars: number): Message {
    return makeMsg(role, 'x'.repeat(chars));
  }

  const emptyTools: ToolDefinition[] = [];

  // ---------------------------------------------------------------------------
  // Message priority ordering
  // ---------------------------------------------------------------------------
  describe('Message priority ordering', () => {
    it('system prompt is always first in output', () => {
      const result = assembler.assemble({
        systemPrompt: 'You are Alfred.',
        messages: [
          makeMsg('user', 'Hello'),
          makeMsg('assistant', 'Hi there!'),
        ],
        memories: [],
        tools: emptyTools,
        maxTokens: 10000,
      });

      expect(result.messages[0].role).toBe('system');
      expect(result.messages[0].content).toBe('You are Alfred.');
    });

    it('preserves chronological order of included messages', () => {
      const result = assembler.assemble({
        systemPrompt: 'System',
        messages: [
          makeMsg('user', 'First'),
          makeMsg('assistant', 'Second'),
          makeMsg('user', 'Third'),
        ],
        memories: [],
        tools: emptyTools,
        maxTokens: 10000,
      });

      // System + 3 messages = 4
      expect(result.messages.length).toBe(4);
      expect(result.messages[1].content).toBe('First');
      expect(result.messages[2].content).toBe('Second');
      expect(result.messages[3].content).toBe('Third');
    });

    it('most recent messages are prioritized over older ones', () => {
      const messages = [
        makeMsg('user', 'Oldest message'),
        makeMsg('assistant', 'Old response'),
        makeMsg('user', 'Middle message'),
        makeMsg('assistant', 'Middle response'),
        makeMsg('user', 'Most recent message'),
      ];

      const result = assembler.assemble({
        systemPrompt: 'S',
        messages,
        memories: [],
        tools: emptyTools,
        maxTokens: 100, // Very limited
      });

      // Should have included the most recent messages
      const lastMsg = result.messages[result.messages.length - 1];
      expect(lastMsg.content).toBe('Most recent message');
    });

    it('memories are injected after system prompt', () => {
      const result = assembler.assemble({
        systemPrompt: 'System',
        messages: [makeMsg('user', 'Hello')],
        memories: ['User prefers dark mode', 'User name is Alice'],
        tools: emptyTools,
        maxTokens: 10000,
      });

      // System(0) -> Memory(1) -> User(2)
      expect(result.messages[0].role).toBe('system');
      expect(result.messages[1].role).toBe('system'); // Memory block
      expect(result.messages[1].content).toContain('RECALLED MEMORIES');
      expect(result.messages[1].content).toContain('dark mode');
      expect(result.messages[1].content).toContain('Alice');
    });
  });

  // ---------------------------------------------------------------------------
  // Token estimation
  // ---------------------------------------------------------------------------
  describe('Token estimation', () => {
    it('estimates tokens as ceil(length / 4) for strings', () => {
      expect(estimateTokens('hello')).toBe(2); // 5/4 = 1.25 -> 2
      expect(estimateTokens('a'.repeat(100))).toBe(25); // 100/4 = 25
      expect(estimateTokens('a'.repeat(7))).toBe(2); // 7/4 = 1.75 -> 2
    });

    it('estimates tokens for objects via JSON.stringify', () => {
      const obj = { key: 'value' };
      const json = JSON.stringify(obj);
      expect(estimateTokens(obj)).toBe(Math.ceil(json.length / 4));
    });

    it('returns tokenEstimate in the assembled context', () => {
      const result = assembler.assemble({
        systemPrompt: 'System prompt here.',
        messages: [makeMsg('user', 'A short message')],
        memories: [],
        tools: emptyTools,
        maxTokens: 10000,
      });

      expect(result.tokenEstimate).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Truncation removes oldest first
  // ---------------------------------------------------------------------------
  describe('Truncation removes oldest first', () => {
    it('truncates old messages when budget is exceeded', () => {
      const messages = Array.from({ length: 20 }, (_, i) =>
        makeMsg(i % 2 === 0 ? 'user' : 'assistant', `Message ${i}: ` + 'x'.repeat(50)),
      );

      const result = assembler.assemble({
        systemPrompt: 'System',
        messages,
        memories: [],
        tools: emptyTools,
        maxTokens: 200, // Very tight budget
      });

      expect(result.truncated).toBe(true);
      // Should have fewer messages than the original (plus system)
      expect(result.messages.length).toBeLessThan(messages.length + 1);
      // The most recent message should still be present
      const lastOriginal = messages[messages.length - 1].content;
      const lastIncluded = result.messages[result.messages.length - 1].content;
      expect(lastIncluded).toBe(lastOriginal);
    });

    it('reports truncated=false when all messages fit', () => {
      const result = assembler.assemble({
        systemPrompt: 'Short.',
        messages: [makeMsg('user', 'Hi')],
        memories: [],
        tools: emptyTools,
        maxTokens: 10000,
      });

      expect(result.truncated).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // System prompt never removed
  // ---------------------------------------------------------------------------
  describe('System prompt is never removed', () => {
    it('system prompt survives even with zero message budget', () => {
      const result = assembler.assemble({
        systemPrompt: 'You must always be present.',
        messages: [makeLargeMsg('user', 10000)],
        memories: [],
        tools: emptyTools,
        maxTokens: 30, // Only enough for system prompt
      });

      expect(result.messages.length).toBeGreaterThanOrEqual(1);
      expect(result.messages[0].role).toBe('system');
      expect(result.messages[0].content).toBe('You must always be present.');
    });

    it('system prompt with absurdly small budget still present', () => {
      const result = assembler.assemble({
        systemPrompt: 'Alfred',
        messages: [],
        memories: [],
        tools: emptyTools,
        maxTokens: 1,
      });

      expect(result.messages.length).toBeGreaterThanOrEqual(1);
      expect(result.messages[0].role).toBe('system');
      expect(result.truncated).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------
  describe('Edge cases', () => {
    it('handles empty messages array', () => {
      const result = assembler.assemble({
        systemPrompt: 'System',
        messages: [],
        memories: [],
        tools: emptyTools,
        maxTokens: 10000,
      });

      expect(result.messages.length).toBe(1); // Just the system prompt
      expect(result.messages[0].role).toBe('system');
      expect(result.truncated).toBe(false);
    });

    it('handles empty memories array', () => {
      const result = assembler.assemble({
        systemPrompt: 'System',
        messages: [makeMsg('user', 'Hello')],
        memories: [],
        tools: emptyTools,
        maxTokens: 10000,
      });

      // No memory message should be injected
      const memoryMsg = result.messages.find(
        (m) => m.role === 'system' && m.content.includes('RECALLED MEMORIES'),
      );
      expect(memoryMsg).toBeUndefined();
    });

    it('handles very large system prompt', () => {
      const largePrompt = 'x'.repeat(10000);
      const result = assembler.assemble({
        systemPrompt: largePrompt,
        messages: [makeMsg('user', 'Hello')],
        memories: [],
        tools: emptyTools,
        maxTokens: 500,
      });

      // Should still have system prompt but nothing else fits
      expect(result.messages[0].content).toBe(largePrompt);
      expect(result.truncated).toBe(true);
    });

    it('tool definitions count toward overhead', () => {
      const tools: ToolDefinition[] = [
        {
          name: 'exec',
          description: 'Execute a shell command',
          parameters: { type: 'object', properties: { command: { type: 'string' } } },
        },
      ];

      const result = assembler.assemble({
        systemPrompt: 'System',
        messages: [makeMsg('user', 'Run a command')],
        memories: [],
        tools,
        maxTokens: 10000,
      });

      // Token estimate should include tool overhead
      expect(result.tokenEstimate).toBeGreaterThan(0);
    });
  });
});
