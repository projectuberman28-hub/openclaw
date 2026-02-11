import { useState, useRef, useEffect } from "react";
import { Send, Paperclip, Mic } from "lucide-react";
import { cn } from "../lib/utils";

interface MessageInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
  onVoiceClick?: () => void;
}

export default function MessageInput({
  onSend,
  disabled = false,
  placeholder = "Message Alfred...",
  onVoiceClick,
}: MessageInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = Math.min(textarea.scrollHeight, 200) + "px";
    }
  }, [value]);

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t border-batcave-border bg-batcave-secondary px-4 py-3">
      <div className="max-w-3xl mx-auto">
        <div className="relative flex items-end gap-2 bg-batcave-tertiary border border-batcave-border rounded-xl px-3 py-2 focus-within:border-batcave-accent/50 focus-within:ring-1 focus-within:ring-batcave-accent/20 transition-all">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
            className={cn(
              "flex-1 bg-transparent text-batcave-text text-sm resize-none outline-none",
              "placeholder-batcave-text-muted min-h-[24px] max-h-[200px]",
              "disabled:opacity-50"
            )}
          />

          <div className="flex items-center gap-1 shrink-0 pb-0.5">
            {onVoiceClick && (
              <button
                onClick={onVoiceClick}
                className="p-1.5 rounded-lg text-batcave-text-muted hover:text-batcave-text hover:bg-batcave-hover transition-colors"
                title="Voice input"
              >
                <Mic className="w-4 h-4" />
              </button>
            )}

            <button
              onClick={handleSend}
              disabled={!value.trim() || disabled}
              className={cn(
                "p-1.5 rounded-lg transition-all",
                value.trim() && !disabled
                  ? "bg-batcave-accent text-white hover:bg-batcave-accent-hover"
                  : "text-batcave-text-muted cursor-not-allowed"
              )}
              title="Send message"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
        <p className="text-xs text-batcave-text-muted/50 mt-1.5 text-center">
          Press Enter to send, Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
