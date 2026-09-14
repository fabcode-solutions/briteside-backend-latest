#!/usr/bin/env node
import 'dotenv/config';
import { spawnSync } from 'child_process';
import { loadSecrets } from '../src/config/secrets.js';

// drizzle-kit (and similar CLIs) read their config file via a synchronous
// require(), so they can never await loadSecrets() themselves — a
// drizzle.config.js that awaits it directly fails to even bundle (top-level
// await isn't supported in the cjs output drizzle-kit compiles the config
// to). This wrapper resolves AWS Secrets Manager credentials into
// process.env first, then spawns the real command inheriting that
// now-populated environment.
//
// Only do this when DATABASE_URL isn't already resolvable from .env — that's
// the actual signal a machine's DB creds come exclusively from Secrets
// Manager (no local Postgres to fall back to). Some environments' .env sets
// NODE_ENV=production and USE_AWS_SECRETS=true even on a local dev machine
// (for testing other production-gated behavior), which would otherwise make
// loadSecrets() silently overwrite an already-correct local DATABASE_URL
// with the REAL production database's credentials — never do that.
if (!process.env.DATABASE_URL) {
  await loadSecrets();
}

const [, , command, ...args] = process.argv;
if (!command) {
  console.error('Usage: node scripts/with-secrets.js <command> [...args]');
  process.exit(1);
}

const result = spawnSync(command, args, { stdio: 'inherit', env: process.env, shell: true });
process.exit(result.status ?? 1);
