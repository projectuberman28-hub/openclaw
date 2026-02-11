/**
 * @alfred/gateway - Wire Protocol
 *
 * Defines the message types exchanged over WebSocket between clients
 * (desktop UI, CLI, extensions) and the Alfred gateway server.
 *
 * All messages are serialized as JSON strings on the wire.
 */

// ---------------------------------------------------------------------------
// Client -> Server
// ---------------------------------------------------------------------------

export type ClientMessageType = 'chat' | 'command' | 'subscribe' | 'ping';

export interface ClientMessage {
  /** Message type discriminator. */
  type: ClientMessageType;
  /** Unique message ID for request/response correlation. */
  id: string;
  /** Type-specific payload. */
  payload: unknown;
}

export interface ChatPayload {
  content: string;
  sessionId?: string;
  agentId?: string;
  attachments?: Array<{ filename: string; mimeType: string; data: string }>;
}

export interface CommandPayload {
  command: string;
  args?: Record<string, unknown>;
}

export interface SubscribePayload {
  topics: string[];
}

// ---------------------------------------------------------------------------
// Server -> Client
// ---------------------------------------------------------------------------

export type ServerMessageType =
  | 'text'
  | 'tool_use'
  | 'tool_result'
  | 'thinking'
  | 'error'
  | 'done'
  | 'pong'
  | 'status';

export interface ServerMessage {
  /** Message type discriminator. */
  type: ServerMessageType;
  /** Correlation ID matching the originating ClientMessage.id. */
  id: string;
  /** Type-specific payload. */
  payload: unknown;
}

export interface TextPayload {
  text: string;
  /** True when this is a partial/streaming chunk. */
  partial?: boolean;
}

export interface ToolUsePayload {
  toolName: string;
  toolId: string;
  arguments: Record<string, unknown>;
}

export interface ToolResultPayload {
  toolId: string;
  result: unknown;
  isError?: boolean;
  durationMs: number;
}

export interface ThinkingPayload {
  content: string;
}

export interface ErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

export interface StatusPayload {
  service: string;
  status: 'healthy' | 'degraded' | 'down';
  details?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_CLIENT_TYPES = new Set<string>(['chat', 'command', 'subscribe', 'ping']);

const VALID_SERVER_TYPES = new Set<string>([
  'text', 'tool_use', 'tool_result', 'thinking',
  'error', 'done', 'pong', 'status',
]);

/**
 * Validate a parsed object as a ClientMessage.
 * Returns null if the object does not conform.
 */
function validateClientMessage(obj: Record<string, unknown>): ClientMessage | null {
  if (typeof obj['type'] !== 'string' || !VALID_CLIENT_TYPES.has(obj['type'])) {
    return null;
  }

  if (typeof obj['id'] !== 'string' || obj['id'].length === 0) {
    return null;
  }

  // payload may be anything (including undefined), but must be present as a key
  // We allow missing payload for 'ping'
  return {
    type: obj['type'] as ClientMessageType,
    id: obj['id'],
    payload: obj['payload'] ?? null,
  };
}

/**
 * Validate a parsed object as a ServerMessage.
 */
function validateServerMessage(obj: Record<string, unknown>): ServerMessage | null {
  if (typeof obj['type'] !== 'string' || !VALID_SERVER_TYPES.has(obj['type'])) {
    return null;
  }

  if (typeof obj['id'] !== 'string') {
    return null;
  }

  return {
    type: obj['type'] as ServerMessageType,
    id: obj['id'],
    payload: obj['payload'] ?? null,
  };
}

// ---------------------------------------------------------------------------
// Encode / Decode
// ---------------------------------------------------------------------------

/**
 * Encode a server or client message to a JSON string for the wire.
 */
export function encode(msg: ServerMessage | ClientMessage): string {
  return JSON.stringify(msg);
}

/**
 * Decode a raw wire string into a ClientMessage.
 * Returns null if the data is not valid JSON or fails validation.
 */
export function decode(data: string | Buffer): ClientMessage | null {
  try {
    const raw = typeof data === 'string' ? data : data.toString('utf-8');
    const parsed = JSON.parse(raw);

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }

    return validateClientMessage(parsed as Record<string, unknown>);
  } catch {
    return null;
  }
}

/**
 * Decode a raw wire string into a ServerMessage.
 * Returns null if the data is not valid JSON or fails validation.
 */
export function decodeServerMessage(data: string | Buffer): ServerMessage | null {
  try {
    const raw = typeof data === 'string' ? data : data.toString('utf-8');
    const parsed = JSON.parse(raw);

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }

    return validateServerMessage(parsed as Record<string, unknown>);
  } catch {
    return null;
  }
}

/**
 * Create a server message helper.
 */
export function serverMsg(type: ServerMessageType, id: string, payload: unknown): ServerMessage {
  return { type, id, payload };
}

/**
 * Create a client message helper.
 */
export function clientMsg(type: ClientMessageType, id: string, payload: unknown): ClientMessage {
  return { type, id, payload };
}
