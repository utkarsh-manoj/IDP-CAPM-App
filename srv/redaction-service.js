// srv/redaction-service.js
const cds = require('@sap/cds');
const path = require('path');
const fs = require('fs');
const dmsClient = require('./clients/dms-client');
const queue = require('./queue/queue');
const paramsLoader = require('./utils/params-loader');
const LOG = require('./utils/logging');

module.exports = cds.service.impl(async function () {
  const { Config } = this.entities;

  // On startup: load tuning/best_params.json and persist into HANA Config
  try {
    const bpPath = path.join(__dirname, '..', 'tuning', 'best_params.json');
    if (fs.existsSync(bpPath)) {
      const bp = JSON.parse(fs.readFileSync(bpPath, 'utf8'));
      LOG.info('Boot: best_params.json found; persisting to HANA Config');
      // Upsert into Config: simple DELETE+INSERT for this scaffold (adjust for production)
      try { await DELETE.from(Config); } catch(e){ /* ignore */ }
      await INSERT.into(Config).entries({ threshold: bp.threshold || 0.5, bestParams: JSON.stringify(bp) });
      paramsLoader.loadLocalParams(bp);
    } else {
      // fallback: read from DB
      const conf = await SELECT.one.from(Config);
      if (conf && conf.bestParams) {
        const parsed = JSON.parse(conf.bestParams);
        paramsLoader.loadLocalParams(parsed);
      }
    }
  } catch (e) {
    LOG.error('Error loading best_params at startup:', e.message || e);
  }

  // processInvoice: receives file bytes and transactionId
  this.on('processInvoice', async (req) => {
    const { transactionId, file } = req.data;
    if (!transactionId || !file) {
      LOG.error('processInvoice missing transactionId or file');
      req.error(400, 'transactionId and file required');
      return;
    }

    // 1) Save original PDF to DMS
    let dmsResp;
    try {
      dmsResp = await dmsClient.upload(Buffer.from(file), { originalName: `invoice_${transactionId}.pdf` });
    } catch (e) {
      LOG.error('DMS upload failed', e.message || e);
      await INSERT.into('InvoiceAudit').entries({
        transactionId, invoiceNumber: null, action: 'ERROR_DMS_UPLOAD',
        payload: JSON.stringify({ error: e.message }), createdAt: new Date()
      });
      throw e;
    }
    const dmsIdOriginal = dmsResp.id || dmsResp.documentId || dmsResp.dmsId;

    // 2) Insert audit entry (ENQUEUED)
    await INSERT.into('InvoiceAudit').entries({
      transactionId,
      invoiceNumber: null,
      dmsIdOriginal,
      action: 'ENQUEUED',
      payload: JSON.stringify({ dmsIdOriginal }),
      createdAt: new Date()
    });

    // 3) Enqueue for background processing
    await queue.enqueueJob({ transactionId, dmsIdOriginal });

    LOG.info(`processInvoice enqueued: transaction=${transactionId} dmsId=${dmsIdOriginal}`);
    return {
      status: 'enqueued',
      transactionId,
      dmsIdOriginal
    };
  });

  // exportProcessedInvoice remains simple - forwarding to CPI client
  this.on('exportProcessedInvoice', async (req) => {
    const cpiClient = require('./clients/cpi-client');
    const { transactionId } = req.data;
    const payload = await cpiClient.buildExportPayload(transactionId);
    const resp = await cpiClient.sendToCpi(payload);
    await INSERT.into('InvoiceAudit').entries({
      transactionId,
      invoiceNumber: payload.documentData?.invoiceNumber || null,
      action: 'EXPORT',
      payload: JSON.stringify({ payload, resp }),
      createdAt: new Date()
    });
    return resp;
  });
});
