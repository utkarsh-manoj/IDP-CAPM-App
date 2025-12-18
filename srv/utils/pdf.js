// srv/utils/pdf.js
const { PDFDocument, rgb } = require('pdf-lib');
const coordsUtil = require('./coords');

module.exports.mask = async (buffer, positions) => {
  const pdfDoc = await PDFDocument.load(buffer);
  const pages = pdfDoc.getPages();
  for (const pos of positions || []) {
    const pageIndex = pos.pageIndex || 0;
    if (pageIndex < 0 || pageIndex >= pages.length) continue;
    const page = pages[pageIndex];
    const { width, height } = page.getSize();
    if (!pos.coords) continue;
    const c = coordsUtil.toPdfCoords(pos.coords, width, height);
    if (c.width <= 0 || c.height <= 0) continue;
    page.drawRectangle({
      x: c.x,
      y: c.y,
      width: c.width,
      height: c.height,
      color: rgb(0, 0, 0)
    });
  }
  return await pdfDoc.save();
};
