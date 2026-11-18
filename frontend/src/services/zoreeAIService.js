/**
 * ZoreeAI Service
 * ----------------------------------------------------------------
 * The API/data layer for ZoreeAI. The component must NEVER call
 * fetch() directly — it goes through here. (CLAUDE_RULES §4.)
 *
 * Responsibilities:
 *   - Send the chat turn to the API server (/api/assistant/chat),
 *     which calls Claude with the server's key. No AI key is ever
 *     held in the browser. The server caches the system prompt.
 *   - Short-circuit obvious off-topic queries locally using the
 *     scope filter, returning the canned refusal without a network
 *     round-trip.
 */

import { buildSystemPrompt } from "./zoreeAIContext";
import { isLikelyOnTopic, TMS_REFUSAL_MESSAGE } from "./zoreeAIScope";
import { AssistantApi } from "../lib/api";

const RECENT_TURNS = 14;

/**
 * Match TMS record IDs the user might mention in a message.
 * Accepts: ORD-..., SHP-..., INV-... with alphanumeric/hyphen suffixes.
 * Case-insensitive; suffix length capped to avoid runaway matches.
 */
const ID_PATTERN = /\b((?:ORD|SHP|INV)-[A-Za-z0-9-]{3,20})\b/gi;

/**
 * Extract distinct record IDs mentioned in the user message.
 * @param {string} text
 * @returns {string[]} Uppercase, de-duplicated IDs.
 */
function extractReferencedIds(text) {
  if (!text) return [];
  const matches = String(text).match(ID_PATTERN) || [];
  const seen = new Set();
  const out = [];
  for (const m of matches) {
    const id = m.toUpperCase();
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * Outcome of a locally-refused request — shaped like an API reply
 * so callers can treat it uniformly.
 */
function refusal() {
  return {
    kind: "text",
    text: TMS_REFUSAL_MESSAGE,
    refusedLocally: true,
  };
}

/**
 * Send a chat turn to Claude.
 *
 * @param {Object} args
 * @param {string} args.userText        - The user's latest message.
 * @param {Array}  args.history         - Prior turns: [{role,content}]
 * @param {Object} args.data            - TMS data snapshot.
 * @returns {Promise<
 *   | { kind: 'text',  text: string, refusedLocally?: boolean }
 *   | { kind: 'error', message: string, status?: number }
 * >}
 */
export async function sendMessage({ userText, history, data }) {
  // Layer 1 — local scope pre-filter (saves tokens + avoids rate-limit hits)
  if (!isLikelyOnTopic(userText)) {
    return refusal();
  }

  // Pull any explicit ORD-/SHP-/INV- IDs out of the user message so the
  // context builder can guarantee those records are present, regardless
  // of the trimming window.
  const referencedIds = extractReferencedIds(userText);
  const systemText = buildSystemPrompt(data, referencedIds);

  // Trim chat history to the most recent turns so the request stays
  // within ITPM limits even for long conversations.
  const recentHistory = Array.isArray(history) ? history.slice(-RECENT_TURNS) : [];

  try {
    const res = await AssistantApi.chat(systemText, recentHistory);
    if (!res || !res.text) return { kind: "error", message: "The assistant returned no text." };
    return { kind: "text", text: res.text };
  } catch (err) {
    return { kind: "error", message: err?.message || "Network request failed" };
  }
}

/** Whether the server has an AI key configured. */
export async function assistantStatus() {
  try { return Boolean((await AssistantApi.status()).configured); } catch { return false; }
}
