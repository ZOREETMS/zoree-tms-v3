// ═══════════════════════════════════════════════════════════════════
// Fusion Publisher — in-process retry queue.
//
// Bounded-concurrency queue with exponential backoff, used by
// fusionPublisher to send TMS events to OIC. We don't pull in BullMQ /
// Redis for this — the volume is modest (single shipment events) and
// keeping the queue in-process matches the rest of the TMS API
// (mwQueueWorker.js does the same for the OMS path).
//
// Usage:
//   const q = createRetryQueue({ maxConcurrency: 4, maxRetries: 8 });
//   q.enqueue({ id, work: async () => fetch(...) });
//
// On terminal failure (after maxRetries), the onTerminalFailure callback
// fires so the caller can persist to integration_event_log.
// ═══════════════════════════════════════════════════════════════════

function createRetryQueue({
  maxConcurrency  = 4,
  maxRetries      = 8,
  baseDelayMs     = 1000,
  maxDelayMs      = 5 * 60 * 1000,
  onTerminalFailure = null,
} = {}) {
  const pending = [];
  let running = 0;

  function backoffMs(attempt) {
    const ms = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
    // Add jitter (±10%) so a herd of retries doesn't sync up.
    return Math.floor(ms * (0.9 + Math.random() * 0.2));
  }

  async function runOne(item) {
    running += 1;
    try {
      await item.work();
    } catch (err) {
      item.attempts = (item.attempts || 0) + 1;
      if (item.attempts > maxRetries) {
        if (typeof onTerminalFailure === 'function') {
          try { await onTerminalFailure(item, err); } catch (cbErr) { console.error('[fusionPublisher.retryQueue] terminal callback failed:', cbErr.message); }
        } else {
          console.error('[fusionPublisher.retryQueue] terminal failure for', item.id, err.message);
        }
      } else {
        const delay = backoffMs(item.attempts);
        setTimeout(() => { pending.push(item); pump(); }, delay);
      }
    } finally {
      running -= 1;
      pump();
    }
  }

  function pump() {
    while (running < maxConcurrency && pending.length) {
      const next = pending.shift();
      // intentionally not awaited — runOne manages running counter
      runOne(next);
    }
  }

  function enqueue(item) {
    if (!item || typeof item.work !== 'function') {
      throw new Error('enqueue requires { id, work: async () => ... }');
    }
    pending.push({ attempts: 0, ...item });
    pump();
  }

  function size() { return pending.length + running; }

  return { enqueue, size };
}

module.exports = { createRetryQueue };
