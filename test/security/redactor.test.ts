/**
 * Tests for @alfred/privacy - Redactor
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { Redactor } from '@alfred/privacy';
import type { PIIDetection } from '@alfred/privacy';

describe('Redactor', () => {
  let redactor: Redactor;

  const makeDetection = (
    type: string,
    value: string,
    start: number,
    end: number,
    confidence = 0.95,
  ): PIIDetection => ({ type, value, start, end, confidence });

  beforeEach(() => {
    redactor = new Redactor();
  });

  // ---------------------------------------------------------------------------
  // Redact mode
  // ---------------------------------------------------------------------------
  describe('redact mode', () => {
    it('replaces PII with [TYPE_REDACTED]', () => {
      const text = 'My SSN is 123-45-6789';
      const detections = [makeDetection('ssn', '123-45-6789', 10, 21)];
      const result = redactor.redact(text, detections, 'redact');
      expect(result).toBe('My SSN is [SSN_REDACTED]');
    });

    it('uppercases the type name in the placeholder', () => {
      const text = 'Email: test@example.com';
      const detections = [makeDetection('email', 'test@example.com', 7, 23)];
      const result = redactor.redact(text, detections, 'redact');
      expect(result).toBe('Email: [EMAIL_REDACTED]');
    });

    it('uses redact mode by default when no mode specified', () => {
      const text = 'Card 4111111111111111';
      const detections = [makeDetection('credit_card', '4111111111111111', 5, 21)];
      const result = redactor.redact(text, detections);
      expect(result).toBe('Card [CREDIT_CARD_REDACTED]');
    });
  });

  // ---------------------------------------------------------------------------
  // Hash mode
  // ---------------------------------------------------------------------------
  describe('hash mode', () => {
    it('replaces PII with [HASH:xxxxxxxx] using SHA-256', () => {
      const text = 'SSN: 123-45-6789';
      const detections = [makeDetection('ssn', '123-45-6789', 5, 16)];
      const result = redactor.redact(text, detections, 'hash');
      expect(result).toMatch(/^SSN: \[HASH:[a-f0-9]{8}\]$/);
    });

    it('produces consistent hashes for the same value', () => {
      const text = 'a: 123-45-6789 b: 123-45-6789';
      const detections = [
        makeDetection('ssn', '123-45-6789', 3, 14),
        makeDetection('ssn', '123-45-6789', 18, 29),
      ];
      const result = redactor.redact(text, detections, 'hash');
      const hashes = result.match(/\[HASH:([a-f0-9]{8})\]/g);
      expect(hashes).toHaveLength(2);
      expect(hashes![0]).toBe(hashes![1]);
    });

    it('hash uses configured salt', () => {
      const saltedRedactor = new Redactor({ salt: 'custom-salt' });
      const text = 'SSN: 123-45-6789';
      const detections = [makeDetection('ssn', '123-45-6789', 5, 16)];
      const result1 = saltedRedactor.redact(text, detections, 'hash');

      const expectedHash = createHash('sha256')
        .update('custom-salt:123-45-6789')
        .digest('hex')
        .slice(0, 8);
      expect(result1).toBe(`SSN: [HASH:${expectedHash}]`);
    });

    it('uses first 8 hex characters of SHA-256', () => {
      const text = 'Value: test';
      const detections = [makeDetection('custom', 'test', 7, 11)];
      const result = redactor.redact(text, detections, 'hash');
      const hashMatch = result.match(/\[HASH:([a-f0-9]+)\]/);
      expect(hashMatch).not.toBeNull();
      expect(hashMatch![1].length).toBe(8);
    });
  });

  // ---------------------------------------------------------------------------
  // Remove mode
  // ---------------------------------------------------------------------------
  describe('remove mode', () => {
    it('replaces PII with empty string', () => {
      const text = 'My SSN is 123-45-6789 ok';
      const detections = [makeDetection('ssn', '123-45-6789', 10, 21)];
      const result = redactor.redact(text, detections, 'remove');
      expect(result).toBe('My SSN is  ok');
    });

    it('collapses adjacent text when PII is removed', () => {
      const text = 'Call 555-123-4567';
      const detections = [makeDetection('phone', '555-123-4567', 5, 17)];
      const result = redactor.redact(text, detections, 'remove');
      expect(result).toBe('Call ');
    });
  });

  // ---------------------------------------------------------------------------
  // Reverse position processing preserves indices
  // ---------------------------------------------------------------------------
  describe('Reverse position processing', () => {
    it('processes detections in reverse order to preserve indices', () => {
      const text = 'SSN: 111-22-3333 Email: a@b.com';
      const detections = [
        makeDetection('ssn', '111-22-3333', 5, 16),
        makeDetection('email', 'a@b.com', 24, 31),
      ];
      const result = redactor.redact(text, detections, 'redact');
      expect(result).toBe('SSN: [SSN_REDACTED] Email: [EMAIL_REDACTED]');
    });

    it('handles overlapping detections correctly', () => {
      const text = 'Data: 123-45-6789';
      // Two detections at the same position - should handle gracefully
      const detections = [
        makeDetection('ssn', '123-45-6789', 6, 17),
      ];
      const result = redactor.redact(text, detections, 'redact');
      expect(result).toBe('Data: [SSN_REDACTED]');
    });
  });

  // ---------------------------------------------------------------------------
  // Multiple PII types in same text
  // ---------------------------------------------------------------------------
  describe('Multiple PII types', () => {
    it('redacts multiple PII types in a single text', () => {
      const text = 'SSN: 123-45-6789, Email: test@test.com, Phone: 555-111-2222';
      const detections = [
        makeDetection('ssn', '123-45-6789', 5, 16),
        makeDetection('email', 'test@test.com', 25, 38),
        makeDetection('phone', '555-111-2222', 47, 59),
      ];
      const result = redactor.redact(text, detections, 'redact');
      expect(result).toContain('[SSN_REDACTED]');
      expect(result).toContain('[EMAIL_REDACTED]');
      expect(result).toContain('[PHONE_REDACTED]');
      expect(result).not.toContain('123-45-6789');
      expect(result).not.toContain('test@test.com');
      expect(result).not.toContain('555-111-2222');
    });
  });

  // ---------------------------------------------------------------------------
  // redactMessages
  // ---------------------------------------------------------------------------
  describe('redactMessages', () => {
    it('redacts PII across message arrays', () => {
      const messages = [
        { role: 'user', content: 'My SSN is 123-45-6789' },
        { role: 'assistant', content: 'I understand.' },
      ];
      const detections = [
        makeDetection('ssn', '123-45-6789', 10, 21),
      ];
      const result = redactor.redactMessages(messages, detections, 'redact');
      expect(result[0].content).toBe('My SSN is [SSN_REDACTED]');
      expect(result[1].content).toBe('I understand.');
    });

    it('preserves other message properties', () => {
      const messages = [
        { role: 'user', content: 'SSN: 111-22-3333', metadata: { source: 'cli' } },
      ];
      const detections = [makeDetection('ssn', '111-22-3333', 5, 16)];
      const result = redactor.redactMessages(messages, detections, 'redact');
      expect(result[0].role).toBe('user');
      expect((result[0] as any).metadata).toEqual({ source: 'cli' });
    });

    it('leaves messages without matching detections unchanged', () => {
      const messages = [
        { role: 'user', content: 'Hello world' },
        { role: 'assistant', content: 'Hi there' },
      ];
      const detections: PIIDetection[] = [];
      const result = redactor.redactMessages(messages, detections, 'redact');
      expect(result[0].content).toBe('Hello world');
      expect(result[1].content).toBe('Hi there');
    });
  });

  // ---------------------------------------------------------------------------
  // Empty detections
  // ---------------------------------------------------------------------------
  describe('No detections', () => {
    it('returns text unchanged when detections array is empty', () => {
      const text = 'No PII here';
      const result = redactor.redact(text, [], 'redact');
      expect(result).toBe('No PII here');
    });
  });
});
