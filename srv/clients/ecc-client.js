// srv/clients/ecc-client.js
const { executeHttpRequest } = require('@sap-cloud-sdk/connectivity');
const LOG = require('../utils/logging');

module.exports.getRawProductMaster = async () => {
  const dest = { destinationName: 'ECC_PM_DEST' };
  const res = await executeHttpRequest(dest, {
    method: 'GET',
    url: '/sap/opu/odata/sap/ZPRODUCT_MASTER_SRV/Products?$format=json'
  });
  const rows = res.data?.d?.results || res.data?.value || [];
  LOG.info('ECC product master rows:', rows.length);
  return rows;
};
