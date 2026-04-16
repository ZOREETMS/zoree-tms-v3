function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createLaneQuoteCache({ ttlMs = 120000, maxEntries = 2000 } = {}) {
  const store = new Map();

  function pruneIfNeeded() {
    const now = Date.now();
    for (const [k, entry] of store.entries()) {
      if (entry.expiresAt <= now) store.delete(k);
    }
    if (store.size <= maxEntries) return;
    const ordered = [...store.entries()].sort((a, b) => a[1].lastAccess - b[1].lastAccess);
    const removeCount = store.size - maxEntries;
    for (let i = 0; i < removeCount; i += 1) {
      store.delete(ordered[i][0]);
    }
  }

  function keyFromParts(parts) {
    return stableStringify(parts || {});
  }

  return {
    get(parts) {
      const key = keyFromParts(parts);
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expiresAt <= Date.now()) {
        store.delete(key);
        return null;
      }
      entry.lastAccess = Date.now();
      return deepClone(entry.value);
    },
    set(parts, value) {
      const key = keyFromParts(parts);
      store.set(key, {
        value: deepClone(value),
        expiresAt: Date.now() + ttlMs,
        lastAccess: Date.now(),
      });
      pruneIfNeeded();
    },
    stats() {
      return { size: store.size, ttlMs, maxEntries };
    },
    clear() {
      store.clear();
    },
  };
}

module.exports = { createLaneQuoteCache };
