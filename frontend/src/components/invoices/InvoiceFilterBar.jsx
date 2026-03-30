import { INVOICE_STATUSES } from "../../types/invoice";

export default function InvoiceFilterBar({
  search, onSearchChange,
  statusFilter, onStatusChange,
  carrierFilter, onCarrierChange,
  carriers,
}) {
  return (
    <div className="filter-bar">
      <div className="search-wrap">
        <input
          className="search-input"
          placeholder="Search invoices..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>

      <select
        className="fsel"
        value={statusFilter}
        onChange={(e) => onStatusChange(e.target.value)}
      >
        <option value="">All Statuses</option>
        {INVOICE_STATUSES.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>

      <select
        className="fsel"
        value={carrierFilter}
        onChange={(e) => onCarrierChange(e.target.value)}
      >
        <option value="">All Carriers</option>
        {carriers.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
    </div>
  );
}
