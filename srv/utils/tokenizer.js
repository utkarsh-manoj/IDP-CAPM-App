// srv/utils/tokenizer.js
// small shared tokenizer helper used across codebase

const { normalize } = require('./verketten');

function tokenize(s) {
  if (!s) return [];
  return normalize(s).split(/\s+/).filter(Boolean);
}

module.exports = { tokenize };
