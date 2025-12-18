using invoice from '../db/schema';

service RedactionService {

  /**
   * NEW signature:
   * CAP receives the file directly.
   */
  action processInvoice(
    transactionId : String,
    file          : LargeBinary     // PDF file content
  ) returns String;

  action exportProcessedInvoice(
    transactionId : String
  ) returns LargeString;

  entity ProductMaster       as projection on invoice.ProductMaster;
  entity ProcessedInvoices   as projection on invoice.ProcessedInvoices;
  entity LineItemScores      as projection on invoice.LineItemScores;
  entity InvoiceAudit        as projection on invoice.InvoiceAudit;
  entity Config              as projection on invoice.Config;
}
