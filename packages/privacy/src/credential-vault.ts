/**
 * @alfred/privacy - Credential Vault
 *
 * AES-256-GCM encrypted credential storage.
 *
 * Vault file format: iv (16 bytes) + authTag (16 bytes) + encrypted data
 * Key file: generated on first run using Node.js crypto randomBytes.
 *
 * Supports $vault:key_name references that can be resolved at runtime.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32; // 256 bits

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CredentialVaultOptions {
  /** Base directory for vault storage. Defaults to ~/.alfred */
  alfredHome?: string;
}

interface VaultData {
  [key: string]: string;
}

// ---------------------------------------------------------------------------
// CredentialVault class
// ---------------------------------------------------------------------------

export class CredentialVault {
  private alfredHome: string;
  private vaultPath: string;
  private keyPath: string;
  private credentialsDir: string;

  constructor(options: CredentialVaultOptions = {}) {
    this.alfredHome = options.alfredHome ?? join(homedir(), '.alfred');
    this.credentialsDir = join(this.alfredHome, 'credentials');
    this.vaultPath = join(this.credentialsDir, 'vault.enc');
    this.keyPath = join(this.credentialsDir, 'key.age');
  }

  /**
   * Ensure the credentials directory exists.
   */
  private async ensureDir(): Promise<void> {
    await mkdir(this.credentialsDir, { recursive: true });
  }

  /**
   * Get or generate the encryption key.
   * Key is persisted to disk so vault can be reopened across sessions.
   */
  private async getKey(): Promise<Buffer> {
    try {
      const keyData = await readFile(this.keyPath);
      if (keyData.length === KEY_LENGTH) {
        return keyData;
      }
      // Invalid key file, regenerate
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }

    // Generate new key
    await this.ensureDir();
    const key = randomBytes(KEY_LENGTH);
    await writeFile(this.keyPath, key, { mode: 0o600 });
    return key;
  }

  /**
   * Encrypt data using AES-256-GCM.
   * Returns: iv (16) + authTag (16) + ciphertext
   */
  private encrypt(plaintext: string, key: Buffer): Buffer {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);

    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf-8'),
      cipher.final(),
    ]);

    const authTag = cipher.getAuthTag();

    // Format: iv + authTag + encrypted
    return Buffer.concat([iv, authTag, encrypted]);
  }

  /**
   * Decrypt data using AES-256-GCM.
   * Expects: iv (16) + authTag (16) + ciphertext
   */
  private decrypt(data: Buffer, key: Buffer): string {
    if (data.length < IV_LENGTH + AUTH_TAG_LENGTH) {
      throw new Error('Vault data is corrupted: too short');
    }

    const iv = data.subarray(0, IV_LENGTH);
    const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return decrypted.toString('utf-8');
  }

  /**
   * Read and decrypt the vault data. Returns empty object if vault doesn't exist.
   */
  private async readVault(): Promise<VaultData> {
    const key = await this.getKey();

    let rawData: Buffer;
    try {
      rawData = await readFile(this.vaultPath);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw err;
    }

    if (rawData.length === 0) return {};

    try {
      const json = this.decrypt(rawData, key);
      return JSON.parse(json) as VaultData;
    } catch (err) {
      throw new Error(`Failed to decrypt vault: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Encrypt and write the vault data to disk.
   */
  private async writeVault(data: VaultData): Promise<void> {
    await this.ensureDir();
    const key = await this.getKey();
    const json = JSON.stringify(data);
    const encrypted = this.encrypt(json, key);
    await writeFile(this.vaultPath, encrypted, { mode: 0o600 });
  }

  /**
   * Store a credential in the vault.
   * Strips embedded line breaks from the value before storing.
   */
  async store(key: string, value: string): Promise<void> {
    if (!key || typeof key !== 'string') {
      throw new Error('Credential key must be a non-empty string');
    }

    // Strip embedded line breaks from credential values
    const cleanValue = value.replace(/[\r\n]+/g, '');

    const vault = await this.readVault();
    vault[key] = cleanValue;
    await this.writeVault(vault);
  }

  /**
   * Retrieve a credential from the vault.
   * Returns null if the key doesn't exist.
   */
  async retrieve(key: string): Promise<string | null> {
    const vault = await this.readVault();
    return vault[key] ?? null;
  }

  /**
   * Delete a credential from the vault.
   */
  async delete(key: string): Promise<void> {
    const vault = await this.readVault();
    delete vault[key];
    await this.writeVault(vault);
  }

  /**
   * List all credential keys in the vault (not the values).
   */
  async list(): Promise<string[]> {
    const vault = await this.readVault();
    return Object.keys(vault);
  }

  /**
   * Resolve a $vault:key_name reference to its credential value.
   *
   * If the ref matches the pattern "$vault:key_name", retrieve that key.
   * Otherwise returns the ref unchanged.
   *
   * @throws Error if the vault key doesn't exist
   */
  async resolveVaultRef(ref: string): Promise<string> {
    const match = ref.match(/^\$vault:(.+)$/);
    if (!match) return ref;

    const key = match[1];
    const value = await this.retrieve(key);

    if (value === null) {
      throw new Error(`Vault key not found: ${key}`);
    }

    return value;
  }

  /**
   * Check if a string is a vault reference ($vault:...).
   */
  static isVaultRef(value: string): boolean {
    return /^\$vault:.+$/.test(value);
  }

  /**
   * Get paths used by this vault instance.
   */
  getPaths(): { vaultPath: string; keyPath: string; credentialsDir: string } {
    return {
      vaultPath: this.vaultPath,
      keyPath: this.keyPath,
      credentialsDir: this.credentialsDir,
    };
  }
}
