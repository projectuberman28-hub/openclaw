import { useState, useEffect } from "react";
import { MessageSquare, Search, Plus, Trash2, X } from "lucide-react";
import type { Session } from "../lib/protocol";
import { formatRelativeTime, cn } from "../lib/utils";
import * as rpc from "../lib/gateway-rpc";

interface SessionSidebarProps {
  currentSessionId?: string;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  open: boolean;
  onClose: () => void;
}

export default function SessionSidebar({
  currentSessionId,
  onSelectSession,
  onNewSession,
  open,
  onClose,
}: SessionSidebarProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      loadSessions();
    }
  }, [open]);

  const loadSessions = async () => {
    setLoading(true);
    try {
      const data = await rpc.listSessions();
      setSessions(
        data.map((s) => ({
          ...s,
          model: "",
          compacted: false,
        }))
      );
    } catch {
      // Gateway may not be connected
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await rpc.deleteSession(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
    } catch {
      // ignore
    }
  };

  const filtered = sessions.filter((s) =>
    s.title.toLowerCase().includes(search.toLowerCase())
  );

  if (!open) return null;

  return (
    <div className="w-72 bg-batcave-secondary border-r border-batcave-border flex flex-col h-full animate-slide-in-right">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-batcave-border">
        <h3 className="text-sm font-semibold text-batcave-text">Sessions</h3>
        <div className="flex items-center gap-1">
          <button
            onClick={onNewSession}
            className="p-1.5 rounded-lg text-batcave-text-muted hover:text-batcave-text hover:bg-batcave-hover transition-colors"
            title="New session"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-batcave-text-muted hover:text-batcave-text hover:bg-batcave-hover transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 py-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-batcave-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search sessions..."
            className="input-field w-full pl-8 py-1.5 text-xs"
          />
        </div>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-2 py-1">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-batcave-accent/30 border-t-batcave-accent rounded-full animate-spin" />
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="text-center py-8 text-xs text-batcave-text-muted">
            No sessions found
          </div>
        )}

        {filtered.map((session) => (
          <button
            key={session.id}
            onClick={() => onSelectSession(session.id)}
            className={cn(
              "w-full text-left px-3 py-2 rounded-lg mb-0.5 group transition-colors",
              currentSessionId === session.id
                ? "bg-batcave-accent/10 text-batcave-accent"
                : "text-batcave-text hover:bg-batcave-hover"
            )}
          >
            <div className="flex items-start gap-2">
              <MessageSquare className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{session.title}</p>
                <p className="text-xs text-batcave-text-muted mt-0.5">
                  {formatRelativeTime(session.updatedAt)} &middot;{" "}
                  {session.messageCount} msgs
                </p>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(session.id);
                }}
                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-batcave-accent/10 text-batcave-text-muted hover:text-batcave-accent transition-all"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
