// Findings renderer per agent.
import QuoteFindings from "./QuoteFindings";
import SourcingFindings from "./SourcingFindings";
import TraceFindings from "./TraceFindings";
import AuditFindings from "./AuditFindings";
import PodFindings from "./PodFindings";

export const FINDINGS = { quote: QuoteFindings, carrier_sourcing: SourcingFindings, track_trace: TraceFindings, freight_audit: AuditFindings, document_pod: PodFindings };
