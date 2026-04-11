import { useMemo } from "react";
import { useOutletContext } from "react-router-dom";
import { getComplianceData, computeComplianceStats } from "../services/complianceService";
import ComplianceStats from "../components/compliance/ComplianceStats";
import HosComplianceCard from "../components/compliance/HosComplianceCard";
import WeightChecksCard from "../components/compliance/WeightChecksCard";
import HazmatShipmentsCard from "../components/compliance/HazmatShipmentsCard";
import CarrierCertsCard from "../components/compliance/CarrierCertsCard";

export default function CompliancePage() {
  const { carriers } = useOutletContext();

  const complianceData = useMemo(() => getComplianceData(carriers), [carriers]);
  const stats = useMemo(() => computeComplianceStats(complianceData), [complianceData]);

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Compliance Management</div>
          <div className="page-sub">HOS rules, weight limits, hazmat, and regulatory tracking</div>
        </div>
        <div className="header-actions">
          <button className="btn btn-secondary btn-sm">📥 Export Report</button>
        </div>
      </div>

      <div className="page-content">
        <ComplianceStats stats={stats} />

        <div className="two-col">
          <HosComplianceCard hosRecords={complianceData.hos} />
          <WeightChecksCard weightRecords={complianceData.weights} />
          <HazmatShipmentsCard hazmatRecords={complianceData.hazmat} />
          <CarrierCertsCard certRecords={complianceData.certs} />
        </div>
      </div>
    </div>
  );
}
