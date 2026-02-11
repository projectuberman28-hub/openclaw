/**
 * Tests for @alfred/core - LFI Guard
 */
import { describe, it, expect, vi } from 'vitest';
import { sanitizeMediaPath, isMediaPathSafe } from '@alfred/core/security';
import { join, resolve } from 'node:path';

// Mock resolveAlfredHome
vi.mock('@alfred/core/config/paths.js', () => ({
  resolveAlfredHome: () =>
    process.platform === 'win32'
      ? 'C:\\Users\\test\\.alfred'
      : '/home/test/.alfred',
}));

describe('LFI Guard', () => {
  const baseDir =
    process.platform === 'win32'
      ? 'C:\\Users\\test\\.alfred\\workspace\\media'
      : '/home/test/.alfred/workspace/media';

  // ---------------------------------------------------------------------------
  // sanitizeMediaPath blocks traversal
  // ---------------------------------------------------------------------------
  describe('sanitizeMediaPath blocks traversal', () => {
    it('returns null for paths with ".." traversal', () => {
      const result = sanitizeMediaPath('../../etc/passwd', baseDir);
      expect(result).toBeNull();
    });

    it('returns null for paths that would escape the base', () => {
      const result = sanitizeMediaPath('../../../secret.txt', baseDir);
      expect(result).toBeNull();
    });

    it('returns null for absolute paths outside the base', () => {
      const outsidePath =
        process.platform === 'win32'
          ? 'C:\\Windows\\System32\\cmd.exe'
          : '/etc/shadow';
      const result = sanitizeMediaPath(outsidePath, baseDir);
      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // allows valid paths within base
  // ---------------------------------------------------------------------------
  describe('allows valid paths within base', () => {
    it('accepts simple filenames', () => {
      const result = sanitizeMediaPath('photo.jpg', baseDir);
      expect(result).toBe(resolve(baseDir, 'photo.jpg'));
    });

    it('accepts nested paths within base', () => {
      const result = sanitizeMediaPath('albums/summer/pic.png', baseDir);
      expect(result).toBe(resolve(baseDir, 'albums', 'summer', 'pic.png'));
    });

    it('accepts paths with valid extensions', () => {
      const result = sanitizeMediaPath('doc.pdf', baseDir);
      expect(result).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // returns null for escaping paths
  // ---------------------------------------------------------------------------
  describe('returns null for escaping paths', () => {
    it('blocks paths that resolve outside the base directory', () => {
      const result = sanitizeMediaPath('../outside.txt', baseDir);
      expect(result).toBeNull();
    });

    it('blocks deeply nested traversal', () => {
      const result = sanitizeMediaPath('a/b/c/../../../../etc/passwd', baseDir);
      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // URL-encoded traversal attempts
  // ---------------------------------------------------------------------------
  describe('URL-encoded traversal', () => {
    it('blocks %2e%2e encoded traversal', () => {
      const result = sanitizeMediaPath('%2e%2e/etc/passwd', baseDir);
      expect(result).toBeNull();
    });

    it('blocks %2e%2e with mixed encoding', () => {
      const result = sanitizeMediaPath('%2e%2e/%2e%2e/secret', baseDir);
      expect(result).toBeNull();
    });

    it('blocks null byte injection %00', () => {
      const result = sanitizeMediaPath('image.jpg%00.exe', baseDir);
      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Blocked extensions
  // ---------------------------------------------------------------------------
  describe('Blocked extensions', () => {
    it('blocks .exe files by default', () => {
      const result = sanitizeMediaPath('malware.exe', baseDir);
      expect(result).toBeNull();
    });

    it('blocks .sh files by default', () => {
      const result = sanitizeMediaPath('script.sh', baseDir);
      expect(result).toBeNull();
    });

    it('blocks .bat files by default', () => {
      const result = sanitizeMediaPath('run.bat', baseDir);
      expect(result).toBeNull();
    });

    it('allows blocked extensions when allowBlockedExtensions is true', () => {
      const result = sanitizeMediaPath('script.sh', baseDir, {
        allowBlockedExtensions: true,
      });
      expect(result).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // isMediaPathSafe convenience function
  // ---------------------------------------------------------------------------
  describe('isMediaPathSafe', () => {
    it('returns true for safe paths', () => {
      expect(isMediaPathSafe('photo.jpg', baseDir)).toBe(true);
    });

    it('returns false for traversal paths', () => {
      expect(isMediaPathSafe('../../etc/passwd', baseDir)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------
  describe('Edge cases', () => {
    it('returns null for empty requested path', () => {
      expect(sanitizeMediaPath('', baseDir)).toBeNull();
    });

    it('returns null for empty base directory', () => {
      expect(sanitizeMediaPath('file.txt', '')).toBeNull();
    });

    it('returns null for whitespace-only paths', () => {
      expect(sanitizeMediaPath('   ', baseDir)).toBeNull();
    });
  });
});
