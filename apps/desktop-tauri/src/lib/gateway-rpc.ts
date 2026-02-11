/** Gateway RPC client for agent management and other API calls */

const GATEWAY_BASE = "http://127.0.0.1:18789";

async function rpc<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const url = `${GATEWAY_BASE}${path}`;

  const options: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
    },
  };

  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  const resp = await fetch(url, options);

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Gateway RPC error (${resp.status}): ${text}`);
  }

  return resp.json() as Promise<T>;
}

// Session management
export async function listSessions() {
  return rpc<
    Array<{
      id: string;
      title: string;
      createdAt: string;
      updatedAt: string;
      messageCount: number;
    }>
  >("GET", "/api/sessions");
}

export async function getSession(id: string) {
  return rpc<{
    id: string;
    title: string;
    messages: Array<{
      role: string;
      content: string;
      timestamp: string;
    }>;
  }>("GET", `/api/sessions/${id}`);
}

export async function deleteSession(id: string) {
  return rpc<void>("DELETE", `/api/sessions/${id}`);
}

// Agent management
export async function listAgents() {
  return rpc<
    Array<{
      id: string;
      name: string;
      model: string;
      enabled: boolean;
      tools_count: number;
    }>
  >("GET", "/api/agents");
}

export async function createAgent(config: {
  name: string;
  model: string;
  system_prompt: string;
  temperature: number;
  max_tokens: number;
  tools: string[];
}) {
  return rpc<{ id: string; name: string }>("POST", "/api/agents", config);
}

export async function updateAgent(
  id: string,
  config: {
    name: string;
    model: string;
    system_prompt: string;
    temperature: number;
    max_tokens: number;
    tools: string[];
  }
) {
  return rpc<{ id: string; name: string }>(
    "PUT",
    `/api/agents/${id}`,
    config
  );
}

export async function deleteAgent(id: string) {
  return rpc<void>("DELETE", `/api/agents/${id}`);
}

// Skills management
export async function listSkills() {
  return rpc<
    Array<{
      id: string;
      name: string;
      description: string;
      category: string;
      enabled: boolean;
    }>
  >("GET", "/api/skills");
}

export async function toggleSkill(id: string, enabled: boolean) {
  return rpc<void>("PATCH", `/api/skills/${id}`, { enabled });
}

// Forge
export async function triggerForge(skillName: string) {
  return rpc<{ jobId: string }>("POST", "/api/forge/build", { skillName });
}

export async function getForgeStatus() {
  return rpc<{
    queue: Array<{
      id: string;
      skillName: string;
      status: string;
      progress: number;
    }>;
  }>("GET", "/api/forge/status");
}

// Tasks
export async function listTasks() {
  return rpc<
    Array<{
      id: string;
      name: string;
      cron: string;
      enabled: boolean;
      lastRun?: string;
      nextRun?: string;
    }>
  >("GET", "/api/tasks");
}

export async function createTask(task: {
  name: string;
  description: string;
  cron: string;
}) {
  return rpc<{ id: string }>("POST", "/api/tasks", task);
}

export async function deleteTask(id: string) {
  return rpc<void>("DELETE", `/api/tasks/${id}`);
}

export async function runTask(id: string) {
  return rpc<{ status: string }>("POST", `/api/tasks/${id}/run`);
}

// Health
export async function getHealth() {
  return rpc<{
    status: string;
    version: string;
    uptime: number;
  }>("GET", "/health");
}

// Playbook
export async function searchPlaybook(query: string) {
  return rpc<
    Array<{
      id: string;
      title: string;
      summary: string;
      category: string;
      score: number;
    }>
  >("GET", `/api/playbook/search?q=${encodeURIComponent(query)}`);
}

export async function getPlaybookStats() {
  return rpc<{
    totalStrategies: number;
    categories: Record<string, number>;
    lastUpdated: string;
  }>("GET", "/api/playbook/stats");
}
