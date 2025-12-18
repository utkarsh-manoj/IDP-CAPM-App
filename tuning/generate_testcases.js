// tuning/generate_testcases.js
// Read labeled_training.csv and create testcases.json with fields { query, expected_matnr }
// Ensures consistent format for the tuner.

const fs = require('fs');
const path = require('path');
const csv = require('csv-parse/sync');

const IN = path.join(__dirname, 'labeled_training.csv');
const OUT = path.join(__dirname, 'testcases.json');

if (!fs.existsSync(IN)) {
  console.error('Missing labeled_training.csv in tuning folder.');
  process.exit(1);
}

const text = fs.readFileSync(IN, 'utf8');
const records = csv.parse(text, { columns: true, skip_empty_lines: true });
const out = [];
for (const r of records) {
  const query = (r.query || r.Query || r.searchText || r.search || '').toString().trim();
  const expected = (r.expected_matnr || r.expected || r.expectedMatnr || '').toString().trim();
  if (!query) continue;
  out.push({ query, expected_matnr: expected });
}

fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
console.log('Wrote', OUT, 'entries=', out.length);
