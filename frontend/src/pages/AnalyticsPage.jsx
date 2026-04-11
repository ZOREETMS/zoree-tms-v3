import { useOutletContext } from "react-router-dom";
import { useAnalytics } from "../hooks/useAnalytics";
import AnalyticsStats from "../components/analytics/AnalyticsStats";
import SpendByModeCard from "../components/analytics/SpendByModeCard";
import CarrierScorecardCard from "../components/analytics/CarrierScorecardCard";

export default function AnalyticsPage() {
  const { shipments, carriers } = useOutletContext();
  const { kpis, spendByMode, carrierScorecard } = useAnalytics(
    shipments,
    carriers
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Analytics & Reports</div>
          <div className="page-sub">
            KPIs, spend analysis, and carrier scorecards
          </div>
        </div>
        <div className="header-actions">
          <button className="btn btn-secondary btn-sm">Export PDF</button>
        </div>
      </div>

      <div className="page-content">
        <AnalyticsStats kpis={kpis} />

        <div className="two-col">
          <SpendByModeCard spendByMode={spendByMode} />
          <CarrierScorecardCard carriers={carrierScorecard} />
        </div>
      </div>
    </div>
  );
}
