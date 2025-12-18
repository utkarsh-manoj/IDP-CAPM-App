// srv/utils/similarity.js
const { InvertedIndex } = require('./inverted-index');
const paramsLoader = require('./params-loader');
const LOG = require('./logging');

// Basic normalization/tokenization (kept small & consistent with verketten)
function tokenizeSimple(s) {
  if (!s) return [];
  return s.toString().toLowerCase().replace(/[^0-9a-zäöüß]+/g,' ').split(/\s+/).filter(Boolean);
}

// Jaccard
function jaccard(a,b){
  const A = new Set(a), B = new Set(b);
  if (A.size===0 && B.size===0) return 1;
  if (A.size===0 || B.size===0) return 0;
  const inter = [...A].filter(x=>B.has(x)).length;
  const uni = new Set([...A,...B]).size;
  return inter/uni;
}

// Dice
function dice(a,b){
  const A = tokenizeSimple(a), B = tokenizeSimple(b);
  if (A.length===0 && B.length===0) return 1;
  if (A.length===0 || B.length===0) return 0;
  const inter = A.filter(x => B.includes(x)).length;
  return (2*inter)/(A.length + B.length);
}

// Cosine (count vector)
function cosine(a,b){
  const A = tokenizeSimple(a), B = tokenizeSimple(b);
  if (A.length===0 || B.length===0) return 0;
  const fa = {}, fb = {};
  A.forEach(t=>fa[t]=(fa[t]||0)+1); B.forEach(t=>fb[t]=(fb[t]||0)+1);
  const terms = new Set([...Object.keys(fa), ...Object.keys(fb)]);
  let dot=0, magA=0, magB=0;
  terms.forEach(t=>{ const va=fa[t]||0, vb=fb[t]||0; dot += va*vb; magA += va*va; magB += vb*vb; });
  if (magA===0||magB===0) return 0;
  return dot/(Math.sqrt(magA)*Math.sqrt(magB));
}

// Levenshtein distance (normalized)
function levenshtein(a,b){
  if(!a) return b?b.length:0;
  if(!b) return a.length;
  a = a.split(''); b = b.split('');
  const m=a.length, n=b.length;
  const dp = Array.from({length:m+1}, ()=>Array(n+1).fill(0));
  for(let i=0;i<=m;i++) dp[i][0]=i;
  for(let j=0;j<=n;j++) dp[0][j]=j;
  for(let i=1;i<=m;i++){
    for(let j=1;j<=n;j++){
      const cost = a[i-1]===b[j-1]?0:1;
      dp[i][j] = Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+cost);
    }
  }
  return dp[m][n];
}

function normalizedLevenshtein(a,b){
  if(!a && !b) return 1;
  if(!a || !b) return 0;
  const d = levenshtein(a,b);
  const max = Math.max(a.length, b.length);
  return max===0?1:1 - (d/max);
}

// token-overlap relative to query
function tokenOverlap(a,b){
  const A = new Set(tokenizeSimple(a)), B = new Set(tokenizeSimple(b));
  if (A.size===0) return 0;
  const inter = [...A].filter(x=>B.has(x)).length;
  return inter / A.size;
}

// Combine with weights (weights normalized externally)
function combineScores(scores, weights){
  let s = 0;
  s += (scores.token||0) * (weights.token||0.5);
  s += (scores.jaccard||0) * (weights.jaccard||0.1);
  s += (scores.dice||0) * (weights.dice||0.1);
  s += (scores.cosine||0) * (weights.cosine||0.2);
  s += (scores.lev||0) * (weights.levenshtein||0.1);
  if (s<0) s=0;
  if (s>1) s=1;
  return s;
}

/**
 * computeScoresFromLineItems
 * - lineItems: array of arrays (each line is array of field objects)
 * - productRows: array [{ matnr, verketten }]
 * - params: runtime params (weights, threshold, noneThreshold, invertedIndex)
 */
function computeScoresFromLineItems(lineItems, productRows, params) {
  params = params || paramsLoader.getParams();
  const weights = params.weights || {};
  const threshold = (params.threshold != null) ? params.threshold : 0.5;
  const noneThreshold = (params.noneThreshold != null) ? params.noneThreshold : 0.35;
  const invOpts = params.invertedIndex || {};

  // Build inverted index (could be loaded from cache in real system)
  const idx = new InvertedIndex();
  idx.build(productRows);

  const items = [];
  for (let i=0;i<lineItems.length;i++){
    const fields = lineItems[i];
    const descField = fields.find(f => (f.name||'').toLowerCase() === 'description') || {};
    const merchantDescription = (descField.value || '').toString();

    const q = merchantDescription;
    const qTokens = tokenizeSimple(q);

    const candidates = idx.query(qTokens, 200);

    let best = { matnr: null, verketten: null, score: 0, rawScores: null };

    const candidateRows = candidates.length ? candidates : Object.keys(idx.docs).slice(0,500).map(k=>({ matnr:k, text: idx.docs[k] }));

    for (const c of candidateRows) {
      const candText = c.text || c.verketten || '';
      const scores = {
        token: tokenOverlap(q, candText),
        jaccard: jaccard(q, candText),
        dice: dice(q, candText),
        cosine: cosine(q, candText),
        lev: normalizedLevenshtein(q, candText)
      };
      const combined = combineScores(scores, weights);
      if (combined > best.score) {
        best = { matnr: c.matnr, verketten: candText, score: combined, rawScores: scores };
      }
    }

    // Decide NONE-class: if best score below noneThreshold OR no candidate found -> NONE
    let predictedMatnr = null;
    let predictedScore = best.score || 0;
    let matchedText = best.verketten || '';

    if (!best.matnr || predictedScore < noneThreshold) {
      predictedMatnr = "NONE";
      predictedScore = 0;
      matchedText = "";
    } else {
      predictedMatnr = best.matnr;
    }

    items.push({
      index: i,
      merchantDescription,
      bestMatch: predictedMatnr === "NONE" ? null : { matnr: predictedMatnr, verketten: matchedText },
      matnr: predictedMatnr,
      score: Number(predictedScore.toFixed(4)),
      rawScores: best.rawScores,
      pageIndex: descField.page ? Number(descField.page)-1 : 0,
      fields
    });
  }

  return { items, redactionPositions: [] };
}

module.exports = { computeScoresFromLineItems };
