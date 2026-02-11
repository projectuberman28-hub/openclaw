/**
 * @alfred/core - Full TypeBox schema for alfred.json configuration
 *
 * Sections: agents, tools, channels, memory, privacy, forge, playbook, gateway, ui
 */

import { Type, type Static } from '@sinclair/typebox';

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

const IdentitySchema = Type.Object({
  name: Type.String({ default: 'Alfred' }),
  theme: Type.Optional(Type.String()),
  emoji: Type.Optional(Type.String()),
});

const AgentSchema = Type.Object({
  id: Type.String(),
  identity: IdentitySchema,
  model: Type.String({ description: 'Format: provider/model' }),
  contextWindow: Type.Optional(Type.Number({ minimum: 1024, default: 128000 })),
  maxTokens: Type.Optional(Type.Number({ minimum: 1 })),
  temperature: Type.Optional(Type.Number({ minimum: 0, maximum: 2, default: 0.7 })),
  systemPrompt: Type.Optional(Type.String()),
  tools: Type.Array(Type.String(), { default: [] }),
  subagent: Type.Boolean({ default: false }),
  fallbacks: Type.Optional(Type.Array(Type.String())),
});

const ToolSchema = Type.Object({
  name: Type.String(),
  enabled: Type.Boolean({ default: true }),
  timeout: Type.Optional(Type.Number({ minimum: 0, default: 30000 })),
  config: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

const ChannelSchema = Type.Object({
  name: Type.String(),
  type: Type.String({ description: 'Channel type identifier, e.g. cli, discord, matrix' }),
  enabled: Type.Boolean({ default: true }),
  config: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

const MemorySchema = Type.Object({
  backend: Type.String({ default: 'sqlite' }),
  path: Type.Optional(Type.String()),
  vectorStore: Type.Optional(
    Type.Object({
      enabled: Type.Boolean({ default: false }),
      model: Type.Optional(Type.String()),
      dimensions: Type.Optional(Type.Number({ minimum: 1 })),
    }),
  ),
  maxConversationHistory: Type.Number({ minimum: 1, default: 100 }),
  summarize: Type.Boolean({ default: true }),
  syncEnabled: Type.Boolean({ default: false }),
});

const PIIPatternSchema = Type.Object({
  name: Type.String(),
  pattern: Type.String({ description: 'Regular expression' }),
  replacement: Type.Optional(Type.String()),
});

const PrivacySchema = Type.Object({
  piiDetection: Type.Boolean({ default: true }),
  piiRedaction: Type.Boolean({ default: true }),
  customPatterns: Type.Array(PIIPatternSchema, { default: [] }),
  auditLog: Type.Boolean({ default: true }),
  auditPath: Type.Optional(Type.String()),
  localOnly: Type.Boolean({
    default: false,
    description: 'When true, never send data to external services',
  }),
  allowedEndpoints: Type.Array(Type.String(), { default: [] }),
  blockedEndpoints: Type.Array(Type.String(), { default: [] }),
});

const ForgeSchema = Type.Object({
  enabled: Type.Boolean({ default: true }),
  skillsDir: Type.Optional(Type.String()),
  autoInstall: Type.Boolean({ default: false }),
  registry: Type.Optional(Type.String()),
  sandbox: Type.Boolean({ default: true }),
});

const PlaybookSchema = Type.Object({
  enabled: Type.Boolean({ default: true }),
  dir: Type.Optional(Type.String()),
  autoDiscover: Type.Boolean({ default: true }),
  watchForChanges: Type.Boolean({ default: true }),
});

const GatewaySchema = Type.Object({
  enabled: Type.Boolean({ default: true }),
  host: Type.String({ default: '127.0.0.1' }),
  port: Type.Number({ minimum: 1, maximum: 65535, default: 18789 }),
  cors: Type.Optional(
    Type.Object({
      origins: Type.Array(Type.String(), { default: ['http://localhost:*'] }),
    }),
  ),
  rateLimit: Type.Optional(
    Type.Object({
      windowMs: Type.Number({ default: 60000 }),
      maxRequests: Type.Number({ default: 60 }),
    }),
  ),
  auth: Type.Optional(
    Type.Object({
      type: Type.Union([Type.Literal('none'), Type.Literal('token'), Type.Literal('mtls')], {
        default: 'none',
      }),
      token: Type.Optional(Type.String()),
    }),
  ),
});

const UISchema = Type.Object({
  enabled: Type.Boolean({ default: true }),
  theme: Type.String({ default: 'dark' }),
  port: Type.Optional(Type.Number({ minimum: 1, maximum: 65535 })),
  showTokenUsage: Type.Boolean({ default: true }),
  notificationsEnabled: Type.Boolean({ default: true }),
});

// ---------------------------------------------------------------------------
// Root config schema
// ---------------------------------------------------------------------------

export const AlfredConfigSchema = Type.Object({
  $schema: Type.Optional(Type.String()),
  version: Type.Number({ default: 3 }),
  agents: Type.Array(AgentSchema, { default: [] }),
  tools: Type.Array(ToolSchema, { default: [] }),
  channels: Type.Array(ChannelSchema, { default: [] }),
  memory: Type.Optional(MemorySchema),
  privacy: Type.Optional(PrivacySchema),
  forge: Type.Optional(ForgeSchema),
  playbook: Type.Optional(PlaybookSchema),
  gateway: Type.Optional(GatewaySchema),
  ui: Type.Optional(UISchema),
});

export type AlfredConfig = Static<typeof AlfredConfigSchema>;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_CONFIG: AlfredConfig = {
  version: 3,
  agents: [
    {
      id: 'alfred',
      identity: { name: 'Alfred', emoji: '🎩' },
      model: 'anthropic/claude-sonnet-4-20250514',
      contextWindow: 200000,
      maxTokens: 8192,
      temperature: 0.7,
      tools: [],
      subagent: false,
    },
  ],
  tools: [],
  channels: [],
  memory: {
    backend: 'sqlite',
    maxConversationHistory: 100,
    summarize: true,
    syncEnabled: false,
  },
  privacy: {
    piiDetection: true,
    piiRedaction: true,
    customPatterns: [],
    auditLog: true,
    localOnly: false,
    allowedEndpoints: [],
    blockedEndpoints: [],
  },
  forge: {
    enabled: true,
    autoInstall: false,
    sandbox: true,
  },
  playbook: {
    enabled: true,
    autoDiscover: true,
    watchForChanges: true,
  },
  gateway: {
    enabled: true,
    host: '127.0.0.1',
    port: 18789,
  },
  ui: {
    enabled: true,
    theme: 'dark',
    showTokenUsage: true,
    notificationsEnabled: true,
  },
};
