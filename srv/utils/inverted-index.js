// srv/utils/inverted-index.js
const fs = require('fs');
const path = require('path');
const LOG = require('./logging');

function tokenize(s) {
  return (s||'').toLowerCase().replace(/[^0-9a-zäöüß]+/g,' ').split(/\s+/).filter(Boolean);
}

class InvertedIndex {
  constructor() {
    this.index = {}; // token -> Set(matnr)
    this.docs = {};  // matnr -> verketten
  }

  build(rows) {
    this.index = {};
    this.docs = {};
    for (const r of rows) {
      const matnr = String(r.matnr);
      const text = String(r.verketten || '');
      this.docs[matnr] = text;
      const tokens = new Set(tokenize(text));
      for (const t of tokens) {
        this.index[t] = this.index[t] || new Set();
        this.index[t].add(matnr);
      }
    }
    LOG.info('InvertedIndex built tokens=', Object.keys(this.index).length, 'docs=', Object.keys(this.docs).length);
  }

  query(tokens, topN=100) {
    const counts = {};
    for (const t of tokens) {
      const posting = this.index[t];
      if (!posting) continue;
      for (const m of posting) counts[m] = (counts[m]||0)+1;
    }
    const arr = Object.keys(counts).map(m => ({ matnr: m, score: counts[m], text: this.docs[m] }));
    arr.sort((a,b) => b.score - a.score);
    if (arr.length === 0) {
      // fallback to top docs
      const keys = Object.keys(this.docs).slice(0, topN);
      return keys.map(k => ({ matnr: k, score:0, text: this.docs[k] }));
    }
    return arr.slice(0, topN);
  }

  exportToDisk(outPath) {
    const dump = { docs: this.docs, index: {} };
    for (const k of Object.keys(this.index)) dump.index[k] = Array.from(this.index[k]);
    fs.writeFileSync(outPath, JSON.stringify(dump), 'utf8');
  }

  loadFromDisk(p) {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    this.docs = raw.docs || {};
    this.index = {};
    for (const k of Object.keys(raw.index||{})) this.index[k] = new Set(raw.index[k]);
  }
}

module.exports = { InvertedIndex };
