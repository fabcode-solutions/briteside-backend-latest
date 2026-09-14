/**
 * scripts/seed-popular-covers.js
 *
 * One-off seed script: uploads a folder of platform logo images and inserts
 * them directly into `popular_link_covers` (bypassing the API) as SYSTEM-
 * seeded entries (createdByUserId = null), so they show up for everyone in
 * the "popular covers" picker, appear in the admin Logos page, and can't be
 * deleted by a regular user (see PopularCoverService.remove()).
 *
 * USAGE
 *   1. Put the logo image files into a local folder, e.g. ./logos, named to
 *      match the `file` entries in LOGOS below (edit that list to add/remove
 *      logos as needed).
 *   2. Make sure S3 credentials are available — either put AWS_S3_BUCKET (+
 *      AWS_REGION and AWS creds) directly in your .env, or set
 *      USE_AWS_SECRETS=true so this script pulls them from AWS Secrets
 *      Manager the same way `npm run prod` does. Without one of these, real
 *      (non-dry-run) uploads fail with "No value provided for input HTTP
 *      label: Bucket."
 *   3. Run:  node scripts/seed-popular-covers.js ./logos
 *      Add --dry-run to preview without writing anything.
 *
 * Safe to re-run — entries are matched by name and skipped if already present.
 */

import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { eq, sql } from 'drizzle-orm';
import dotenv from 'dotenv';

// NOTE: static `import` statements are hoisted above all other code in an
// ES module, so calling dotenv.config() as a plain statement here would NOT
// run before a static `import { db } from '../src/db/index.js'` above it —
// db/index.js would already have read (empty) process.env by then. Instead
// we load env vars first, then dynamically import db/schema afterward.
dotenv.config();

// Must run BEFORE importing db/index.js — that module builds its Postgres
// pool synchronously at import time from process.env.DATABASE_URL, so
// loadSecrets() (which overwrites DATABASE_URL with the production RDS
// creds when NODE_ENV=production + USE_AWS_SECRETS=true) has to have
// already run, or the pool silently gets built against the wrong database.
const { loadSecrets } = await import('../src/config/secrets.js');
await loadSecrets();

