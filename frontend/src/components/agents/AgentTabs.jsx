// Left rail: the five agents with their pending-approval counts.
import { ui } from "./styles";
import { AGENT_ORDER, AGENT_ICONS } from "../../services/agentsService";

export default function AgentTabs({ agents, selected, pending = {}, onSelect }) {
  const byKey = Object.fromEntries((agents || []).map((a) => [a.key, a]));
  return (
    <div style={ui.side}>
      {AGENT_ORDER.filter((k) => byKey[k]).map((k) => (
        <button key={k} style={ui.agentBtn(selected === k)} onClick={() => onSelect(k)}>
          <span>{AGENT_ICONS[k]}</span>
          <span>{byKey[k].label}</span>
          {pending[k] ? <span style={ui.badge}>{pending[k]}</span> : null}
        </button>
      ))}
    </div>
  );
}
