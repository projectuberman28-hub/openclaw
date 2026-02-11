import { useState, useEffect } from "react";
import {
  CalendarClock,
  Plus,
  Play,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Clock,
  Loader2,
  X,
} from "lucide-react";
import { cn, formatRelativeTime } from "../lib/utils";
import * as rpc from "../lib/gateway-rpc";
import type { TaskSchedule } from "../lib/protocol";

export default function Tasks() {
  const [tasks, setTasks] = useState<TaskSchedule[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newTask, setNewTask] = useState({ name: "", description: "", cron: "" });
  const [loading, setLoading] = useState(false);
  const [runningTask, setRunningTask] = useState<string | null>(null);

  useEffect(() => {
    loadTasks();
  }, []);

  const loadTasks = async () => {
    setLoading(true);
    try {
      const data = await rpc.listTasks();
      setTasks(
        data.map((t) => ({
          ...t,
          description: "",
          status: "idle" as const,
          enabled: true,
        }))
      );
    } catch {
      // Gateway may not be connected
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!newTask.name.trim() || !newTask.cron.trim()) return;
    try {
      await rpc.createTask(newTask);
      setShowCreate(false);
      setNewTask({ name: "", description: "", cron: "" });
      await loadTasks();
    } catch (err) {
      console.error("Failed to create task:", err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await rpc.deleteTask(id);
      setTasks((prev) => prev.filter((t) => t.id !== id));
    } catch {
      // ignore
    }
  };

  const handleRun = async (id: string) => {
    setRunningTask(id);
    try {
      await rpc.runTask(id);
    } catch {
      // ignore
    } finally {
      setRunningTask(null);
    }
  };

  const toggleTask = (id: string) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, enabled: !t.enabled } : t))
    );
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-batcave-text">
            Scheduled Tasks
          </h1>
          <p className="text-sm text-batcave-text-muted mt-1">
            Manage recurring automated tasks
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="btn-primary flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          New Task
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="card p-5 animate-slide-up">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-batcave-text">
              Create New Task
            </h3>
            <button
              onClick={() => setShowCreate(false)}
              className="btn-ghost p-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-batcave-text-muted block mb-1">
                Name
              </label>
              <input
                type="text"
                value={newTask.name}
                onChange={(e) =>
                  setNewTask({ ...newTask, name: e.target.value })
                }
                placeholder="e.g., Daily news summary"
                className="input-field w-full"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-batcave-text-muted block mb-1">
                Description
              </label>
              <input
                type="text"
                value={newTask.description}
                onChange={(e) =>
                  setNewTask({ ...newTask, description: e.target.value })
                }
                placeholder="What should this task do?"
                className="input-field w-full"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-batcave-text-muted block mb-1">
                Cron Schedule
              </label>
              <input
                type="text"
                value={newTask.cron}
                onChange={(e) =>
                  setNewTask({ ...newTask, cron: e.target.value })
                }
                placeholder="e.g., 0 9 * * * (daily at 9 AM)"
                className="input-field w-full font-mono"
              />
              <p className="text-xs text-batcave-text-muted mt-1">
                Standard cron format: minute hour day month weekday
              </p>
            </div>
            <button
              onClick={handleCreate}
              disabled={!newTask.name.trim() || !newTask.cron.trim()}
              className="btn-primary"
            >
              Create Task
            </button>
          </div>
        </div>
      )}

      {/* Task list */}
      <div className="space-y-3">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-batcave-accent animate-spin" />
          </div>
        )}

        {!loading && tasks.length === 0 && (
          <div className="text-center py-12">
            <CalendarClock className="w-12 h-12 text-batcave-text-muted mx-auto mb-4 opacity-30" />
            <p className="text-batcave-text-muted">
              No scheduled tasks. Create one to automate recurring work.
            </p>
          </div>
        )}

        {tasks.map((task) => (
          <div key={task.id} className="card-hover p-4">
            <div className="flex items-start gap-4">
              <button
                onClick={() => toggleTask(task.id)}
                className="shrink-0 mt-0.5"
              >
                {task.enabled ? (
                  <ToggleRight className="w-8 h-8 text-batcave-accent" />
                ) : (
                  <ToggleLeft className="w-8 h-8 text-batcave-text-muted" />
                )}
              </button>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-sm font-semibold text-batcave-text">
                    {task.name}
                  </h3>
                  <span
                    className={cn(
                      "text-xs px-2 py-0.5 rounded-full",
                      task.status === "running"
                        ? "bg-batcave-info/10 text-batcave-info"
                        : task.status === "error"
                        ? "bg-batcave-accent/10 text-batcave-accent"
                        : "bg-batcave-tertiary text-batcave-text-muted"
                    )}
                  >
                    {task.status}
                  </span>
                </div>

                {task.description && (
                  <p className="text-xs text-batcave-text-muted mb-2">
                    {task.description}
                  </p>
                )}

                <div className="flex items-center gap-4 text-xs text-batcave-text-muted">
                  <span className="flex items-center gap-1 font-mono">
                    <Clock className="w-3 h-3" />
                    {task.cron}
                  </span>
                  {task.lastRun && (
                    <span>Last: {formatRelativeTime(task.lastRun)}</span>
                  )}
                  {task.nextRun && (
                    <span>Next: {formatRelativeTime(task.nextRun)}</span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => handleRun(task.id)}
                  disabled={runningTask === task.id}
                  className="btn-ghost p-1.5"
                  title="Run now"
                >
                  {runningTask === task.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4" />
                  )}
                </button>
                <button
                  onClick={() => handleDelete(task.id)}
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
