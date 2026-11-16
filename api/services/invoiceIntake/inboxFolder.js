// ═══════════════════════════════════════════════════════════════════
// AP inbox folder — where carrier invoice PDFs wait to be read.
//
// One folder per client domain:  <INVOICE_INBOX_DIR>/<DOMAIN_CODE>/*.pdf
// (default <repo>/inbox). It stands in for the customer's AP mailbox:
// drop PDFs in, the invoice agent reads them. Read-only — files are
// never moved or deleted; what was already read is tracked by file hash
// in invoice_intakes.
// ═══════════════════════════════════════════════════════════════════
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { normalizeCode } = require('../domains/domainCodes');

const MAX_BYTES = 7 * 1024 * 1024;
const MAX_FILES = 200;

function baseDir() {
  return process.env.INVOICE_INBOX_DIR || path.resolve(__dirname, '..', '..', '..', 'inbox');
}

function folderFor(domain) {
  const code = normalizeCode(domain);
  if (!code) { const e = new Error(`Invalid domain "${domain}"`); e.status = 400; throw e; }
  return path.join(baseDir(), code);
}

/**
 * PDFs in the domain's inbox, in file-name order (arrival order).
 * @returns {{ folder:string, exists:boolean, files:Array<{name:string,size:number,sha256:string,buffer:Buffer}>, tooLarge:string[] }}
 */
function list(domain) {
  const folder = folderFor(domain);
  if (!fs.existsSync(folder)) return { folder, exists: false, files: [], tooLarge: [] };
  const names = fs.readdirSync(folder).filter((n) => /\.pdf$/i.test(n)).sort().slice(0, MAX_FILES);
  const files = [];
  const tooLarge = [];
  for (const name of names) {
    const full = path.join(folder, name);
    const stat = fs.statSync(full);
    if (!stat.isFile()) continue;
    if (stat.size > MAX_BYTES) { tooLarge.push(name); continue; }
    const buffer = fs.readFileSync(full);
    files.push({ name, size: stat.size, sha256: crypto.createHash('sha256').update(buffer).digest('hex'), buffer });
  }
  return { folder, exists: true, files, tooLarge };
}

module.exports = { list, folderFor };
