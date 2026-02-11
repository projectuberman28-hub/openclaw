/**
 * @alfred/privacy - Privacy Gate
 *
 * The main privacy pipeline.
 * Flow: detect PII -> redact if enabled -> audit log -> return processed request.
 *
 * Local providers (ollama, lmstudio, local) bypass the gate entirely
 * because data stays on-device.
 */

import { randomUUID } from 'node:crypto';
import { PIIDetector, type PIIDetection } from './pii-detector.js';
import { Redactor, type RedactionMode } from './redactor.js';
import { AuditLog, type AuditLogOptions } from './audit-log.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PrivacyGateConfig {
  /** Whether PII stripping is enabled. Default true. */
  enabled?: boolean;
  /** Redaction mode. Default 'redact'. */
  mode?: RedactionMode;
  /** Minimum PII confidence to trigger redaction. Default 0.5. */
  minConfidence?: number;
  /** Salt for hash mode. */
  hashSalt?: string;
  /** Audit log options. */
  audit?: AuditLogOptions;
  /** Whether audit logging is enabled. Default true. */
  auditEnabled?: boolean;
}

export interface GateRequest {
  messages: Array<{ role: string; content: string; [key: string]: unknown }>;
  model: string;
  provider: string;
  endpoint?: string;
}

export interface GateContext {
  sessionId: string;
  channel: string;
}

export interface GateResult {
  /** The (possibly redacted) request. */
  request: GateRequest;
  /** All PII detections found. */
  piiDetections: PIIDetection[];
  /** Whether any redaction was applied. */
  wasRedacted: boolean;
  /** Unique audit ID for this gate pass. */
  auditId: string;
}

// ---------------------------------------------------------------------------
// Local provider check
// ---------------------------------------------------------------------------

const LOCAL_PROVIDERS = new Set(['ollama', 'lmstudio', 'local']);

/**
 * Check if a provider runs locally (data stays on-device).
 * Local providers bypass the privacy gate entirely.
 */
export function isLocalProvider(provider: string): boolean {
  return LOCAL_PROVIDERS.has(provider.toLowerCase().trim());
}

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

/**
 * Estimate token count from text using the ~4 chars per token heuristic.
 */
function estimateTokens(messages: Array<{ content: string }>): number {
  let totalChars = 0;
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      totalChars += msg.content.length;
    }
  }
  return Math.ceil(totalChars / 4);
}

// ---------------------------------------------------------------------------
// PrivacyGate class
// ---------------------------------------------------------------------------

export class PrivacyGate {
  private detector: PIIDetector;
  private redactor: Redactor;
  private auditLog: AuditLog;
  private config: Required<Omit<PrivacyGateConfig, 'audit' | 'hashSalt'>> & {
    audit: AuditLogOptions;
    hashSalt: string;
  };

  constructor(config: PrivacyGateConfig = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      mode: config.mode ?? 'redact',
      minConfidence: config.minConfidence ?? 0.5,
      hashSalt: config.hashSalt ?? 'alfred-privacy-salt',
      audit: config.audit ?? {},
      auditEnabled: config.auditEnabled ?? true,
    };

    this.detector = new PIIDetector({
      minConfidence: this.config.minConfidence,
    });

    this.redactor = new Redactor({
      salt: this.config.hashSalt,
    });

    this.auditLog = new AuditLog(this.config.audit);
  }

  /**
   * Get the underlying PIIDetector instance (for adding custom patterns, etc.)
   */
  getDetector(): PIIDetector {
    return this.detector;
  }

  /**
   * Get the underlying AuditLog instance.
   */
  getAuditLog(): AuditLog {
    return this.auditLog;
  }

  /**
   * Gate an outbound request through the privacy pipeline.
   *
   * For local providers, the gate is bypassed entirely (no detection, no redaction,
   * no audit logging) because data never leaves the machine.
   */
  async gateOutbound(request: GateRequest, context: GateContext): Promise<GateResult> {
    const auditId = randomUUID();
    const startTime = Date.now();

    // Local providers bypass entirely
    if (isLocalProvider(request.provider)) {
      return {
        request,
        piiDetections: [],
        wasRedacted: false,
        auditId,
      };
    }

    // Step 1: Detect PII across all messages
    let piiDetections: PIIDetection[] = [];
    if (this.config.enabled) {
      piiDetections = this.detector.scanMessages(request.messages);
    }

    // Step 2: Redact if PII was found and stripping is enabled
    let wasRedacted = false;
    let processedMessages = request.messages;

    if (this.config.enabled && piiDetections.length > 0) {
      processedMessages = this.redactor.redactMessages(
        request.messages,
        piiDetections,
        this.config.mode,
      );
      wasRedacted = true;
    }

    const processedRequest: GateRequest = {
      ...request,
      messages: processedMessages,
    };

    // Step 3: Audit log
    if (this.config.auditEnabled) {
      const latencyMs = Date.now() - startTime;
      const estimatedTokens = estimateTokens(request.messages);

      try {
        await this.auditLog.logOutbound({
          timestamp: Date.now(),
          provider: request.provider,
          model: request.model,
          endpoint: request.endpoint ?? '',
          piiDetected: piiDetections.length,
          piiRedacted: wasRedacted,
          redactedTypes: [...new Set(piiDetections.map((d) => d.type))],
          estimatedTokens,
          latencyMs,
          sessionId: context.sessionId,
          channel: context.channel,
          success: true,
        });
      } catch (err) {
        // Audit log failure should not block the request
        console.error('[PrivacyGate] Audit log write failed:', err);
      }
    }

    return {
      request: processedRequest,
      piiDetections,
      wasRedacted,
      auditId,
    };
  }

  /**
   * Gate an inbound response through the privacy pipeline.
   * Scans cloud responses for PII that should not have been returned.
   */
  async gateInbound(
    response: { content: string; model: string; provider: string; endpoint?: string },
    context: GateContext,
  ): Promise<{ content: string; piiDetections: PIIDetection[]; wasRedacted: boolean }> {
    const startTime = Date.now();

    if (isLocalProvider(response.provider)) {
      return { content: response.content, piiDetections: [], wasRedacted: false };
    }

    // Detect PII in response
    const piiDetections = this.config.enabled
      ? this.detector.scan(response.content)
      : [];

    let wasRedacted = false;
    let processedContent = response.content;

    if (this.config.enabled && piiDetections.length > 0) {
      processedContent = this.redactor.redact(
        response.content,
        piiDetections,
        this.config.mode,
      );
      wasRedacted = true;
    }

    // Audit log
    if (this.config.auditEnabled) {
      const latencyMs = Date.now() - startTime;

      try {
        await this.auditLog.logInbound({
          timestamp: Date.now(),
          provider: response.provider,
          model: response.model,
          endpoint: response.endpoint ?? '',
          piiDetected: piiDetections.length,
          piiRedacted: wasRedacted,
          redactedTypes: [...new Set(piiDetections.map((d) => d.type))],
          estimatedTokens: Math.ceil(response.content.length / 4),
          latencyMs,
          sessionId: context.sessionId,
          channel: context.channel,
          success: true,
        });
      } catch (err) {
        console.error('[PrivacyGate] Audit log write failed:', err);
      }
    }

    return {
      content: processedContent,
      piiDetections,
      wasRedacted,
    };
  }
}
