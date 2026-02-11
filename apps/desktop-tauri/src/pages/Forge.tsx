import { useState, useEffect } from "react";
import {
  Hammer,
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
} from "lucide-react";
import { cn } from "../lib/utils";
import * as rpc from "../lib/gateway-rpc";
import type { ForgeJob } from "../lib/protocol";

export default function Forge() {
  const [jobs, setJobs] = useState<ForgeJob[]>([]);
  const [skillName, setSkillName] = useState("");
  const [description, setDescription] = useState("");
  const [building, setBuilding] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadStatus();
    const interval = setInterval(loadStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadStatus = async () => {
    setLoading(true);
    try {
      const data = await rpc.getForgeStatus();
      setJobs(
        data.queue?.map((j) => ({
          ...j,
          skillName: j.skillName,
          status: j.status as ForgeJob["status"],
          progress: j.progress,
        })) || []
      );
    } catch {
      // Gateway may not be connected
    } finally {
      setLoading(false);
    }
  };

  const handleBuild = async () => {
    if (!skillName.trim()) return;
    setBuilding(true);
    try {
      await rpc.triggerForge(skillName.trim());
      setSkillName("");
      setDescription("");
      await loadStatus();
    } catch (err) {
      console.error("Forge build failed:", err);
    } finally {
      setBuilding(false);
    }
  };

  const getStatusIcon = (status: ForgeJob["status"]) => {
    switch (status) {
      case "queued":
        return <Clock className="w-4 h-4 text-batcave-text-muted" />;
      case "building":
      case "testing":
        return (
          <Loader2 className="w-4 h-4 text-batcave-info animate-spin" />
        );
      case "completed":
        return <CheckCircle2 className="w-4 h-4 text-batcave-success" />;
      case "failed":
        return <XCircle className="w-4 h-4 text-batcave-accent" />;
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-batcave-text">Forge</h1>
          <p className="text-sm text-batcave-text-muted mt-1">
            Build new skills for Alfred using AI
          </p>
        </div>
        <button
          onClick={loadStatus}
          className="btn-ghost flex items-center gap-2 text-sm"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Build form */}
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-batcave-text mb-4 flex items-center gap-2">
          <Hammer className="w-5 h-5 text-batcave-accent" />
          Build New Skill
        </h2>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-batcave-text-muted block mb-1">
              Skill Name
            </label>
            <input
              type="text"
              value={skillName}
              onChange={(e) => setSkillName(e.target.value)}
              placeholder="e.g., weather-forecast"
              className="input-field w-full"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-batcave-text-muted block mb-1">
              Description (what should this skill do?)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what the skill should do..."
              rows={3}
              className="input-field w-full resize-none"
            />
          </div>

          <button
            onClick={handleBuild}
            disabled={!skillName.trim() || building}
            className="btn-primary flex items-center gap-2"
          >
            {building ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            {building ? "Building..." : "Start Build"}
          </button>
        </div>
      </div>

      {/* Build queue */}
      <div className="card">
        <div className="px-4 py-3 border-b border-batcave-border">
          <h2 className="text-sm font-semibold text-batcave-text">
            Build Queue
          </h2>
        </div>

        {jobs.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-batcave-text-muted">
            No builds in queue. Create a new skill above.
          </div>
        ) : (
          <div className="divide-y divide-batcave-border/50">
            {jobs.map((job) => (
              <div
                key={job.id}
                className="px-4 py-3 flex items-center gap-4 hover:bg-batcave-hover transition-colors"
              >
                {getStatusIcon(job.status)}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-batcave-text">
                      {job.skillName}
                    </span>
                    <span
                      className={cn(
                        "text-xs px-2 py-0.5 rounded-full",
                        job.status === "completed"
                          ? "bg-batcave-success/10 text-batcave-success"
                          : job.status === "failed"
                          ? "bg-batcave-accent/10 text-batcave-accent"
                          : job.status === "queued"
                          ? "bg-batcave-tertiary text-batcave-text-muted"
                          : "bg-batcave-info/10 text-batcave-info"
                      )}
                    >
                      {job.status}
                    </span>
                  </div>

                  {/* Progress bar */}
                  {(job.status === "building" || job.status === "testing") && (
                    <div className="w-full h-1.5 bg-batcave-tertiary rounded-full mt-2 overflow-hidden">
                      <div
                        className="h-full bg-batcave-info rounded-full transition-all duration-500"
                        style={{ width: `${job.progress}%` }}
                      />
                    </div>
                  )}

                  {job.error && (
                    <p className="text-xs text-batcave-accent mt-1">
                      {job.error}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
