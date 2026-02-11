import { useState, useRef, useCallback, useEffect } from "react";
import type { ChatMessage, StreamChunk, ToolCall } from "../lib/protocol";
import { generateId } from "../lib/utils";

const WS_URL = "ws://127.0.0.1:18789/ws";

interface UseStreamingOptions {
  onMessage?: (msg: ChatMessage) => void;
  onToolCall?: (tool: ToolCall) => void;
  onError?: (error: string) => void;
  onSessionUpdate?: (sessionId: string) => void;
}

export function useStreaming(options: UseStreamingOptions = {}) {
  const [connected, setConnected] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [activeTools, setActiveTools] = useState<ToolCall[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout>>();

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        setConnected(true);
        console.log("[ws] Connected to Gateway");
      };

      ws.onclose = () => {
        setConnected(false);
        setStreaming(false);
        console.log("[ws] Disconnected from Gateway");

        // Auto-reconnect after 3 seconds
        reconnectTimeout.current = setTimeout(() => {
          connect();
        }, 3000);
      };

      ws.onerror = (event) => {
        console.error("[ws] WebSocket error:", event);
        options.onError?.("WebSocket connection error");
      };

      ws.onmessage = (event) => {
        try {
          const chunk: StreamChunk = JSON.parse(event.data);
          handleChunk(chunk);
        } catch {
          console.error("[ws] Failed to parse message:", event.data);
        }
      };

      wsRef.current = ws;
    } catch (err) {
      console.error("[ws] Failed to connect:", err);
      reconnectTimeout.current = setTimeout(() => {
        connect();
      }, 3000);
    }
  }, []);

  const handleChunk = useCallback(
    (chunk: StreamChunk) => {
      switch (chunk.type) {
        case "text":
          setStreamingText((prev) => prev + (chunk.content || ""));
          break;

        case "tool_call":
          if (chunk.toolCall) {
            setActiveTools((prev) => [...prev, chunk.toolCall!]);
            options.onToolCall?.(chunk.toolCall);
          }
          break;

        case "tool_result":
          if (chunk.toolResult) {
            setActiveTools((prev) =>
              prev.map((t) =>
                t.id === chunk.toolResult?.toolCallId
                  ? { ...t, status: "completed" as const }
                  : t
              )
            );
          }
          break;

        case "done":
          setStreaming(false);
          if (streamingText || chunk.content) {
            const message: ChatMessage = {
              id: generateId(),
              role: "assistant",
              content: streamingText + (chunk.content || ""),
              timestamp: new Date().toISOString(),
              privacy: "local",
              toolCalls:
                activeTools.length > 0 ? [...activeTools] : undefined,
            };
            options.onMessage?.(message);
          }
          setStreamingText("");
          setActiveTools([]);
          if (chunk.session?.id) {
            options.onSessionUpdate?.(chunk.session.id);
          }
          break;

        case "compaction":
          // Session was compacted
          break;

        case "error":
          setStreaming(false);
          setStreamingText("");
          setActiveTools([]);
          options.onError?.(chunk.error || "Unknown streaming error");
          break;
      }
    },
    [streamingText, activeTools, options]
  );

  const sendMessage = useCallback(
    (message: string, sessionId?: string, model?: string) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        options.onError?.("Not connected to Gateway");
        return;
      }

      setStreaming(true);
      setStreamingText("");
      setActiveTools([]);

      const payload = {
        type: "chat",
        sessionId,
        message,
        model,
        stream: true,
      };

      wsRef.current.send(JSON.stringify(payload));
    },
    [options]
  );

  const disconnect = useCallback(() => {
    if (reconnectTimeout.current) {
      clearTimeout(reconnectTimeout.current);
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnected(false);
    setStreaming(false);
  }, []);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    connected,
    streaming,
    streamingText,
    activeTools,
    connect,
    disconnect,
    sendMessage,
  };
}
