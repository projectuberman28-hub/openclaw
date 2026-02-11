import { useRef, useEffect, useState } from "react";
import type { ChatMessage, ToolCall } from "../lib/protocol";
import MessageBubble from "./MessageBubble";
import StreamingText from "./StreamingText";
import ToolUseIndicator from "./ToolUseIndicator";
import CompactionDivider from "./CompactionDivider";

interface ChatWindowProps {
  messages: ChatMessage[];
  streamingText: string;
  streaming: boolean;
  activeTools: ToolCall[];
}

export default function ChatWindow({
  messages,
  streamingText,
  streaming,
  activeTools,
}: ChatWindowProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Smart auto-scroll: don't scroll if user has scrolled up
  const handleScroll = () => {
    const container = containerRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
    setAutoScroll(isNearBottom);
  };

  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, streamingText, autoScroll]);

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto px-4 py-6"
    >
      <div className="max-w-3xl mx-auto space-y-1">
        {messages.length === 0 && !streaming && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-batcave-accent/10 flex items-center justify-center mb-4">
              <span className="text-3xl font-bold text-batcave-accent">A</span>
            </div>
            <h2 className="text-xl font-semibold text-batcave-text mb-2">
              How can I assist you?
            </h2>
            <p className="text-batcave-text-muted max-w-md">
              Ask me anything. I can help with research, coding, analysis,
              writing, and much more. All conversations stay private on your
              machine.
            </p>
          </div>
        )}

        {messages.map((msg, index) => {
          const prevMsg = index > 0 ? messages[index - 1] : null;
          const showCompaction =
            prevMsg && msg.role === "system" && msg.content.includes("compacted");

          return (
            <div key={msg.id}>
              {showCompaction && <CompactionDivider />}
              <MessageBubble message={msg} />
            </div>
          );
        })}

        {/* Active tool calls */}
        {activeTools.map((tool) => (
          <ToolUseIndicator key={tool.id} tool={tool} />
        ))}

        {/* Streaming response */}
        {streaming && streamingText && (
          <div className="py-3">
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-lg bg-batcave-accent/20 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-batcave-accent text-xs font-bold">A</span>
              </div>
              <div className="flex-1 min-w-0">
                <StreamingText text={streamingText} />
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
