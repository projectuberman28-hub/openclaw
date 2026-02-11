/**
 * @alfred/gateway - Authentication
 *
 * Token-based authentication for the gateway HTTP and WebSocket endpoints.
 * Token is loaded from the credential vault or generated on first run.
 * Can be overridden via ALFRED_GATEWAY_TOKEN environment variable.
 */

import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { CredentialVault } from '@alfred/privacy';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VAULT_KEY = 'gateway_token';
const TOKEN_BYTES = 32;
const LOG_PREFIX = '[GatewayAuth]';

// ---------------------------------------------------------------------------
// GatewayAuth
// ---------------------------------------------------------------------------

export class GatewayAuth {
  private token: string | null = null;
  private vault: CredentialVault;
  private initialized = false;

  constructor(vault?: CredentialVault) {
    this.vault = vault ?? new CredentialVault();
  }

  /**
   * Initialize the auth module.
   * Loads token from env, vault, or generates a new one.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // 1. Check environment override
    const envToken = process.env['ALFRED_GATEWAY_TOKEN'];
    if (envToken && envToken.length > 0) {
      this.token = envToken;
      console.log(`${LOG_PREFIX} Using token from ALFRED_GATEWAY_TOKEN environment variable`);
      this.initialized = true;
      return;
    }

    // 2. Try loading from credential vault
    try {
      const stored = await this.vault.retrieve(VAULT_KEY);
      if (stored) {
        this.token = stored;
        console.log(`${LOG_PREFIX} Loaded token from credential vault`);
        this.initialized = true;
        return;
      }
    } catch (err) {
      console.warn(`${LOG_PREFIX} Failed to read vault, generating new token:`, err);
    }

    // 3. Generate new token
    this.token = GatewayAuth.generateToken();

    // Persist to vault
    try {
      await this.vault.store(VAULT_KEY, this.token);
      console.log(`${LOG_PREFIX} Generated and stored new gateway token`);
    } catch (err) {
      console.warn(`${LOG_PREFIX} Failed to persist token to vault:`, err);
    }

    this.initialized = true;
  }

  /**
   * Get the current token. Useful for displaying to the user on first run.
   */
  getToken(): string | null {
    return this.token;
  }

  /**
   * Validate an HTTP request's Authorization header.
   * Expects: Authorization: Bearer <token>
   *
   * Returns true if auth is disabled (no token configured) or token matches.
   */
  validateHttp(req: IncomingMessage): boolean {
    // If no token is set, auth is effectively disabled
    if (!this.token) return true;

    const authHeader = req.headers['authorization'];
    if (!authHeader) {
      this.logInvalidAttempt(req, 'Missing Authorization header');
      return false;
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0]?.toLowerCase() !== 'bearer') {
      this.logInvalidAttempt(req, 'Malformed Authorization header');
      return false;
    }

    const providedToken = parts[1]!;
    if (providedToken !== this.token) {
      this.logInvalidAttempt(req, 'Invalid token');
      return false;
    }

    return true;
  }

  /**
   * Validate a WebSocket connection.
   * The first message from the client must contain the token.
   *
   * Accepts a connect frame: { token: string }
   */
  validateWs(connectFrame: unknown): boolean {
    // If no token is set, auth is effectively disabled
    if (!this.token) return true;

    if (typeof connectFrame !== 'object' || connectFrame === null) {
      return false;
    }

    const frame = connectFrame as Record<string, unknown>;
    const providedToken = frame['token'];

    if (typeof providedToken !== 'string') {
      return false;
    }

    return providedToken === this.token;
  }

  /**
   * Generate a cryptographically secure random token.
   */
  static generateToken(): string {
    return randomBytes(TOKEN_BYTES).toString('hex');
  }

  /**
   * Log an invalid authentication attempt with timestamp and IP.
   */
  private logInvalidAttempt(req: IncomingMessage, reason: string): void {
    const ip = req.socket.remoteAddress ?? 'unknown';
    const timestamp = new Date().toISOString();
    const method = req.method ?? 'UNKNOWN';
    const url = req.url ?? '/';

    console.warn(
      `${LOG_PREFIX} [${timestamp}] Invalid auth from ${ip} - ${method} ${url}: ${reason}`,
    );
  }
}
