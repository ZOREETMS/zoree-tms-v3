// AI Agent Console — run the five back-office agents and approve what they propose.
// Agents never change the TMS on their own: every action waits here for a person.
import { useState } from "react";
import AgentTabs from "../components/agents/AgentTabs";
import AgentRunForm from "../components/agents/AgentRunForm";
import RunCard from "../components/agents/RunCard";
import { ui } from "../components/agents/styles";
import { AGENT_ICONS, EMAIL_ORDER_AGENT } from "../services/agentsService";
import { useEmailIntakeStatus } from "../hooks/useEmailIntake";
import EmailOrdersPage from "./EmailOrdersPage";
import { useAgentCatalog, useAgentRuns, useRunAgent } from "../hooks/useAgents";

export default function AgentConsolePage() {
  const [agent, setAgent] = useState("quote");
  const catalog = useAgentCatalog();
  const runs = useAgentRuns(agent === EMAIL_ORDER_AGENT.key ? null : agent);
  const runMutation = useRunAgent();

  const emailStatus = useEmailIntakeStatus();
  const data = catalog.data || {};
  const agents = [...(data.agents || []), EMAIL_ORDER_AGENT];
  const pending = { ...(data.pending || {}), email_orders: emailStatus.data?.counts?.pending_review || 0 };
  const meta = agents.find((a) => a.key === agent);
  const isEmail = agent === EMAIL_ORDER_AGENT.key;
  const config = data.config || {};
  const error = (catalog.error || runs.error || runMutation.error)?.message;
  const latestId = runMutation.data && runMutation.data.agent === agent ? runMutation.data.id : null;

  return (
    <div style={{ ...ui.wrap, maxWidth: 1320 }}>
      <h2 style={{ margin: 0 }}>AI Agents</h2>
      <div style={ui.muted}>Agents read the email, rate the lane, watch the loads and check the invoices. You approve every action before it touches the TMS or leaves the building.</div>

      <div style={ui.bar}>
        <span style={ui.dot(config.llmConfigured)} /> <span style={{ color: "#fff" }}>{config.llmConfigured ? "Claude connected" : "ANTHROPIC_API_KEY not set — email/document reading is off"}</span>
        <span style={{ opacity: 0.5, color: "#fff" }}>|</span>
        <span style={{ color: "#fff" }}>{config.emailSending ? "Approved messages are emailed" : "Demo mode: approved messages are recorded, not emailed"}</span>
      </div>
      {error && <div style={ui.err}>{error}</div>}

      <div style={ui.layout}>
        <AgentTabs agents={agents} selected={agent} pending={pending} onSelect={(k) => { setAgent(k); runMutation.reset(); }} />
        <div>
          {meta && (
            <div style={ui.card}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>{AGENT_ICONS[agent]} {meta.label}</div>
              <div style={{ ...ui.muted, margin: "2px 0 12px" }}>{meta.summary}</div>
              {!isEmail && <AgentRunForm agent={agent} busy={runMutation.isPending} onRun={(input) => runMutation.mutate({ agent, input })} />}
              {isEmail && <EmailOrdersPage embedded />}
            </div>
          )}
          {isEmail ? null : runs.isLoading ? <div style={ui.muted}>Loading runs…</div> : (runs.data || []).length === 0 ? (
            <div style={{ ...ui.muted, padding: "24px 0", textAlign: "center" }}>No runs yet. Run the agent above.</div>
          ) : (runs.data || []).map((r) => <RunCard key={r.id} run={r} actionTypes={data.actionTypes || {}} defaultOpen={r.id === latestId} />)}
        </div>
      </div>
    </div>
  );
}
