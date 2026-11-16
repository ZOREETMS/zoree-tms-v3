// One invoice document for the review drawer, plus AP's approve / dispute action.
import { useCallback, useEffect, useState } from "react";
import { getIntakeDetail, getIntakeFileUrl } from "../services/invoiceIntakeService";
import { resolveException } from "../services/apReleaseService";

export function useInvoiceIntakeDetail(intakeId, onChanged) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [fileUrl, setFileUrl] = useState("");
  const hasFile = Boolean(detail?.hasFile);

  // The original PDF, when it was kept. The object URL is released on change.
  useEffect(() => {
    if (!intakeId || !hasFile) { setFileUrl(""); return undefined; }
    let url = ""; let gone = false;
    getIntakeFileUrl(intakeId).then((u) => { if (gone) URL.revokeObjectURL(u); else { url = u; setFileUrl(u); } }).catch(() => setFileUrl(""));
    return () => { gone = true; if (url) URL.revokeObjectURL(url); };
  }, [intakeId, hasFile]);

  const load = useCallback(async () => {
    if (!intakeId) return;
    try {
      setDetail(await getIntakeDetail(intakeId));
      setError("");
    } catch (e) {
      setError(e?.message || "Could not load this document");
    }
  }, [intakeId]);

  useEffect(() => { setDetail(null); load(); }, [load]);

  const decide = useCallback(async (action, comment) => {
    if (!detail?.invoice?.id) return;
    setBusy(true);
    try {
      await resolveException(detail.invoice.id, action, comment);
      await load();
      if (onChanged) onChanged();
    } catch (e) {
      setError(e?.message || "Could not save the decision");
    } finally {
      setBusy(false);
    }
  }, [detail, load, onChanged]);

  return { detail, error, busy, decide, fileUrl };
}
