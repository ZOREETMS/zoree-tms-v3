// Input panel for the selected agent.
import QuoteForm from "./forms/QuoteForm";
import SourcingForm from "./forms/SourcingForm";
import TraceForm from "./forms/TraceForm";
import AuditForm from "./forms/AuditForm";
import PodForm from "./forms/PodForm";

const FORMS = { quote: QuoteForm, carrier_sourcing: SourcingForm, track_trace: TraceForm, freight_audit: AuditForm, document_pod: PodForm };

export default function AgentRunForm({ agent, onRun, busy }) {
  const Form = FORMS[agent];
  return Form ? <Form onRun={onRun} busy={busy} /> : null;
}
