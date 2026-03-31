import { useState, useRef, useEffect, useCallback } from "react";
import { DbApi } from "../lib/api";

/* ─────────────────────────────────────────────
   ZoreeAI — Floating chat assistant
   Ported from the old vanilla-JS TMS chatbot
   ───────────────────────────────────────────── */

function buildTMSContext(data) {
  const { orders = [], shipments = [], carriers = [], lanePreferences = [], rates = [] } = data || {};
  const unplanned = orders.filter((o) => o.status === "Unplanned");
  const planned = orders.filter((o) => o.status === "Planned" || o.status === "Consolidated");
  const inTransit = shipments.filter((s) => s.status === "In Transit");
  const exceptions = shipments.filter((s) => s.status === "Exception");

  const carrierSummary = carriers
    .map((c) => {
      const cnt = shipments.filter((s) => s.carrier === c.name).length;
      const cost = parseFloat(c.cost) || 0;
      return `${c.name} (SCAC:${c.scac || "?"}, OTD:${c.otd || "?"}%, ${cnt} shipments${cost ? `, $${cost.toFixed(2)}/mi` : ""})`;
    })
    .join("; ");

  const shipmentsList = shipments
    .slice(0, 30)
    .map(
      (s) =>
        `${s.id}: ${(s.origin || "").split(",")[0]}→${(s.dest || s.destination || "").split(",")[0]} | ${s.carrier || "?"} | ${s.status} | ${s.cost || "?"}`
    )
    .join("\n");

  // Include ALL orders so the AI can find any order by ID
  const allOrdersList = orders
    .map(
      (o) =>
        `${o.id}: ${o.customer || "?"} | ${o.origin || "?"}→${o.dest || o.destination || "?"} | ${o.weight || "?"}lbs | ${o.pieces || "?"} pcs | ${o.commodity || "—"} | Status: ${o.status} | Ready: ${o.ready || o.pickup_date || "?"} | Due: ${o.due || o.delivery_date || "?"}${o.shipment_id ? ` | Shipment: ${o.shipment_id}` : ""}${o.preferred_carrier ? ` [PREF:${o.preferred_carrier}]` : ""}`
    )
    .join("\n");

  const rateSummary = rates.length > 0
    ? rates.slice(0, 20).map(
        (r) => `${r.carrier || "?"}|${(r.origin || "").split(",")[0]}→${(r.dest || r.destination || "").split(",")[0]} $${r.rate || "?"}/mi FSC:${r.fsc || "?"}`
      ).join("; ")
    : "No rates configured";

  return [
    "You are ZoreeAI, an AI assistant embedded in ZoreeTMS — a Transportation Management System.",
    "You have live access to all TMS data below. Be concise, specific, and actionable. Reference actual IDs and numbers.",
    "",
    `=== SHIPMENTS (total: ${shipments.length}) ===`,
    `In Transit: ${inTransit.length} | Exceptions: ${exceptions.length}`,
    shipmentsList,
    "",
    `=== ALL ORDERS (total: ${orders.length}) ===`,
    `Unplanned: ${unplanned.length} | Planned/Consolidated: ${planned.length}`,
    allOrdersList || "None",
    "",
    "=== CARRIERS ===",
    carrierSummary || "None configured",
    "",
    "=== RATES ===",
    rateSummary,
    "",
    "=== ACTIONS YOU CAN EXECUTE ===",
    "You can perform real TMS actions. Respond with a JSON action block when the user wants to DO something.",
    "IMPORTANT: When executing an action, end your response with a JSON block in this exact format:",
    "```action",
    '{ "action": "ACTION_NAME", "params": { ... } }',
    "```",
    "",
    "Available actions:",
    "PLAN_ORDER            — params: { orderIds: [string], carrier?: string } — Creates a real shipment. USE THIS when user says 'plan order X'.",
    "UPDATE_ORDER_STATUS   — params: { orderId, newStatus }   — statuses: Unplanned, Planned, In Transit, Delivered, Cancelled, On Hold",
    "UPDATE_SHIPMENT_STATUS — params: { shipmentId, newStatus } — statuses: Planned, Confirmed, In Transit, Delivered, Exception, Cancelled",
    "ASSIGN_CARRIER        — params: { shipmentId, carrier }",
    "HOLD_ORDER            — params: { orderId, reason }",
    "CANCEL_ORDER          — params: { orderId, reason }",
    "CANCEL_SHIPMENT       — params: { shipmentId, reason }",
    "FLAG_EXCEPTION        — params: { shipmentId, issue }",
    "GET_RATES             — params: { originZip, destZip, weight, freightClass?, originCity?, destCity? } — fetch live rates for ALL modes (LTL via CzarLite + TL from rate table + PC*Miler mileage). Returns quotes from all available carriers. CRITICAL: ALWAYS include originCity and destCity derived from the zip: 770xx='Houston, TX', 752xx='Dallas, TX', 606xx='Chicago, IL', 303xx='Atlanta, GA', 100xx-104xx='New York, NY', 432xx='Columbus, OH', 981xx='Seattle, WA', 900xx='Los Angeles, CA', 331xx='Miami, FL'. Example: zip 77003 → originCity 'Houston, TX'. Without these, LTL discounts are NOT applied.",
    "",
    "Rules for actions:",
    '- "plan ORD-XXXX" = emit PLAN_ORDER action immediately. Keep text to 1-2 lines then the action block.',
    "- PLAN_ORDER is safe and non-destructive — never ask for confirmation before planning.",
    "- Only ask for confirmation before CANCEL_ORDER or CANCEL_SHIPMENT.",
    "- Never fabricate order or shipment IDs — only use IDs from the data above.",
    "",
    "IMPORTANT: You can see ALL orders above. When a user asks about a specific order ID, find it in the list.",
  ].join("\n");
}

