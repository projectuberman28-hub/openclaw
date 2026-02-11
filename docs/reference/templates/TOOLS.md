# Available Tools Reference

## Overview

Tools are capabilities that Alfred can invoke during a conversation to interact with the system, retrieve information, or perform actions. Each tool has a defined schema, permission requirements, and security constraints. Tools are executed through the Safe Executor, which enforces timeouts, resource limits, and sandboxing.

## Built-in Tools

### web-search

Performs a privacy-respecting web search using the local SearXNG instance with cloud fallback to Grok search (with inline citations).

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | Search query string |
| `numResults` | number | no | Number of results to return (default: 10, max: 50) |
| `engines` | string[] | no | Specific search engines to use (default: all configured) |
| `timeRange` | string | no | Time filter: `day`, `week`, `month`, `year` |
| `language` | string | no | Language code for results (default: user's locale) |

**Security:**
- Query is not PII-redacted (it is the user's explicit intent)
- Results are fetched through SSRF guard
- Cloud fallback (Grok) goes through Privacy Gate

**Example:**
```json
{
  "tool": "web-search",
  "params": {
    "query": "TypeScript 5.7 new features",
    "numResults": 5,
    "timeRange": "month"
  }
}
```

### exec

Executes a shell command on the host system. Requires user approval for commands that modify the filesystem or have side effects.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `command` | string | yes | Shell command to execute |
| `cwd` | string | no | Working directory (default: `~/.alfred/workspace`) |
| `timeout` | number | no | Timeout in milliseconds (default: 30000) |
| `approval` | string | no | Pre-approval token for previously approved commands |

**Security:**
- Path validation prevents traversal outside allowed directories
- LFI guard prevents reading sensitive system files
- Commands displayed in monospace for user review before execution
- Approval flow: Alfred presents the command, user approves, command executes
- Commands in `~/.alfred/workspace` have relaxed approval for read-only operations

**Example:**
```json
{
  "tool": "exec",
  "params": {
    "command": "git log --oneline -10",
    "cwd": "/home/user/projects/myapp"
  }
}
```

### file-read

Reads the contents of a file from the filesystem.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | yes | Absolute or workspace-relative file path |
| `encoding` | string | no | File encoding (default: `utf-8`) |
| `lineStart` | number | no | Start reading from this line (1-indexed) |
| `lineEnd` | number | no | Stop reading at this line (inclusive) |

**Security:**
- Path validator ensures the path is within allowed directories
- LFI guard blocks reading of sensitive files (`/etc/shadow`, credential files, etc.)
- Binary files are detected and reported rather than read as text

### file-write

Writes content to a file on the filesystem.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | yes | Absolute or workspace-relative file path |
| `content` | string | yes | Content to write |
| `mode` | string | no | `"overwrite"` (default), `"append"`, or `"create"` (fails if file exists) |
| `encoding` | string | no | File encoding (default: `utf-8`) |

**Security:**
- Path validator prevents writing outside allowed directories
- Cannot overwrite system files or files in `~/.alfred/credentials/`
- Write operations outside workspace require user approval

### http-request

Makes an HTTP request to an external URL.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | yes | Target URL |
| `method` | string | no | HTTP method (default: `GET`) |
| `headers` | object | no | Request headers |
| `body` | string | no | Request body |
| `timeout` | number | no | Timeout in milliseconds (default: 15000) |

**Security:**
- SSRF guard validates the URL against blocklists (private IPs, internal services, cloud metadata endpoints)
- Privacy Gate applies if the URL is to a known cloud service
- Response size is capped at 10MB
- Redirects are followed but re-validated at each hop

### memory-search

Searches Alfred's persistent memory using semantic vector search and keyword matching.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | Natural language search query |
| `limit` | number | no | Maximum results (default: 10) |
| `timeRange` | object | no | `{ after, before }` ISO date strings for temporal filtering |
| `category` | string | no | Memory category filter: `conversation`, `fact`, `preference`, `procedure` |
| `minRelevance` | number | no | Minimum relevance score (0.0 - 1.0, default: 0.5) |

**Security:**
- Memory search is local-only and never touches cloud services
- Results are filtered by the current agent's memory access permissions

### memory-store

Stores a new memory entry for future retrieval.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `content` | string | yes | Memory content to store |
| `category` | string | no | Category: `conversation`, `fact`, `preference`, `procedure` (default: `fact`) |
| `tags` | string[] | no | Tags for keyword-based retrieval |
| `importance` | number | no | Importance score (0.0 - 1.0, default: 0.5) |

### playbook-query

Queries the Playbook operational memory for learned procedures and preferences.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | Natural language query about how to do something |
| `type` | string | no | Entry type: `procedure`, `preference`, `decision` |
| `limit` | number | no | Maximum results (default: 5) |

### playbook-record

Records a new operational entry in the Playbook.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `content` | string | yes | What was learned or decided |
| `type` | string | yes | Entry type: `procedure`, `preference`, `decision` |
| `source` | string | no | Reference to the conversation or event that produced this entry |
| `confidence` | number | no | Confidence score (0.0 - 1.0, default: 0.8) |

## Skill Tools

Each loaded skill can register additional tools. Skill tools follow the same schema and security model as built-in tools but are loaded dynamically. Skill tools are namespaced by their skill ID to avoid collisions:

```json
{
  "tool": "pdf-extract:extract",
  "params": {
    "path": "/tmp/report.pdf",
    "pages": "1-5"
  }
}
```

See each skill's `SKILL.md` for its tool definitions.

## Tool Configuration

### Per-Agent Tool Access

Tools are enabled per-agent in the agent configuration:

```json
{
  "tools": ["web-search", "exec", "file-read", "file-write", "memory-search"]
}
```

An empty `tools` array means the agent has no tool access. Omitting the `tools` field enables the default tool set: `["web-search", "file-read", "memory-search", "playbook-query"]`.

### Tool Approval Modes

Tools that perform side effects (exec, file-write, http-request) support configurable approval modes:

| Mode | Description |
|------|-------------|
| `always` | Always require user approval (default for exec) |
| `first` | Require approval on first use per session, then auto-approve similar commands |
| `trusted` | Auto-approve for trusted directories/URLs, require approval elsewhere |
| `never` | Never require approval (use with caution) |

Configuration in `~/.alfred/alfred.json`:

```json
{
  "tools": {
    "exec": {
      "approvalMode": "trusted",
      "trustedDirs": ["~/.alfred/workspace", "~/projects"]
    },
    "file-write": {
      "approvalMode": "first"
    }
  }
}
```

## Safe Executor

All tool calls pass through the Safe Executor, which enforces:

- **Timeout**: Default 30 seconds, configurable per tool (max 5 minutes)
- **Output size**: Response truncated at 100KB with a note about truncation
- **Concurrency**: Maximum 5 concurrent tool calls per agent
- **Resource limits**: CPU and memory caps for exec-type tools
- **Retry policy**: Transient failures retried up to 3 times with exponential backoff
- **Audit trail**: Every tool call logged with parameters, result summary, and duration
