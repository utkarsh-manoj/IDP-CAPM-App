// srv/utils/coords.js
module.exports.toPdfCoords = (coords, pageWidth, pageHeight) => {
  // coords: { x, y, w, h } normalized 0..1 with origin top-left
  const x = (coords.x || 0) * pageWidth;
  const width = (coords.w || 0) * pageWidth;
  const yTop = (coords.y || 0) * pageHeight;
  const height = (coords.h || 0) * pageHeight;
  const y = pageHeight - yTop - height;
  return { x, y, width, height };
};
