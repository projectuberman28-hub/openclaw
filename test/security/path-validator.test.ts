/**
 * Tests for @alfred/core - Path Validator
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validatePath, sanitizePath, isWithinBase } from '@alfred/core/security';
import { join, resolve, sep } from 'node:path';

// Mock resolveAlfredHome so tests don't depend on the real home directory
vi.mock('@alfred/core/config/paths.js', () => ({
  resolveAlfredHome: () =>
    process.platform === 'win32'
      ? 'C:\\Users\\test\\.alfred'
      : '/home/test/.alfred',
}));

describe('Path Validator', () => {
  const alfredHome =
    process.platform === 'win32'
      ? 'C:\\Users\\test\\.alfred'
      : '/home/test/.alfred';

  // ---------------------------------------------------------------------------
  // validatePath rejects ".."
  // ---------------------------------------------------------------------------
  describe('Rejects ".." traversal', () => {
    it('rejects paths containing ".."', () => {
      expect(validatePath('../../etc/passwd')).toBe(false);
    });

    it('rejects paths with .. in middle segments', () => {
      expect(validatePath('workspace/../../../secret')).toBe(false);
    });

    it('rejects paths with mixed separators and ".."', () => {
      expect(validatePath('workspace\\..\\..\\secret')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // validatePath rejects absolute paths outside ALFRED_HOME
  // ---------------------------------------------------------------------------
  describe('Rejects absolute paths outside ALFRED_HOME', () => {
    it('rejects /etc/passwd', () => {
      if (process.platform !== 'win32') {
        expect(validatePath('/etc/passwd')).toBe(false);
      }
    });

    it('rejects paths outside ALFRED_HOME', () => {
      const outsidePath =
        process.platform === 'win32'
          ? 'C:\\Windows\\System32\\config'
          : '/var/log/syslog';
      expect(validatePath(outsidePath)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // validatePath rejects suspicious chars
  // ---------------------------------------------------------------------------
  describe('Rejects suspicious characters', () => {
    it('rejects null bytes', () => {
      expect(validatePath('file\0name')).toBe(false);
    });

    it('rejects URL-encoded null bytes', () => {
      expect(validatePath('file%00name')).toBe(false);
    });

    it('rejects URL-encoded traversal', () => {
      expect(validatePath('%2e%2e/etc/passwd')).toBe(false);
    });

    it('rejects carriage returns and newlines', () => {
      expect(validatePath('file\rname')).toBe(false);
      expect(validatePath('file\nname')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // validatePath accepts valid paths within ALFRED_HOME
  // ---------------------------------------------------------------------------
  describe('Accepts valid paths', () => {
    it('accepts relative paths without traversal', () => {
      expect(validatePath('workspace/project/file.txt')).toBe(true);
    });

    it('accepts simple filenames', () => {
      expect(validatePath('config.json')).toBe(true);
    });

    it('accepts paths within an allowed base', () => {
      const base = join(alfredHome, 'workspace');
      expect(validatePath('subdir/file.txt', base)).toBe(true);
    });

    it('accepts absolute paths within ALFRED_HOME', () => {
      const insidePath = join(alfredHome, 'workspace', 'data.json');
      expect(validatePath(insidePath)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // sanitizePath
  // ---------------------------------------------------------------------------
  describe('sanitizePath', () => {
    it('removes null bytes', () => {
      const result = sanitizePath('file\0name.txt');
      expect(result).not.toContain('\0');
    });

    it('removes URL-encoded null bytes', () => {
      const result = sanitizePath('file%00name.txt');
      expect(result).not.toContain('%00');
    });

    it('removes URL-encoded traversal sequences', () => {
      const result = sanitizePath('%2e%2e/etc/passwd');
      expect(result).not.toContain('%2e%2e');
      expect(result).not.toContain('..');
    });

    it('normalizes the path', () => {
      const result = sanitizePath('workspace/./subdir/file.txt');
      expect(result).not.toContain('/./');
    });

    it('removes ".." segments', () => {
      const result = sanitizePath('a/../b/file.txt');
      expect(result).not.toContain('..');
    });

    it('removes carriage returns and newlines', () => {
      const result = sanitizePath('file\r\nname.txt');
      expect(result).not.toContain('\r');
      expect(result).not.toContain('\n');
    });
  });

  // ---------------------------------------------------------------------------
  // isWithinBase
  // ---------------------------------------------------------------------------
  describe('isWithinBase', () => {
    it('returns true for paths within the base', () => {
      const base = join(alfredHome, 'workspace');
      expect(isWithinBase('subdir/file.txt', base)).toBe(true);
    });

    it('returns true for the base itself', () => {
      const base = join(alfredHome, 'workspace');
      expect(isWithinBase('.', base)).toBe(true);
    });

    it('returns false for paths that escape the base', () => {
      const base = join(alfredHome, 'workspace');
      expect(isWithinBase('../../etc/passwd', base)).toBe(false);
    });

    it('returns false for sibling directories (prefix match attack)', () => {
      const base = join(alfredHome, 'workspace');
      // workspace-evil should not be within workspace
      const evilPath = join(alfredHome, 'workspace-evil', 'file.txt');
      expect(isWithinBase(evilPath, base)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Empty and invalid input
  // ---------------------------------------------------------------------------
  describe('Edge cases', () => {
    it('rejects empty string', () => {
      expect(validatePath('')).toBe(false);
    });

    it('rejects whitespace-only string', () => {
      expect(validatePath('   ')).toBe(false);
    });
  });
});
