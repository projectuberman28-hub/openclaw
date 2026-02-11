/**
 * Tests for Forge Sandbox (VM-based code isolation)
 *
 * Tests VM sandbox restrictions and Docker command generation.
 * Uses Node.js vm module to simulate the sandbox environment.
 */
import { describe, it, expect } from 'vitest';
import { createContext, runInNewContext, Script } from 'node:vm';

describe('Forge Sandbox', () => {
  // ---------------------------------------------------------------------------
  // VM sandbox blocks fs access
  // ---------------------------------------------------------------------------
  describe('VM sandbox blocks fs access', () => {
    it('throws when code tries to require fs', () => {
      const sandbox = createContext({
        console: { log: () => {} },
        Math,
        JSON,
        Date,
        Array,
        Object,
        String,
        Number,
        Boolean,
        Error,
        TypeError,
        RangeError,
        parseInt,
        parseFloat,
      });

      expect(() => {
        runInNewContext('require("fs")', sandbox);
      }).toThrow();
    });

    it('throws when code tries to access process', () => {
      const sandbox = createContext({
        Math,
        JSON,
      });

      expect(() => {
        runInNewContext('process.exit(0)', sandbox);
      }).toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // VM sandbox blocks child_process
  // ---------------------------------------------------------------------------
  describe('VM sandbox blocks child_process', () => {
    it('throws when code tries to require child_process', () => {
      const sandbox = createContext({
        Math,
        JSON,
      });

      expect(() => {
        runInNewContext('require("child_process")', sandbox);
      }).toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // VM sandbox blocks net/http
  // ---------------------------------------------------------------------------
  describe('VM sandbox blocks net/http', () => {
    it('throws when code tries to require net', () => {
      const sandbox = createContext({
        Math,
        JSON,
      });

      expect(() => {
        runInNewContext('require("net")', sandbox);
      }).toThrow();
    });

    it('throws when code tries to require http', () => {
      const sandbox = createContext({
        Math,
        JSON,
      });

      expect(() => {
        runInNewContext('require("http")', sandbox);
      }).toThrow();
    });

    it('throws when code tries to use fetch', () => {
      const sandbox = createContext({
        Math,
        JSON,
      });

      expect(() => {
        runInNewContext('fetch("http://example.com")', sandbox);
      }).toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // VM sandbox allows safe operations
  // ---------------------------------------------------------------------------
  describe('VM sandbox allows safe operations', () => {
    it('allows Math operations', () => {
      const sandbox = createContext({ Math });
      const result = runInNewContext('Math.sqrt(16)', sandbox);
      expect(result).toBe(4);
    });

    it('allows JSON operations', () => {
      const sandbox = createContext({ JSON });
      const result = runInNewContext('JSON.stringify({ a: 1 })', sandbox);
      expect(result).toBe('{"a":1}');
    });

    it('allows Date operations', () => {
      const sandbox = createContext({ Date });
      const result = runInNewContext('typeof new Date().getTime()', sandbox);
      expect(result).toBe('number');
    });

    it('allows array operations', () => {
      const sandbox = createContext({ Array, JSON });
      const result = runInNewContext('[1,2,3].map(x => x * 2)', sandbox);
      expect(result).toEqual([2, 4, 6]);
    });

    it('allows string operations', () => {
      const sandbox = createContext({});
      const result = runInNewContext('"hello".toUpperCase()', sandbox);
      expect(result).toBe('HELLO');
    });

    it('allows basic arithmetic', () => {
      const sandbox = createContext({});
      const result = runInNewContext('2 + 2 * 3', sandbox);
      expect(result).toBe(8);
    });
  });

  // ---------------------------------------------------------------------------
  // VM sandbox enforces timeout
  // ---------------------------------------------------------------------------
  describe('VM sandbox enforces timeout', () => {
    it('throws on infinite loops with timeout', () => {
      const sandbox = createContext({});
      const script = new Script('while(true) {}');

      expect(() => {
        script.runInContext(sandbox, { timeout: 100 });
      }).toThrow();
    });

    it('completes within timeout for fast code', () => {
      const sandbox = createContext({ Math });
      const script = new Script('Math.PI * 2');

      const result = script.runInContext(sandbox, { timeout: 1000 });
      expect(result).toBeCloseTo(Math.PI * 2);
    });
  });

  // ---------------------------------------------------------------------------
  // Docker command generation
  // ---------------------------------------------------------------------------
  describe('Docker command generation', () => {
    it('generates correct docker flags for sandboxed execution', () => {
      const imageName = 'alfred-forge-sandbox:latest';
      const skillPath = '/tmp/skill';
      const expectedFlags = [
        '--network none',
        '--read-only',
        '--memory 256m',
        '--cpus 0.5',
        '--pids-limit 50',
        '--no-new-privileges',
      ];

      const dockerCmd = buildDockerCommand(imageName, skillPath);

      for (const flag of expectedFlags) {
        expect(dockerCmd).toContain(flag);
      }
    });

    it('includes --rm flag for auto-cleanup', () => {
      const dockerCmd = buildDockerCommand('image', '/path');
      expect(dockerCmd).toContain('--rm');
    });

    it('includes volume mount for skill directory', () => {
      const dockerCmd = buildDockerCommand('image', '/tmp/skill');
      expect(dockerCmd).toContain('-v');
      expect(dockerCmd).toContain('/tmp/skill');
    });

    it('uses the correct image name', () => {
      const dockerCmd = buildDockerCommand('my-sandbox:v1', '/path');
      expect(dockerCmd).toContain('my-sandbox:v1');
    });
  });
});

/**
 * Helper: builds a Docker command string with security flags.
 * This simulates what the Forge scaffold would generate.
 */
function buildDockerCommand(image: string, skillPath: string): string {
  return [
    'docker run',
    '--rm',
    '--network none',
    '--read-only',
    '--memory 256m',
    '--cpus 0.5',
    '--pids-limit 50',
    '--no-new-privileges',
    `--tmpfs /tmp:rw,noexec,nosuid,size=64m`,
    `-v ${skillPath}:/skill:ro`,
    image,
    'node /skill/index.js',
  ].join(' ');
}
