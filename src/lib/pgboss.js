import { PgBoss } from 'pg-boss';
import logger from '../config/logger.js';

let boss = null;

const log = {
  info: (msg, meta = {}) => logger.info(msg, { module: 'pg-boss', ...meta }),
  warn: (msg, meta = {}) => logger.warn(msg, { module: 'pg-boss', ...meta }),
  error: (msg, meta = {}) => logger.error(msg, { module: 'pg-boss', ...meta }),
};

export async function initPgBoss() {
  if (boss) return boss;

  boss = new PgBoss({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    // Emit queue state summary every 60s — visible in logs for queue health monitoring
    monitorStateIntervalSeconds: 60,
  });

  // Unhandled internal pg-boss errors (DB connectivity, etc.)
  boss.on('error', err => {
    log.error('Unhandled pg-boss error', { error: err.message, stack: err.stack });
  });

  // Periodic queue state: shows counts per status across all queues
  boss.on('monitor-states', states => {
    log.info('Queue monitor snapshot', { states });
  });

  await boss.start();
  log.info('pg-boss started');

  return boss;
}

export function getBoss() {
  if (!boss) throw new Error('pg-boss not initialized. Call initPgBoss() first.');
  return boss;
}
