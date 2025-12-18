namespace invoice;

using {cuid} from '@sap/cds/common';

/**
 * Product Master table (HANA)
 * Includes all fields provided from ECC + dynamically computed Verketten.
 * Updated by CAP job: srv/maintenance/product-master-refresh.js
 */
entity ProductMaster : cuid {
    key matnr         : String(50); // Material number (business key)
        eanUpcCode    : String(50);
        materialShort : String(50);
        materialLong1 : String(50);
        materialLong2 : String(50);
        modell        : String(50);
        oberflaeche   : String(50);
        farbe         : String(50);
        typ           : String(50);
        auspraegung   : String(50);
        groesse       : String(50);
        modell1       : String(50);
        modell2       : String(50);
        modell3       : String(50);
        modell4       : String(50);
        modell5       : String(50);
        modell6       : String(50);
        modell7       : String(50);
        modell8       : String(50);
        verketten     : String(500); /* Machine-generated using custom Verketten algorithm */

}

/**
 * Records all invoices successfully processed by CAP.
 * Includes identity fields used by duplicate detection.
 */
entity ProcessedInvoices : cuid {
        transactionId     : String(100);
    key invoiceNumber     : String(50);
    key invoiceDate       : Date;
    key senderBankAccount : String(100);
    key taxId             : String(100);
        dmsIdOriginal     : String(100);
        dmsIdRedacted     : String(100);
        doxJobId          : String(100);
        processedAt       : Timestamp;

}

/**
 * Stores similarity matching results for each invoice line item
 */
entity LineItemScores : cuid {
    processedInvoice         : Association to ProcessedInvoices;
    matnr                    : String(50);
    merchantDescription      : String(500);
    matchedText              : String(500); // best match (verketten or raw)
    score                    : Decimal(5, 4); // final weighted hybrid similarity
    predictedLabelConfidence : Decimal(5, 4);
    isValid                  : Boolean;
    positionIndex            : Integer;
    page                     : Integer;
}

/**
 * Stores DOX → CPI export audit
 */
entity InvoiceAudit : cuid {
    transactionId : String(100);
    invoiceNumber : String(50);
    dmsIdOriginal : String(100);
    dmsIdRedacted : String(100);
    action        : String(40); // COMPLETE, DUPLICATE, ERROR, EXPORT, etc.
    payload       : LargeString;
    createdAt     : Timestamp;
}

/**
 * Stores global runtime settings:
 *  - threshold
 *  - best_params (auto-loaded from tuning/best_params.json)
 */
entity Config : cuid {
    threshold  : Decimal(3, 2);
    bestParams : LargeString; // JSON content of weights
}
