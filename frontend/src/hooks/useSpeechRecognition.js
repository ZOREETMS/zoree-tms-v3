/**
 * useSpeechRecognition — Web Speech API hook for voice input.
 * Converts speech to text using the browser's built-in SpeechRecognition.
 *
 * Usage:
 *   const { transcript, isListening, isSupported, startListening, stopListening } = useSpeechRecognition();
 */
import { useState, useRef, useCallback, useEffect } from "react";

const SpeechRecognition = typeof window !== "undefined"
  ? window.SpeechRecognition || window.webkitSpeechRecognition
  : null;

export default function useSpeechRecognition({ lang = "en-US", onResult, onError, silenceTimeout = 2000 } = {}) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const recognitionRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const latestTranscriptRef = useRef("");

  const isSupported = !!SpeechRecognition;

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch {}
      }
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    };
  }, []);

  const startListening = useCallback(() => {
    if (!SpeechRecognition) return;

    // Stop any existing session
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
    }

    const recognition = new SpeechRecognition();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;

    let finalTranscript = "";

    recognition.onstart = () => {
      setIsListening(true);
      setTranscript("");
      finalTranscript = "";
      latestTranscriptRef.current = "";
    };

    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += t;
        } else {
          interim = t;
        }
      }
      const current = finalTranscript + interim;
      setTranscript(current);
      latestTranscriptRef.current = current;

      // Reset silence timer on each result
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = setTimeout(() => {
        // Auto-stop after silence — deliver final result
        recognition.stop();
      }, silenceTimeout);
    };

    recognition.onerror = (event) => {
      console.warn("[SpeechRecognition] error:", event.error);
      setIsListening(false);
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      if (onError) onError(event.error || "voice-input-failed");
    };

    recognition.onend = () => {
      setIsListening(false);
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      // Deliver final transcript via callback
      const bestTranscript = (finalTranscript || latestTranscriptRef.current || "").trim();
      if (bestTranscript && onResult) {
        onResult(bestTranscript);
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch (err) {
      setIsListening(false);
      if (onError) onError(err?.message || "voice-input-start-failed");
    }
  }, [lang, onResult, onError, silenceTimeout]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
    }
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
  }, []);

  return { transcript, isListening, isSupported, startListening, stopListening };
}
