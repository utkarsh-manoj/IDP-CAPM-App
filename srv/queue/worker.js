// srv/queue/worker.js
const { Worker, QueueScheduler } = require('bullmq');
const IORedis = require('ioredis');
const cds = require('@sap/cds');
const LOG = require('../utils/logging');

const doxClient = require('../clients/dox-client');
const dmsClient = require('../clients/dms-client');
const similarity = require('../utils/similarity');
const paramsLoader = require('../utils/params-loader');
const pdfUtil = require('../utils/pdf');

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const connection = new IORedis(redisUrl);

// Required to enable delayed/retry scheduling
new QueueScheduler('invoice-processing', { connection });

const worker = new Worker('invoice-processing', async job => {
  const { transactionId, dmsIdOriginal } = job.data;
  LOG.info('Worker claim job', transactionId, dmsIdOriginal);

  const { ProcessedInvoices, LineItemScores, InvoiceAudit, ProductMaster, Config } = cds.entities;

  try {
    // 1) Submit DOX job (POST) and wait for completion
    const doxJob = await doxClient.submitJob(dmsIdOriginal);
    const doxResult = await doxClient.waitForJobCompletion(doxJob.jobId || doxJob.id);

    // 2) Extract header fields by name (Doc AI -> "name" property)
    const headerFields = doxResult.extraction?.headerFields || [];
    const getHeader = (n) => {
      const f = headerFields.find(x => String(x.name||'').toLowerCase() === String(n).toLowerCase());
      return f || {};
    };

    const documentNumber = (getHeader('documentNumber').value || getHeader('document_number').value || '').toString().trim() || null;
    const documentDate = getHeader('documentDate').value || getHeader('document_date').value || null;
    const senderBankAccount = (getHeader('senderBankAccount').value || '').toString().trim() || null;
    const taxId = (getHeader('taxId').value || '').toString().trim() || null;

    // 3) Duplicate detection
    if (documentNumber && documentDate && senderBankAccount && taxId) {
      const existing = await SELECT.one.from(ProcessedInvoices).where({
        invoiceNumber: documentNumber,
        invoiceDate: documentDate,
        senderBankAccount,
        taxId
      });
      if (existing) {
        LOG.warn('Duplicate invoice detected', documentNumber);
        await INSERT.into(InvoiceAudit).entries({
          transactionId,
          invoiceNumber: documentNumber,
          dmsIdOriginal,
          action: 'DUPLICATE',
          payload: JSON.stringify({ reason: 'duplicate' }),
          createdAt: new Date()
        });
        return { status: 'duplicate' };
      }
    }

    // 4) Insert ProcessedInvoices row (reserve)
    await INSERT.into(ProcessedInvoices).entries({
      transactionId,
      invoiceNumber: documentNumber,
      invoiceDate: documentDate,
      senderBankAccount,
      taxId,
      dmsIdOriginal,
      doxJobId: doxJob.jobId || doxJob.id,
      processedAt: new Date()
    });

    // 5) Compute similarity
    const productRows = await SELECT.from(ProductMaster);
    const params = paramsLoader.getParams();
    const threshold = params.threshold != null ? params.threshold : 0.5;

    const lineItems = doxResult.extraction?.lineItems || [];
    const computed = similarity.computeScoresFromLineItems(lineItems, productRows, params);

    // 6) Persist LineItemScores
    const entries = computed.items.map(i => {
      const predictedMatnr = i.matnr || "NONE";
      const predictedConfidence = i.score || 0;
      const matchedText = (i.bestMatch && i.bestMatch.verketten) || i.matchedText || "";

      return {
        processedInvoice_transactionId: transactionId,
        matnr: predictedMatnr,
        merchantDescription: i.merchantDescription,
        matchedText: matchedText,
        score: Number(predictedConfidence).toFixed(4),
        predictedLabelConfidence: Number(predictedConfidence).toFixed(4),
        isValid: (predictedMatnr !== "NONE") && (predictedConfidence >= threshold),
        positionIndex: i.index,
        page: i.pageIndex
      };
    });

    if (entries.length) {
      const CHUNK = 200;
      for (let i=0; i<entries.length; i+=CHUNK) {
        await INSERT.into(LineItemScores).entries(entries.slice(i,i+CHUNK));
      }
    }

    // 7) Build redactionPositions and redact PDF
    const redactionPositions = computed.items
      .filter(i => {
        const pm = i.matnr || "NONE";
        const conf = i.score || 0;
        // redact if NONE OR below threshold
        return (pm === "NONE") || (conf < threshold);
      })
      .map(i => ({
        pageIndex: i.pageIndex,
        coords: (i.fields.find(f => (f.name||'').toLowerCase() === 'description') || {}).coordinates
      }))
      .filter(p => p.coords);

    const originalBuffer = await dmsClient.download(dmsIdOriginal);
    const redactedBytes = await pdfUtil.mask(originalBuffer, redactionPositions);
    const uploadResp = await dmsClient.upload(Buffer.from(redactedBytes), { originalName: `redacted_${transactionId}.pdf` });
    const dmsIdRedacted = uploadResp.id || uploadResp.documentId || uploadResp.dmsId;

    // 8) Audit COMPLETE
    await INSERT.into(InvoiceAudit).entries({
      transactionId,
      invoiceNumber: documentNumber,
      dmsIdOriginal,
      dmsIdRedacted,
      action: 'COMPLETE',
      payload: JSON.stringify({ computedItems: computed.items.length }),
      createdAt: new Date()
    });

    LOG.info('Worker finished job', transactionId);
    return { status: 'complete', dmsIdRedacted };

  } catch (err) {
    LOG.error('Worker error', err.message || err);
    await INSERT.into(InvoiceAudit).entries({
      transactionId: job.data.transactionId,
      invoiceNumber: null,
      action: 'ERROR',
      payload: JSON.stringify({ error: err.message }),
      createdAt: new Date()
    });
    throw err;
  }
}, { connection });

module.exports = { worker };