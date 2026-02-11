/**
 * Tests for @alfred/privacy - Data Boundary
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { DataBoundary } from '@alfred/privacy';
import { join } from 'node:path';

describe('DataBoundary', () => {
  let boundary: DataBoundary;
  const alfredHome = process.platform === 'win32' ? 'C:\\Users\\test\\.alfred' : '/home/test/.alfred';

  beforeEach(() => {
    boundary = new DataBoundary({ alfredHome });
  });

  // ---------------------------------------------------------------------------
  // isPathSafe - allows ALFRED_HOME paths
  // ---------------------------------------------------------------------------
  describe('isPathSafe allows ALFRED_HOME paths', () => {
    it('allows paths within ALFRED_HOME', () => {
      const testPath = join(alfredHome, 'workspace', 'project', 'file.txt');
      expect(boundary.isPathSafe(testPath)).toBe(true);
    });

    it('allows paths in workspace subdirectory', () => {
      const testPath = join(alfredHome, 'workspace', 'data.json');
      expect(boundary.isPathSafe(testPath)).toBe(true);
    });

    it('allows ALFRED_HOME root itself', () => {
      const testPath = join(alfredHome, 'alfred.json');
      expect(boundary.isPathSafe(testPath)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // isPathSafe - blocks credential paths
  // ---------------------------------------------------------------------------
  describe('isPathSafe blocks credential paths', () => {
    it('blocks paths inside credentials directory', () => {
      const testPath = join(alfredHome, 'credentials', 'vault.enc');
      expect(boundary.isPathSafe(testPath)).toBe(false);
    });

    it('blocks vault.enc file directly', () => {
      const testPath = join(alfredHome, 'credentials', 'vault.enc');
      expect(boundary.isPathSafe(testPath)).toBe(false);
    });

    it('blocks key.age file', () => {
      const testPath = join(alfredHome, 'credentials', 'key.age');
      expect(boundary.isPathSafe(testPath)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // isSyncSafe - blocks sensitive files
  // ---------------------------------------------------------------------------
  describe('isSyncSafe blocks sensitive file types', () => {
    it('blocks .key files', () => {
      const testPath = join(alfredHome, 'workspace', 'server.key');
      expect(boundary.isSyncSafe(testPath)).toBe(false);
    });

    it('blocks .pem files', () => {
      const testPath = join(alfredHome, 'workspace', 'cert.pem');
      expect(boundary.isSyncSafe(testPath)).toBe(false);
    });

    it('blocks .env files', () => {
      const testPath = join(alfredHome, 'workspace', '.env');
      expect(boundary.isSyncSafe(testPath)).toBe(false);
    });

    it('blocks .env.local files (prefix match)', () => {
      const testPath = join(alfredHome, 'workspace', '.env.local');
      expect(boundary.isSyncSafe(testPath)).toBe(false);
    });

    it('allows safe file types for sync', () => {
      const testPath = join(alfredHome, 'workspace', 'data.json');
      expect(boundary.isSyncSafe(testPath)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // validateToolArgs blocks file_read on vault.enc
  // ---------------------------------------------------------------------------
  describe('validateToolArgs', () => {
    it('blocks tool args that reference vault.enc', () => {
      const result = boundary.validateToolArgs('file_read', {
        filepath: join(alfredHome, 'credentials', 'vault.enc'),
      });
      expect(result.safe).toBe(false);
      expect(result.reason).toBeDefined();
    });

    it('blocks tool args referencing credentials directory', () => {
      const result = boundary.validateToolArgs('file_read', {
        path: join(alfredHome, 'credentials', 'key.age'),
      });
      expect(result.safe).toBe(false);
    });

    it('allows tool args referencing safe paths', () => {
      const result = boundary.validateToolArgs('file_read', {
        path: join(alfredHome, 'workspace', 'readme.md'),
      });
      expect(result.safe).toBe(true);
    });

    it('blocks paths outside ALFRED_HOME in path-like args', () => {
      const outsidePath = process.platform === 'win32' ? 'C:\\etc\\passwd' : '/etc/passwd';
      const result = boundary.validateToolArgs('file_read', {
        path: outsidePath,
      });
      expect(result.safe).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Path traversal blocked
  // ---------------------------------------------------------------------------
  describe('Path traversal prevention', () => {
    it('blocks ../../etc/passwd traversal', () => {
      const traversalPath = join(alfredHome, '..', '..', 'etc', 'passwd');
      expect(boundary.isPathSafe(traversalPath)).toBe(false);
    });

    it('blocks paths that normalize outside ALFRED_HOME', () => {
      const traversalPath = join(alfredHome, 'workspace', '..', '..', 'etc', 'shadow');
      expect(boundary.isPathSafe(traversalPath)).toBe(false);
    });

    it('blocks paths entirely outside ALFRED_HOME', () => {
      const outsidePath = process.platform === 'win32' ? 'C:\\Windows\\System32\\config' : '/etc/shadow';
      expect(boundary.isPathSafe(outsidePath)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Utility methods
  // ---------------------------------------------------------------------------
  describe('Utility methods', () => {
    it('getAlfredHome returns the configured home directory', () => {
      expect(boundary.getAlfredHome()).toBe(join(alfredHome));
    });

    it('getAllowedPrefixes returns ALFRED_HOME and workspace', () => {
      const prefixes = boundary.getAllowedPrefixes();
      expect(prefixes.length).toBeGreaterThanOrEqual(2);
    });
  });
});
