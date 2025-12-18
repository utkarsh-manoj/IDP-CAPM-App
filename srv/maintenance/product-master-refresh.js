// srv/maintenance/product-master-refresh.js
const cds = require('@sap/cds');
const verketten = require('../utils/verketten');
const eccClient = require('../clients/ecc-client');
const fs = require('fs');
const path = require('path');
const { InvertedIndex } = require('../utils/inverted-index');
const LOG = require('../utils/logging');

module.exports = cds.service.impl(async function () {
  const { ProductMaster } = this.entities;

  this.on('refreshProductMaster', async () => {
    LOG.info('Starting product master refresh from ECC...');
    const raw = await eccClient.getRawProductMaster(); // expects array of objects

    const rows = raw.map(r => {
      // Map ECC fields to our schema; accept many possible keys for compatibility
      const mapped = {
        matnr: String(r.HerstMaterialNr || r.MATNR || r.Matnr || r.materialNumber || '').trim(),
        Materialkurzbezeichnung: r.Materialkurzbezeichnung || r.shortText || r.MAKTX || '',
        MateriallangbezeichnungTeil1: r.MateriallangbezeichnungTeil1 || r.longText1 || '',
        MateriallangbezeichnungTeil2: r.MateriallangbezeichnungTeil2 || r.longText2 || '',
        Modell: r.Modell || r.model || '',
        Oberflaeche: r.Oberflaeche || r.surface || '',
        Farbe: r.Farbe || r.color || '',
        Typ: r.Typ || '',
        Auspraegung: r.Auspraegung || '',
        Groesse: r.Groesse || ''
      };
      const ver = verketten.buildVerketten(mapped);
      return { matnr: mapped.matnr, verketten: ver };
    }).filter(r => r.matnr);

    // Replace ProductMaster table content (simple approach)
    await DELETE.from(ProductMaster);
    if (rows.length) {
      const CHUNK = 500;
      for (let i=0;i<rows.length;i+=CHUNK) {
        await INSERT.into(ProductMaster).entries(rows.slice(i,i+CHUNK));
      }
    }

    // Save training/product_master.csv (semicolon sep)
    try {
      const out = path.join(__dirname, '..', '..', 'tuning', 'product_master.csv');
      const content = ['matnr;verketten'].concat(rows.map(r => `${r.matnr};${(r.verketten||'').replace(/;/g,' ')}`)).join('\n');
      fs.writeFileSync(out, content, 'utf8');
      LOG.info('Wrote tuning/product_master.csv', out);
    } catch (e) {
      LOG.error('Failed to write product_master.csv', e.message || e);
    }

    // Build inverted index and persist cache for runtime speed
    try {
      const idx = new InvertedIndex();
      idx.build(rows);
      const cachePath = path.join(__dirname, 'utils', '__cache');
      fs.mkdirSync(cachePath, { recursive: true });
      fs.writeFileSync(path.join(cachePath, 'product_master_index.json'), JSON.stringify({
        docs: idx.docs,
        index: Object.fromEntries(Object.entries(idx.index).map(([k,v]) => [k, Array.from(v)]))
      }, null, 2), 'utf8');
      LOG.info('Wrote product_master_index cache');
    } catch (e) {
      LOG.error('Failed to build/save inverted index cache', e.message || e);
    }

    return { imported: rows.length };
  });

});
