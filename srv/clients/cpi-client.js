// srv/clients/cpi-client.js
const { executeHttpRequest } = require('@sap-cloud-sdk/connectivity');
const cds = require('@sap/cds');

module.exports.buildExportPayload = async (transactionId) => {
  const { ProcessedInvoices, LineItemScores } = cds.entities;
  const invoice = await SELECT.one.from(ProcessedInvoices).where({ transactionId });
  if (!invoice) throw new Error('Invoice not found for transactionId ' + transactionId);
  const items = await SELECT.from(LineItemScores).where({ processedInvoice_transactionId: transactionId });

  const bmiProducts = items.filter(i => i.isValid).map(i => ({
    sapArticleNumber: i.matnr,
    sapArticleName: i.matchedText,
    quantity: 1,
    unitPrice: 0,
    netAmount: 0
  }));

  return {
    transactionId,
    timestamp: new Date().toISOString(),
    documentId: invoice.dmsIdOriginal,
    documentData: { invoiceNumber: invoice.invoiceNumber, invoiceDate: invoice.invoiceDate },
    classificationResult: { bmiProducts },
    status: 'success',
    errors: []
  };
};

module.exports.sendToCpi = async (payload) => {
  const dest = { destinationName: 'CPI_DEST' };
  const res = await executeHttpRequest(dest, { method: 'POST', url: '/http/invoice-output', data: payload });
  return res.data;
};
