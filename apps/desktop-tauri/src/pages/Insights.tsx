import { useState, useEffect } from "react";
import {
  BarChart3,
  TrendingUp,
  MessageSquare,
  Clock,
  Hash,
  Brain,
  Calendar,
} from "lucide-react";
import Canvas from "../components/Canvas";

interface InsightsData {
  totalConversations: number;
  totalMessages: number;
  avgResponseTime: string;
  topTopics: Array<{ label: string; value: number }>;
  dailyActivity: Array<{ label: string; value: number }>;
  toolUsage: Array<{ name: string; count: number; percentage: number }>;
  patterns: string[];
}

const sampleData: InsightsData = {
  totalConversations: 0,
  totalMessages: 0,
  avgResponseTime: "0s",
  topTopics: [],
  dailyActivity: [
    { label: "Mon", value: 0 },
    { label: "Tue", value: 0 },
    { label: "Wed", value: 0 },
    { label: "Thu", value: 0 },
    { label: "Fri", value: 0 },
    { label: "Sat", value: 0 },
    { label: "Sun", value: 0 },
  ],
  toolUsage: [],
  patterns: [],
};

export default function Insights() {
  const [data, setData] = useState<InsightsData>(sampleData);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-batcave-text">Insights</h1>
        <p className="text-sm text-batcave-text-muted mt-1">
          Conversation intelligence and usage patterns
        </p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="card p-4">
          <div className="flex items-center gap-3 mb-2">
            <MessageSquare className="w-5 h-5 text-batcave-accent" />
            <span className="text-xs font-medium text-batcave-text-muted uppercase">
              Conversations
            </span>
          </div>
          <div className="text-2xl font-bold text-batcave-text">
            {data.totalConversations}
          </div>
        </div>

        <div className="card p-4">
          <div className="flex items-center gap-3 mb-2">
            <Hash className="w-5 h-5 text-batcave-info" />
            <span className="text-xs font-medium text-batcave-text-muted uppercase">
              Messages
            </span>
          </div>
          <div className="text-2xl font-bold text-batcave-text">
            {data.totalMessages}
          </div>
        </div>

        <div className="card p-4">
          <div className="flex items-center gap-3 mb-2">
            <Clock className="w-5 h-5 text-batcave-success" />
            <span className="text-xs font-medium text-batcave-text-muted uppercase">
              Avg Response
            </span>
          </div>
          <div className="text-2xl font-bold text-batcave-text">
            {data.avgResponseTime}
          </div>
        </div>

        <div className="card p-4">
          <div className="flex items-center gap-3 mb-2">
            <Brain className="w-5 h-5 text-batcave-warning" />
            <span className="text-xs font-medium text-batcave-text-muted uppercase">
              Patterns
            </span>
          </div>
          <div className="text-2xl font-bold text-batcave-text">
            {data.patterns.length}
          </div>
        </div>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Daily activity */}
        <div className="card">
          <div className="px-4 py-3 border-b border-batcave-border flex items-center gap-2">
            <Calendar className="w-4 h-4 text-batcave-text-muted" />
            <h3 className="text-sm font-semibold text-batcave-text">
              Daily Activity
            </h3>
          </div>
          <Canvas
            type="chart"
            data={data.dailyActivity}
          />
          {data.dailyActivity.every((d) => d.value === 0) && (
            <div className="px-4 pb-4 text-center text-sm text-batcave-text-muted">
              Start chatting to see activity data
            </div>
          )}
        </div>

        {/* Top topics */}
        <div className="card">
          <div className="px-4 py-3 border-b border-batcave-border flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-batcave-text-muted" />
            <h3 className="text-sm font-semibold text-batcave-text">
              Top Topics
            </h3>
          </div>
          {data.topTopics.length > 0 ? (
            <Canvas type="chart" data={data.topTopics} />
          ) : (
            <div className="px-4 py-8 text-center text-sm text-batcave-text-muted">
              No topics analyzed yet
            </div>
          )}
        </div>
      </div>

      {/* Tool usage */}
      <div className="card">
        <div className="px-4 py-3 border-b border-batcave-border flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-batcave-text-muted" />
          <h3 className="text-sm font-semibold text-batcave-text">
            Tool Usage
          </h3>
        </div>
        {data.toolUsage.length > 0 ? (
          <div className="p-4 space-y-3">
            {data.toolUsage.map((tool) => (
              <div key={tool.name} className="flex items-center gap-3">
                <span className="text-sm text-batcave-text w-32 truncate">
                  {tool.name}
                </span>
                <div className="flex-1 h-2 bg-batcave-tertiary rounded-full overflow-hidden">
                  <div
                    className="h-full bg-batcave-accent rounded-full"
                    style={{ width: `${tool.percentage}%` }}
                  />
                </div>
                <span className="text-xs text-batcave-text-muted w-16 text-right">
                  {tool.count} uses
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-4 py-8 text-center text-sm text-batcave-text-muted">
            No tool usage data yet. Tools will appear here once used in
            conversations.
          </div>
        )}
      </div>

      {/* Patterns */}
      <div className="card">
        <div className="px-4 py-3 border-b border-batcave-border flex items-center gap-2">
          <Brain className="w-4 h-4 text-batcave-text-muted" />
          <h3 className="text-sm font-semibold text-batcave-text">
            Detected Patterns
          </h3>
        </div>
        {data.patterns.length > 0 ? (
          <div className="p-4 space-y-2">
            {data.patterns.map((pattern, i) => (
              <div
                key={i}
                className="flex items-center gap-2 text-sm text-batcave-text"
              >
                <TrendingUp className="w-3.5 h-3.5 text-batcave-info shrink-0" />
                {pattern}
              </div>
            ))}
          </div>
        ) : (
          <div className="px-4 py-8 text-center text-sm text-batcave-text-muted">
            Alfred will identify conversation patterns as you interact more.
            Keep chatting!
          </div>
        )}
      </div>
    </div>
  );
}
