import 'dotenv/config';
import { readFileSync } from 'fs';
import { Pool } from 'pg';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/run-manual-migration.js <path-to-sql-file>');
  process.exit(1);
}

const sql = readFileSync(file, 'utf8');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  await pool.query(sql);
  console.log(`Applied: ${file}`);
} finally {
  await pool.end();
}
