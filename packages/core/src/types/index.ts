/**
 * @alfred/core - Type definitions using TypeBox schemas
 * All message, tool, agent, channel, session, health, privacy, and audit types.
 */

import { Type, type Static } from '@sinclair/typebox';

// ---------------------------------------------------------------------------
// Message
// ---------------------------------------------------------------------------

export const MessageRoleSchema = Type.Union([
  Type.Literal('user'),
  Type.Literal('assistant'),
  Type.Literal('system'),
  Type.Literal('tool'),
]);
export type MessageRole = Static<typeof MessageRoleSchema>;

export const ToolUseSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  arguments: Type.Record(Type.String(), Type.Unknown()),
});
export type ToolUse = Static<typeof ToolUseSchema>;

export const ToolResultBlockSchema = Type.Object({
  toolUseId: Type.String(),
  content: Type.Unknown(),
  isError: Type.Optional(Type.Boolean()),
});
export type ToolResultBlock = Static<typeof ToolResultBlockSchema>;

export const MessageSchema = Type.Object({
  role: MessageRoleSchema,
  content: Type.String(),
  toolUse: Type.Optional(Type.Array(ToolUseSchema)),
  toolResult: Type.Optional(Type.Array(ToolResultBlockSchema)),
  timestamp: Type.Number({ description: 'Unix epoch ms' }),
  sessionId: Type.String(),
});
export type Message = Static<typeof MessageSchema>;

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export const ToolDefinitionSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  description: Type.String(),
  parameters: Type.Record(Type.String(), Type.Unknown(), {
    description: 'JSON-Schema of the parameters object',
  }),
  timeout: Type.Optional(Type.Number({ minimum: 0, description: 'Timeout in ms' })),
});
export type ToolDefinition = Static<typeof ToolDefinitionSchema>;

export const ToolResultSchema = Type.Object({
  name: Type.String(),
  result: Type.Optional(Type.Unknown()),
  error: Type.Optional(Type.String()),
  durationMs: Type.Number({ minimum: 0 }),
});
export type ToolResult = Static<typeof ToolResultSchema>;

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export const AgentIdentitySchema = Type.Object({
  name: Type.String(),
  theme: Type.Optional(Type.String()),
  emoji: Type.Optional(Type.String()),
});
export type AgentIdentity = Static<typeof AgentIdentitySchema>;

export const AgentConfigSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  identity: AgentIdentitySchema,
  model: Type.String({ description: 'Format: provider/model' }),
  tools: Type.Array(Type.String()),
  subagent: Type.Boolean({ default: false }),
});
export type AgentConfig = Static<typeof AgentConfigSchema>;

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export const ModelConfigSchema = Type.Object({
  primary: Type.String({ description: 'Format: provider/model' }),
  fallbacks: Type.Array(Type.String(), { default: [] }),
});
export type ModelConfig = Static<typeof ModelConfigSchema>;

// ---------------------------------------------------------------------------
// Channel
// ---------------------------------------------------------------------------

export const AttachmentSchema = Type.Object({
  filename: Type.String(),
  mimeType: Type.String(),
  url: Type.Optional(Type.String()),
  data: Type.Optional(Type.String({ description: 'Base64-encoded data' })),
  size: Type.Optional(Type.Number()),
});
export type Attachment = Static<typeof AttachmentSchema>;

export const ChannelMessageSchema = Type.Object({
  channel: Type.String(),
  sender: Type.String(),
  content: Type.String(),
  attachments: Type.Optional(Type.Array(AttachmentSchema)),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});
export type ChannelMessage = Static<typeof ChannelMessageSchema>;

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export const SessionInfoSchema = Type.Object({
  id: Type.String(),
  agentId: Type.String(),
  channel: Type.String(),
  startedAt: Type.Number({ description: 'Unix epoch ms' }),
  messageCount: Type.Number({ minimum: 0 }),
  lastActivity: Type.Number({ description: 'Unix epoch ms' }),
});
export type SessionInfo = Static<typeof SessionInfoSchema>;

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export const HealthStatusEnum = Type.Union([
  Type.Literal('healthy'),
  Type.Literal('degraded'),
  Type.Literal('down'),
  Type.Literal('unknown'),
]);
export type HealthStatusLevel = Static<typeof HealthStatusEnum>;

export const HealthStatusSchema = Type.Object({
  service: Type.String(),
  status: HealthStatusEnum,
  lastCheck: Type.Number({ description: 'Unix epoch ms' }),
  details: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});
export type HealthStatus = Static<typeof HealthStatusSchema>;

// ---------------------------------------------------------------------------
// PII / Privacy
// ---------------------------------------------------------------------------

export const PIITypeSchema = Type.Union([
  Type.Literal('email'),
  Type.Literal('phone'),
  Type.Literal('ssn'),
  Type.Literal('credit_card'),
  Type.Literal('ip_address'),
  Type.Literal('name'),
  Type.Literal('address'),
  Type.Literal('date_of_birth'),
  Type.Literal('custom'),
]);
export type PIIType = Static<typeof PIITypeSchema>;

export const PIIDetectionSchema = Type.Object({
  type: PIITypeSchema,
  value: Type.String(),
  start: Type.Number({ minimum: 0 }),
  end: Type.Number({ minimum: 0 }),
  confidence: Type.Number({ minimum: 0, maximum: 1 }),
});
export type PIIDetection = Static<typeof PIIDetectionSchema>;

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export const AuditDirectionSchema = Type.Union([
  Type.Literal('outbound'),
  Type.Literal('inbound'),
]);
export type AuditDirection = Static<typeof AuditDirectionSchema>;

export const AuditEntrySchema = Type.Object({
  timestamp: Type.Number({ description: 'Unix epoch ms' }),
  provider: Type.String(),
  model: Type.String(),
  endpoint: Type.String(),
  direction: AuditDirectionSchema,
  piiDetected: Type.Boolean(),
  piiRedacted: Type.Boolean(),
  redactedTypes: Type.Array(PIITypeSchema),
  estimatedTokens: Type.Number({ minimum: 0 }),
  latencyMs: Type.Number({ minimum: 0 }),
  sessionId: Type.String(),
  channel: Type.String(),
  success: Type.Boolean(),
});
export type AuditEntry = Static<typeof AuditEntrySchema>;
