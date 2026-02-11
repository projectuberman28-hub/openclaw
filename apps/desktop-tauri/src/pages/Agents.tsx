import { useState, useEffect } from "react";
import {
  Bot,
  Plus,
  Pencil,
  Trash2,
  X,
  Loader2,
  Zap,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import { cn } from "../lib/utils";
import { tauriInvoke } from "../hooks/useTauri";
import ModelPicker from "../components/ModelPicker";
import type { AgentConfig, AgentInfo } from "../lib/protocol";

const emptyAgent: AgentConfig = {
  name: "",
  model: "",
  system_prompt: "",
  temperature: 0.7,
  max_tokens: 4096,
  tools: [],
  enabled: true,
};

export default function Agents() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [editing, setEditing] = useState<AgentConfig | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadAgents();
  }, []);

  const loadAgents = async () => {
    setLoading(true);
    try {
      const data = await tauriInvoke<AgentInfo[]>("list_agents");
      setAgents(data);
    } catch {
      // Gateway may not be connected
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = () => {
    setEditing({ ...emptyAgent });
    setIsNew(true);
  };

  const handleEdit = (agent: AgentInfo) => {
    setEditing({
      id: agent.id,
      name: agent.name,
      model: agent.model,
      system_prompt: "",
      temperature: 0.7,
      max_tokens: 4096,
      tools: [],
      enabled: agent.enabled,
    });
    setIsNew(false);
  };

  const handleSave = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      if (isNew) {
        await tauriInvoke<AgentInfo>("create_agent", { config: editing });
      } else if (editing.id) {
        await tauriInvoke<AgentInfo>("update_agent", {
          id: editing.id,
          config: editing,
        });
      }
      setEditing(null);
      await loadAgents();
    } catch (err) {
      console.error("Failed to save agent:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await tauriInvoke<string>("delete_agent", { id });
      setAgents((prev) => prev.filter((a) => a.id !== id));
    } catch {
      // ignore
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-batcave-text">Agents</h1>
          <p className="text-sm text-batcave-text-muted mt-1">
            Manage specialized AI agents
          </p>
        </div>
        <button
          onClick={handleCreate}
          className="btn-primary flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          New Agent
        </button>
      </div>

      {/* Editor */}
      {editing && (
        <div className="card p-5 animate-slide-up">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-batcave-text">
              {isNew ? "Create Agent" : "Edit Agent"}
            </h3>
            <button
              onClick={() => setEditing(null)}
              className="btn-ghost p-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-batcave-text-muted block mb-1">
                Name
              </label>
              <input
                type="text"
                value={editing.name}
                onChange={(e) =>
                  setEditing({ ...editing, name: e.target.value })
                }
                placeholder="e.g., Research Assistant"
                className="input-field w-full"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-batcave-text-muted block mb-1">
                Model
              </label>
              <ModelPicker
                value={editing.model}
                onChange={(model) => setEditing({ ...editing, model })}
              />
            </div>

            <div>
              <label className="text-xs font-medium text-batcave-text-muted block mb-1">
                System Prompt
              </label>
              <textarea
                value={editing.system_prompt}
                onChange={(e) =>
                  setEditing({ ...editing, system_prompt: e.target.value })
                }
                placeholder="Instructions for this agent's behavior..."
                rows={4}
                className="input-field w-full resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-batcave-text-muted block mb-1">
                  Temperature ({editing.temperature})
                </label>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={editing.temperature}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      temperature: parseFloat(e.target.value),
                    })
                  }
                  className="w-full accent-batcave-accent"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-batcave-text-muted block mb-1">
                  Max Tokens
                </label>
                <input
                  type="number"
                  value={editing.max_tokens}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      max_tokens: parseInt(e.target.value) || 4096,
                    })
                  }
                  className="input-field w-full"
                />
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={!editing.name.trim() || saving}
                className="btn-primary flex items-center gap-2"
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : null}
                {isNew ? "Create" : "Save"}
              </button>
              <button
                onClick={() => setEditing(null)}
                className="btn-secondary"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Agents list */}
      <div className="space-y-3">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-batcave-accent animate-spin" />
          </div>
        )}

        {!loading && agents.length === 0 && !editing && (
          <div className="text-center py-12">
            <Bot className="w-12 h-12 text-batcave-text-muted mx-auto mb-4 opacity-30" />
            <p className="text-batcave-text-muted mb-4">
              No agents configured. Create one to get started.
            </p>
            <button onClick={handleCreate} className="btn-primary">
              Create Agent
            </button>
          </div>
        )}

        {agents.map((agent) => (
          <div key={agent.id} className="card-hover p-4">
            <div className="flex items-center gap-4">
              <div
                className={cn(
                  "w-10 h-10 rounded-lg flex items-center justify-center",
                  agent.enabled
                    ? "bg-batcave-accent/10 text-batcave-accent"
                    : "bg-batcave-tertiary text-batcave-text-muted"
                )}
              >
                <Bot className="w-5 h-5" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-batcave-text">
                    {agent.name}
                  </h3>
                  {agent.enabled ? (
                    <ToggleRight className="w-5 h-5 text-batcave-accent" />
                  ) : (
                    <ToggleLeft className="w-5 h-5 text-batcave-text-muted" />
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-batcave-text-muted mt-0.5">
                  <span className="font-mono">{agent.model}</span>
                  <span className="flex items-center gap-1">
                    <Zap className="w-3 h-3" />
                    {agent.tools_count} tools
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleEdit(agent)}
                  className="btn-ghost p-1.5"
                  title="Edit"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDelete(agent.id)}
                  className="btn-ghost p-1.5 text-batcave-text-muted hover:text-batcave-accent"
                  title="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
