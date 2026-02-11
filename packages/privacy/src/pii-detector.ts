/**
 * @alfred/privacy - PII Detector
 *
 * Pattern-based PII scanner with confidence scoring.
 * Detects SSN, email, phone, credit cards (with Luhn validation),
 * IP addresses, dates of birth, API keys/tokens, and bank account numbers.
 * Supports custom patterns.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PIIDetection {
  type: string;
  value: string;
  start: number;
  end: number;
  confidence: number;
}

interface PIIPattern {
  name: string;
  regex: RegExp;
  confidence: number;
  /** Optional validator run after regex match to refine confidence or reject */
  validate?: (match: string) => number | false;
}

// ---------------------------------------------------------------------------
// Luhn algorithm for credit card validation
// ---------------------------------------------------------------------------

/**
 * Validate a number string with the Luhn algorithm.
 * Returns true if the checksum is valid.
 */
export function luhnCheck(digits: string): boolean {
  const stripped = digits.replace(/[\s-]/g, '');
  if (!/^\d+$/.test(stripped) || stripped.length < 2) return false;

  let sum = 0;
  let alternate = false;

  for (let i = stripped.length - 1; i >= 0; i--) {
    let n = parseInt(stripped[i], 10);
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }

  return sum % 10 === 0;
}

// ---------------------------------------------------------------------------
// Built-in patterns
// ---------------------------------------------------------------------------

