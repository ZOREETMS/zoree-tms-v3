// ═══════════════════════════════════════════════════════════════════
// Claude structured-output helper for agents (server-side key only).
//
// Every agent LLM call is a single "fill in this schema" tool call: the
// model gets no tools that act on the TMS. What it returns is validated
// by the calling agent and turned into proposed actions a person approves.
// Content passed in (emails, carrier replies, documents) is untrusted —
// the system prompt from each agent says to treat it as data only.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-5-5';

function isConfigured(env = process.env) {
  return !!env.ANTHROPIC_API_KEY;
}

/**
 * @param {object} args
 * @param {string} args.system
 * @param {Array|string} args.content   user content blocks (text / image / document) or a string
 * @param {object} args.tool            { name, description, input_schema }
 * @param {number} [args.maxTokens=2048]
 * @param {Function} [args.fetchImpl=fetch]
 * @returns {Promise<{input:object, model:string, usage:object}>}
 */
async function callTool({ system, content, tool, maxTokens = 2048, fetchImpl = fetch }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { const e = new Error('ANTHROPIC_API_KEY is not set in api/.env'); e.status = 503; throw e; }
  const model = process.env.AGENT_MODEL || DEFAULT_MODEL;
  const res = await fetchImpl(API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: `${system}\n\nAlways answer by calling the ${tool.name} tool exactly once.`,
      tools: [tool],
      tool_choice: { type: 'auto' },
      messages: [{ role: 'user', content: typeof content === 'string' ? [{ type: 'text', text: content }] : content }],
    }),
    signal: AbortSignal.timeout(Number(process.env.AGENT_LLM_TIMEOUT_MS) || 90000),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* non-JSON error body */ }
  if (!res.ok) {
    const msg = data && data.error ? `${data.error.type}: ${data.error.message}` : text.slice(0, 300);
    const e = new Error(`Claude API ${res.status}: ${msg}`); e.status = 502; throw e;
  }
  const block = (data.content || []).find((b) => b.type === 'tool_use' && b.name === tool.name);
  if (!block) { const e = new Error(`Claude returned no ${tool.name} result (stop_reason: ${data.stop_reason || 'unknown'})`); e.status = 502; throw e; }
  return { input: block.input || {}, model: data.model || model, usage: data.usage || {} };
}

module.exports = { callTool, isConfigured, DEFAULT_MODEL };
