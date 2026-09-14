import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const client = new SecretsManagerClient({ region: 'us-east-2' });
let lastPassword = null;

const DB_ENV_KEYS = new Set([
  'POSTGRESQL_HOST',
  'POSTGRESQL_PORT',
  'POSTGRESQL_DB_NAME',
  'POSTGRESQL_USER',
  'POSTGRESQL_PASSWORD',
  'DATABASE_URL',
]);

function isTrue(value) {
  return String(value).toLowerCase() === 'true';
}

async function fetchSecret(name) {
  const res = await client.send(
    new GetSecretValueCommand({
      SecretId: name,
      VersionStage: 'AWSCURRENT',
    })
  );
  return JSON.parse(res.SecretString);
}

function buildDatabaseUrl() {
  const user = encodeURIComponent(process.env.POSTGRESQL_USER);
  const pass = encodeURIComponent(process.env.POSTGRESQL_PASSWORD);
  process.env.DATABASE_URL = `postgresql://${user}:${pass}@${process.env.POSTGRESQL_HOST}:${process.env.POSTGRESQL_PORT || 5432}/${process.env.POSTGRESQL_DB_NAME || 'postgres'}?sslmode=no-verify`;
}

function applyRdsSecret(s) {
  process.env.POSTGRESQL_HOST = s.host;
  process.env.POSTGRESQL_PORT = String(s.port || 5432);
  process.env.POSTGRESQL_DB_NAME = s.dbname || s.database || 'postgres';
  process.env.POSTGRESQL_USER = s.username;
  process.env.POSTGRESQL_PASSWORD = s.password;
  buildDatabaseUrl();
  lastPassword = s.password;
}

export async function loadSecrets() {
  if (!isTrue(process.env.USE_AWS_SECRETS)) return;

  const isProd = (process.env.NODE_ENV || '').toLowerCase() === 'production';

  const [rds, app] = await Promise.all([
    isProd ? fetchSecret('prod/gokryo') : Promise.resolve(null),
    fetchSecret('prod/gokryo/nonRotational'),
  ]);
  // console.log('[secrets] loaded secrets from AWS Secrets Manager', app);
  // In dev: skip DB keys so your local .env values stay intact
  for (const [k, v] of Object.entries(app)) {
    if (v != null && (isProd || !DB_ENV_KEYS.has(k))) {
      process.env[k] = String(v);
    }
  }

  // Prod: overwrite DB creds from RDS rotational secret
  if (isProd && rds) {
    applyRdsSecret(rds);
  }

  // Dev: build DATABASE_URL from local .env POSTGRESQL_* vars
  if (!isProd && !process.env.DATABASE_URL && process.env.POSTGRESQL_HOST) {
    buildDatabaseUrl();
  }
}

export async function refreshRdsSecret() {
  const rds = await fetchSecret('prod/gokryo');
  applyRdsSecret(rds);
  console.log('[secrets] RDS secret refreshed');
}

export function startRotationWatcher(onRotation) {
  console.log('[secrets] starting rotation watcher (every 15 minutes)');
  setInterval(
    async () => {
      try {
        const rds = await fetchSecret('prod/gokryo');
        if (lastPassword && rds.password !== lastPassword) {
          console.log('[secrets] rotation detected');
          applyRdsSecret(rds);
          await onRotation();
        }
        lastPassword = rds.password;
      } catch (e) {
        console.error('[secrets] watcher error (keeping existing creds):', e.message);
      }
    },
    15 * 60 * 1000
  );
}
