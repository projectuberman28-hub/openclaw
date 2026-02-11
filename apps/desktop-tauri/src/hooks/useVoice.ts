import { useState, useCallback, useRef, useEffect } from "react";

interface UseVoiceOptions {
  onTranscript?: (text: string) => void;
  onSpeechEnd?: (finalText: string) => void;
  continuous?: boolean;
  language?: string;
}

interface UseVoiceReturn {
  listening: boolean;
  speaking: boolean;
  transcript: string;
  supported: boolean;
  startListening: () => void;
  stopListening: () => void;
  speak: (text: string) => void;
  stopSpeaking: () => void;
}

/** Web Speech API STT + SpeechSynthesis TTS hook */
export function useVoice(options: UseVoiceOptions = {}): UseVoiceReturn {
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [transcript, setTranscript] = useState("");
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const synthRef = useRef<SpeechSynthesis | null>(null);

  const supported =
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  useEffect(() => {
    if (typeof window !== "undefined") {
      synthRef.current = window.speechSynthesis;
    }
  }, []);

  const startListening = useCallback(() => {
    if (!supported) return;

    const SpeechRecognition =
      window.SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();

    recognition.continuous = options.continuous ?? false;
    recognition.interimResults = true;
    recognition.lang = options.language ?? "en-US";

    recognition.onstart = () => {
      setListening(true);
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interimTranscript = "";
      let finalTranscript = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        } else {
          interimTranscript += result[0].transcript;
        }
      }

      const currentText = finalTranscript || interimTranscript;
      setTranscript(currentText);
      options.onTranscript?.(currentText);
    };

    recognition.onend = () => {
      setListening(false);
      if (transcript) {
        options.onSpeechEnd?.(transcript);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error("[voice] Recognition error:", event.error);
      setListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [supported, options, transcript]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setListening(false);
  }, []);

  const speak = useCallback((text: string) => {
    if (!synthRef.current) return;

    // Cancel any ongoing speech
    synthRef.current.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    // Try to find a good voice
    const voices = synthRef.current.getVoices();
    const preferred = voices.find(
      (v) =>
        v.name.includes("Natural") ||
        v.name.includes("Enhanced") ||
        v.name.includes("Google")
    );
    if (preferred) {
      utterance.voice = preferred;
    }

    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);

    synthRef.current.speak(utterance);
  }, []);

  const stopSpeaking = useCallback(() => {
    if (synthRef.current) {
      synthRef.current.cancel();
    }
    setSpeaking(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopListening();
      stopSpeaking();
    };
  }, [stopListening, stopSpeaking]);

  return {
    listening,
    speaking,
    transcript,
    supported,
    startListening,
    stopListening,
    speak,
    stopSpeaking,
  };
}
