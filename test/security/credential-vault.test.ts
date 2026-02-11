/**
 * Tests for @alfred/privacy - Credential Vault
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CredentialVault } from '@alfred/privacy';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('CredentialVault', () => {
  let vault: CredentialVault;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'alfred-vault-test-'));
    vault = new CredentialVault({ alfredHome: tempDir });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // Store and retrieve roundtrip
  // ---------------------------------------------------------------------------
  describe('Store and retrieve', () => {
    it('stores and retrieves a credential by key', async () => {
      await vault.store('api_key', 'sk-test-12345');
      const value = await vault.retrieve('api_key');
      expect(value).toBe('sk-test-12345');
    });

    it('stores and retrieves multiple credentials', async () => {
      await vault.store('key1', 'value1');
      await vault.store('key2', 'value2');
      await vault.store('key3', 'value3');

      expect(await vault.retrieve('key1')).toBe('value1');
      expect(await vault.retrieve('key2')).toBe('value2');
      expect(await vault.retrieve('key3')).toBe('value3');
    });
  });

  // ---------------------------------------------------------------------------
  // Encrypted file format
  // ---------------------------------------------------------------------------
  describe('Encrypted file format', () => {
    it('vault file contains iv + authTag + encrypted data', async () => {
      await vault.store('secret', 'my-secret-value');

      const paths = vault.getPaths();
      const rawData = await readFile(paths.vaultPath);

      // iv = 16 bytes, authTag = 16 bytes, plus ciphertext
      expect(rawData.length).toBeGreaterThan(32);

      // The first 16 bytes are the IV
      const iv = rawData.subarray(0, 16);
      expect(iv.length).toBe(16);

      // Bytes 16-32 are the auth tag
      const authTag = rawData.subarray(16, 32);
      expect(authTag.length).toBe(16);

      // Remaining bytes are the ciphertext
      const ciphertext = rawData.subarray(32);
      expect(ciphertext.length).toBeGreaterThan(0);

      // The raw file should NOT contain plaintext
      const rawString = rawData.toString('utf-8');
      expect(rawString).not.toContain('my-secret-value');
    });
  });

  // ---------------------------------------------------------------------------
  // Key generation on first run
  // ---------------------------------------------------------------------------
  describe('Key generation', () => {
    it('generates a key file on first vault operation', async () => {
      await vault.store('test', 'value');

      const paths = vault.getPaths();
      const keyData = await readFile(paths.keyPath);
      // Key is 32 bytes (256 bits) for AES-256
      expect(keyData.length).toBe(32);
    });

    it('reuses the same key across operations', async () => {
      await vault.store('key1', 'val1');
      const paths = vault.getPaths();
      const key1 = await readFile(paths.keyPath);

      await vault.store('key2', 'val2');
      const key2 = await readFile(paths.keyPath);

      expect(Buffer.compare(key1, key2)).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Delete credential
  // ---------------------------------------------------------------------------
  describe('Delete credential', () => {
    it('deletes a credential by key', async () => {
      await vault.store('to-delete', 'secret');
      expect(await vault.retrieve('to-delete')).toBe('secret');

      await vault.delete('to-delete');
      expect(await vault.retrieve('to-delete')).toBeNull();
    });

    it('does not affect other credentials when deleting one', async () => {
      await vault.store('keep', 'keeper');
      await vault.store('remove', 'remover');

      await vault.delete('remove');

      expect(await vault.retrieve('keep')).toBe('keeper');
      expect(await vault.retrieve('remove')).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // List credentials (returns names, not values)
  // ---------------------------------------------------------------------------
  describe('List credentials', () => {
    it('returns an array of key names', async () => {
      await vault.store('alpha', 'value-a');
      await vault.store('beta', 'value-b');
      await vault.store('gamma', 'value-c');

      const keys = await vault.list();
      expect(keys).toContain('alpha');
      expect(keys).toContain('beta');
      expect(keys).toContain('gamma');
    });

    it('returns empty array when vault is empty', async () => {
      const keys = await vault.list();
      expect(keys).toEqual([]);
    });

    it('does not return credential values', async () => {
      await vault.store('secret-key', 'super-secret-value');
      const keys = await vault.list();
      expect(keys).not.toContain('super-secret-value');
    });
  });

  // ---------------------------------------------------------------------------
  // Line break stripping
  // ---------------------------------------------------------------------------
  describe('Line break stripping', () => {
    it('strips newlines from credential values', async () => {
      await vault.store('token', 'abc\ndef\nghi');
      const value = await vault.retrieve('token');
      expect(value).toBe('abcdefghi');
    });

    it('strips carriage returns from credential values', async () => {
      await vault.store('token', 'abc\r\ndef');
      const value = await vault.retrieve('token');
      expect(value).toBe('abcdef');
    });

    it('strips mixed line breaks', async () => {
      await vault.store('token', 'line1\nline2\r\nline3\rline4');
      const value = await vault.retrieve('token');
      expect(value).toBe('line1line2line3line4');
    });
  });

  // ---------------------------------------------------------------------------
  // resolveVaultRef
  // ---------------------------------------------------------------------------
  describe('resolveVaultRef', () => {
    it('resolves $vault:key_name references', async () => {
      await vault.store('my_api_key', 'sk-resolved');
      const resolved = await vault.resolveVaultRef('$vault:my_api_key');
      expect(resolved).toBe('sk-resolved');
    });

    it('returns non-vault refs unchanged', async () => {
      const result = await vault.resolveVaultRef('plain-string');
      expect(result).toBe('plain-string');
    });

    it('throws Error for non-existent vault key references', async () => {
      await expect(vault.resolveVaultRef('$vault:does_not_exist'))
        .rejects.toThrow('Vault key not found');
    });
  });

  // ---------------------------------------------------------------------------
  // Non-existent key returns null
  // ---------------------------------------------------------------------------
  describe('Non-existent key', () => {
    it('returns null when retrieving a non-existent key', async () => {
      const value = await vault.retrieve('no-such-key');
      expect(value).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Overwrite existing key
  // ---------------------------------------------------------------------------
  describe('Overwrite existing key', () => {
    it('overwrites the value of an existing key', async () => {
      await vault.store('key', 'original');
      expect(await vault.retrieve('key')).toBe('original');

      await vault.store('key', 'updated');
      expect(await vault.retrieve('key')).toBe('updated');
    });
  });

  // ---------------------------------------------------------------------------
  // isVaultRef static method
  // ---------------------------------------------------------------------------
  describe('isVaultRef', () => {
    it('returns true for $vault: prefixed strings', () => {
      expect(CredentialVault.isVaultRef('$vault:my_key')).toBe(true);
    });

    it('returns false for non-vault strings', () => {
      expect(CredentialVault.isVaultRef('not-a-vault-ref')).toBe(false);
      expect(CredentialVault.isVaultRef('')).toBe(false);
    });
  });
});
