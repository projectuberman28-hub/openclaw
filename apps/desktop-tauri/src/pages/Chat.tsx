import { useState, useCallback, useEffect } from "react";
import { useParams } from "react-router-dom";
import { PanelLeftOpen, PanelLeftClose } from "lucide-react";
import ChatWindow from "../components/ChatWindow";
import MessageInput from "../components/MessageInput";
import SessionSidebar from "../components/SessionSidebar";
import { useStreaming } from "../hooks/useStreaming";
import type { ChatMessage } from "../lib/protocol";
import { generateId } from "../lib/utils";

export default function Chat() {
  const { sessionId: urlSessionId } = useParams();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | undefined>(urlSessionId);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleNewMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const handleSessionUpdate = useCallback((id: string) => {
    setSessionId(id);
  }, []);

  const handleError = useCallback((error: string) => {
    console.error("[chat] Error:", error);
  }, []);

  const {
    connected,
    streaming,
    streamingText,
    activeTools,
    connect,
    sendMessage: wsSend,
  } = useStreaming({
    onMessage: handleNewMessage,
    onError: handleError,
    onSessionUpdate: handleSessionUpdate,
  });

  // Connect to WebSocket on mount
  useEffect(() => {
    connect();
  }, [connect]);

  const handleSend = (text: string) => {
    // Add user message to local state immediately
    const userMessage: ChatMessage = {
      id: generateId(),
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
      privacy: "local",
    };
    setMessages((prev) => [...prev, userMessage]);

    // Send via WebSocket
    wsSend(text, sessionId);
  };

  const handleNewSession = () => {
    setMessages([]);
    setSessionId(undefined);
  };

  const handleSelectSession = async (id: string) => {
    setSessionId(id);
    // Load session messages from Gateway
    try {
      const resp = await fetch(`http://127.0.0.1:18789/api/sessions/${id}`);
      if (resp.ok) {
        const data = await resp.json();
        setMessages(
          data.messages?.map(
            (m: { role: string; content: string; timestamp: string }) => ({
              id: generateId(),
              role: m.role as ChatMessage["role"],
              content: m.content,
              timestamp: m.timestamp,
              privacy: "local" as const,
            })
          ) || []
        );
      }
    } catch {
      // ignore
    }
    setSidebarOpen(false);
  };

  return (
    <div className="flex h-full">
      {/* Session sidebar */}
      <SessionSidebar
        currentSessionId={sessionId}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Chat header */}
        <div className="h-12 flex items-center px-4 border-b border-batcave-border bg-batcave-secondary shrink-0">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="btn-ghost p-1.5 mr-2"
            title="Toggle sessions"
          >
            {sidebarOpen ? (
              <PanelLeftClose className="w-4 h-4" />
            ) : (
              <PanelLeftOpen className="w-4 h-4" />
            )}
          </button>

          <div className="flex items-center gap-2">
            <h1 className="text-sm font-semibold text-batcave-text">Chat</h1>
            {!connected && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-batcave-accent/10 text-batcave-accent">
                Disconnected
              </span>
            )}
            {streaming && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-batcave-info/10 text-batcave-info">
                Streaming...
              </span>
            )}
          </div>
        </div>

        {/* Messages */}
        <ChatWindow
          messages={messages}
          streamingText={streamingText}
          streaming={streaming}
          activeTools={activeTools}
        />

        {/* Input */}
        <MessageInput
          onSend={handleSend}
          disabled={streaming || !connected}
          placeholder={
            !connected
              ? "Connecting to Gateway..."
              : streaming
              ? "Alfred is thinking..."
              : "Message Alfred..."
          }
        />
      </div>
    </div>
  );
}
