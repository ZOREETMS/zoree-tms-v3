import { AUDIT_STATUS, PAY_STATUS } from "../../types/freightAudit";

export default function AuditActionButtons({ record, onApprove, onDispute, onRelease }) {
  return (
    <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
      {record.payStatus === PAY_STATUS.PENDING && (
        <button className="btn btn-primary btn-sm" onClick={() => onApprove(record.inv)}>
          Approve
        </button>
      )}
      {record.auditStatus === AUDIT_STATUS.DISCREPANCY && (
        <button className="btn btn-danger btn-sm" onClick={() => onDispute(record.inv)}>
          Dispute
        </button>
      )}
      {record.payStatus === PAY_STATUS.ON_HOLD && (
        <button className="btn btn-secondary btn-sm" onClick={() => onRelease(record.inv)}>
          Release
        </button>
      )}
    </div>
  );
}
