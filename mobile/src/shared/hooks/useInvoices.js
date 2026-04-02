import { useMemo, useState } from "react";
import { computeStats, computeVariance } from "../services/invoiceService";

export default function useInvoices(invoices = []) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [carrierFilter, setCarrierFilter] = useState("");
  const [sortCol, setSortCol] = useState("date");
  const [sortAsc, setSortAsc] = useState(false);

  const filtered = useMemo(() => {
    let list = [...invoices];

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((inv) =>
        [inv.num, inv.carrier, inv.shipId, inv.notes]
          .some((v) => String(v || "").toLowerCase().includes(q))
      );
    }

    if (statusFilter) {
      list = list.filter((inv) => inv.status === statusFilter);
    }

    if (carrierFilter) {
      list = list.filter((inv) => inv.carrier === carrierFilter);
    }

    list.sort((a, b) => {
      let av = a[sortCol] ?? "";
      let bv = b[sortCol] ?? "";
      if (typeof av === "number" && typeof bv === "number") {
        return sortAsc ? av - bv : bv - av;
      }
      av = String(av).toLowerCase();
      bv = String(bv).toLowerCase();
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    });

    return list.map((inv) => ({
      ...inv,
      variance: computeVariance(inv.agreed, inv.amount),
    }));
  }, [invoices, search, statusFilter, carrierFilter, sortCol, sortAsc]);

  const stats = useMemo(() => computeStats(invoices), [invoices]);

  const carriers = useMemo(() => {
    const set = new Set(invoices.map((i) => i.carrier).filter(Boolean));
    return [...set].sort();
  }, [invoices]);

  function toggleSort(col) {
    if (sortCol === col) setSortAsc(!sortAsc);
    else { setSortCol(col); setSortAsc(true); }
  }

  return {
    filtered,
    stats,
    carriers,
    search, setSearch,
    statusFilter, setStatusFilter,
    carrierFilter, setCarrierFilter,
    sortCol, sortAsc, toggleSort,
  };
}
