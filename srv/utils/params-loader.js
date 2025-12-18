// srv/utils/params-loader.js
const fs = require('fs');
const path = require('path');
const LOG = require('./logging');

let runtimeParams = {
  threshold: 0.5,
  // weights for the hybrid scoring
  weights: {
    token: 0.5,
    jaccard: 0.1,
    dice: 0.1,
    cosine: 0.2,
    levenshtein: 0.1
  },
  // special threshold to decide NONE-class; engine returns "NONE" if best < noneThreshold
  noneThreshold: 0.35,
  invertedIndex: { minDocFreq: 1 }
};

module.exports.loadLocalParams = (p) => {
  if (!p) return;
  if (p.threshold != null) runtimeParams.threshold = Number(p.threshold);
  if (p.weights) runtimeParams.weights = Object.assign(runtimeParams.weights, p.weights);
  if (p.noneThreshold != null) runtimeParams.noneThreshold = Number(p.noneThreshold);
  if (p.invertedIndex) runtimeParams.invertedIndex = Object.assign(runtimeParams.invertedIndex, p.invertedIndex);
  LOG.info('Loaded runtime params', runtimeParams);
};

module.exports.getParams = () => runtimeParams;

// try to auto-load tuning/best_params.json on module load
try {
  const bp = path.join(__dirname, '..', '..', 'tuning', 'best_params.json');
  if (fs.existsSync(bp)) {
    const parsed = JSON.parse(fs.readFileSync(bp, 'utf8'));
    module.exports.loadLocalParams(parsed);
  }
} catch (e) {
  LOG.error('params-loader bootstrap error', e.message || e);
}