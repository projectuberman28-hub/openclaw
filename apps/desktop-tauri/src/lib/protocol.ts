/** Wire protocol types matching the Alfred Gateway */

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: string;
  privacy: PrivacyLevel;
  model?: string;
  toolCalls?: ToolCall[];
  toolResult?: ToolResult;
  tokens?: TokenUsage;
}

export type PrivacyLevel = "local" | "cloud-redacted" | "cloud";

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  status: "pending" | "running" | "completed" | "error";
}

export interface ToolResult {
  toolCallId: string;
  output: string;
  error?: string;
}

export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

export interface Session {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  model: string;
  compacted: boolean;
}

export interface StreamChunk {
  type: "text" | "tool_call" | "tool_result" | "error" | "done" | "compaction";
  content?: string;
  toolCall?: ToolCall;
  toolResult?: ToolResult;
  error?: string;
  session?: Session;
}

export interface SendMessageRequest {
  sessionId?: string;
  message: string;
  model?: string;
  tools?: string[];
  stream?: boolean;
}

export interface ServiceStatus {
  name: string;
  running: boolean;
  port: number | null;
  health: string;
  details?: string;
}

export interface SystemSnapshot {
  gpu: {
    name: string;
    vram_mb: number;
    driver_version: string;
    detected: boolean;
  };
  cpu: {
    name: string;
    cores: number;
    threads: number;
    usage_percent: number;
  };
  memory: {
    total_mb: number;
    used_mb: number;
    available_mb: number;
    usage_percent: number;
  };
  disk: {
    total_gb: number;
    used_gb: number;
    available_gb: number;
    usage_percent: number;
  };
  os: string;
  hostname: string;
}

export interface AgentConfig {
  id?: string;
  name: string;
  model: string;
  system_prompt: string;
  temperature: number;
  max_tokens: number;
  tools: string[];
  enabled: boolean;
}

export interface AgentInfo {
  id: string;
  name: string;
  model: string;
  enabled: boolean;
  tools_count: number;
  created_at: string;
}

export interface PrivacyScore {
  score: number;
  local_messages: number;
  cloud_messages: number;
  redacted_messages: number;
  total_messages: number;
  recommendations: string[];
}

export interface AuditLogEntry {
  timestamp: string;
  action: string;
  source: string;
  destination: string;
  data_type: string;
  privacy_level: string;
  details?: string;
}

export interface TaskSchedule {
  id: string;
  name: string;
  description: string;
  cron: string;
  enabled: boolean;
  lastRun?: string;
  nextRun?: string;
  status: "idle" | "running" | "error";
}

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  category: string;
  enabled: boolean;
  version: string;
  author: string;
}

export interface ForgeJob {
  id: string;
  skillName: string;
  status: "queued" | "building" | "testing" | "completed" | "failed";
  progress: number;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface DeviceInfo {
  id: string;
  name: string;
  type: "mobile" | "desktop" | "tablet";
  lastSeen: string;
  synced: boolean;
  paired: boolean;
}
