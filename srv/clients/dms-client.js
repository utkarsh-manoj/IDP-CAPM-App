// srv/clients/dms-client.js
const { executeHttpRequest } = require('@sap-cloud-sdk/connectivity');
const LOG = require('../utils/logging');

module.exports.upload = async (buffer, meta = {}) => {
  const dest = { destinationName: 'DMS_DEST' };
  const base64 = buffer.toString('base64');
  const payload = {
    fileName: meta.originalName || `file_${Date.now()}.pdf`,
    contentBase64: base64,
    mimeType: 'application/pdf'
  };
  const res = await executeHttpRequest(dest, {
    method: 'POST',
    url: '/documents',
    data: payload
  });
  return res.data;
};

module.exports.download = async (dmsId) => {
  const dest = { destinationName: 'DMS_DEST' };
  const res = await executeHttpRequest(dest, {
    method: 'GET',
    url: `/documents/${dmsId}/content`,
    responseType: 'arraybuffer'
  });
  return Buffer.from(res.data);
};
