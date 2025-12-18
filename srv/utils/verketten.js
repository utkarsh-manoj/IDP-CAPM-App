// srv/utils/verketten.js
// Build Verketten string: pick meaningful attributes, normalize, tokenize, dedupe, sort by informativeness.

const STOP_WORDS = new Set([
  "info","info:","pos","pos.","menge","st","stk","st.","m","lfm","m2","qm","kg","liter","lieferung",
  "art","art.","bezeichnung","="," :",":","x","beidseitig","nutzbar","langl","ca","ca.","inkl","zzgl",
  "breite","höhe","mm","cm","länge","farbe","und","mit","ohne","f.","f","für","fürs","pro","a","b","das"
]);

const normalize = (s) => {
  if (!s) return '';
  return s.toString()
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d"]/g, "'")
    .normalize('NFKD') // decompose accents
    .replace(/[^0-9a-zäöüß\-\/\s]/g, ' ') // keep basic latin and german chars
    .replace(/[\-\/]/g, ' ')
    .replace(/\s+/g,' ')
    .trim();
};

const tokenize = (s) => {
  return normalize(s).split(/\s+/).filter(Boolean);
};

// Informativeness score for token (longer and numeric tokens are more informative)
const informativeness = (t) => {
  if (!t) return 0;
  if (/^\d+$/.test(t)) return 2 + Math.min(3, t.length / 2);
  const len = t.length;
  if (len >= 8) return 4;
  if (len >= 5) return 3;
  if (len >= 3) return 2;
  return 1;
};

function buildVerketten(row) {
  // row: object with product attribute fields (keys vary)
  // Step 1: pick meaningful attributes (omit HerstMaterialNr and EAN)
  const picks = [];
  const priorityFields = [
    'materialShort','materialLong1','materialLong2','modell','oberflaeche','farbe',
    'typ','auspraegung','groesse','modell1','modell2','modell3','modell4','modell5','modell6','modell7','modell8'
  ];

  for (const f of priorityFields) {
    if (row[f]) picks.push(String(row[f]));
  }

  // Also accept other keys in row (defensive)
  for (const k of Object.keys(row)) {
    if (!priorityFields.includes(k) && !/herst|ean|eanupc|materialnr/i.test(k) && row[k]) {
      picks.push(String(row[k]));
    }
  }

  // Normalize and tokenize all picks to atomic tokens
  let tokens = [];
  for (const p of picks) {
    tokens = tokens.concat(tokenize(p));
  }

  // Filter tokens:
  tokens = tokens
    .map(t => t.trim())
    .filter(t => t.length >= 2)             // remove <2 chars
    .filter(t => !STOP_WORDS.has(t))        // remove stopwords
    .filter(t => !/^[\d\W]{1,}$/.test(t));  // remove non-informative

  // Deduplicate while preserving highest informativeness
  const map = new Map();
  for (const t of tokens) {
    const inf = informativeness(t);
    if (!map.has(t) || map.get(t) < inf) map.set(t, inf);
  }

  // Sort tokens by informativeness desc, then lexicographically
  const sorted = Array.from(map.entries())
    .sort((a,b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    })
    .map(x => x[0]);

  // Rebuild Verketten: join with single space
  return sorted.join(' ');
}

module.exports = { buildVerketten, tokenize, normalize, STOP_WORDS };
