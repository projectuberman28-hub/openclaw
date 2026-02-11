import { useState, useEffect } from "react";
import {
  Zap,
  Search,
  ToggleLeft,
  ToggleRight,
  Hammer,
  RefreshCw,
  Tag,
} from "lucide-react";
import { cn } from "../lib/utils";
import * as rpc from "../lib/gateway-rpc";
import type { SkillInfo } from "../lib/protocol";

const defaultSkills: SkillInfo[] = [
  {
    id: "web-search",
    name: "Web Search",
    description: "Search the web using SearXNG for current information",
    category: "Research",
    enabled: true,
    version: "1.0.0",
    author: "Alfred Core",
  },
  {
    id: "code-exec",
    name: "Code Execution",
    description: "Execute code in sandboxed environments",
    category: "Development",
    enabled: true,
    version: "1.0.0",
    author: "Alfred Core",
  },
  {
    id: "file-ops",
    name: "File Operations",
    description: "Read, write, and manage files on the local filesystem",
    category: "System",
    enabled: true,
    version: "1.0.0",
    author: "Alfred Core",
  },
  {
    id: "calendar",
    name: "Calendar",
    description: "Manage calendar events and reminders",
    category: "Productivity",
    enabled: false,
    version: "1.0.0",
    author: "Alfred Core",
  },
  {
    id: "email",
    name: "Email",
    description: "Draft, send, and manage email messages",
    category: "Communication",
    enabled: false,
    version: "1.0.0",
    author: "Alfred Core",
  },
  {
    id: "data-analysis",
    name: "Data Analysis",
    description: "Analyze datasets, create charts, and extract insights",
    category: "Research",
    enabled: true,
    version: "1.0.0",
    author: "Alfred Core",
  },
];

export default function Skills() {
  const [skills, setSkills] = useState<SkillInfo[]>(defaultSkills);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("");

  const categories = [...new Set(skills.map((s) => s.category))];

  const filtered = skills.filter((skill) => {
    const matchesSearch =
      skill.name.toLowerCase().includes(search.toLowerCase()) ||
      skill.description.toLowerCase().includes(search.toLowerCase());
    const matchesCategory =
      !filterCategory || skill.category === filterCategory;
    return matchesSearch && matchesCategory;
  });

  const toggleSkill = (id: string) => {
    setSkills((prev) =>
      prev.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s))
    );
  };

  const enabledCount = skills.filter((s) => s.enabled).length;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-batcave-text">Skills</h1>
          <p className="text-sm text-batcave-text-muted mt-1">
            {enabledCount} of {skills.length} skills enabled
          </p>
        </div>
        <button
          onClick={() => {
            // Navigate to Forge
            window.location.hash = "#/forge";
          }}
          className="btn-primary flex items-center gap-2"
        >
          <Hammer className="w-4 h-4" />
          Open Forge
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-batcave-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search skills..."
            className="input-field w-full pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFilterCategory("")}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
              !filterCategory
                ? "bg-batcave-accent/10 text-batcave-accent"
                : "text-batcave-text-muted hover:text-batcave-text hover:bg-batcave-hover"
            )}
          >
            All
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() =>
                setFilterCategory(filterCategory === cat ? "" : cat)
              }
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                filterCategory === cat
                  ? "bg-batcave-accent/10 text-batcave-accent"
                  : "text-batcave-text-muted hover:text-batcave-text hover:bg-batcave-hover"
              )}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Skills grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((skill) => (
          <div key={skill.id} className="card-hover p-4">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    "w-10 h-10 rounded-lg flex items-center justify-center",
                    skill.enabled
                      ? "bg-batcave-accent/10 text-batcave-accent"
                      : "bg-batcave-tertiary text-batcave-text-muted"
                  )}
                >
                  <Zap className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-batcave-text">
                    {skill.name}
                  </h3>
                  <span className="text-xs text-batcave-text-muted flex items-center gap-1">
                    <Tag className="w-3 h-3" />
                    {skill.category}
                  </span>
                </div>
              </div>

              <button
                onClick={() => toggleSkill(skill.id)}
                className="shrink-0"
              >
                {skill.enabled ? (
                  <ToggleRight className="w-8 h-8 text-batcave-accent" />
                ) : (
                  <ToggleLeft className="w-8 h-8 text-batcave-text-muted" />
                )}
              </button>
            </div>

            <p className="text-xs text-batcave-text-muted mb-3">
              {skill.description}
            </p>

            <div className="flex items-center justify-between text-xs text-batcave-text-muted">
              <span>v{skill.version}</span>
              <span>{skill.author}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
