import { useEffect } from "react";
import { Mic, MicOff, Volume2, VolumeX, X } from "lucide-react";
import { useVoice } from "../hooks/useVoice";
import { cn } from "../lib/utils";

interface VoiceModeProps {
  onTranscript: (text: string) => void;
  onClose: () => void;
  continuous?: boolean;
}

export default function VoiceMode({
  onTranscript,
  onClose,
  continuous = false,
}: VoiceModeProps) {
  const {
    listening,
    speaking,
    transcript,
    supported,
    startListening,
    stopListening,
    stopSpeaking,
  } = useVoice({
    continuous,
    onSpeechEnd: (text) => {
      if (text.trim()) {
        onTranscript(text.trim());
      }
    },
  });

  // Space key for push-to-talk
  useEffect(() => {
    if (continuous) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat && !listening) {
        e.preventDefault();
        startListening();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        stopListening();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [continuous, listening, startListening, stopListening]);

  if (!supported) {
    return (
      <div className="fixed inset-0 bg-batcave-primary/90 backdrop-blur-sm flex items-center justify-center z-50">
        <div className="card p-8 text-center max-w-sm">
          <MicOff className="w-12 h-12 text-batcave-accent mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-batcave-text mb-2">
            Voice Not Supported
          </h3>
          <p className="text-sm text-batcave-text-muted mb-4">
            Your browser does not support the Web Speech API.
          </p>
          <button onClick={onClose} className="btn-primary">
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-batcave-primary/90 backdrop-blur-sm flex flex-col items-center justify-center z-50">
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-6 right-6 p-2 rounded-lg text-batcave-text-muted hover:text-batcave-text hover:bg-batcave-hover transition-colors"
      >
        <X className="w-6 h-6" />
      </button>

      {/* Voice visualization */}
      <div className="relative mb-8">
        <div
          className={cn(
            "w-32 h-32 rounded-full flex items-center justify-center transition-all",
            listening
              ? "bg-batcave-accent/20 ring-4 ring-batcave-accent/40 animate-pulse"
              : speaking
              ? "bg-batcave-info/20 ring-4 ring-batcave-info/40"
              : "bg-batcave-tertiary"
          )}
        >
          {listening ? (
            <Mic className="w-12 h-12 text-batcave-accent" />
          ) : speaking ? (
            <Volume2 className="w-12 h-12 text-batcave-info" />
          ) : (
            <Mic className="w-12 h-12 text-batcave-text-muted" />
          )}
        </div>

        {/* Ripple effect when listening */}
        {listening && (
          <>
            <div className="absolute inset-0 rounded-full border-2 border-batcave-accent/30 animate-ping" />
            <div
              className="absolute inset-0 rounded-full border-2 border-batcave-accent/20 animate-ping"
              style={{ animationDelay: "0.5s" }}
            />
          </>
        )}
      </div>

      {/* Status text */}
      <h2 className="text-xl font-semibold text-batcave-text mb-2">
        {listening
          ? "Listening..."
          : speaking
          ? "Speaking..."
          : "Ready"}
      </h2>

      {/* Transcript */}
      {transcript && (
        <p className="text-sm text-batcave-text-muted max-w-md text-center mb-6">
          {transcript}
        </p>
      )}

      {/* Controls */}
      <div className="flex items-center gap-4">
        {!continuous && (
          <p className="text-sm text-batcave-text-muted">
            Hold <kbd className="px-2 py-0.5 bg-batcave-tertiary rounded text-xs font-mono">Space</kbd> to talk
          </p>
        )}

        {continuous && (
          <button
            onClick={listening ? stopListening : startListening}
            className={cn(
              "px-6 py-3 rounded-xl font-medium transition-all",
              listening
                ? "bg-batcave-accent text-white"
                : "bg-batcave-tertiary text-batcave-text hover:bg-batcave-hover"
            )}
          >
            {listening ? "Stop Listening" : "Start Listening"}
          </button>
        )}

        {speaking && (
          <button
            onClick={stopSpeaking}
            className="px-4 py-2 rounded-lg bg-batcave-tertiary text-batcave-text-muted hover:text-batcave-text transition-colors"
          >
            <VolumeX className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>
  );
}
