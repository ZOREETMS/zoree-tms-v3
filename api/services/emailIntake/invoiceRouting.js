// ═══════════════════════════════════════════════════════════════════
// Carrier invoices that arrive by email → invoice PDF intake.
//
// The email order agent already reads every inbound email. When it says
// "this is a carrier invoice", each PDF attachment goes through the same
// path as a manual upload (invoiceIntake.intakePdf) with source 'email',
// plus a sender check against the carrier's address on file.
// Turn off with EMAIL_INVOICE_INTAKE=false.
// ═══════════════════════════════════════════════════════════════════
'use strict';

const invoiceIntake = require('../invoiceIntake/intakeService');
const pdfExtractor = require('../invoiceIntake/pdfExtractor');

const AGENT_USER = { email: 'invoice-intake-agent', role: 'system' };

function enabled() {
  const v = process.env.EMAIL_INVOICE_INTAKE;
  return v === undefined || v === '' || String(v).toLowerCase() !== 'false';
}

function pdfAttachments(email) {
  return (email.attachments || []).filter((a) => a && a.content
    && ((a.contentType || '').toLowerCase() === 'application/pdf' || /\.pdf$/i.test(a.filename || '')));
}

/**
 * Start reading every PDF on the email now (one promise per PDF, in
 * attachment order). The mailbox run reads several emails at once and
 * hands these to routeInvoiceEmail so decisions can stay in arrival order.
 */
function startReads(email) {
  return pdfAttachments(email).map((att) => {
    const p = pdfExtractor.extract(att.content);
    p.catch(() => {}); // a failed read is reported by intakePdf
    return p;
  });
}

/**
 * @param {object} email  { fromAddress, attachments:[{ filename, contentType, content:Buffer }] }
 * @param {{ preReads?: Promise<object>[] }} [opts]  reads already in flight (startReads)
 * @returns {Promise<object[]>} one result per PDF
 */
async function routeInvoiceEmail(email, { preReads = null } = {}) {
  const out = [];
  const pdfs = pdfAttachments(email);
  for (let i = 0; i < pdfs.length; i += 1) {
    const att = pdfs[i];
    try {
      const r = await invoiceIntake.intakePdf({
        fileName: att.filename || 'invoice.pdf', buffer: att.content, user: AGENT_USER, source: 'email', sender: email.fromAddress || null, senderAuth: email.auth || null,
        preRead: preReads ? preReads[i] : null,
      });
      out.push({ intakeId: r.intakeId, fileName: r.fileName, status: r.status, invoiceId: r.invoiceId || null, invoiceStatus: r.invoiceStatus || null, summary: r.summary });
    } catch (e) {
      out.push({ fileName: att.filename || 'invoice.pdf', status: 'failed', summary: e.message });
    }
  }
  return out;
}

module.exports = { enabled, pdfAttachments, routeInvoiceEmail, startReads };
