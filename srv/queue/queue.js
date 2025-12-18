// srv/queue/queue.js
const { Queue } = require('bullmq');
const IORedis = require('ioredis');
const LOG = require('../utils/logging');

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const connection = new IORedis(redisUrl);

const invoiceQueue = new Queue('invoice-processing', { connection });

async function enqueueJob(payload) {
  const job = await invoiceQueue.add('process-invoice', payload, {
    jobId: payload.transactionId,
    removeOnComplete: true,
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 }
  });
  LOG.info('Enqueued job', job.id, payload.transactionId);
  return job;
}

module.exports = { enqueueJob, invoiceQueue, connection };
