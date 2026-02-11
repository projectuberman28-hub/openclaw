import { useState, useEffect } from "react";
import { Shield, RefreshCw, Eye, Lock, AlertTriangle } from "lucide-react";
import PrivacyScoreComponent from "../components/PrivacyScore";
import PrivacyBadge from "../components/PrivacyBadge";
import { tauriInvoke } from "../hooks/useTauri";
import type { PrivacyScore, AuditLogEntry } from "../lib/protocol";
import { formatRelativeTime } from "../lib/utils";

export default function Privacy() {
  const [score, setScore] = useState<PrivacyScore | null>(null);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [logLimit, setLogLimit] = useState(50);

  useEffect(() => {
    loadData();
  }, [logLimit]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [scoreData, logData] = await Promise.all([
        tauriInvoke<PrivacyScore>("get_privacy_score"),
        tauriInvoke<AuditLogEntry[]>("get_audit_log", { limit: logLimit }),
      ]);
      setScore(scoreData);
      setAuditLog(logData);
    } catch {
      // Gateway may not be connected
      setScore({
        score: 100,
        local_messages: 0,
        cloud_messages: 0,
        redacted_messages: 0,
        total_messages: 0,
        recommendations: ["All data stays local by default"],
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-batcave-text">
            Privacy Dashboard
          </h1>
          <p className="text-sm text-batcave-text-muted mt-1">
            Monitor and control your data privacy
          </p>
        </div>
        <button
          onClick={loadData}
          className="btn-ghost flex items-center gap-2 text-sm"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Score + stats row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Privacy score */}
        <div className="card p-6 flex flex-col items-center justify-center">
          <h3 className="text-sm font-semibold text-batcave-text mb-4">
            Privacy Score
          </h3>
          <PrivacyScoreComponent score={score?.score ?? 100} size="lg" />
        </div>

        {/* Stats */}
        <div className="card p-6 lg:col-span-2">
          <h3 className="text-sm font-semibold text-batcave-text mb-4">
            Data Routing Summary
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="text-center p-3 bg-batcave-tertiary rounded-lg">
              <div className="text-2xl font-bold text-batcave-success">
                {score?.local_messages ?? 0}
              </div>
              <div className="text-xs text-batcave-text-muted mt-1 flex items-center justify-center gap-1">
                <Lock className="w-3 h-3" />
                Local
              </div>
            </div>
            <div className="text-center p-3 bg-batcave-tertiary rounded-lg">
              <div className="text-2xl font-bold text-batcave-warning">
                {score?.redacted_messages ?? 0}
              </div>
              <div className="text-xs text-batcave-text-muted mt-1 flex items-center justify-center gap-1">
                <Eye className="w-3 h-3" />
                Redacted
              </div>
            </div>
            <div className="text-center p-3 bg-batcave-tertiary rounded-lg">
              <div className="text-2xl font-bold text-batcave-accent">
                {score?.cloud_messages ?? 0}
              </div>
              <div className="text-xs text-batcave-text-muted mt-1 flex items-center justify-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                Cloud
              </div>
            </div>
            <div className="text-center p-3 bg-batcave-tertiary rounded-lg">
              <div className="text-2xl font-bold text-batcave-text">
                {score?.total_messages ?? 0}
              </div>
              <div className="text-xs text-batcave-text-muted mt-1">Total</div>
            </div>
          </div>

          {/* Recommendations */}
          {score?.recommendations && score.recommendations.length > 0 && (
            <div className="mt-4">
              <h4 className="text-xs font-semibold text-batcave-text-muted uppercase mb-2">
                Recommendations
              </h4>
              <ul className="space-y-1">
                {score.recommendations.map((rec, i) => (
                  <li
                    key={i}
                    className="text-sm text-batcave-text-muted flex items-start gap-2"
                  >
                    <Shield className="w-3.5 h-3.5 text-batcave-info shrink-0 mt-0.5" />
                    {rec}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Audit log */}
      <div className="card">
        <div className="flex items-center justify-between px-4 py-3 border-b border-batcave-border">
          <h3 className="text-sm font-semibold text-batcave-text">Audit Log</h3>
          <select
            value={logLimit}
            onChange={(e) => setLogLimit(parseInt(e.target.value))}
            className="input-field text-xs py-1"
          >
            <option value="25">Last 25</option>
            <option value="50">Last 50</option>
            <option value="100">Last 100</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-batcave-border">
                <th className="text-left px-4 py-2 text-xs font-medium text-batcave-text-muted uppercase">
                  Time
                </th>
                <th className="text-left px-4 py-2 text-xs font-medium text-batcave-text-muted uppercase">
                  Action
                </th>
                <th className="text-left px-4 py-2 text-xs font-medium text-batcave-text-muted uppercase">
                  Source
                </th>
                <th className="text-left px-4 py-2 text-xs font-medium text-batcave-text-muted uppercase">
                  Destination
                </th>
                <th className="text-left px-4 py-2 text-xs font-medium text-batcave-text-muted uppercase">
                  Privacy
                </th>
              </tr>
            </thead>
            <tbody>
              {auditLog.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-8 text-center text-batcave-text-muted"
                  >
                    No audit log entries yet. Start using Alfred to see data
                    routing decisions.
                  </td>
                </tr>
              ) : (
                auditLog.map((entry, i) => (
                  <tr
                    key={i}
                    className="border-b border-batcave-border/50 hover:bg-batcave-hover transition-colors"
                  >
                    <td className="px-4 py-2 text-batcave-text-muted text-xs whitespace-nowrap">
                      {formatRelativeTime(entry.timestamp)}
                    </td>
                    <td className="px-4 py-2 text-batcave-text">
                      {entry.action}
                    </td>
                    <td className="px-4 py-2 text-batcave-text-muted font-mono text-xs">
                      {entry.source}
                    </td>
                    <td className="px-4 py-2 text-batcave-text-muted font-mono text-xs">
                      {entry.destination}
                    </td>
                    <td className="px-4 py-2">
                      <PrivacyBadge
                        level={entry.privacy_level as any}
                        showLabel
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
