import 'dotenv/config';
import { loadSecrets } from '../src/config/secrets.js';

// One-time backfill: cover posts created by ProfileService._handleCoverPost
// before it adopted media verdicts have no content_moderation row, so feeds
// treat them as 'approved' even when the underlying file was flagged/rejected.
// Adopts existing verdicts (or enqueues a Stream check) for each live cover post.
// Run: node scripts/backfill-cover-post-moderation.js

process.env.USE_AWS_SECRETS = process.env.USE_AWS_SECRETS || 'true';
await loadSecrets();

const { db } = await import('../src/db/index.js');
const { posts } = await import('../src/db/schema/index.js');
const { eq, and, isNull } = await import('drizzle-orm');
const { MediaModerationService, MEDIA_ENTITY } =
  await import('../src/services/moderation/mediaModeration.service.js');

const coverPosts = await db
  .select({
    id: posts.id,
    userId: posts.userId,
    mediaUrls: posts.mediaUrls,
    mediaTypes: posts.mediaTypes,
  })
  .from(posts)
  .where(and(eq(posts.isCoverPost, true), isNull(posts.deletedAt)));

console.log(`Found ${coverPosts.length} live cover posts`);

for (const post of coverPosts) {
  const urls = post.mediaUrls || [];
  const types = post.mediaTypes || [];
  if (urls.length === 0) continue;
  await MediaModerationService.adoptMediaVerdicts({
    entityType: MEDIA_ENTITY.POST,
    entityId: post.id,
    userId: post.userId,
    imageUrls: urls.filter((_, i) => types[i] !== 'video'),
    videoUrls: urls.filter((_, i) => types[i] === 'video'),
  });
  console.log(`Adopted verdicts for cover post ${post.id}`);
}

console.log('Done');
process.exit(0);
