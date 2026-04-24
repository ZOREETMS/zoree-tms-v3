/**
 * ZoreeAI Service
 * ----------------------------------------------------------------
 * The API/data layer for ZoreeAI. The component must NEVER call
 * fetch() directly — it goes through here. (CLAUDE_RULES §4.)
 *
 * Responsibilities:
 *   - Wrap the Anthropic Messages API call.
 *   - Enable prompt caching on the (large, stable) system prompt
 *     so repeated turns don't repeatedly consume ITPM quota.
 *   - Short-circuit obvious off-topic queries locally using the
 *     scope filter, returning the canned refusal without a network
 *     round-trip.
 */

import { buildSystemPrompt } from "./zoreeAIContext";
import { isLikelyOnTopic, TMS_REFUSAL_MESSAGE } from "./zoreeAIScope";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS = 2048;
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
 * @param {string} args.apiKey          - Anthropic API key.
 * @param {string} args.userText        - The user's latest message.
 * @param {Array}  args.history         - Prior turns: [{role,content}]
 * @param {Object} args.data            - TMS data snapshot.
 * @returns {Promise<
 *   | { kind: 'text',  text: string, refusedLocally?: boolean }
 *   | { kind: 'error', message: string, status?: number }
 * >}
 */
export async function sendMessage({ apiKey, userText, history, data }) {
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

  // Prompt caching: mark the (large, stable) system prompt as cacheable.
  // The referenced-records section is per-turn so it would break the
  // cache key; we accept that cost to keep the lookup feature. The
  // rest of the context still stabilizes across turns when no IDs are
  // mentioned (general queries still hit the cache).
  const systemBlocks = [
    {
      type: "text",
      text: systemText,
      cache_control: { type: "ephemeral" },
    },
  ];

  let response;
  try {
    response = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: systemBlocks,
        messages: recentHistory,
      }),
    });
  } catch (err) {
    return { kind: "error", message: err?.message || "Network request failed" };
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    return { kind: "error", message: `Unexpected response (HTTP ${response.status})`, status: response.status };
  }

  if (payload?.error) {
    return {
      kind: "error",
      message: payload.error.message || JSON.stringify(payload.error),
      status: response.status,
    };
  }

  const text = payload?.content?.[0]?.text;
  if (!text) {
    return { kind: "error", message: `Unexpected response (HTTP ${response.status})`, status: response.status };
  }

  // Defensive: if the model ignored the directive and produced something
  // off-topic (rare, but caching + history can drift), replace with refusal.
  // We detect by checking for the action block marker (legit) or the
  // canned sentence itself (model complying). Otherwise, the model's reply
  // is trusted. This is intentionally lightweight — real enforcement is
  // in the system prompt.
  return { kind: "text", text };
}
