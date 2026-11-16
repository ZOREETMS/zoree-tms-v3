// ═══════════════════════════════════════════════════════════════════
// AP release & NetSuite export routes (migration 054). Thin transport:
// every rule lives in services/apRelease. Finance or admin only; an
// authorized override additionally needs admin (or a named approver).
//
//   GET  /api/ap/queue                         awaiting release · released · exported · blocked
//   POST /api/ap/invoices/:id/resolve          { action: approve|dispute, justification }
//   POST /api/ap/invoices/:id/revalidate       re-run the 3-way match now
//   POST /api/ap/invoices/:id/release          { note?, override?: { justification } }
//   POST /api/ap/release                       { invoiceIds[], note? }   normal path only
//   GET  /api/ap/invoices/:id/history          immutable AP audit ledger for one invoice
//   GET  /api/ap/exports                       batches with their invoices (NetSuite preview)
//   POST /api/ap/exports                       { invoiceIds? } → new batch + CSV
//   GET  /api/ap/exports/:id/csv               the batch CSV again (same batch, logged)
//   GET  /api/ap/exports/:id/history           ledger rows for one batch
//   POST /api/ap/exports/:id/confirm-import    { reference? } AP confirms they imported it (no NetSuite write)
// ═══════════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const { defaultService } = require('../services/apRelease');

module.exports = function createApReleaseRouter({ verifyToken, hasAnyRole, service = null }) {
  const router = express.Router();
  const svc = () => service || defaultService();

  /** Auth + role gate + error mapping around one handler. */
  const handle = (fn) => async (req, res) => {
    const user = await verifyToken(req, res);
    if (!user) return undefined;
    if (!hasAnyRole(user, 'admin', 'finance')) {
      return res.status(403).json({ error: `Role '${user.activeRole || 'unknown'}' cannot release or export invoices. Required: admin or finance.` });
    }
    const ctx = { user, actorRole: user.activeRole || null, isAdmin: hasAnyRole(user, 'admin') };
    try {
      return await fn(req, res, ctx);
    } catch (e) {
      return res.status(e.status || 500).json({ error: e.message });
    }
  };
  const ids = (v) => (Array.isArray(v) ? v.map(String).filter(Boolean) : null);

  router.get('/queue', handle(async (_req, res) => res.json(await svc().queue())));

  router.post('/invoices/:id/resolve', handle(async (req, res, ctx) => res.json(await svc().resolveException({
    invoiceId: req.params.id, action: req.body?.action, justification: req.body?.justification, ...ctx,
  }))));

  router.post('/invoices/:id/revalidate', handle(async (req, res, ctx) => res.json(await svc().revalidate({ invoiceId: req.params.id, ...ctx }))));

  router.post('/invoices/:id/release', handle(async (req, res, ctx) => {
    const override = req.body?.override && typeof req.body.override === 'object' ? { justification: String(req.body.override.justification || '') } : null;
    res.status(201).json(await svc().release({ invoiceId: req.params.id, note: req.body?.note, override, ...ctx }));
  }));

  router.post('/release', handle(async (req, res, ctx) => res.json(await svc().releaseMany({ invoiceIds: ids(req.body?.invoiceIds), note: req.body?.note, ...ctx }))));

  router.get('/invoices/:id/history', handle(async (req, res) => res.json({ events: await svc().auditHistory({ invoiceId: req.params.id }) })));

  router.get('/exports', handle(async (_req, res) => res.json(await svc().exportsWithItems())));

  router.post('/exports', handle(async (req, res, ctx) => {
    const out = await svc().createExport({ invoiceIds: ids(req.body?.invoiceIds), ...ctx });
    res.status(201).json({ batch: out.batch, fileName: out.fileName, csv: out.csv, sha256: out.sha256, total: out.total, count: out.count, skipped: out.skipped, missingConfig: out.missingConfig });
  }));

  router.get('/exports/:id/csv', handle(async (req, res, ctx) => {
    const out = await svc().batchCsv({ batchId: req.params.id, ...ctx });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${String(out.fileName).replace(/[^\w.\-]/g, '_')}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(out.csv);
  }));

  router.get('/exports/:id/history', handle(async (req, res) => res.json({ events: await svc().auditHistory({ batchId: req.params.id }) })));

  router.post('/exports/:id/confirm-import', handle(async (req, res, ctx) => res.json(await svc().confirmImport({ batchId: req.params.id, reference: req.body?.reference, ...ctx }))));

  return router;
};
