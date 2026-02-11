/**
 * Tests for @alfred/privacy - PII Detector
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { PIIDetector, luhnCheck } from '@alfred/privacy';

describe('PIIDetector', () => {
  let detector: PIIDetector;

  beforeEach(() => {
    detector = new PIIDetector();
  });

  // ---------------------------------------------------------------------------
  // Luhn algorithm
  // ---------------------------------------------------------------------------
  describe('luhnCheck', () => {
    it('returns true for a valid Visa number', () => {
      expect(luhnCheck('4111111111111111')).toBe(true);
    });

    it('returns true for a valid MasterCard number', () => {
      expect(luhnCheck('5500000000000004')).toBe(true);
    });

    it('returns true for a valid Amex number', () => {
      expect(luhnCheck('378282246310005')).toBe(true);
    });

    it('returns false for an invalid number', () => {
      expect(luhnCheck('4111111111111112')).toBe(false);
    });

    it('returns false for non-digit input', () => {
      expect(luhnCheck('abcdefgh')).toBe(false);
    });

    it('returns false for very short input', () => {
      expect(luhnCheck('1')).toBe(false);
    });

    it('strips dashes and spaces before checking', () => {
      expect(luhnCheck('4111-1111-1111-1111')).toBe(true);
      expect(luhnCheck('4111 1111 1111 1111')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // SSN detection
  // ---------------------------------------------------------------------------
  describe('SSN detection', () => {
    it('detects SSN with dashes (###-##-####)', () => {
      const results = detector.scan('My SSN is 123-45-6789.');
      const ssn = results.find((r) => r.type === 'ssn');
      expect(ssn).toBeDefined();
      expect(ssn!.value).toBe('123-45-6789');
    });

    it('returns correct start/end positions for SSN', () => {
      const text = 'SSN: 999-88-7777';
      const results = detector.scan(text);
      const ssn = results.find((r) => r.type === 'ssn');
      expect(ssn).toBeDefined();
      expect(text.slice(ssn!.start, ssn!.end)).toBe('999-88-7777');
    });

    it('does not detect SSN without dashes by default (######### alone)', () => {
      // The built-in regex requires dashes: \d{3}-\d{2}-\d{4}
      const results = detector.scan('My SSN is 123456789 no dashes');
      const ssn = results.find((r) => r.type === 'ssn');
      expect(ssn).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Email detection
  // ---------------------------------------------------------------------------
  describe('Email detection', () => {
    it('detects standard email addresses', () => {
      const results = detector.scan('Email me at alice@example.com');
      const email = results.find((r) => r.type === 'email');
      expect(email).toBeDefined();
      expect(email!.value).toBe('alice@example.com');
    });

    it('detects emails with plus addressing', () => {
      const results = detector.scan('Contact user+tag@mail.co.uk please');
      const email = results.find((r) => r.type === 'email');
      expect(email).toBeDefined();
      expect(email!.value).toBe('user+tag@mail.co.uk');
    });

    it('detects emails with dots and hyphens in domain', () => {
      const results = detector.scan('Send to john@my-company.example.org');
      const email = results.find((r) => r.type === 'email');
      expect(email).toBeDefined();
      expect(email!.value).toBe('john@my-company.example.org');
    });

    it('assigns high confidence to email detections', () => {
      const results = detector.scan('test@test.com');
      const email = results.find((r) => r.type === 'email');
      expect(email!.confidence).toBeGreaterThanOrEqual(0.9);
    });
  });

  // ---------------------------------------------------------------------------
  // Phone detection
  // ---------------------------------------------------------------------------
  describe('Phone detection', () => {
    it('detects US phone with parentheses (###) ###-####', () => {
      const results = detector.scan('Call me at (555) 123-4567');
      const phone = results.find((r) => r.type === 'phone');
      expect(phone).toBeDefined();
    });

    it('detects US phone with dashes ###-###-####', () => {
      const results = detector.scan('Phone: 555-123-4567');
      const phone = results.find((r) => r.type === 'phone');
      expect(phone).toBeDefined();
    });

    it('detects US phone with +1 prefix', () => {
      const results = detector.scan('International: +15551234567');
      const phone = results.find((r) => r.type === 'phone');
      expect(phone).toBeDefined();
    });

    it('rejects numbers with fewer than 10 digits', () => {
      const results = detector.scan('Short number: 555-123');
      const phone = results.find((r) => r.type === 'phone');
      expect(phone).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Credit card detection with Luhn validation
  // ---------------------------------------------------------------------------
  describe('Credit card detection', () => {
    it('detects valid Visa number', () => {
      const results = detector.scan('Card: 4111 1111 1111 1111');
      const cc = results.find((r) => r.type === 'credit_card');
      expect(cc).toBeDefined();
      expect(cc!.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('detects valid MasterCard number', () => {
      const results = detector.scan('MC: 5500 0000 0000 0004');
      const cc = results.find((r) => r.type === 'credit_card');
      expect(cc).toBeDefined();
    });

    it('detects valid Amex number', () => {
      const results = detector.scan('Amex: 3782 8224 6310 005');
      const cc = results.find((r) => r.type === 'credit_card');
      expect(cc).toBeDefined();
    });

    it('rejects number that fails Luhn validation', () => {
      const results = detector.scan('Bad card: 4111 1111 1111 1112');
      const cc = results.find((r) => r.type === 'credit_card');
      expect(cc).toBeUndefined();
    });

    it('detects card numbers with dashes', () => {
      const results = detector.scan('Card: 4111-1111-1111-1111');
      const cc = results.find((r) => r.type === 'credit_card');
      expect(cc).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // API key detection
  // ---------------------------------------------------------------------------
  describe('API key detection', () => {
    it('detects OpenAI-style sk- keys', () => {
      const key = 'sk-' + 'a'.repeat(40);
      const results = detector.scan(`Key: ${key}`);
      const apiKey = results.find((r) => r.type === 'api_key');
      expect(apiKey).toBeDefined();
      expect(apiKey!.value).toBe(key);
    });

    it('detects publishable pk- keys', () => {
      const key = 'pk-' + 'b'.repeat(30);
      const results = detector.scan(`Publishable: ${key}`);
      const apiKey = results.find((r) => r.type === 'api_key');
      expect(apiKey).toBeDefined();
    });

    it('detects GitHub PAT ghp_ tokens', () => {
      const token = 'ghp_' + 'c'.repeat(36);
      const results = detector.scan(`GitHub: ${token}`);
      const apiKey = results.find((r) => r.type === 'api_key');
      expect(apiKey).toBeDefined();
      expect(apiKey!.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('detects Bearer tokens', () => {
      const results = detector.scan('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig');
      const apiKey = results.find((r) => r.type === 'api_key');
      expect(apiKey).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // IP address detection
  // ---------------------------------------------------------------------------
  describe('IP address detection', () => {
    it('detects valid IPv4 addresses', () => {
      const results = detector.scan('Server IP: 192.168.1.100');
      const ip = results.find((r) => r.type === 'ip_address');
      expect(ip).toBeDefined();
      expect(ip!.value).toBe('192.168.1.100');
    });

    it('rejects invalid IPv4 octets > 255', () => {
      const results = detector.scan('Bad IP: 999.999.999.999');
      const ip = results.find((r) => r.type === 'ip_address');
      expect(ip).toBeUndefined();
    });

    it('assigns lower confidence to loopback 127.0.0.1', () => {
      const results = detector.scan('Localhost: 127.0.0.1');
      const ip = results.find((r) => r.type === 'ip_address');
      // The validator returns 0.3 for 127.0.0.1 which is below default 0.5 threshold
      // so it should be filtered out
      expect(ip).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Date of birth detection
  // ---------------------------------------------------------------------------
  describe('DOB detection', () => {
    it('detects MM/DD/YYYY format', () => {
      const results = detector.scan('DOB: 01/15/1990');
      const dob = results.find((r) => r.type === 'date_of_birth');
      expect(dob).toBeDefined();
      expect(dob!.value).toBe('01/15/1990');
    });

    it('detects YYYY-MM-DD format', () => {
      const results = detector.scan('Born: 1985-12-25');
      const dob = results.find((r) => r.type === 'date_of_birth');
      expect(dob).toBeDefined();
      expect(dob!.value).toBe('1985-12-25');
    });

    it('detects MM-DD-YYYY format', () => {
      const results = detector.scan('Birthday: 03-22-2000');
      const dob = results.find((r) => r.type === 'date_of_birth');
      expect(dob).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Confidence scoring
  // ---------------------------------------------------------------------------
  describe('Confidence scoring', () => {
    it('SSN confidence is >= 0.9', () => {
      const results = detector.scan('SSN: 123-45-6789');
      const ssn = results.find((r) => r.type === 'ssn');
      expect(ssn!.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('email confidence is >= 0.9', () => {
      const results = detector.scan('user@test.com');
      const email = results.find((r) => r.type === 'email');
      expect(email!.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('credit card confidence is >= 0.9 for valid Luhn', () => {
      const results = detector.scan('4111 1111 1111 1111');
      const cc = results.find((r) => r.type === 'credit_card');
      expect(cc!.confidence).toBeGreaterThanOrEqual(0.9);
    });
  });

  // ---------------------------------------------------------------------------
  // Custom pattern addition
  // ---------------------------------------------------------------------------
  describe('Custom patterns', () => {
    it('addPattern registers a new pattern that produces detections', () => {
      detector.addPattern('custom_id', /CUST-\d{6}/, 0.8);
      const results = detector.scan('Customer CUST-123456 placed an order');
      const custom = results.find((r) => r.type === 'custom_id');
      expect(custom).toBeDefined();
      expect(custom!.value).toBe('CUST-123456');
      expect(custom!.confidence).toBe(0.8);
    });

    it('addPattern auto-adds global flag if missing', () => {
      detector.addPattern('tag', /TAG-\w+/, 0.7);
      const results = detector.scan('Found TAG-abc and TAG-def in text');
      const tags = results.filter((r) => r.type === 'tag');
      expect(tags.length).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // scanMessages
  // ---------------------------------------------------------------------------
  describe('scanMessages', () => {
    it('scans PII across multiple messages', () => {
      const messages = [
        { role: 'user', content: 'My SSN is 123-45-6789' },
        { role: 'assistant', content: 'Got it.' },
        { role: 'user', content: 'Email: test@example.com' },
      ];
      const results = detector.scanMessages(messages);
      const types = results.map((r) => r.type);
      expect(types).toContain('ssn');
      expect(types).toContain('email');
    });

    it('returns detections with positions relative to each message content', () => {
      const messages = [
        { role: 'user', content: 'SSN: 111-22-3333' },
      ];
      const results = detector.scanMessages(messages);
      const ssn = results.find((r) => r.type === 'ssn');
      expect(ssn).toBeDefined();
      expect(messages[0].content.slice(ssn!.start, ssn!.end)).toBe('111-22-3333');
    });
  });

  // ---------------------------------------------------------------------------
  // Minimum confidence threshold filtering
  // ---------------------------------------------------------------------------
  describe('Minimum confidence threshold', () => {
    it('filters out detections below the threshold', () => {
      const strictDetector = new PIIDetector({ minConfidence: 0.9 });
      // DOB has confidence 0.6 -- should be filtered
      const results = strictDetector.scan('DOB: 01/15/1990 Email: a@b.com SSN: 123-45-6789');
      const dob = results.find((r) => r.type === 'date_of_birth');
      expect(dob).toBeUndefined();
      // Email and SSN are 0.95 so should remain
      expect(results.find((r) => r.type === 'email')).toBeDefined();
      expect(results.find((r) => r.type === 'ssn')).toBeDefined();
    });

    it('setMinConfidence updates the threshold', () => {
      detector.setMinConfidence(1.0);
      const results = detector.scan('123-45-6789 test@example.com');
      // All patterns have confidence < 1.0 so nothing should be returned
      expect(results.length).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // No PII returns empty array
  // ---------------------------------------------------------------------------
  describe('No PII detection', () => {
    it('returns empty array for text with no PII', () => {
      const results = detector.scan('Hello, this is a completely normal sentence with no personal data.');
      expect(results).toEqual([]);
    });

    it('returns empty array for empty string', () => {
      const results = detector.scan('');
      expect(results).toEqual([]);
    });
  });
});
