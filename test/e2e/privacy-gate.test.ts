/**
 * E2E Tests for Privacy Gate Pipeline
 *
 * Tests the full flow: message with PII -> detection -> redaction -> audit -> clean message.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PrivacyGate, PIIDetector, Redactor, AuditLog } from '@alfred/privacy';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Privacy Gate E2E', () => {
  let tempDir: string;
  let logPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'alfred-privacy-e2e-'));
    logPath = join(tempDir, 'cloud-audit.jsonl');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const context = {
    sessionId: 'e2e-session',
    channel: 'test',
  };

  // ---------------------------------------------------------------------------
  // Full pipeline: PII -> detection -> redaction -> audit -> clean
  // ---------------------------------------------------------------------------
  describe('Full pipeline', () => {
    it('processes message with PII through the complete pipeline', async () => {
      const gate = new PrivacyGate({
        audit: { logPath },
      });

      const request = {
        messages: [
          {
            role: 'user',
            content: 'My SSN is 123-45-6789 and email is test@example.com',
          },
        ],
        model: 'openai/gpt-4o',
        provider: 'openai',
      };

      const result = await gate.gateOutbound(request, context);

      // 1. Detection: PII was found
      expect(result.piiDetections.length).toBeGreaterThanOrEqual(2);
      const types = result.piiDetections.map((d) => d.type);
      expect(types).toContain('ssn');
      expect(types).toContain('email');

      // 2. Redaction: PII was replaced
      expect(result.wasRedacted).toBe(true);
      const cleanContent = result.request.messages[0].content;
      expect(cleanContent).not.toContain('123-45-6789');
      expect(cleanContent).not.toContain('test@example.com');
      expect(cleanContent).toContain('[SSN_REDACTED]');
      expect(cleanContent).toContain('[EMAIL_REDACTED]');

      // 3. Audit: log entry was created
      const logContent = await readFile(logPath, 'utf-8');
      expect(logContent.length).toBeGreaterThan(0);

      const entry = JSON.parse(logContent.trim());
      expect(entry.direction).toBe('outbound');
      expect(entry.provider).toBe('openai');
      expect(entry.piiDetected).toBeGreaterThanOrEqual(2);
      expect(entry.piiRedacted).toBe(true);
      expect(entry.redactedTypes).toContain('ssn');
      expect(entry.redactedTypes).toContain('email');

      // 4. Clean message out
      expect(result.request.messages[0].content).toBe(cleanContent);
    });

    it('handles text with no PII gracefully', async () => {
      const gate = new PrivacyGate({ audit: { logPath } });

      const request = {
        messages: [
          { role: 'user', content: 'Hello, how are you today?' },
        ],
        model: 'openai/gpt-4o',
        provider: 'openai',
      };

      const result = await gate.gateOutbound(request, context);
      expect(result.piiDetections).toHaveLength(0);
      expect(result.wasRedacted).toBe(false);
      expect(result.request.messages[0].content).toBe('Hello, how are you today?');
    });
  });

  // ---------------------------------------------------------------------------
  // Privacy score calculation
  // ---------------------------------------------------------------------------
  describe('Privacy score', () => {
    it('calculates privacy score after multiple calls', async () => {
      const auditLog = new AuditLog({ logPath });

      // Log some outbound calls with PII detected and redacted
      await auditLog.logOutbound({
        timestamp: Date.now(),
        provider: 'openai',
        model: 'gpt-4o',
        endpoint: '/v1/chat',
        piiDetected: 2,
        piiRedacted: true,
        redactedTypes: ['ssn', 'email'],
        estimatedTokens: 100,
        latencyMs: 50,
        sessionId: 'sess-1',
        channel: 'cli',
        success: true,
      });

      await auditLog.logOutbound({
        timestamp: Date.now(),
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        endpoint: '/v1/messages',
        piiDetected: 1,
        piiRedacted: true,
        redactedTypes: ['phone'],
        estimatedTokens: 200,
        latencyMs: 30,
        sessionId: 'sess-2',
        channel: 'cli',
        success: true,
      });

      // Call without PII
      await auditLog.logOutbound({
        timestamp: Date.now(),
        provider: 'openai',
        model: 'gpt-4o',
        endpoint: '/v1/chat',
        piiDetected: 0,
        piiRedacted: false,
        redactedTypes: [],
        estimatedTokens: 50,
        latencyMs: 20,
        sessionId: 'sess-3',
        channel: 'cli',
        success: true,
      });

      const score = await auditLog.getPrivacyScore();
      expect(score.totalCalls).toBe(3);
      expect(score.piiCaught).toBe(2);
      expect(score.redactionRate).toBe(1); // all PII was redacted
      expect(score.score).toBe(100);
    });
  });

  // ---------------------------------------------------------------------------
  // Audit log entries
  // ---------------------------------------------------------------------------
  describe('Audit log entries', () => {
    it('stores correct fields in audit entries', async () => {
      const gate = new PrivacyGate({ audit: { logPath } });

      await gate.gateOutbound(
        {
          messages: [
            { role: 'user', content: 'Call me at 555-123-4567' },
          ],
          model: 'anthropic/claude-sonnet-4-20250514',
          provider: 'anthropic',
          endpoint: '/v1/messages',
        },
        { sessionId: 'audit-test', channel: 'discord' },
      );

      const logContent = await readFile(logPath, 'utf-8');
      const entry = JSON.parse(logContent.trim());

      expect(entry.provider).toBe('anthropic');
      expect(entry.model).toBe('anthropic/claude-sonnet-4-20250514');
      expect(entry.sessionId).toBe('audit-test');
      expect(entry.channel).toBe('discord');
      expect(entry.direction).toBe('outbound');
      expect(entry.success).toBe(true);
      expect(typeof entry.timestamp).toBe('number');
      expect(typeof entry.latencyMs).toBe('number');
      expect(typeof entry.estimatedTokens).toBe('number');
    });

    it('retrieves entries from the audit log', async () => {
      const auditLog = new AuditLog({ logPath });

      await auditLog.logOutbound({
        timestamp: Date.now(),
        provider: 'openai',
        model: 'gpt-4o',
        endpoint: '/v1/chat',
        piiDetected: 1,
        piiRedacted: true,
        redactedTypes: ['email'],
        estimatedTokens: 100,
        latencyMs: 50,
        sessionId: 'read-test',
        channel: 'cli',
        success: true,
      });

      const entries = await auditLog.getEntries();
      expect(entries.length).toBe(1);
      expect(entries[0].provider).toBe('openai');
      expect(entries[0].sessionId).toBe('read-test');
    });
  });
});
