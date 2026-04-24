/**
 * ZoreeAI Scope Guard
 * ----------------------------------------------------------------
 * Central definition of what ZoreeAI is allowed to talk about.
 * Used in two places:
 *   1. `isLikelyOnTopic` — cheap client-side pre-filter to reject
 *      obviously off-topic messages before spending API tokens.
 *   2. System prompt text (consumed by zoreeAIContext.js) — tells
 *      the model to refuse off-topic requests with a canned reply.
 *
 * Keep this module free of React / side effects. Pure data + a
 * simple heuristic function.
 */

/**
 * Canonical TMS topic keywords. Additions here are reflected in
 * both the pre-filter and the system prompt (keep the two in sync).
 */
export const TMS_TOPIC_KEYWORDS = [
  // Core entities
  "order", "orders", "ord-",
  "shipment", "shipments", "shp-",
  "invoice", "invoices", "inv-",
  "carrier", "carriers", "scac",
  "rate", "rates", "quote", "quotes", "tariff",
  "customer", "customers",
  "location", "locations", "warehouse", "dock",
  "equipment", "trailer", "truck", "fleet",
  "lane", "lanes", "route", "routes", "stop", "stops",
  // Operations / lifecycle
  "plan", "planned", "unplanned", "consolidate", "consolidated",
  "tender", "accept", "reject", "hold", "cancel",
  "pickup", "delivery", "delivered", "transit", "exception",
  "bol", "pod", "tracking", "eta",
  "ltl", "ftl", "tl", "parcel", "intermodal", "drayage",
  // Cost / financial
  "cost", "freight", "spend", "charge", "charges", "fsc",
  "accessorial", "discount", "fuel surcharge",
  // Compliance / ops
  "otd", "on time", "performance", "kpi",
  "hos", "eld", "compliance",
  // System terms
  "tms", "oms", "zoree", "zoreeai",
];

/**
 * Canned refusal text shown to users (and instructed to the model).
 * Keep in sync with the system prompt rule in zoreeAIContext.js.
 */
export const TMS_REFUSAL_MESSAGE =
  "I'm ZoreeAI — I can only help with TMS topics like orders, shipments, " +
  "carriers, invoices, rates, and routes. What TMS question can I help with?";

/**
 * Short explainer block injected into the system prompt so the model
 * enforces scope even if the pre-filter lets something through
 * (e.g. a question phrased without any keywords).
 */
export const TMS_SCOPE_DIRECTIVE = [
  "=== SCOPE RESTRICTION (STRICT — DO NOT VIOLATE) ===",
  "You ONLY answer questions about this Transportation Management System:",
  "orders, shipments, invoices, carriers, rates, lanes, routes, dock",
  "scheduling, equipment, fleet, OMS sync, tracking, exceptions, freight",
  "costs, carrier performance, and related transportation/logistics topics.",
  "",
  "For ANY off-topic request — general knowledge, coding help, geography,",
  "math puzzles, politics, trivia, personal advice, other software, etc. —",
  "respond EXACTLY with this sentence and nothing else:",
  `"${TMS_REFUSAL_MESSAGE}"`,
  "",
  "Do not answer the off-topic question even partially. Do not explain the",
  "restriction. Do not apologize. Just return the canned sentence above.",
  "=== END SCOPE RESTRICTION ===",
].join("\n");

/**
 * Very short inputs (greetings, acknowledgements, follow-ups like
 * "yes", "do it", "more details") should NOT be pre-filtered, since
 * they're legitimate conversational glue.
 */
const SHORT_INPUT_MAX_WORDS = 4;

/**
 * Obvious off-topic signals — if any are present we can refuse
 * locally without burning API tokens. Keep this list conservative;
 * ambiguity goes to the model with the scope directive.
 */
const OFF_TOPIC_RED_FLAGS = [
  "capital of", "president of", "prime minister",
  "weather in", "write a poem", "write a song",
  "tell me a joke", "recipe for", "how to cook",
  "meaning of life", "who won", "what year did",
  "translate to", "translate into",
];

/**
 * Lightweight client-side topic check.
 *
 *   returns true  → looks TMS-related OR too short to judge → send to API
 *   returns false → clear off-topic signal → refuse locally
 *
 * The model is the real enforcement layer; this just saves tokens
 * on the obvious cases.
 *
 * @param {string} userText
 * @returns {boolean}
 */
export function isLikelyOnTopic(userText) {
  if (!userText) return true;
  const text = String(userText).trim().toLowerCase();
  if (!text) return true;

  // Too short to classify — let the model decide.
  if (text.split(/\s+/).length <= SHORT_INPUT_MAX_WORDS) return true;

  // Red-flag phrases → clearly off-topic.
  for (const flag of OFF_TOPIC_RED_FLAGS) {
    if (text.includes(flag)) return false;
  }

  // If ANY TMS keyword appears → on-topic.
  for (const kw of TMS_TOPIC_KEYWORDS) {
    if (text.includes(kw)) return true;
  }

  // No red flag AND no keyword — ambiguous, let the model decide.
  return true;
}