function formatMessage(text) {
  // Strip action blocks from display
  const clean = text.replace(/```action[\s\S]*?```/g, "").trim();
  return clean
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(
      /`([^`]+)`/g,
      '<code style="background:#f0f4ff;padding:1px 5px;border-radius:4px;font-family:monospace;font-size:12px">$1</code>'
    )
    .replace(/\n\n/g, '</p><p style="margin:6px 0 0">')
    .replace(/\n/g, "<br>");
}

function parseAction(text) {
  const match = text.match(/```action\s*([\s\S]*?)```/);
  if (!match) return null;
  try {
    return JSON.parse(match[1].trim());
  } catch {
    return null;
  }
}

function actionLabel(a) {
  const p = a.params || {};
  switch (a.action) {
    case "PLAN_ORDER":
      return `📋 Plan ${Array.isArray(p.orderIds) ? p.orderIds.join(", ") : p.orderIds} → new shipment${p.carrier ? ` with ${p.carrier}` : " · best available carrier"}`;
    case "UPDATE_ORDER_STATUS":
      return `Update Order ${p.orderId} → ${p.newStatus}`;
    case "UPDATE_SHIPMENT_STATUS":
      return `Update Shipment ${p.shipmentId} → ${p.newStatus}`;
    case "ASSIGN_CARRIER":
      return `Assign ${p.carrier} to Shipment ${p.shipmentId}`;
    case "HOLD_ORDER":
      return `Put Order ${p.orderId} On Hold — ${p.reason}`;
    case "CANCEL_ORDER":
      return `Cancel Order ${p.orderId} — ${p.reason}`;
    case "CANCEL_SHIPMENT":
      return `Cancel Shipment ${p.shipmentId} — ${p.reason}`;
    case "FLAG_EXCEPTION":
      return `Flag Shipment ${p.shipmentId} as Exception — ${p.issue}`;
    case "GET_RATES":
      return `📊 Get live rates (all modes): ${p.originZip} → ${p.destZip} (${p.weight || 5000} lbs)`;
    default:
      return `${a.action} — ${JSON.stringify(p)}`;
  }
}

const ENV_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY || "";

export default function ZoreeAI({ data }) {
  const [open, setOpen] = useState(false);
  const [apiKey, setApiKey] = useState(ENV_KEY);
  const [keyInput, setKeyInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [typing, setTyping] = useState(false);
  const [inputVal, setInputVal] = useState("");
  const [connected, setConnected] = useState(!!ENV_KEY);
  const [initialized, setInitialized] = useState(false);
  const chatHistoryRef = useRef([]);
  const pendingActionsRef = useRef({});
  const msgsEndRef = useRef(null);
  const inputRef = useRef(null);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => msgsEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }, []);

  useEffect(scrollToBottom, [messages, typing, scrollToBottom]);

  useEffect(() => {
    if (open && connected && !initialized) {
      initChat();
      setInitialized(true);
    }
    if (open && connected) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open, connected]);

  function initChat() {
    const welcome = {
      role: "ai",
      text: "Hi! 👋 I'm ZoreeAI — your TMS copilot.\n\nJust tell me what to do and I'll execute it:\n• **\"Plan ORD-2026-XXXXX\"** → I pick the best carrier, price it, create the shipment\n• **Shipment summary** — overview of all in-transit & exceptions\n• **Carrier performance** — OTD rates and shipment counts\n• Assign / reassign carriers, hold or cancel orders, flag exceptions\n\nNo steps. No options. Just results.",
    };
    setMessages([welcome]);
    chatHistoryRef.current = [];
  }

  function handleSaveKey() {
    const key = keyInput.trim();
    if (!key || key.length < 20) return;
    setApiKey(key);
    setKeyInput("");
    setConnected(true);
    initChat();
  }

  function handleResetKey() {
    setApiKey("");
    setConnected(false);
    setMessages([]);
    chatHistoryRef.current = [];
  }

  // ── Action executor — calls real TMS API ──────────────
  async function executeAction(actionData) {
    const p = actionData.params || {};
    const { orders = [], shipments = [], refreshData } = data || {};

    switch (actionData.action) {
      case "PLAN_ORDER": {
        let rawIds = p.orderIds || (p.orderId ? [p.orderId] : []);
        if (!Array.isArray(rawIds)) rawIds = [rawIds];
        if (rawIds.length === 0) throw new Error("No order IDs provided");

        const planOrders = rawIds.map((oid) => {
          const ord = orders.find((o) => o.id === oid);
          if (!ord) throw new Error(`Order ${oid} not found`);
          if (ord.status !== "Unplanned") throw new Error(`Order ${oid} is ${ord.status} — only Unplanned orders can be planned`);
          return ord;
        });

        const o0 = planOrders[0];
        const tw = planOrders.reduce((s, x) => s + (Number(x.weight) || 0), 0);
        const tp = planOrders.reduce((s, x) => s + (parseInt(x.pieces) || 0), 0);

        // Pick carrier — use preferred or first available
        let chosenCarrier = p.carrier;
        if (!chosenCarrier && data.carriers?.length > 0) {
          chosenCarrier = data.carriers[0].name;
        }
        chosenCarrier = chosenCarrier || "TBD";

        const newId = `SHP-${new Date().getFullYear()}-${1860 + Math.floor(Date.now() % 100000)}`;
        // Match exact DB column names from shipments table
        const newShip = {
          id: newId,
          origin: o0.origin,
          dest: o0.dest || o0.destination,
          mode: tw <= 15000 ? "LTL" : "TL",
          carrier: chosenCarrier,
          weight: tw,
          pieces: tp,
          total_cost: 0,
          pickup_date: planOrders.map((x) => x.ready || x.pickup_date).filter(Boolean).sort()[0] || null,
          delivery_date: planOrders.map((x) => x.due || x.delivery_date).filter(Boolean).sort().reverse()[0] || null,
          status: "Planned",
          order_ids: rawIds,
          notes: `Planned by ZoreeAI. Orders: ${rawIds.join(", ")}`,
        };

        await DbApi.upsert("shipments", newShip);

        // Update orders to Planned
        for (const ord of planOrders) {
          await DbApi.patch("orders", ord.id, {
            status: planOrders.length > 1 ? "Consolidated" : "Planned",
            shipment_id: newId,
          });
        }

        if (refreshData) await refreshData();
        return `Shipment **${newId}** created · ${rawIds.length} order(s) · Carrier: ${chosenCarrier} · ${(o0.origin || "").split(",")[0]} → ${(o0.dest || o0.destination || "").split(",")[0]}`;
      }

      case "UPDATE_ORDER_STATUS": {
        const o = orders.find((x) => x.id === p.orderId);
        if (!o) throw new Error(`Order ${p.orderId} not found`);
        const prev = o.status;
        await DbApi.patch("orders", p.orderId, { status: p.newStatus });
        if (refreshData) await refreshData();
        return `Order ${p.orderId} status changed from ${prev} → ${p.newStatus}`;
      }

      case "UPDATE_SHIPMENT_STATUS": {
        const s = shipments.find((x) => x.id === p.shipmentId);
        if (!s) throw new Error(`Shipment ${p.shipmentId} not found`);
        const prev = s.status;
        const patch = { status: p.newStatus };
        if (p.newStatus === "In Transit" && !s.shipped_at) patch.shipped_at = new Date().toISOString();
        if (p.newStatus === "Delivered" && !s.delivered_at) patch.delivered_at = new Date().toISOString();
        await DbApi.patch("shipments", p.shipmentId, patch);
        if (refreshData) await refreshData();
        return `Shipment ${p.shipmentId} status changed from ${prev} → ${p.newStatus}`;
      }

      case "ASSIGN_CARRIER": {
        const s = shipments.find((x) => x.id === p.shipmentId);
        if (!s) throw new Error(`Shipment ${p.shipmentId} not found`);
        const prev = s.carrier || "None";
        await DbApi.patch("shipments", p.shipmentId, { carrier: p.carrier });
        if (refreshData) await refreshData();
        return `Carrier for shipment ${p.shipmentId} set to ${p.carrier} (was: ${prev})`;
      }

      case "HOLD_ORDER": {
        await DbApi.patch("orders", p.orderId, { status: "On Hold", notes: `HOLD: ${p.reason || "AI action"}` });
        if (refreshData) await refreshData();
        return `Order ${p.orderId} placed On Hold — ${p.reason}`;
      }

      case "CANCEL_ORDER": {
        await DbApi.patch("orders", p.orderId, { status: "Cancelled", notes: `CANCELLED: ${p.reason || "AI action"}` });
        if (refreshData) await refreshData();
        return `Order ${p.orderId} cancelled — ${p.reason}`;
      }

      case "CANCEL_SHIPMENT": {
        const linked = orders.filter((o) => o.shipment_id === p.shipmentId);
        for (const o of linked) {
          await DbApi.patch("orders", o.id, { status: "Unplanned", shipment_id: null });
        }
        await DbApi.patch("shipments", p.shipmentId, { status: "Cancelled", notes: `CANCELLED: ${p.reason || "AI action"}` });
        if (refreshData) await refreshData();
        return `Shipment ${p.shipmentId} cancelled · ${linked.length} order(s) returned to Unplanned`;
      }

      case "FLAG_EXCEPTION": {
        await DbApi.patch("shipments", p.shipmentId, { status: "Exception", notes: `EXCEPTION: ${p.issue || "Flagged by AI"}` });
        if (refreshData) await refreshData();
        return `Shipment ${p.shipmentId} flagged as Exception — ${p.issue}`;
      }

      case "GET_RATES": {
        const originZip = p.originZip || "";
        const destZip = p.destZip || "";
        const weight = parseInt(p.weight) || 5000;
        const freightClass = parseInt(p.freightClass) || 70;
        const originCity = p.originCity || "";
        const destCity = p.destCity || "";
        if (!originZip || !destZip) throw new Error("originZip and destZip are required");

        const apiBase = import.meta.env.VITE_API_BASE || window.ZOREE_API_URL || "http://localhost:3001/api";
        const token = localStorage.getItem("zoree_token") || "";
        const lane = {
          laneKey: `${originZip}-${destZip}`,
          originZip, destZip,
          totalWeight: weight,
          freightClass,
          origin: originCity || originZip,
          destination: destCity || destZip,
          orderIds: [],
        };
        const res = await fetch(`${apiBase.replace(/\/api\/?$/, "")}/api/bulk-plan/rate`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
          body: JSON.stringify({ lanes: [lane], optimizeBy: "cost" }),
        });
        const rateData = await res.json();
        const result = rateData?.results?.[0];
        if (!result || !result.quotes?.length) {
          return `No rates available for ${originZip}→${destZip} (${weight} lbs). Check that carriers/rates are configured for this lane.`;
        }

        const ltlQuotes = result.quotes.filter((q) => q.mode === "LTL");
        const tlQuotes = result.quotes.filter((q) => q.mode === "TL");
        const otherQuotes = result.quotes.filter((q) => q.mode !== "LTL" && q.mode !== "TL");
        const best = result.bestQuote;
        const lines = [];

        lines.push(`**Load type:** ${result.loadType || "—"}`);
        if (best) lines.push(`**Best quote:** ${best.carrier} (${best.mode}) — **$${best.totalCharge}**`);
        lines.push("");

        if (ltlQuotes.length > 0) {
          lines.push(`**LTL Rates** (${ltlQuotes.length} carriers):`);
          ltlQuotes.forEach((q) => {
            const disc = q.discountPct > 0 ? ` | Disc: ${q.discountPct}%` : "";
            const fsc = q.fscCharge > 0 ? ` | FSC: $${q.fscCharge}` : "";
            const transit = q.transitDays ? ` | Transit: ${q.transitDays}d` : "";
            const svc = q.serviceLevel ? ` | ${q.serviceLevel}` : "";
            const rec = q.recommended ? " ⭐" : "";
            lines.push(`• ${q.carrier}: **$${q.totalCharge}**${disc}${fsc}${transit}${svc}${rec}`);
          });
          lines.push("");
        }

        if (tlQuotes.length > 0) {
          lines.push(`**TL Rates** (${tlQuotes.length} carriers):`);
          tlQuotes.forEach((q) => {
            const miles = q.pcmilerMiles || q.miles ? ` | ${q.pcmilerMiles || q.miles} mi` : "";
            const fsc = q.fscCharge > 0 ? ` | FSC: $${Math.round(q.fscCharge)}` : "";
            const transit = q.transitDays ? ` | Transit: ${q.transitDays}d` : "";
            const rec = q.recommended ? " ⭐" : "";
            lines.push(`• ${q.carrier}: **$${q.totalCharge}**${miles}${fsc}${transit}${rec}`);
          });
          lines.push("");
        }

        if (otherQuotes.length > 0) {
          lines.push(`**Other Modes** (${otherQuotes.length}):`);
          otherQuotes.forEach((q) => {
            lines.push(`• ${q.carrier} (${q.mode}): **$${q.totalCharge}**`);
          });
        }

        if (!ltlQuotes.length && !tlQuotes.length && !otherQuotes.length) {
          return `No carrier quotes returned for ${originZip}→${destZip} (${weight} lbs).`;
        }

        return `Live rates for ${originCity || originZip} → ${destCity || destZip} (${weight.toLocaleString()} lbs, Class ${freightClass}):\n\n${lines.join("\n")}`;
      }

      default:
        throw new Error(`Unknown action: ${actionData.action}`);
    }
  }

  async function handleConfirmAction(actionId) {
    const actionData = pendingActionsRef.current[actionId];
    if (!actionData) return;
    delete pendingActionsRef.current[actionId];

    setMessages((prev) =>
      prev.map((m) =>
        m.actionId === actionId ? { ...m, actionStatus: "executing" } : m
      )
    );

    try {
      const result = await executeAction(actionData);
      setMessages((prev) =>
        prev.map((m) =>
          m.actionId === actionId ? { ...m, actionStatus: "done", actionResult: result } : m
        )
      );
      chatHistoryRef.current.push({ role: "user", content: `[SYSTEM: Action executed successfully — ${result}]` });
      setMessages((prev) => [...prev, { role: "ai", text: `✅ **Action completed:** ${result}\n\nIs there anything else you need?` }]);
    } catch (e) {
      setMessages((prev) =>
        prev.map((m) =>
          m.actionId === actionId ? { ...m, actionStatus: "error", actionResult: e.message } : m
        )
      );
    }
  }

  function handleDeclineAction(actionId) {
    delete pendingActionsRef.current[actionId];
    setMessages((prev) =>
      prev.map((m) =>
        m.actionId === actionId ? { ...m, actionStatus: "cancelled" } : m
      )
    );
    setMessages((prev) => [...prev, { role: "ai", text: "Got it — action cancelled. Let me know if you need anything else." }]);
  }

  async function callAPI(userText) {
    setMessages((prev) => [...prev, { role: "user", text: userText }]);
    chatHistoryRef.current.push({ role: "user", content: userText });
    setTyping(true);

    try {
      const systemPrompt = (() => {
        try {
          const ctx = buildTMSContext(data);
          console.log("[ZoreeAI] Context length:", ctx.length, "| Orders:", (data?.orders || []).length);
          return ctx;
        } catch (e) {
          console.error("[ZoreeAI] Context build error:", e);
          return "You are ZoreeAI, a TMS assistant for Zoree. Answer questions about transportation and logistics.";
        }
      })();

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 2048,
          system: systemPrompt,
          messages: chatHistoryRef.current.slice(-14),
        }),
      });

      const respData = await response.json();

      if (respData.content?.[0]?.text) {
        const reply = respData.content[0].text;
        chatHistoryRef.current.push({ role: "assistant", content: reply });

        // Check for action block
        const action = parseAction(reply);
        if (action) {
          const actionId = `act-${Date.now()}`;
          pendingActionsRef.current[actionId] = action;
          setMessages((prev) => [...prev, { role: "ai", text: reply, actionId, action, actionStatus: "pending" }]);
        } else {
          setMessages((prev) => [...prev, { role: "ai", text: reply }]);
        }
      } else if (respData.error) {
        const errMsg = respData.error.message || JSON.stringify(respData.error);
        setMessages((prev) => [
          ...prev,
          { role: "ai", text: `⚠️ API error: ${errMsg}\n\nIf this says "invalid x-api-key", click "change key" in the header and re-enter your key.` },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          { role: "ai", text: `⚠️ Unexpected response (HTTP ${response.status})` },
        ]);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "ai", text: `⚠️ Could not reach ZoreeAI.\n\nError: ${err.message}` },
      ]);
    }

    setTyping(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function handleSend() {
    const text = inputVal.trim();
    if (!text || typing) return;
    setInputVal("");
    callAPI(text);
  }

  function handleQuickPrompt(text) {
    if (typing) return;
    callAPI(text);
  }

  const quickPrompts = [
    "📦 Shipment summary",
    "🚛 Carrier performance",
    "💰 Freight spend",
    "⚠️ Exceptions today",
    "📋 Unplanned orders",
  ];

  return (
    <>
      {/* Floating Action Button */}
      <div className="zoree-ai-fab" onClick={() => setOpen(!open)} title="Ask ZoreeAI">
        🧠
      </div>

      {/* Chat Panel */}
      {open && (
        <div className="zoree-ai-panel">
          {/* Header */}
          <div className="zoree-ai-header">
            <div className="zoree-ai-header-icon">🧠</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: "#fff" }}>ZoreeAI</div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,.65)" }}>
                {connected ? (
                  <>
                    🟢 Connected&nbsp;
                    <span
                      onClick={handleResetKey}
                      style={{ cursor: "pointer", textDecoration: "underline", opacity: 0.7 }}
                    >
                      change key
                    </span>
                  </>
                ) : (
                  "Ask me anything about your TMS"
                )}
              </div>
            </div>
            <button className="zoree-ai-close" onClick={() => setOpen(false)}>
              ✕
            </button>
          </div>

          {/* API Key Screen */}
          {!connected && (
            <div className="zoree-ai-apikey-screen">
              <div style={{ fontSize: 32 }}>🔑</div>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#1e2d6b", textAlign: "center" }}>
                Connect ZoreeAI
              </div>
              <div style={{ fontSize: 12, color: "#64748b", textAlign: "center", lineHeight: 1.6 }}>
                Enter your Anthropic API key to enable the AI assistant. Your key is stored only in
                memory and never sent anywhere except the Anthropic API.
              </div>
              <input
                type="password"
                placeholder="sk-ant-api03-..."
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSaveKey()}
                className="zoree-ai-key-input"
                autoFocus
              />
              <button onClick={handleSaveKey} className="zoree-ai-connect-btn">
                Connect →
              </button>
              <a
                href="https://console.anthropic.com/settings/keys"
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: 11, color: "#3b82f6", textDecoration: "none" }}
              >
                Get an API key at console.anthropic.com ↗
              </a>
            </div>
          )}

          {/* Messages Area */}
          {connected && (
            <>
              <div className="zoree-ai-messages">
                {messages.map((msg, i) => (
                  <div key={i} className={`zoree-ai-msg ${msg.role}`}>
                    <p
                      style={{ margin: 0 }}
                      dangerouslySetInnerHTML={{ __html: formatMessage(msg.text) }}
                    />
                    {/* Action confirm card */}
                    {msg.action && msg.actionStatus === "pending" && (
                      <div className="zoree-ai-action-card">
                        <div className="zoree-ai-action-label">⚡ Proposed Action</div>
                        <div style={{ color: "#1e2d6b", fontWeight: 600, marginBottom: 10, fontSize: 12 }}>
                          {actionLabel(msg.action)}
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button className="zoree-ai-action-confirm" onClick={() => handleConfirmAction(msg.actionId)}>
                            ✅ Confirm & Execute
                          </button>
                          <button className="zoree-ai-action-cancel" onClick={() => handleDeclineAction(msg.actionId)}>
                            ✗ Cancel
                          </button>
                        </div>
                      </div>
                    )}
                    {msg.actionStatus === "executing" && (
                      <div className="zoree-ai-action-card" style={{ borderColor: "rgba(59,130,246,.3)" }}>
                        <div style={{ color: "#3b82f6", fontWeight: 600, fontSize: 12 }}>⏳ Executing…</div>
                      </div>
                    )}
                    {msg.actionStatus === "done" && (
                      <div className="zoree-ai-action-card" style={{ background: "rgba(16,185,129,.08)", borderColor: "rgba(16,185,129,.3)" }}>
                        <div style={{ color: "#34d399", fontWeight: 600, fontSize: 12 }}>✅ Done — {msg.actionResult}</div>
                      </div>
                    )}
                    {msg.actionStatus === "error" && (
                      <div className="zoree-ai-action-card" style={{ background: "rgba(239,68,68,.08)", borderColor: "rgba(239,68,68,.3)" }}>
                        <div style={{ color: "#f87171", fontWeight: 600, fontSize: 12 }}>❌ Failed — {msg.actionResult}</div>
                      </div>
                    )}
                    {msg.actionStatus === "cancelled" && (
                      <div className="zoree-ai-action-card" style={{ background: "rgba(255,255,255,.03)", borderColor: "rgba(255,255,255,.08)" }}>
                        <div style={{ color: "#64748b", fontSize: 12 }}>Action cancelled.</div>
                      </div>
                    )}
                  </div>
                ))}
                {typing && (
                  <div className="zoree-ai-msg ai">
                    <div className="zoree-ai-typing">
                      <span />
                      <span />
                      <span />
                    </div>
                  </div>
                )}
                <div ref={msgsEndRef} />
              </div>

              {/* Quick Prompts */}
              {messages.length <= 1 && (
                <div className="zoree-ai-prompts">
                  {quickPrompts.map((p) => (
                    <button key={p} className="zoree-ai-prompt-btn" onClick={() => handleQuickPrompt(p)}>
                      {p}
                    </button>
                  ))}
                </div>
              )}

              {/* Input Bar */}
              <div className="zoree-ai-input-bar">
                <input
                  ref={inputRef}
                  placeholder="Ask about shipments, carriers, costs..."
                  value={inputVal}
                  onChange={(e) => setInputVal(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  disabled={typing}
                  className="zoree-ai-input"
                  style={{ textTransform: "none" }}
                />
                <button
                  onClick={handleSend}
                  disabled={typing}
                  className="zoree-ai-send-btn"
                  style={{ opacity: typing ? 0.5 : 1 }}
                >
                  ➤
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
