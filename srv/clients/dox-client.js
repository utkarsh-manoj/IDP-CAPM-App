// srv/clients/dox-client.js
const { executeHttpRequest } = require('@sap-cloud-sdk/connectivity');
const LOG = require('../utils/logging');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

module.exports.submitJob = async (dmsId) => {
  const dest = { destinationName: 'DOX_DEST' };
  const res = await executeHttpRequest(dest, {
    method: 'POST',
    url: '/document-information-extraction/v1/jobs',
    data: { documentId: dmsId }
  });
  return res.data;
};

module.exports.waitForJobCompletion = async (jobId) => {
  const dest = { destinationName: 'DOX_DEST' };
  while (true) {
    const res = await executeHttpRequest(dest, {
      method: 'GET',
      url: `/document-information-extraction/v1/jobs/${jobId}`
    });
    const status = res.data?.status;
    if (status === 'DONE') return res.data.result || res.data;
    if (status === 'FAILED') throw new Error('DOX job failed: ' + JSON.stringify(res.data));
    LOG.info('DOX status', jobId, status);
    await sleep(3000);
  }
};
