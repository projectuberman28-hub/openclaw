/**
 * Tests for @alfred/privacy - Privacy Gate
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PrivacyGate, isLocalProvider } from '@alfred/privacy';
import type { GateRequest, GateContext } from '@alfred/privacy';

// Mock the audit log's file system calls so tests don't touch disk
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  appendFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(''),
  stat: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
}));

describe('PrivacyGate', () => {
  let gate: PrivacyGate;

  const makeRequest = (content: string, provider = 'openai'): GateRequest => ({
    messages: [{ role: 'user', content }],
    model: 'openai/gpt-4o',
    provider,
  });

  const context: GateContext = {
    sessionId: 'test-session-123',
    channel: 'cli',
  };

  beforeEach(() => {
    gate = new PrivacyGate();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // isLocalProvider
  // ---------------------------------------------------------------------------
  describe('isLocalProvider', () => {
    it('identifies ollama as local', () => {
      expect(isLocalProvider('ollama')).toBe(true);
    });

    it('identifies lmstudio as local', () => {
      expect(isLocalProvider('lmstudio')).toBe(true);
    });

    it('identifies local as local', () => {
      expect(isLocalProvider('local')).toBe(true);
    });

    it('is case-insensitive', () => {
      expect(isLocalProvider('Ollama')).toBe(true);
      expect(isLocalProvider('LMSTUDIO')).toBe(true);
    });

    it('does not identify cloud providers as local', () => {
      expect(isLocalProvider('openai')).toBe(false);
      expect(isLocalProvider('anthropic')).toBe(false);
      expect(isLocalProvider('google')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Local providers bypass gate entirely
  // ---------------------------------------------------------------------------
  describe('Local providers bypass', () => {
    it('bypasses gate for ollama provider', async () => {
      const request = makeRequest('My SSN is 123-45-6789', 'ollama');
      const result = await gate.gateOutbound(request, context);

      expect(result.piiDetections).toHaveLength(0);
      expect(result.wasRedacted).toBe(false);
      expect(result.request.messages[0].content).toBe('My SSN is 123-45-6789');
    });

    it('bypasses gate for lmstudio provider', async () => {
      const request = makeRequest('Email: test@example.com', 'lmstudio');
      const result = await gate.gateOutbound(request, context);

      expect(result.piiDetections).toHaveLength(0);
      expect(result.wasRedacted).toBe(false);
    });

    it('bypasses gate for local provider', async () => {
      const request = makeRequest('Card: 4111 1111 1111 1111', 'local');
      const result = await gate.gateOutbound(request, context);

      expect(result.piiDetections).toHaveLength(0);
      expect(result.wasRedacted).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Cloud providers go through full pipeline
  // ---------------------------------------------------------------------------
  describe('Cloud providers full pipeline', () => {
    it('detects and redacts PII for cloud providers', async () => {
      const request = makeRequest('My SSN is 123-45-6789', 'openai');
      const result = await gate.gateOutbound(request, context);

      expect(result.piiDetections.length).toBeGreaterThan(0);
      expect(result.wasRedacted).toBe(true);
      expect(result.request.messages[0].content).toContain('[SSN_REDACTED]');
      expect(result.request.messages[0].content).not.toContain('123-45-6789');
    });

    it('returns auditId for every call', async () => {
      const request = makeRequest('Hello world', 'openai');
      const result = await gate.gateOutbound(request, context);
      expect(result.auditId).toBeDefined();
      expect(typeof result.auditId).toBe('string');
      expect(result.auditId.length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // PII detection + redaction + audit logging flow
  // ---------------------------------------------------------------------------
  describe('Full pipeline flow', () => {
    it('detects PII, redacts it, and creates audit entry', async () => {
      const request = makeRequest('SSN: 111-22-3333, Email: user@test.com', 'anthropic');
      const result = await gate.gateOutbound(request, context);

      // Detection
      const types = result.piiDetections.map((d) => d.type);
      expect(types).toContain('ssn');
      expect(types).toContain('email');

      // Redaction
      expect(result.wasRedacted).toBe(true);
      expect(result.request.messages[0].content).not.toContain('111-22-3333');
      expect(result.request.messages[0].content).not.toContain('user@test.com');

      // Audit - the audit log method was called (we mocked appendFile)
      const { appendFile } = await import('node:fs/promises');
      expect(appendFile).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // gateOutbound returns correct structure
  // ---------------------------------------------------------------------------
  describe('GateResult structure', () => {
    it('contains request, piiDetections, wasRedacted, and auditId', async () => {
      const request = makeRequest('No PII here', 'openai');
      const result = await gate.gateOutbound(request, context);

      expect(result).toHaveProperty('request');
      expect(result).toHaveProperty('piiDetections');
      expect(result).toHaveProperty('wasRedacted');
      expect(result).toHaveProperty('auditId');
    });

    it('request contains the processed messages', async () => {
      const request = makeRequest('Clean text', 'openai');
      const result = await gate.gateOutbound(request, context);

      expect(result.request.messages).toBeDefined();
      expect(result.request.model).toBe('openai/gpt-4o');
      expect(result.request.provider).toBe('openai');
    });
  });

  // ---------------------------------------------------------------------------
  // Token estimation
  // ---------------------------------------------------------------------------
  describe('Token estimation', () => {
    it('estimates tokens for the audit log', async () => {
      const request = makeRequest('This is a test message with some content.', 'openai');
      await gate.gateOutbound(request, context);

      // The audit appendFile call should include estimatedTokens
      const { appendFile } = await import('node:fs/promises');
      const calls = vi.mocked(appendFile).mock.calls;
      if (calls.length > 0) {
        const logLine = calls[0][1] as string;
        const entry = JSON.parse(logLine.trim());
        expect(entry.estimatedTokens).toBeGreaterThan(0);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // With piiStripping disabled
  // ---------------------------------------------------------------------------
  describe('PII stripping disabled', () => {
    it('does not detect or redact PII when enabled is false', async () => {
      const disabledGate = new PrivacyGate({ enabled: false });
      const request = makeRequest('My SSN is 123-45-6789', 'openai');
      const result = await disabledGate.gateOutbound(request, context);

      expect(result.piiDetections).toHaveLength(0);
      expect(result.wasRedacted).toBe(false);
      expect(result.request.messages[0].content).toBe('My SSN is 123-45-6789');
    });
  });

  // ---------------------------------------------------------------------------
  // Audit entry for every cloud call
  // ---------------------------------------------------------------------------
  describe('Audit logging', () => {
    it('creates an audit entry for every cloud provider call', async () => {
      const { appendFile } = await import('node:fs/promises');
      const mockedAppend = vi.mocked(appendFile);
      mockedAppend.mockClear();

      const request = makeRequest('Hello', 'openai');
      await gate.gateOutbound(request, context);

      expect(mockedAppend).toHaveBeenCalledTimes(1);

      const logLine = mockedAppend.mock.calls[0][1] as string;
      const entry = JSON.parse(logLine.trim());
      expect(entry.direction).toBe('outbound');
      expect(entry.provider).toBe('openai');
      expect(entry.sessionId).toBe('test-session-123');
      expect(entry.channel).toBe('cli');
    });

    it('does not create audit entry for local providers', async () => {
      const { appendFile } = await import('node:fs/promises');
      const mockedAppend = vi.mocked(appendFile);
      mockedAppend.mockClear();

      const request = makeRequest('Hello', 'ollama');
      await gate.gateOutbound(request, context);

      expect(mockedAppend).not.toHaveBeenCalled();
    });
  });
});
