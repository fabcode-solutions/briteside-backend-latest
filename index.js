import 'dotenv/config';
import { loadSecrets } from './src/config/secrets.js';

// Load AWS Secrets Manager credentials into process.env before anything else
await loadSecrets();

const { sql } = await import('drizzle-orm');
const { default: app } = await import('./src/app.js');
const { default: env } = await import('./src/config/config.js');
const { default: logger } = await import('./src/config/logger.js');
const { db } = await import('./src/db/index.js');

// start the server
const server = app.listen(env.port, () => {
  logger.info(`Listening to port ${env.port}`);
});

// check database connection
try {
  const res = await db.execute(sql`select 1 as connection`).then(res => res[0]);
  if (!res.connection) {
    throw new Error('Not connected to database');
  }
  logger.info('Connected to database');
} catch (err) {
  logger.error('Failed to connect to database:', err);
  server.close();
}
