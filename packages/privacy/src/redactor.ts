/**
 * @alfred/privacy - Redactor
 *
 * Three modes for handling detected PII:
 *   "redact" -> [TYPE_REDACTED]
 *   "hash"   -> [HASH:a1b2c3d4]
 *   "remove" -> ""
 *
 * Processes detections in reverse position order to preserve string indices.
 * Hash mode uses salt-based SHA-256.
 */

import { createHash } from 'node:crypto';
import type { PIIDetection } from './pii-detector.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RedactionMode = 'redact' | 'hash' | 'remove';

export interface RedactorOptions {
  /** Salt for SHA-256 hashing in 'hash' mode. Defaults to 'alfred-privacy-salt'. */
  salt?: string;
}

// ---------------------------------------------------------------------------
// Redactor class
// ---------------------------------------------------------------------------

export class Redactor {
  private salt: string;

  constructor(options: RedactorOptions = {}) {
    this.salt = options.salt ?? 'alfred-privacy-salt';
  }

  /**
   * Update the salt used for hash mode.
   */
  setSalt(salt: string): void {
    this.salt = salt;
  }

  /**
   * Redact PII from a text string.
   *
   * Detections are processed in reverse positional order so that earlier
   * indices remain valid as replacements change string length.
   */
  redact(text: string, detections: PIIDetection[], mode: RedactionMode = 'redact'): string {
    if (detections.length === 0) return text;

    // Sort detections by start position descending (reverse order)
    const sorted = [...detections].sort((a, b) => b.start - a.start);

    let result = text;
    for (const detection of sorted) {
      const replacement = this.getReplacement(detection, mode);
      result = result.slice(0, detection.start) + replacement + result.slice(detection.end);
    }

    return result;
  }

  /**
   * Redact PII from an array of messages.
   *
   * Each message's content is redacted individually.
   * Detections are matched to the correct message by comparing values
   * that exist in that message's content.
   */
  redactMessages(
    messages: Array<{ role: string; content: string; [key: string]: unknown }>,
    detections: PIIDetection[],
    mode: RedactionMode = 'redact',
  ): Array<{ role: string; content: string; [key: string]: unknown }> {
    return messages.map((msg) => {
      // Find detections that belong to this message by checking if the value
      // exists at the specified position in this message's content.
      const messageDetections = detections.filter((d) => {
        if (d.start >= 0 && d.end <= msg.content.length) {
          return msg.content.slice(d.start, d.end) === d.value;
        }
        return false;
      });

      if (messageDetections.length === 0) return { ...msg };

      return {
        ...msg,
        content: this.redact(msg.content, messageDetections, mode),
      };
    });
  }

  /**
   * Generate the replacement string for a given detection and mode.
   */
  private getReplacement(detection: PIIDetection, mode: RedactionMode): string {
    switch (mode) {
      case 'redact':
        return `[${detection.type.toUpperCase()}_REDACTED]`;

      case 'hash': {
        const hash = this.hashValue(detection.value);
        return `[HASH:${hash}]`;
      }

      case 'remove':
        return '';

      default:
        return `[${detection.type.toUpperCase()}_REDACTED]`;
    }
  }

  /**
   * SHA-256 hash a value with the configured salt.
   * Returns the first 8 hex characters for a compact representation.
   */
  private hashValue(value: string): string {
    const hash = createHash('sha256')
      .update(this.salt + ':' + value)
      .digest('hex');
    return hash.slice(0, 8);
  }
}
