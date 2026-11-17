// ═══════════════════════════════════════════════════════════════════
// Plain text from a PDF's text layer — no dependencies (Node zlib only).
//
// Used for the independent read check: Jev compares what Claude read
// against the words actually printed in the PDF. It handles the common
// case (text drawn with Tj / TJ / ' / " in Flate or uncompressed content
// streams, standard fonts). Anything it can't decode — a scan, or a font
// with a custom glyph encoding — comes back short or empty, and the
// caller sends that invoice to a person. Pure, no I/O.
// ═══════════════════════════════════════════════════════════════════
'use strict';

const zlib = require('zlib');

function inflate(buf) {
  try { return zlib.inflateSync(buf); } catch { /* fall through */ }
  try { return zlib.inflateRawSync(buf); } catch { return null; }
}

/** ASCII85 (the ~> terminated form reportlab and others write). */
function ascii85(buf) {
  let t = buf.toString('latin1').replace(/\s+/g, '');
  if (t.startsWith('<~')) t = t.slice(2);
  const end = t.indexOf('~>');
  if (end >= 0) t = t.slice(0, end);
  const out = [];
  let group = [];
  for (const ch of t) {
    if (ch === 'z' && group.length === 0) { out.push(0, 0, 0, 0); continue; }
    const c = ch.charCodeAt(0) - 33;
    if (c < 0 || c > 84) return null;
    group.push(c);
    if (group.length === 5) {
      let v = 0; for (const g of group) v = v * 85 + g;
      out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
      group = [];
    }
  }
  if (group.length) {
    const n = group.length;
    while (group.length < 5) group.push(84);
    let v = 0; for (const g of group) v = v * 85 + g;
    out.push(...[(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255].slice(0, n - 1));
  }
  return Buffer.from(out);
}

/** Every content stream's bytes, decoded (ASCII85 and/or Flate). */
function streams(pdf) {
  const out = [];
  const s = pdf.toString('latin1');
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(s))) {
    if (s.slice(Math.max(0, m.index - 3), m.index) === 'end') continue; // "endstream"
    const objAt = s.lastIndexOf(' obj', m.index);
    const dict = s.slice(objAt < 0 ? Math.max(0, m.index - 600) : objAt, m.index);
    const start = m.index + m[0].length;
    const end = s.indexOf('endstream', start);
    if (end < 0) break;
    re.lastIndex = end + 9;
    if (/\/Subtype\s*\/Image|\/FontFile|\/Length1|\/Type\s*\/XRef|\/Type\s*\/ObjStm/.test(dict)) continue;
    const filters = (dict.match(/\/Filter\s*(\[[^\]]*\]|\/\w+)/) || [, ''])[1].match(/\/\w+/g) || [];
    let raw = pdf.subarray(start, end);
    for (const f of filters) {
      if (!raw) break;
      if (f === '/ASCII85Decode' || f === '/A85') raw = ascii85(raw);
      else if (f === '/FlateDecode' || f === '/Fl') raw = inflate(raw);
      else raw = null; // DCT, CCITT… (images) — no text in them
    }
    if (raw) out.push(raw.toString('latin1'));
  }
  return out;
}

/** Decode a PDF literal string body (between the parentheses). */
function literal(body) {
  return body.replace(/\\([nrtbf()\\]|[0-7]{1,3}|\r?\n)/g, (_, e) => {
    if (/^[0-7]+$/.test(e)) return String.fromCharCode(parseInt(e, 8));
    return { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' }[e] ?? '';
  });
}

function hexString(h) {
  const clean = h.replace(/\s+/g, '');
  let t = '';
  for (let i = 0; i < clean.length; i += 2) t += String.fromCharCode(parseInt(clean.slice(i, i + 2).padEnd(2, '0'), 16));
  return t;
}

/**
 * Text operators of one content stream, in drawing order. The stream is
 * tokenised in one pass, so string contents (e.g. "DET") are never
 * mistaken for operators such as ET.
 */
function textOf(content) {
  const parts = [];
  const tok = /\((?:\\.|[^\\)])*\)|<(?!<)[0-9A-Fa-f\s]*>|\bBT\b|\bET\b|T\*|\bTd\b|\bTD\b|\bTm\b|\bTj\b|\bTJ\b|'|"/g;
  let m; let line = ''; let inText = false;
  const flush = () => { if (line) { parts.push(line); line = ''; } };
  while ((m = tok.exec(content))) {
    const t = m[0];
    if (t === 'BT') { inText = true; continue; }
    if (t === 'ET') { flush(); inText = false; continue; }
    if (!inText) continue;
    if (t[0] === '(') line += literal(t.slice(1, -1));
    else if (t[0] === '<') line += hexString(t.slice(1, -1));
    else if (t === 'Td' || t === 'TD' || t === 'Tm' || t === 'T*' || t === "'" || t === '"') flush();
  }
  flush();
  return parts;
}

/**
 * @param {Buffer} pdf
 * @returns {string} text, one drawn run per line ('' when none could be read)
 */
function extractText(pdf) {
  if (!Buffer.isBuffer(pdf) || pdf.subarray(0, 5).toString('latin1') !== '%PDF-') return '';
  const lines = streams(pdf).flatMap(textOf).map((l) => l.replace(/[^\x20-\x7E -ÿ]/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
  return lines.join('\n');
}

module.exports = { extractText };
