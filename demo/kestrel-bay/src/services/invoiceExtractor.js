'use strict';
// Reads one carrier invoice PDF with Claude and returns structured fields.
// Claude only reads; it does not decide anything. Every extraction is cached
// by file hash so the demo still runs if the network drops mid-panel.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const claude = require('./anthropicClient');

const CACHE_DIR = path.join(__dirname, '..', '..', 'cache', 'extractions');

const SYSTEM = `You read carrier freight invoices for a 3PL's accounts-payable team.
Return ONLY one JSON object, no prose, no code fences, with exactly these keys:
{
  "invoiceNumber": string,
  "carrier": string,              // carrier legal name as printed
  "invoiceDate": "YYYY-MM-DD" or null,
  "proNumber": string or null,    // PRO, load or BOL number
  "shipmentRef": string or null,  // the customer's shipment reference, e.g. KB-SH-12345
  "origin": string or null,
  "destination": string or null,
  "lines": [ { "description": string, "category": "base"|"fuel"|"accessorial"|"other", "accessorialType": "liftgate"|"detention"|"lumper"|"layover"|"redelivery"|null, "hours": number or null, "amount": number } ],
  "total": number,                // the amount due as printed
  "confidence": number,           // 0 to 1: how sure you are every field above is read correctly
  "warnings": [string]            // anything unclear, missing or odd on the document itself
}
Rules: copy numbers exactly as printed; never compute or correct them. "base" is the linehaul or freight charge. "fuel" is any fuel surcharge. Use null when a field is not on the page. Do not judge whether charges are correct.`;

function hashOf(buf) { return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16); }

function readCache(hash) {
  const p = path.join(CACHE_DIR, `${hash}.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

function writeCache(hash, value) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(path.join(CACHE_DIR, `${hash}.json`), JSON.stringify(value, null, 2));
}

function parseJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('model did not return JSON');
  return JSON.parse(text.slice(start, end + 1));
}

/**
 * @param {string} filePath
 * @param {{preferCache?: boolean}} [opts]
 * @returns {Promise<{file:string, hash:string, fields:object|null, source:'claude'|'cache'|'failed', error?:string, ms:number}>}
 */
async function extract(filePath, { preferCache = false } = {}) {
  const started = Date.now();
  const buf = fs.readFileSync(filePath);
  const hash = hashOf(buf);
  const file = path.basename(filePath);
  const cached = readCache(hash);
  if (preferCache && cached) {
    // Offline replay: optionally pace it like a live read so a recording looks like the real run.
    const pace = Number(process.env.OFFLINE_READ_DELAY_MS) || 0;
    if (pace) await new Promise((r) => setTimeout(r, pace));
    return { file, hash, fields: cached, source: 'cache', ms: Date.now() - started };
  }
  try {
    const out = await claude.complete({
      system: SYSTEM,
      content: [claude.pdfBlock(buf), { type: 'text', text: 'Extract this invoice.' }],
      maxTokens: 900,
    });
    const fields = parseJson(out.text);
    writeCache(hash, fields);
    return { file, hash, fields, source: 'claude', ms: Date.now() - started };
  } catch (e) {
    if (cached) return { file, hash, fields: cached, source: 'cache', error: e.message, ms: Date.now() - started };
    return { file, hash, fields: null, source: 'failed', error: e.message, ms: Date.now() - started };
  }
}

module.exports = { extract, CACHE_DIR };
