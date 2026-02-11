import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@alfred/core': path.resolve(__dirname, 'packages/core/src'),
      '@alfred/privacy': path.resolve(__dirname, 'packages/privacy/src'),
      '@alfred/memory': path.resolve(__dirname, 'packages/memory/src'),
      '@alfred/fallback': path.resolve(__dirname, 'packages/fallback/src'),
      '@alfred/agent': path.resolve(__dirname, 'packages/agent/src'),
      '@alfred/tools': path.resolve(__dirname, 'packages/tools/src'),
      '@alfred/forge': path.resolve(__dirname, 'packages/forge/src'),
      '@alfred/playbook': path.resolve(__dirname, 'packages/playbook/src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'apps'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'apps/',
        'test/',
        '**/*.test.ts',
        '**/*.d.ts',
      ],
    },
    testTimeout: 30000,
    hookTimeout: 30000,
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'e2e',
          include: ['test/e2e/**/*.test.ts'],
          testTimeout: 60000,
        },
      },
      {
        test: {
          name: 'security',
          include: ['test/security/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'smoke',
          include: ['test/smoke/**/*.ts'],
        },
      },
    ],
  },
});
