import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema/index.js';
import { drizzleLogger } from '../utils/logger.js';
import { EnhancedQueryLogger } from 'drizzle-query-logger';

const isProd = (process.env.NODE_ENV || '').toLowerCase() === 'production';

let pool, db;

function build() {
  const p = new Pool({ connectionString: process.env.DATABASE_URL });
  p.on('error', err => console.error('[db] pool error:', err.message));

  const opts = { schema };
  if (!isProd) opts.logger = new EnhancedQueryLogger();

  pool = p;
  db = drizzle(p, opts);
}

build();

export { db };

export function refreshPool() {
  const old = pool;
  build();
  old.end().catch(e => console.error('[db] drain error:', e.message));
  console.log('[db] pool refreshed');
}
