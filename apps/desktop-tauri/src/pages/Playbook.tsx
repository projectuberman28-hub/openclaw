import { useState, useEffect } from "react";
import { BookOpen, Search, BarChart3, Tag, RefreshCw } from "lucide-react";
import * as rpc from "../lib/gateway-rpc";
import { cn } from "../lib/utils";

interface PlaybookEntry {
  id: string;
  title: string;
  summary: string;
  category: string;
  score: number;
}

interface PlaybookStats {
  totalStrategies: number;
  categories: Record<string, number>;
  lastUpdated: string;
}

export default function Playbook() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaybookEntry[]>([]);
  const [stats, setStats] = useState<PlaybookStats | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const data = await rpc.getPlaybookStats();
      setStats(data);
    } catch {
      // Gateway may not be connected
      setStats({
        totalStrategies: 0,
        categories: {},
        lastUpdated: new Date().toISOString(),
      });
    }
  };

  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const data = await rpc.searchPlaybook(query);
      setResults(data);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-batcave-text">Playbook</h1>
        <p className="text-sm text-batcave-text-muted mt-1">
          Search strategies and knowledge base
        </p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card p-4 text-center">
          <BookOpen className="w-6 h-6 text-batcave-accent mx-auto mb-2" />
          <div className="text-2xl font-bold text-batcave-text">
            {stats?.totalStrategies ?? 0}
          </div>
          <div className="text-xs text-batcave-text-muted">
            Total Strategies
          </div>
        </div>
        <div className="card p-4 text-center">
          <Tag className="w-6 h-6 text-batcave-info mx-auto mb-2" />
          <div className="text-2xl font-bold text-batcave-text">
            {stats ? Object.keys(stats.categories).length : 0}
          </div>
          <div className="text-xs text-batcave-text-muted">Categories</div>
        </div>
        <div className="card p-4 text-center">
          <BarChart3 className="w-6 h-6 text-batcave-success mx-auto mb-2" />
          <div className="text-2xl font-bold text-batcave-text">
            {results.length}
          </div>
          <div className="text-xs text-batcave-text-muted">Search Results</div>
        </div>
      </div>

      {/* Search bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-batcave-text-muted" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Search playbook strategies..."
            className="input-field w-full pl-9"
          />
        </div>
        <button
          onClick={handleSearch}
          disabled={!query.trim() || searching}
          className="btn-primary flex items-center gap-2"
        >
          {searching ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : (
            <Search className="w-4 h-4" />
          )}
          Search
        </button>
      </div>

      {/* Category breakdown */}
      {stats && Object.keys(stats.categories).length > 0 && (
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-batcave-text mb-3">
            Categories
          </h3>
          <div className="flex flex-wrap gap-2">
            {Object.entries(stats.categories).map(([cat, count]) => (
              <button
                key={cat}
                onClick={() => {
                  setQuery(cat);
                  handleSearch();
                }}
                className="px-3 py-1.5 bg-batcave-tertiary rounded-lg text-xs text-batcave-text hover:bg-batcave-hover transition-colors flex items-center gap-1.5"
              >
                <span>{cat}</span>
                <span className="text-batcave-text-muted">({count})</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-batcave-text">
            Results ({results.length})
          </h3>
          {results.map((entry) => (
            <div key={entry.id} className="card-hover p-4">
              <div className="flex items-start justify-between mb-2">
                <h4 className="text-sm font-semibold text-batcave-text">
                  {entry.title}
                </h4>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-batcave-tertiary text-batcave-text-muted">
                    {entry.category}
                  </span>
                  <span className="text-xs text-batcave-text-muted">
                    Score: {(entry.score * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
              <p className="text-sm text-batcave-text-muted">
                {entry.summary}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {results.length === 0 && query && !searching && (
        <div className="text-center py-12">
          <BookOpen className="w-12 h-12 text-batcave-text-muted mx-auto mb-4 opacity-30" />
          <p className="text-batcave-text-muted">
            No strategies found for &quot;{query}&quot;
          </p>
        </div>
      )}
    </div>
  );
}
