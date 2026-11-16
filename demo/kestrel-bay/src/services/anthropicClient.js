'use strict';
// One place that talks to Claude. Text or PDF in, text out.
const config = require('../config');

function available() { return Boolean(config.anthropic.apiKey); }

/**
 * @param {object} a
 * @param {string} a.system
 * @param {Array}  a.content   Messages API content blocks for the user turn
 * @param {number} [a.maxTokens]
 */
async function complete({ system, content, maxTokens = 600 }) {
  if (!available()) throw new Error('no model key');
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), config.anthropic.timeoutMs);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': config.anthropic.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      // The model may think before answering; leave headroom so the visible answer is never cut off.
      body: JSON.stringify({ model: config.anthropic.model, max_tokens: maxTokens + 2000, system, messages: [{ role: 'user', content }] }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const data = await res.json();
    const text = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text || '').join('').trim();
    if (!text) throw new Error(`empty model response (${data.stop_reason || 'unknown'})`);
    return { text, model: data.model, usage: data.usage };
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`model timed out after ${config.anthropic.timeoutMs}ms`);
    throw e;
  } finally { clearTimeout(t); }
}

function pdfBlock(buffer) {
  return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') } };
}

module.exports = { available, complete, pdfBlock };
