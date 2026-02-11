/**
 * Unit Tests for Session Compaction
 *
 * Tests compaction summary generation, parentId chain preservation, and fact extraction.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SessionCompactor } from '@alfred/agent/compaction';
import { estimateTokens } from '@alfred/agent/context';
import type { Message } from '@alfred/core/types/index.js';

describe('SessionCompactor', () => {
  let compactor: SessionCompactor;

  function makeMsg(role: string, content: string, sessionId = 'sess-1'): Message {
    return {
      role: role as any,
      content,
      timestamp: Date.now(),
      sessionId,
    };
  }

  beforeEach(() => {
    compactor = new SessionCompactor();
  });

  // ---------------------------------------------------------------------------
  // Compaction produces summary
  // ---------------------------------------------------------------------------
  describe('Compaction produces summary', () => {
    it('generates a summary for compacted messages', async () => {
      const messages: Message[] = Array.from({ length: 10 }, (_, i) =>
        makeMsg(i % 2 === 0 ? 'user' : 'assistant', `Message ${i} content here`),
      );

      const result = await compactor.compact(messages, {
        reserveTokensFloor: 50,
        memoryFlush: false,
      });

      expect(result.summary).toBeTruthy();
      expect(result.summary.length).toBeGreaterThan(0);
      expect(result.summary).toContain('compacted');
    });

    it('summary includes message counts', async () => {
      const messages: Message[] = [
        makeMsg('user', 'Hello'),
        makeMsg('assistant', 'Hi!'),
        makeMsg('user', 'How are you?'),
        makeMsg('assistant', 'Great!'),
        makeMsg('user', 'Good'),
        makeMsg('assistant', 'Anything else?'),
      ];

      const result = await compactor.compact(messages, {
        reserveTokensFloor: 30,
        memoryFlush: false,
      });

      expect(result.summary).toContain('user');
      expect(result.summary).toContain('assistant');
    });

    it('compacted messages contain a summary message', async () => {
      const messages = Array.from({ length: 8 }, (_, i) =>
        makeMsg(i % 2 === 0 ? 'user' : 'assistant', `Msg ${i}: ` + 'x'.repeat(50)),
      );

      const result = await compactor.compact(messages, {
        reserveTokensFloor: 100,
        memoryFlush: false,
      });

      // First message in the compacted output should be the summary
      expect(result.compactedMessages[0].role).toBe('system');
      expect(result.compactedMessages[0].content).toContain('CONVERSATION SUMMARY');
    });

    it('returns empty summary when messages fit within floor', async () => {
      const messages = [makeMsg('user', 'Short')];

      const result = await compactor.compact(messages, {
        reserveTokensFloor: 100000,
        memoryFlush: false,
      });

      expect(result.summary).toBe('');
      expect(result.compactedMessages).toEqual(messages);
    });

    it('returns empty result for empty messages', async () => {
      const result = await compactor.compact([], {
        reserveTokensFloor: 100,
        memoryFlush: false,
      });

      expect(result.compactedMessages).toEqual([]);
      expect(result.summary).toBe('');
      expect(result.extractedFacts).toEqual([]);
      expect(result.parentIdChain).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // parentId chain preserved
  // ---------------------------------------------------------------------------
  describe('parentId chain preserved', () => {
    it('builds parentId chain from compacted messages', async () => {
      const messages: Message[] = Array.from({ length: 6 }, (_, i) =>
        makeMsg(
          i % 2 === 0 ? 'user' : 'assistant',
          `Message ${i}`,
          'chain-session',
        ),
      );

      const result = await compactor.compact(messages, {
        reserveTokensFloor: 30,
        memoryFlush: false,
      });

      expect(result.parentIdChain.length).toBeGreaterThan(0);
      for (const pid of result.parentIdChain) {
        expect(pid).toContain('chain-session');
      }
    });

    it('parentIdChain includes timestamps for lineage tracking', async () => {
      const baseTime = Date.now();
      const messages: Message[] = [
        { role: 'user', content: 'Msg 1', timestamp: baseTime, sessionId: 'sess' },
        { role: 'assistant', content: 'Msg 2', timestamp: baseTime + 1000, sessionId: 'sess' },
        { role: 'user', content: 'Msg 3', timestamp: baseTime + 2000, sessionId: 'sess' },
        { role: 'assistant', content: 'Msg 4', timestamp: baseTime + 3000, sessionId: 'sess' },
      ];

      const result = await compactor.compact(messages, {
        reserveTokensFloor: 10,
        memoryFlush: false,
      });

      // Each chain entry should be sessionId:timestamp
      for (const entry of result.parentIdChain) {
        expect(entry).toMatch(/^sess:\d+$/);
      }
    });

    it('parentIdChain is empty when no compaction occurs', async () => {
      const messages = [makeMsg('user', 'Hi')];

      const result = await compactor.compact(messages, {
        reserveTokensFloor: 100000,
        memoryFlush: false,
      });

      expect(result.parentIdChain).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Facts extracted
  // ---------------------------------------------------------------------------
  describe('Fact extraction', () => {
    it('extracts facts from user preferences', async () => {
      const messages: Message[] = [
        makeMsg('user', 'I prefer TypeScript over JavaScript'),
        makeMsg('assistant', 'Noted.'),
        makeMsg('user', 'I always use vim'),
        makeMsg('assistant', 'Got it, using vim.'),
        makeMsg('user', 'Continue'),
        makeMsg('assistant', 'Ok.'),
      ];

      const result = await compactor.compact(messages, {
        reserveTokensFloor: 20,
        memoryFlush: false,
      });

      const prefFacts = result.extractedFacts.filter((f) => f.includes('preference'));
      expect(prefFacts.length).toBeGreaterThan(0);
    });

    it('extracts facts from user statements with numbers', async () => {
      const messages: Message[] = [
        makeMsg('user', 'The server runs on port 8080'),
        makeMsg('assistant', 'Done. Configured port 8080.'),
        makeMsg('user', 'There are 5000 records in the database'),
        makeMsg('assistant', 'Done. Updated record count.'),
        makeMsg('user', 'Continue'),
        makeMsg('assistant', 'Ready.'),
      ];

      const result = await compactor.compact(messages, {
        reserveTokensFloor: 20,
        memoryFlush: false,
      });

      const numFacts = result.extractedFacts.filter((f) => f.includes('stated'));
      expect(numFacts.length).toBeGreaterThan(0);
    });

    it('extracts action-taken facts from assistant messages', async () => {
      const messages: Message[] = [
        makeMsg('user', 'Create a new file'),
        makeMsg('assistant', 'Done. Created the file at /workspace/new.txt'),
        makeMsg('user', 'Update the config'),
        makeMsg('assistant', 'Done. Updated the configuration successfully'),
        makeMsg('user', 'Okay'),
        makeMsg('assistant', 'Anything else?'),
      ];

      const result = await compactor.compact(messages, {
        reserveTokensFloor: 20,
        memoryFlush: false,
      });

      const actionFacts = result.extractedFacts.filter((f) => f.includes('Action'));
      expect(actionFacts.length).toBeGreaterThan(0);
    });

    it('deduplicates extracted facts', async () => {
      const messages: Message[] = [
        makeMsg('user', 'I prefer dark mode'),
        makeMsg('assistant', 'Ok'),
        makeMsg('user', 'I prefer dark mode'),
        makeMsg('assistant', 'Already noted'),
        makeMsg('user', 'Continue'),
        makeMsg('assistant', 'Ready'),
      ];

      const result = await compactor.compact(messages, {
        reserveTokensFloor: 20,
        memoryFlush: false,
      });

      // Facts should be deduplicated
      const darkModeFacts = result.extractedFacts.filter(
        (f) => f.includes('dark mode'),
      );
      expect(darkModeFacts.length).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Compaction retains recent messages
  // ---------------------------------------------------------------------------
  describe('Retains recent messages', () => {
    it('keeps at least 2 most recent messages', async () => {
      const messages = Array.from({ length: 10 }, (_, i) =>
        makeMsg(i % 2 === 0 ? 'user' : 'assistant', `Msg ${i}`),
      );

      const result = await compactor.compact(messages, {
        reserveTokensFloor: 10,
        memoryFlush: false,
      });

      // compactedMessages should include the summary + at least 2 retained messages
      const nonSystemMessages = result.compactedMessages.filter(
        (m) => !m.content.includes('CONVERSATION SUMMARY'),
      );
      expect(nonSystemMessages.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Token estimation via compactor
  // ---------------------------------------------------------------------------
  describe('Token estimation', () => {
    it('estimateTokens returns correct count for messages', () => {
      const messages: Message[] = [
        makeMsg('user', 'Hello world'),
        makeMsg('assistant', 'Hi there'),
      ];

      const total = compactor.estimateTokens(messages);
      expect(total).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Announcement tracking
  // ---------------------------------------------------------------------------
  describe('Announcement tracking', () => {
    it('tracks whether compaction was announced', async () => {
      expect(compactor.wasAnnounced).toBe(false);

      const messages = Array.from({ length: 6 }, (_, i) =>
        makeMsg(i % 2 === 0 ? 'user' : 'assistant', `Msg ${i}: ` + 'y'.repeat(50)),
      );

      await compactor.compact(messages, {
        reserveTokensFloor: 50,
        memoryFlush: false,
      });

      expect(compactor.wasAnnounced).toBe(true);
    });

    it('resets announcement flag', async () => {
      const messages = Array.from({ length: 6 }, (_, i) =>
        makeMsg(i % 2 === 0 ? 'user' : 'assistant', `Msg ${i}: ` + 'z'.repeat(50)),
      );

      await compactor.compact(messages, {
        reserveTokensFloor: 50,
        memoryFlush: false,
      });
      expect(compactor.wasAnnounced).toBe(true);

      compactor.resetAnnouncement();
      expect(compactor.wasAnnounced).toBe(false);
    });
  });
});
