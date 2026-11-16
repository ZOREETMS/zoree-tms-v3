// ════════════════════════════════════════════════════════════════════
// sealedBox.js — AES-256-GCM seal/open for small JSON payloads.
//
// Used to keep the OAuth layer stateless: registered client ids,
// pending login transactions and authorization codes are all sealed
// blobs, so the server keeps working across restarts and multiple
// instances without a database table.
//
// Output format: base64url( iv[12] | tag[16] | ciphertext )
// Every payload carries `exp` (unix seconds); open() rejects expired
// payloads and anything that fails authentication.
// ════════════════════════════════════════════════════════════════════

const crypto = require('crypto');

const IV_BYTES = 12;
const TAG_BYTES = 16;

function createSealedBox(secret, purpose) {
  if (!secret || secret.length < 32) throw new Error('sealedBox: secret must be 32+ chars');
  if (!purpose) throw new Error('sealedBox: purpose is required');
  // Derive a separate key per purpose so a sealed client id can never
  // be replayed as an authorization code (and vice versa).
  const key = crypto.createHash('sha256').update(`${purpose}:${secret}`).digest();

  function seal(payload, ttlSeconds) {
    const body = { ...payload };
    if (ttlSeconds) body.exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(JSON.stringify(body), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64url');
  }

  /** Returns the payload, or null when tampered, malformed or expired. */
  function open(token) {
    try {
      const buf = Buffer.from(String(token), 'base64url');
      if (buf.length <= IV_BYTES + TAG_BYTES) return null;
      const iv = buf.subarray(0, IV_BYTES);
      const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
      const ct = buf.subarray(IV_BYTES + TAG_BYTES);
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      const json = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
      const body = JSON.parse(json);
      if (body.exp && body.exp < Math.floor(Date.now() / 1000)) return null;
      return body;
    } catch {
      return null;
    }
  }

  return { seal, open };
}

module.exports = { createSealedBox };
