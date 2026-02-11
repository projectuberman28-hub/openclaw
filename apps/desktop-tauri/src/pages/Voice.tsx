import { useState } from "react";
import {
  Mic,
  Volume2,
  Settings,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import VoiceMode from "../components/VoiceMode";

export default function Voice() {
  const [voiceActive, setVoiceActive] = useState(false);
  const [continuous, setContinuous] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [ttsRate, setTtsRate] = useState(1.0);
  const [ttsPitch, setTtsPitch] = useState(1.0);

  const handleTranscript = (text: string) => {
    console.log("Voice transcript:", text);
    // Would send to chat
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-batcave-text">Voice</h1>
        <p className="text-sm text-batcave-text-muted mt-1">
          Voice interaction settings and controls
        </p>
      </div>

      {/* Voice activation */}
      <div className="card p-6 text-center">
        <div className="w-24 h-24 rounded-full bg-batcave-tertiary flex items-center justify-center mx-auto mb-4">
          <Mic className="w-10 h-10 text-batcave-text-muted" />
        </div>
        <h2 className="text-lg font-semibold text-batcave-text mb-2">
          Voice Mode
        </h2>
        <p className="text-sm text-batcave-text-muted mb-6">
          {continuous
            ? "Continuous listening mode - Alfred will listen until you stop"
            : "Push-to-talk mode - Hold Space key to speak"}
        </p>
        <button
          onClick={() => setVoiceActive(true)}
          className="btn-primary text-lg px-8 py-3 flex items-center gap-3 mx-auto"
        >
          <Mic className="w-5 h-5" />
          Start Voice Mode
        </button>
      </div>

      {/* Settings */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* STT Settings */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-batcave-text mb-4 flex items-center gap-2">
            <Mic className="w-4 h-4 text-batcave-accent" />
            Speech-to-Text
          </h3>

          <div className="space-y-4">
            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <span className="text-sm text-batcave-text block">
                  Continuous Mode
                </span>
                <span className="text-xs text-batcave-text-muted">
                  Keep listening after each utterance
                </span>
              </div>
              <button onClick={() => setContinuous(!continuous)}>
                {continuous ? (
                  <ToggleRight className="w-8 h-8 text-batcave-accent" />
                ) : (
                  <ToggleLeft className="w-8 h-8 text-batcave-text-muted" />
                )}
              </button>
            </label>

            <div className="p-3 bg-batcave-tertiary rounded-lg text-xs text-batcave-text-muted">
              {continuous
                ? "Alfred will keep listening until you manually stop. Good for extended conversations."
                : "Hold the Space key to talk. Release to send. Good for quick commands."}
            </div>
          </div>
        </div>

        {/* TTS Settings */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-batcave-text mb-4 flex items-center gap-2">
            <Volume2 className="w-4 h-4 text-batcave-info" />
            Text-to-Speech
          </h3>

          <div className="space-y-4">
            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <span className="text-sm text-batcave-text block">
                  Enable TTS
                </span>
                <span className="text-xs text-batcave-text-muted">
                  Read responses aloud
                </span>
              </div>
              <button onClick={() => setTtsEnabled(!ttsEnabled)}>
                {ttsEnabled ? (
                  <ToggleRight className="w-8 h-8 text-batcave-accent" />
                ) : (
                  <ToggleLeft className="w-8 h-8 text-batcave-text-muted" />
                )}
              </button>
            </label>

            <div>
              <label className="text-xs font-medium text-batcave-text-muted block mb-1">
                Speed ({ttsRate.toFixed(1)}x)
              </label>
              <input
                type="range"
                min="0.5"
                max="2"
                step="0.1"
                value={ttsRate}
                onChange={(e) => setTtsRate(parseFloat(e.target.value))}
                className="w-full accent-batcave-accent"
                disabled={!ttsEnabled}
              />
            </div>

            <div>
              <label className="text-xs font-medium text-batcave-text-muted block mb-1">
                Pitch ({ttsPitch.toFixed(1)})
              </label>
              <input
                type="range"
                min="0.5"
                max="2"
                step="0.1"
                value={ttsPitch}
                onChange={(e) => setTtsPitch(parseFloat(e.target.value))}
                className="w-full accent-batcave-accent"
                disabled={!ttsEnabled}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Voice mode overlay */}
      {voiceActive && (
        <VoiceMode
          onTranscript={handleTranscript}
          onClose={() => setVoiceActive(false)}
          continuous={continuous}
        />
      )}
    </div>
  );
}