const BUILTIN_PATTERNS: PIIPattern[] = [
  // SSN: ###-##-####
  {
    name: 'ssn',
    regex: /\b(\d{3}-\d{2}-\d{4})\b/g,
    confidence: 0.95,
  },

  // Email
  {
    name: 'email',
    regex: /\b([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/g,
    confidence: 0.95,
  },

  // Phone: multiple formats
  // US: (###) ###-####, ###-###-####, ### ### ####, +1##########, etc.
  {
    name: 'phone',
    regex: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    confidence: 0.8,
    validate: (match: string) => {
      // Must have at least 10 digits
      const digits = match.replace(/\D/g, '');
      if (digits.length < 10 || digits.length > 11) return false;
      return 0.8;
    },
  },

  // Credit card: 13-19 digit sequences (with optional spaces/dashes), Luhn validated
  {
    name: 'credit_card',
    regex: /\b(\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{1,7})\b/g,
    confidence: 0.9,
    validate: (match: string) => {
      const digits = match.replace(/[\s-]/g, '');
      if (digits.length < 13 || digits.length > 19) return false;
      return luhnCheck(digits) ? 0.95 : false;
    },
  },

  // IPv4 address
  {
    name: 'ip_address',
    regex: /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g,
    confidence: 0.7,
    validate: (match: string) => {
      const octets = match.split('.').map(Number);
      const valid = octets.every((o) => o >= 0 && o <= 255);
      if (!valid) return false;
      // Exclude common non-PII like 0.0.0.0, 127.0.0.1, version-like patterns
      if (match === '0.0.0.0' || match === '127.0.0.1') return 0.3;
      return 0.7;
    },
  },

  // Date of birth: MM/DD/YYYY, MM-DD-YYYY, YYYY-MM-DD
  {
    name: 'date_of_birth',
    regex:
      /\b(?:(?:0[1-9]|1[0-2])[\/\-](?:0[1-9]|[12]\d|3[01])[\/\-](?:19|20)\d{2}|(?:19|20)\d{2}[\/\-](?:0[1-9]|1[0-2])[\/\-](?:0[1-9]|[12]\d|3[01]))\b/g,
    confidence: 0.6,
  },

  // API keys / tokens
  // OpenAI: sk-...
  {
    name: 'api_key',
    regex: /\b(sk-[a-zA-Z0-9]{20,})\b/g,
    confidence: 0.95,
  },
  // Publishable key: pk-...
  {
    name: 'api_key',
    regex: /\b(pk-[a-zA-Z0-9]{20,})\b/g,
    confidence: 0.9,
  },
  // Bearer token
  {
    name: 'api_key',
    regex: /\b(Bearer\s+[a-zA-Z0-9\-._~+\/]+=*)\b/gi,
    confidence: 0.85,
  },
  // GitHub PAT: ghp_...
  {
    name: 'api_key',
    regex: /\b(ghp_[a-zA-Z0-9]{36,})\b/g,
    confidence: 0.95,
  },
  // GitHub OAuth: gho_...
  {
    name: 'api_key',
    regex: /\b(gho_[a-zA-Z0-9]{36,})\b/g,
    confidence: 0.95,
  },
  // Generic long hex/base64 token (>= 32 chars, labeled lower confidence)
  {
    name: 'api_key',
    regex: /\b((?:token|key|secret|api[_-]?key)[=:\s]+[a-zA-Z0-9\-._~+\/]{32,})\b/gi,
    confidence: 0.7,
  },

  // Bank account number (8-17 digits that are not credit cards)
  {
    name: 'bank_account',
    regex: /\b(\d{8,17})\b/g,
    confidence: 0.3,
    validate: (match: string) => {
      // Only flag if it looks like a standalone long number
      // Low confidence because many long numbers are not bank accounts
      const len = match.length;
      if (len < 8 || len > 17) return false;
      // Exclude credit card range (will be caught by CC pattern with higher confidence)
      if (len >= 13 && len <= 19 && luhnCheck(match)) return false;
      return 0.3;
    },
  },
];

// ---------------------------------------------------------------------------
// PIIDetector class
// ---------------------------------------------------------------------------

export class PIIDetector {
  private patterns: PIIPattern[];
  private minConfidence: number;

  constructor(options: { minConfidence?: number } = {}) {
    this.patterns = [...BUILTIN_PATTERNS];
    this.minConfidence = options.minConfidence ?? 0.5;
  }

  /**
   * Add a custom PII pattern.
   */
  addPattern(name: string, regex: RegExp, confidence: number): void {
    // Ensure global flag so we can iterate all matches
    const flags = regex.flags.includes('g') ? regex.flags : regex.flags + 'g';
    this.patterns.push({
      name,
      regex: new RegExp(regex.source, flags),
      confidence,
    });
  }

  /**
   * Set the minimum confidence threshold for returned detections.
   */
  setMinConfidence(threshold: number): void {
    this.minConfidence = threshold;
  }

  /**
   * Scan a single text string for PII.
   */
  scan(text: string): PIIDetection[] {
    const detections: PIIDetection[] = [];

    for (const pattern of this.patterns) {
      // Reset regex state
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
      let match: RegExpExecArray | null;

      while ((match = regex.exec(text)) !== null) {
        const value = match[1] ?? match[0];
        const start = match.index + (match[0].indexOf(value));
        const end = start + value.length;

        let confidence = pattern.confidence;

        // Run optional validator
        if (pattern.validate) {
          const result = pattern.validate(value);
          if (result === false) continue;
          confidence = result;
        }

        if (confidence >= this.minConfidence) {
          detections.push({
            type: pattern.name,
            value,
            start,
            end,
            confidence,
          });
        }
      }
    }

    // Deduplicate: if multiple patterns match the same span, keep highest confidence
    return this.deduplicateDetections(detections);
  }

  /**
   * Scan an array of messages for PII.
   * Returns detections with positions relative to each message's content.
   */
  scanMessages(messages: Array<{ role: string; content: string }>): PIIDetection[] {
    const allDetections: PIIDetection[] = [];
    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        const detections = this.scan(msg.content);
        allDetections.push(...detections);
      }
    }
    return allDetections;
  }

  /**
   * Remove overlapping detections, keeping the one with higher confidence.
   */
  private deduplicateDetections(detections: PIIDetection[]): PIIDetection[] {
    if (detections.length <= 1) return detections;

    // Sort by start position, then by confidence descending
    const sorted = [...detections].sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start;
      return b.confidence - a.confidence;
    });

    const result: PIIDetection[] = [];
    let lastEnd = -1;
    let lastConfidence = -1;

    for (const det of sorted) {
      // If this detection overlaps with the previous kept one
      if (det.start < lastEnd) {
        // Only keep it if it has strictly higher confidence
        if (det.confidence > lastConfidence) {
          result.pop();
          result.push(det);
          lastEnd = det.end;
          lastConfidence = det.confidence;
        }
        // Otherwise skip it
        continue;
      }

      result.push(det);
      lastEnd = det.end;
      lastConfidence = det.confidence;
    }

    return result;
  }
}
