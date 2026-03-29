import { useState, useRef, useEffect, useCallback } from "react";
import { useOutletContext } from "react-router-dom";

/* ─────────────────────────────────────────────
   ZoreeAI — Floating chat assistant
   Ported from the old vanilla-JS TMS chatbot
   ───────────────────────────────────────────── */

function buildTMSContext(data) {
  const { orders = [], shipments = [], carriers = [] } = data || {};
  const unplanned = orders.filter((o) => o.status === "Unplanned");
  const inTransit = shipments.filter((s) => s.status === "In Transit");
  const exceptions = shipments.filter((s) => s.status === "Exception");

  const carrierSummary = carriers
    .map((c) => {
      const cnt = shipments.filter((s) => s.carrier === c.name).length;
      return `${c.name} (SCAC:${c.scac || "?"}, OTD:${c.otd || "?"}%, ${cnt} shipments)`;
    })
    .join("; ");

  const recentShips = shipments
    .slice(0, 10)
    .map(
      (s) =>
        `${s.id}: ${(s.origin || "").split(",")[0]}→${(s.dest || s.destination || "").split(",")[0]} | ${s.carrier || "?"} | ${s.status} | ${s.cost || "?"}`
    )
    .join("\n");

  const unplannedList = unplanned
    .slice(0, 20)
    .map(
      (o) =>
        `${o.id}: ${o.customer || "?"} | ${(o.origin || "").split(",")[0]}→${(o.dest || o.destination || "").split(",")[0]} | ${o.weight || "?"}lbs | Ready: ${o.ready || o.pickup_date || "?"} | Due: ${o.due || o.delivery_date || "?"}`
    )
    .join("\n");

  return [
    "You are ZoreeAI, an AI assistant embedded in ZoreeTMS — a Transportation Management System.",
    "You have live access to all TMS data below. Be concise, specific, and actionable. Reference actual IDs and numbers. Use bullet points for lists.",
    "",
    `=== SHIPMENTS (total: ${shipments.length}) ===`,
    `In Transit: ${inTransit.length} | Exceptions: ${exceptions.length}`,
    recentShips,
    "",
    `=== ORDERS (total: ${orders.length}) ===`,
    `Unplanned: ${unplanned.length}`,
    unplannedList || "None",
    "",
    "=== CARRIERS ===",
    carrierSummary || "None configured",
    "",
    "Answer questions based on this data. Be professional, helpful, and precise.",
    "When the user asks about shipments, orders, carriers, or any TMS data, reference actual IDs and numbers from the data above.",
  ].join("\n");
}

function formatMessage(text) {
  return text
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

export default function ZoreeAI() {
  const data = useOutletContext();
  const [open, setOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [typing, setTyping] = useState(false);
  const [inputVal, setInputVal] = useState("");
  const [connected, setConnected] = useState(false);
  const chatHistoryRef = useRef([]);
  const msgsEndRef = useRef(null);
  const inputRef = useRef(null);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => msgsEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }, []);

  useEffect(scrollToBottom, [messages, typing, scrollToBottom]);

  // Focus input when chat opens
  useEffect(() => {
    if (open && connected) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open, connected]);

  function initChat() {
    const welcome = {
      role: "ai",
      text: "Hi! 👋 I'm ZoreeAI — your TMS copilot.\n\nAsk me anything about your shipments, orders, carriers, or costs. Here are some things I can help with:\n• **Shipment summary** — overview of all in-transit & exceptions\n• **Carrier performance** — OTD rates and shipment counts\n• **Unplanned orders** — what needs attention\n• **Freight spend** — cost breakdowns\n\nJust type your question below!",
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

  async function handleSend() {
    const text = inputVal.trim();
    if (!text || typing) return;
    setInputVal("");

    // Add user message
    setMessages((prev) => [...prev, { role: "user", text }]);
    chatHistoryRef.current.push({ role: "user", content: text });

    setTyping(true);

    try {
      const systemPrompt = (() => {
        try {
          return buildTMSContext(data);
        } catch {
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
          max_tokens: 1000,
          system: systemPrompt,
          messages: chatHistoryRef.current.slice(-14),
        }),
      });

      const respData = await response.json();

      if (respData.content?.[0]?.text) {
        const reply = respData.content[0].text;
        chatHistoryRef.current.push({ role: "assistant", content: reply });
        setMessages((prev) => [...prev, { role: "ai", text: reply }]);
      } else if (respData.error) {
        const errMsg = respData.error.message || JSON.stringify(respData.error);
        setMessages((prev) => [
          ...prev,
          {
            role: "ai",
            text: `⚠️ API error: ${errMsg}\n\nIf this says "invalid x-api-key", click "change key" in the header and re-enter your key.`,
          },
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

  function handleQuickPrompt(text) {
    setInputVal(text);
    setTimeout(() => {
      setInputVal("");
      handleSendDirect(text);
    }, 0);
  }

  async function handleSendDirect(text) {
    if (!text || typing) return;
    setMessages((prev) => [...prev, { role: "user", text }]);
    chatHistoryRef.current.push({ role: "user", content: text });
    setTyping(true);

    try {
      const systemPrompt = (() => {
        try {
          return buildTMSContext(data);
        } catch {
          return "You are ZoreeAI, a TMS assistant for Zoree.";
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
          max_tokens: 1000,
          system: systemPrompt,
          messages: chatHistoryRef.current.slice(-14),
        }),
      });

      const respData = await response.json();
      if (respData.content?.[0]?.text) {
        const reply = respData.content[0].text;
        chatHistoryRef.current.push({ role: "assistant", content: reply });
        setMessages((prev) => [...prev, { role: "ai", text: reply }]);
      } else {
        setMessages((prev) => [
          ...prev,
          { role: "ai", text: "⚠️ Unexpected response from API." },
        ]);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "ai", text: `⚠️ Error: ${err.message}` },
      ]);
    }

    setTyping(false);
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
              <div
                style={{
                  fontSize: 12,
                  color: "#64748b",
                  textAlign: "center",
                  lineHeight: 1.6,
                }}
              >
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
