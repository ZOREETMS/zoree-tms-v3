/**
 * useSpeechSynthesis — Web Speech API hook for voice output.
 * Reads text aloud using the browser's built-in SpeechSynthesis.
 *
 * Usage:
 *   const { speak, stop, isSpeaking, isSupported } = useSpeechSynthesis();
 */
import { useState, useRef, useCallback, useEffect } from "react";

/**
 * Strip markdown formatting for cleaner speech output.
 * Removes bold, code blocks, action blocks, bullet points, etc.
 */
function stripMarkdown(text) {
  return text
    .replace(/```action[\s\S]*?```/g, "")    // Remove action blocks
    .replace(/```[\s\S]*?```/g, "")          // Remove code blocks
    .replace(/`([^`]+)`/g, "$1")             // Inline code → plain text
    .replace(/\*\*([^*]+)\*\*/g, "$1")       // Bold → plain
    .replace(/\*([^*]+)\*/g, "$1")           // Italic → plain
    .replace(/^[•\-\*]\s+/gm, "")           // Bullet points
    .replace(/^#+\s+/gm, "")                // Headings
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // Links → text only
    .replace(/\n{2,}/g, ". ")               // Double newlines → pause
    .replace(/\n/g, " ")                     // Single newlines → space
    .replace(/\s{2,}/g, " ")                // Collapse whitespace
    .trim();
}

export default function useSpeechSynthesis({ rate = 1.0, pitch = 1.0 } = {}) {
  const [isSpeaking, setSpeaking] = useState(false);
  const utteranceRef = useRef(null);

  const isSupported = typeof window !== "undefined" && "speechSynthesis" in window;

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (isSupported) {
        window.speechSynthesis.cancel();
      }
    };
  }, [isSupported]);

  /**
   * Select the best available voice — prefer natural/enhanced English voices.
   */
  const getVoice = useCallback(() => {
    if (!isSupported) return null;
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;

    // Prefer: Google US English > Microsoft natural voices > any English voice
    const preferences = [
      (v) => v.name.includes("Google") && v.lang.startsWith("en"),
      (v) => v.name.includes("Natural") && v.lang.startsWith("en"),
      (v) => v.name.includes("Enhanced") && v.lang.startsWith("en"),
      (v) => v.lang === "en-US",
      (v) => v.lang.startsWith("en"),
    ];

    for (const test of preferences) {
      const match = voices.find(test);
      if (match) return match;
    }
    return voices[0];
  }, [isSupported]);

  const speak = useCallback((text) => {
    if (!isSupported || !text) return;

    // Cancel any ongoing speech
    window.speechSynthesis.cancel();

    const clean = stripMarkdown(text);
    if (!clean) return;

    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.rate = rate;
    utterance.pitch = pitch;

    const voice = getVoice();
    if (voice) utterance.voice = voice;

    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);

    utteranceRef.current = utterance;

    // Chrome bug: voices may not be loaded yet on first call
    // Retry after voices are loaded
    if (window.speechSynthesis.getVoices().length === 0) {
      window.speechSynthesis.onvoiceschanged = () => {
        const v = getVoice();
        if (v) utterance.voice = v;
        window.speechSynthesis.speak(utterance);
      };
    } else {
      window.speechSynthesis.speak(utterance);
    }
  }, [isSupported, rate, pitch, getVoice]);

  const stop = useCallback(() => {
    if (isSupported) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
    }
  }, [isSupported]);

  return { speak, stop, isSpeaking, isSupported };
}
