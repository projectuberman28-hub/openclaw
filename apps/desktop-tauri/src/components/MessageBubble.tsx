import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import type { ChatMessage } from "../lib/protocol";
import PrivacyBadge from "./PrivacyBadge";
import CodeBlock from "./CodeBlock";
import { formatRelativeTime } from "../lib/utils";
import { User, Bot, Zap } from "lucide-react";

interface MessageBubbleProps {
  message: ChatMessage;
}

export default function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  const isTool = message.role === "tool";

  if (isSystem) {
    return (
      <div className="flex justify-center py-2">
        <span className="text-xs text-batcave-text-muted bg-batcave-tertiary px-3 py-1 rounded-full">
          {message.content}
        </span>
      </div>
    );
  }

  if (isTool) {
    return (
      <div className="py-1 px-3 ml-11">
        <div className="bg-batcave-tertiary border border-batcave-border rounded-lg p-3 text-sm">
          <span className="text-batcave-text-muted text-xs font-medium">
            Tool Result
          </span>
          <pre className="text-batcave-text text-xs mt-1 whitespace-pre-wrap font-mono">
            {message.content}
          </pre>
        </div>
      </div>
    );
  }

  return (
    <div className={`py-3 animate-fade-in ${isUser ? "" : ""}`}>
      <div className="flex gap-3">
        {/* Avatar */}
        <div
          className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
            isUser
              ? "bg-batcave-tertiary"
              : "bg-batcave-accent/20"
          }`}
        >
          {isUser ? (
            <User className="w-4 h-4 text-batcave-text-muted" />
          ) : (
            <span className="text-batcave-accent text-xs font-bold">A</span>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium text-batcave-text">
              {isUser ? "You" : "Alfred"}
            </span>
            <span className="text-xs text-batcave-text-muted">
              {formatRelativeTime(message.timestamp)}
            </span>
            <PrivacyBadge level={message.privacy} />
          </div>

          {/* Message content */}
          <div className="text-sm text-batcave-text leading-relaxed prose prose-invert prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-pre:my-2 prose-ul:my-1 prose-ol:my-1">
            <ReactMarkdown
              rehypePlugins={[rehypeHighlight]}
              components={{
                code({ className, children, ...props }) {
                  const match = /language-(\w+)/.exec(className || "");
                  const isInline = !match;

                  if (isInline) {
                    return (
                      <code
                        className="bg-batcave-tertiary px-1.5 py-0.5 rounded text-batcave-accent text-xs font-mono"
                        {...props}
                      >
                        {children}
                      </code>
                    );
                  }

                  return (
                    <CodeBlock
                      language={match?.[1] || "text"}
                      code={String(children).replace(/\n$/, "")}
                    />
                  );
                },
                pre({ children }) {
                  return <>{children}</>;
                },
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>

          {/* Tool calls */}
          {message.toolCalls && message.toolCalls.length > 0 && (
            <div className="mt-2 space-y-1">
              {message.toolCalls.map((tool) => (
                <div
                  key={tool.id}
                  className="flex items-center gap-2 text-xs text-batcave-text-muted"
                >
                  <Zap className="w-3 h-3" />
                  <span>Used {tool.name}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-xs ${
                      tool.status === "completed"
                        ? "bg-batcave-success/10 text-batcave-success"
                        : tool.status === "error"
                        ? "bg-batcave-accent/10 text-batcave-accent"
                        : "bg-batcave-warning/10 text-batcave-warning"
                    }`}
                  >
                    {tool.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

