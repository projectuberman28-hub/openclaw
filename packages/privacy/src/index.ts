/**
 * @alfred/privacy - Alfred's privacy layer
 *
 * PII detection, redaction, audit logging, credential management,
 * data boundaries, and the unified privacy gate pipeline.
 */

export {
  PIIDetector,
  luhnCheck,
  type PIIDetection,
} from './pii-detector.js';

export {
  Redactor,
  type RedactionMode,
  type RedactorOptions,
} from './redactor.js';

export {
  AuditLog,
  type AuditEntry,
  type PrivacyScore,
  type AuditLogOptions,
} from './audit-log.js';

export {
  PrivacyGate,
  isLocalProvider,
  type PrivacyGateConfig,
  type GateRequest,
  type GateContext,
  type GateResult,
} from './privacy-gate.js';

export {
  CredentialVault,
  type CredentialVaultOptions,
} from './credential-vault.js';

export {
  DataBoundary,
  type DataBoundaryOptions,
  type ValidationResult,
} from './data-boundary.js';