const { db } = await import('../src/db/index.js');
const { popularLinkCovers } = await import('../src/db/schema/index.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// filename -> display name shown under the logo in the picker
const LOGOS = [
  { file: 'Apple Music.png', name: 'Apple Music' },
  { file: 'Apple Podcasts.png', name: 'Apple Podcasts' },
  { file: 'Behance.png', name: 'Behance' },
  { file: 'Discord.png', name: 'Discord' },
  { file: 'Ebay.png', name: 'eBay' },
  { file: 'Etsy.png', name: 'Etsy' },
  { file: 'Facebook.png', name: 'Facebook' },
  { file: 'GoFundMe.png', name: 'GoFundMe' },
  { file: 'Instagram.png', name: 'Instagram' },
  { file: 'LinkedIn.png', name: 'LinkedIn' },
  { file: 'Patreon.png', name: 'Patreon' },
  { file: 'Pinterest.png', name: 'Pinterest' },
  { file: 'Reddit.png', name: 'Reddit' },
  { file: 'Snapchat.png', name: 'Snapchat' },
  { file: 'SoundCloud.png', name: 'SoundCloud' },
  { file: 'Spotify.png', name: 'Spotify' },
  { file: 'Substack.png', name: 'Substack' },
  { file: 'TikTok.png', name: 'TikTok' },
  { file: 'X.png', name: 'X' },
  { file: 'YouTube.png', name: 'YouTube' },
];

// Deliberately NOT importing UploadService here — its module graph pulls in
// mediaModeration -> admin.service -> ...eventually src/config/passport.js,
// which constructs OAuth strategies at import time and throws if e.g.
// FACEBOOK_CLIENT_ID isn't set in this shell's env. FileManagementService has
// everything this script actually needs (S3 upload + the `media` dedup
// table) with none of that baggage, so we call it directly instead.
const { default: FileManagementService } = await import(
  '../src/services/fileManagement.service.js'
);
const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

// S3 folder these get stored under — kept separate from post/story media.
const UPLOAD_FOLDER = 'popular-covers';

/**
 * Uploads a local file to S3 and tracks it in the `media` table, mirroring
 * the relevant subset of UploadService.uploadFile (content-hash dedup +
 * public URL) without importing the full service graph. uploadedBy is
 * intentionally null — these are system-owned assets, not attributed to any
 * one account.
 */
async function uploadFile(localPath, filename) {
  const buffer = await fs.readFile(localPath);
  const ext = path.extname(filename).toLowerCase();
  const mimetype = MIME_BY_EXT[ext] || 'application/octet-stream';

  const fileHash = FileManagementService.calculateFileHash(buffer);
  const existing = await FileManagementService.findByHash(fileHash);
  if (existing) return existing.url;

  const timestamp = Date.now();
  const randomString = Math.random().toString(36).substring(2, 15);
  const sanitizedBaseName = path
    .basename(filename, ext)
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .toLowerCase();
  const s3Key = `${UPLOAD_FOLDER}/${sanitizedBaseName}_${timestamp}_${randomString}${ext}`;

  await s3Client.send(
    new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET,
      Key: s3Key,
      Body: buffer,
      ContentType: mimetype,
      ACL: 'public-read',
    })
  );

  const url = FileManagementService.buildPublicUrl(s3Key);

  await FileManagementService.createOrIncrementReference({
    fileHash,
    s3Key,
    s3Bucket: process.env.AWS_S3_BUCKET,
    url,
    mimetype,
    size: buffer.length,
    folder: UPLOAD_FOLDER,
    originalName: filename,
    extension: ext,
    properties: {},
    uploadedBy: null,
  });

  return url;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const dirArg = process.argv.find((a, i) => i >= 2 && !a.startsWith('--'));
  const logosDir = path.resolve(process.cwd(), dirArg || './logos');

  // Fail fast with one clear message instead of the same cryptic AWS SDK
  // error repeated once per logo.
  if (!dryRun && !process.env.AWS_S3_BUCKET) {
    console.error(
      'AWS_S3_BUCKET is not set. Add it (+ AWS_REGION and AWS creds) to your .env, ' +
        'or set USE_AWS_SECRETS=true to pull it from AWS Secrets Manager. ' +
        'Use --dry-run to preview without uploading.'
    );
    process.exit(1);
  }

  console.log(`Reading logos from: ${logosDir}${dryRun ? '  (dry run)' : ''}`);

  // Current max displayOrder, so new items append to the end.
  const [{ maxOrder }] = await db
    .select({ maxOrder: sql`COALESCE(MAX(${popularLinkCovers.displayOrder}), 0)` })
    .from(popularLinkCovers);
  let nextOrder = Number(maxOrder) + 1;

  const results = { inserted: [], skipped: [], failed: [] };

  for (const { file, name } of LOGOS) {
    const localPath = path.join(logosDir, file);

    try {
      await fs.access(localPath);
    } catch {
      results.failed.push({ file, name, reason: 'file not found' });
      continue;
    }

    // Skip if a cover with this exact name already exists — keeps the
    // script safe to re-run without creating duplicates.
    const existing = await db.query.popularLinkCovers.findFirst({
      where: eq(popularLinkCovers.name, name),
    });
    if (existing) {
      results.skipped.push({ file, name, reason: 'already exists' });
      continue;
    }

    if (dryRun) {
      results.inserted.push({ file, name, url: '(dry-run, not uploaded)' });
      continue;
    }

    try {
      const url = await uploadFile(localPath, file);

      await db.insert(popularLinkCovers).values({
        name,
        url,
        coverType: 'image',
        createdByUserId: null, // system-seeded: not removable by regular users
        displayOrder: nextOrder++,
      });

      results.inserted.push({ file, name, url });
    } catch (err) {
      results.failed.push({ file, name, reason: err.message });
    }
  }

  console.log('\n— Summary —');
  console.log(`Inserted: ${results.inserted.length}`);
  results.inserted.forEach(r => console.log(`  ✓ ${r.name} (${r.file})`));

  if (results.skipped.length) {
    console.log(`\nSkipped (already exist): ${results.skipped.length}`);
    results.skipped.forEach(r => console.log(`  – ${r.name}`));
  }

  if (results.failed.length) {
    console.log(`\nFailed: ${results.failed.length}`);
    results.failed.forEach(r => console.log(`  ✗ ${r.name}: ${r.reason}`));
    process.exitCode = 1;
  }
}

main()
  .then(() => process.exit(process.exitCode || 0))
  .catch(err => {
    console.error('Seed script failed:', err);
    process.exit(1);
  });