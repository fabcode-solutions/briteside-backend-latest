import { SESClient, SendBulkTemplatedEmailCommand } from '@aws-sdk/client-ses';

const sesClient = new SESClient({ region: process.env.AWS_SES_REGION });
const FROM_ADDRESS = process.env.AWS_SES_FROM_MAIL;
const BATCH_SIZE = 50;
const BATCH_DELAY_MS = 100;

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function sendBatch(templateName, defaultTemplateData, batch) {
  const destinations = batch.map(r => ({
    Destination: { ToAddresses: [r.email] },
    ReplacementTemplateData: JSON.stringify(r.data),
  }));

  const command = new SendBulkTemplatedEmailCommand({
    Source: FROM_ADDRESS,
    Template: templateName,
    DefaultTemplateData: defaultTemplateData,
    Destinations: destinations,
  });

  const result = await sesClient.send(command);
  const failed = [];

  result.Status?.forEach((status, idx) => {
    if (status.Status !== 'Success') {
      failed.push({ email: batch[idx].email, data: batch[idx].data, error: status.Error });
    }
  });

  return { sent: batch.length - failed.length, failed };
}

/**
 * Send bulk templated emails in batches of 50, with one retry pass for all failures.
 *
 * @param {string} templateName - SES template name (must already exist in SES)
 * @param {object} defaultData - Fallback template variable values (used when replacement is missing)
 * @param {Array<{email: string, data: object}>} recipients
 * @returns {Promise<{sent: number, failed: Array<{email, error}>}>}
 */
export async function sendBulkTemplatedEmail(templateName, defaultData, recipients) {
  const defaultTemplateData = JSON.stringify(defaultData);
  const batches = chunkArray(recipients, BATCH_SIZE);

  let totalSent = 0;
  let allFailed = [];

  for (const batch of batches) {
    try {
      const { sent, failed } = await sendBatch(templateName, defaultTemplateData, batch);
      totalSent += sent;
      allFailed.push(...failed);
    } catch (err) {
      console.error('Bulk mail batch error:', err.message);
      batch.forEach(r => allFailed.push({ email: r.email, data: r.data, error: err.message }));
    }
    await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
  }

  if (allFailed.length === 0) {
    return { sent: totalSent, failed: [] };
  }

  // Single retry pass for all failed destinations
  console.log(`Retrying ${allFailed.length} failed recipient(s)...`);
  const retryBatches = chunkArray(allFailed, BATCH_SIZE);
  const stillFailed = [];

  for (const batch of retryBatches) {
    try {
      const { sent, failed } = await sendBatch(templateName, defaultTemplateData, batch);
      totalSent += sent;
      stillFailed.push(...failed);
    } catch (err) {
      batch.forEach(r => stillFailed.push({ email: r.email, error: err.message }));
    }
    await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
  }

  return { sent: totalSent, failed: stillFailed };
}
