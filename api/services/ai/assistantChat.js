// ═══════════════════════════════════════════════════════════════════
// Assistant chat — the in-app chat's call to Claude, made by the server.
//
// The browser used to call api.anthropic.com itself with a key held in the
// page (lost on sign-out, and readable by anyone with DevTools). Now the
// browser sends the conversation here and the server adds its own key
// (ANTHROPIC_API_KEY in api/.env). The key never reaches the browser.
//
// The model, token cap and message limits are fixed here, so a signed-in
// user cannot use this as an open relay to other models or huge prompts.
// ═══════════════════════════════════════════════════════════════════
'use strict';

const API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 2048;
const MAX_MESSAGES = 30;
const MAX_MESSAGE_CHARS = 20000;
const MAX_SYSTEM_CHARS = 600000;

const isConfigured = (env = process.env) => Boolean(env.ANTHROPIC_API_KEY);
const bad = (message, status = 400) => { const e = new Error(message); e.status = status; return e; };

/** Pure: validate and normalize what the browser sent. */
function buildRequest({ system, messages }, env = process.env) {
  if (typeof system !== 'string' || !system.trim()) throw bad('system prompt is required');
  if (system.length > MAX_SYSTEM_CHARS) throw bad('system prompt is too large');
  if (!Array.isArray(messages) || !messages.length) throw bad('messages are required');
  const recent = messages.slice(-MAX_MESSAGES).map((m) => {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string' || !m.content.trim()) throw bad('each message needs a role (user/assistant) and text content');
    if (m.content.length > MAX_MESSAGE_CHARS) throw bad('a message is too long');
    return { role: m.role, content: m.content };
  });
  if (recent[recent.length - 1].role !== 'user') throw bad('the last message must be from the user');
  return {
    model: env.ASSISTANT_CHAT_MODEL || DEFAULT_MODEL,
    max_tokens: MAX_TOKENS,
    // The system prompt is large and mostly stable: cache it across turns.
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: recent,
  };
}

/** @returns {Promise<{ text: string, model: string }>} */
async function chat(input, { env = process.env, fetchImpl = fetch } = {}) {
  if (!isConfigured(env)) throw bad('The assistant is not set up on the server (ANTHROPIC_API_KEY missing in api/.env).', 503);
  const body = buildRequest(input, env);
  let res;
  try {
    res = await fetchImpl(API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
    });
  } catch (e) { throw bad(`Could not reach the AI service: ${e.message}`, 502); }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.error) {
    const msg = (data && data.error && data.error.message) || `HTTP ${res.status}`;
    // Never pass a key problem to the browser as-is; say what to fix.
    if (res.status === 401) throw bad('The server\'s AI key was rejected. Update ANTHROPIC_API_KEY in api/.env.', 502);
    throw bad(`AI service error: ${msg}`, res.status === 429 ? 429 : 502);
  }
  const text = data.content && data.content[0] && data.content[0].text;
  if (!text) throw bad('The AI service returned no text.', 502);
  return { text, model: data.model || body.model };
}

module.exports = { chat, buildRequest, isConfigured, _limits: { MAX_MESSAGES, MAX_MESSAGE_CHARS, MAX_TOKENS } };
