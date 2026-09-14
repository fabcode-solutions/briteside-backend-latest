// Shared snapshot storage on S3 — lets every API instance skip re-downloading
// ~12 GitHub source files per sync cycle. One elected instance builds and
// uploads; every instance (including the builder) reads the small pointer
// file and only pulls the full snapshot when its version actually changed.
import { gzipSync, gunzipSync } from 'zlib';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import logger from '../../config/logger.js';

const log = {
  info: (msg, meta = {}) => logger.info(msg, { module: 'urlModeration:s3', ...meta }),
  warn: (msg, meta = {}) => logger.warn(msg, { module: 'urlModeration:s3', ...meta }),
  error: (msg, meta = {}) => logger.error(msg, { module: 'urlModeration:s3', ...meta }),
};

const PREFIX = 'url-moderation';
const POINTER_KEY = `${PREFIX}/latest.json`;

const s3 = new S3Client({ region: process.env.AWS_REGION });
const BUCKET = process.env.AWS_S3_BUCKET;

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function serialize(snapshot) {
  const body = JSON.stringify({
    domains: Array.from(snapshot.domainMap.entries()),
    keywords: Array.from(snapshot.keywordMap.entries()),
    version: snapshot.version,
    builtAt: snapshot.builtAt.toISOString(),
    sourceStats: snapshot.sourceStats,
  });
  return gzipSync(Buffer.from(body, 'utf8'));
}

function deserialize(buffer) {
  const json = JSON.parse(gunzipSync(buffer).toString('utf8'));
  return {
    domainMap: new Map(json.domains),
    keywordMap: new Map(json.keywords),
    version: json.version,
    builtAt: new Date(json.builtAt),
    sourceStats: json.sourceStats,
  };
}

/** Uploads the full snapshot, then flips the pointer to it. Leader-only. */
export async function uploadSnapshot(snapshot) {
  if (!BUCKET) throw new Error('AWS_S3_BUCKET is not configured');

  const key = `${PREFIX}/snapshot-${snapshot.version}.json.gz`;
  const gzipped = serialize(snapshot);

  await s3.send(
    new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: gzipped, ContentType: 'application/gzip' })
  );
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: POINTER_KEY,
      Body: JSON.stringify({
        key,
        version: snapshot.version,
        domainCount: snapshot.domainMap.size,
        keywordCount: snapshot.keywordMap.size,
        builtAt: snapshot.builtAt.toISOString(),
      }),
      ContentType: 'application/json',
    })
  );

  log.info('Snapshot published to S3', { key, version: snapshot.version, domainCount: snapshot.domainMap.size });
}

/** Reads the small pointer file. Returns null if none has ever been published. */
export async function readPointer() {
  if (!BUCKET) return null;
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: POINTER_KEY }));
    const body = await streamToBuffer(res.Body);
    return JSON.parse(body.toString('utf8'));
  } catch (err) {
    if (err.name === 'NoSuchKey') return null;
    log.warn('Failed to read S3 pointer', { error: err.message });
    return null;
  }
}

/** Downloads and decompresses the full snapshot referenced by a pointer. */
export async function downloadSnapshot(key) {
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const buffer = await streamToBuffer(res.Body);
  return deserialize(buffer);
}
