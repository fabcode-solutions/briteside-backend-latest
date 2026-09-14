import 'dotenv/config';
/**
 * scripts/seed-social.js
 *
 * Seeds realistic posts, stories, likes, comments, and mutual follows
 * for every user already in the database.
 *
 * Safe to re-run — skips users who already have posts/stories.
 *
 * Usage:
 *   node scripts/seed-social.js
 *
 * Add to package.json:
 *   "seed:social": "node scripts/seed-social.js"
 */

import { eq, and, sql, inArray } from 'drizzle-orm';
import { fileURLToPath } from 'url';
import { db } from '../src/db/index.js';
import {
  users,
  posts,
  postLikes,
  postComments,
  postUserComments,
  stories,
  storyViews,
  storyLikes,
  socialProfiles,
  userFollows,
  userInterests,
  interestCategories,
} from '../src/db/schema/index.js';

const __filename = fileURLToPath(import.meta.url);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Random integer between min and max (inclusive) */
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

/** Pick `n` random elements from array (no repeats) */
const sample = (arr, n) => {
  const copy = [...arr];
  const result = [];
  for (let i = 0; i < Math.min(n, copy.length); i++) {
    const idx = rand(0, copy.length - 1);
    result.push(copy.splice(idx, 1)[0]);
  }
  return result;
};

/** Random past date within the last `days` days */
const pastDate = (days = 60) => {
  const d = new Date();
  d.setSeconds(d.getSeconds() - rand(60, days * 86400));
  return d;
};

// ─── Content library ──────────────────────────────────────────────────────────

const POST_CAPTIONS = [
  'Loving this view 🌅',
  "Can't believe how far I've come. Grateful for every step of the journey.",
  "New week, new goals. Let's get it 💪",
  'Sometimes you just need a good coffee and a great playlist ☕🎵',
  'Spent the afternoon exploring the city. Hidden gems everywhere.',
  'Working on something exciting. Stay tuned 👀',
  'Good vibes only this weekend 🙌',
  'Throwback to one of my favorite moments this year.',
  'Consistency is the real superpower. Keep showing up.',
  "Big things coming. Can't say much yet but I'm hyped.",
  'Grateful for the people who check on me without being asked.',
  'Learning something new every single day.',
  'This city never sleeps and neither do I apparently 😅',
  'Sunsets like these remind me why I love where I live.',
  'Taking a little break from everything. Back soon 🌿',
  'Just posted a new blog — link in bio!',
  'Sunday reset: journaling, stretching, meal prep. Self-care looks different for everyone.',
  'Ran into an old friend today. Some connections just never fade.',
  "Excited to announce I'll be speaking at an event next month!",
  'Never underestimate the power of a fresh start.',
  'On the road again ✈️ Who wants a postcard?',
  'Creating content that actually matters to me. Quality over quantity.',
  'Had the best dinner with some incredible humans tonight.',
  'Pushing limits, breaking barriers, loving the process.',
  'Real ones know the grind behind the highlight reel.',
  'This project has been months in the making. Finally ready to share.',
  'Mental health check: how are you really doing today?',
  'The best investment you can make is in yourself.',
  'Celebrating small wins because they add up to big ones.',
  "First time trying this and I'm obsessed 😍",
];

const COMMENT_TEXTS = [
  'Love this! 🔥',
  'This is everything! 🙌',
  'So inspiring, thank you for sharing.',
  'Goals! Keep it up.',
  'This made my day.',
  'I needed to see this today.',
  'Incredible work, as always.',
  "Can't stop watching this 😂",
  "You're killing it!",
  'his is amazing 💯',
  'So proud of you!',
  'Where was this taken?',
  'Tag me next time!',
  'Obsessed with this content.',
  'Always delivering the best stuff.',
  'This hit different today.',
  'Following for more of this!',
  'Drop the details in the comments please!',
  'You have no idea how much this means to me.',
  'Saved. Will share with everyone I know.',
];

// Unsplash images by category (stable URLs, no auth needed)
const IMAGE_POOLS = {
  lifestyle: [
    'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1551632811-561732d1e306?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1447752875215-b2761acb3c5d?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?w=800&auto=format&fit=crop',
  ],
  city: [
    'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1480714378408-67cf0d13bc1b?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1514565131-fce0801e6f64?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1522083165195-3424ed129620?w=800&auto=format&fit=crop',
  ],
  food: [
    'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1495147466023-ac5c588e2e94?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1476224203421-9ac39bcb3327?w=800&auto=format&fit=crop',
  ],
  fitness: [
    'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1526506118085-60ce8714f8c5?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1548690312-e3b507d8c110?w=800&auto=format&fit=crop',
  ],
  tech: [
    'https://images.unsplash.com/photo-1518770660439-4636190af475?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1531297484001-80022131f5a1?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=800&auto=format&fit=crop',
  ],
  portrait: [
    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=800&auto=format&fit=crop',
  ],
};

const ALL_IMAGES = Object.values(IMAGE_POOLS).flat();

// Story-sized (portrait) images
const STORY_IMAGES = [
  'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=600&h=1067&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1501854140801-50d01698950b?w=600&h=1067&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1523712999610-f77fbcfc3843?w=600&h=1067&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1490750967868-88df5691cc64?w=600&h=1067&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=600&h=1067&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1470770841072-f978cf4d019e?w=600&h=1067&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1487088678257-3a541e6e3922?w=600&h=1067&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1433086966358-54859d0ed716?w=600&h=1067&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1518020382113-a7e8fc38eac9?w=600&h=1067&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1528360983277-13d401cdc186?w=600&h=1067&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1511367461989-f85a21fda167?w=600&h=1067&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1488563058818-4a2c9a7fcbdb?w=600&h=1067&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1542831371-29b0f74f9713?w=600&h=1067&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1493612276216-ee3925520721?w=600&h=1067&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1503023345310-bd7c1de61c7d?w=600&h=1067&auto=format&fit=crop',
];

const LOCATIONS = [
  'New York, NY',
  'Los Angeles, CA',
  'Miami, FL',
  'Chicago, IL',
  'Austin, TX',
  'Seattle, WA',
  'Denver, CO',
  'Nashville, TN',
  'San Francisco, CA',
  'Boston, MA',
  null,
  null,
  null, // nulls so ~30% of posts have no location
];

// ─── Core seed functions ───────────────────────────────────────────────────────

/**
 * Ensure every user has a socialProfile row.
 */
async function ensureSocialProfiles(userIds) {
  const existing = await db.query.socialProfiles.findMany({
    where: inArray(socialProfiles.userId, userIds),
    columns: { userId: true },
  });
  const existingSet = new Set(existing.map(p => p.userId));
  const missing = userIds.filter(id => !existingSet.has(id));

  if (missing.length > 0) {
    await db.insert(socialProfiles).values(
      missing.map(userId => ({
        userId,
        isPublic: true,
        followersCount: 0,
        followingCount: 0,
        postsCount: 0,
        profileViewsCount: 0,
        coverImages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }))
    );
    console.log(`  ✅ Created ${missing.length} missing social profiles`);
  }
}

/**
 * Seed mutual follows so users have a real social graph.
 * Each user follows ~40–70% of other users.
 */
async function seedFollows(userIds) {
  console.log('\n👥  Seeding follows...');

  const existing = await db.query.userFollows.findMany({
    columns: { followerId: true, followingId: true },
  });
  const existingSet = new Set(existing.map(f => `${f.followerId}:${f.followingId}`));

  const toInsert = [];

  for (const followerId of userIds) {
    const others = userIds.filter(id => id !== followerId);
    const toFollow = sample(
      others,
      rand(Math.floor(others.length * 0.4), Math.floor(others.length * 0.7))
    );

    for (const followingId of toFollow) {
      if (!existingSet.has(`${followerId}:${followingId}`)) {
        toInsert.push({
          followerId,
          followingId,
          createdAt: pastDate(90),
        });
        existingSet.add(`${followerId}:${followingId}`);
      }
    }
  }

  if (toInsert.length > 0) {
    // Insert in batches of 100
    for (let i = 0; i < toInsert.length; i += 100) {
      await db
        .insert(userFollows)
        .values(toInsert.slice(i, i + 100))
        .onConflictDoNothing();
    }
    console.log(`  ✅ Created ${toInsert.length} follow relationships`);

    // Update follower / following counts
    for (const userId of userIds) {
      const [{ followersCount }] = await db
        .select({ followersCount: sql`count(*)::int` })
        .from(userFollows)
        .where(eq(userFollows.followingId, userId));

      const [{ followingCount }] = await db
        .select({ followingCount: sql`count(*)::int` })
        .from(userFollows)
        .where(eq(userFollows.followerId, userId));

      await db
        .update(socialProfiles)
        .set({ followersCount, followingCount, updatedAt: new Date() })
        .where(eq(socialProfiles.userId, userId));
    }
  } else {
    console.log('  ⚠️  All follows already exist, skipping');
  }
}

/**
 * Seed posts for each user (3–8 posts per user, skip if already has posts).
 * Returns a flat list of all created post IDs.
 */
async function seedPosts(userIds) {
  console.log('\n📝  Seeding posts...');

  const allPostIds = [];

  for (const userId of userIds) {
    // Skip if user already has posts
    const existingPost = await db.query.posts.findFirst({
      where: eq(posts.userId, userId),
      columns: { id: true },
    });
    if (existingPost) {
      // Collect existing post IDs for likes/comments seeding
      const userPosts = await db.query.posts.findMany({
        where: eq(posts.userId, userId),
        columns: { id: true },
      });
      allPostIds.push(...userPosts.map(p => p.id));
      continue;
    }

    const postCount = rand(3, 8);
    const userPostIds = [];

    for (let i = 0; i < postCount; i++) {
      const hasMedia = Math.random() > 0.25; // 75% of posts have images
      const mediaCount = hasMedia ? rand(1, 3) : 0;
      const mediaUrls = hasMedia ? sample(ALL_IMAGES, mediaCount) : [];
      const mediaTypes = mediaUrls.map(() => 'image');
      const aspectRatios = mediaUrls.map(() => {
        const ratios = ['1:1', '4:5', '16:9', '3:4'];
        return ratios[rand(0, ratios.length - 1)];
      });

      const caption = POST_CAPTIONS[rand(0, POST_CAPTIONS.length - 1)];
      const location = LOCATIONS[rand(0, LOCATIONS.length - 1)];
      const visibility = Math.random() > 0.1 ? 'public' : 'followers';
      const createdAt = pastDate(60);

      const [post] = await db
        .insert(posts)
        .values({
          userId,
          caption,
          mediaUrls,
          mediaTypes,
          aspectRatios,
          location,
          visibility,
          tags: [],
          settings: { commentsDisabled: false, hideLikes: false },
          likesCount: 0,
          commentsCount: 0,
          sharesCount: 0,
          repostsCount: 0,
          viewsCount: rand(10, 500),
          isArchived: false,
          createdAt,
          updatedAt: createdAt,
        })
        .returning({ id: posts.id });

      userPostIds.push(post.id);
    }

    allPostIds.push(...userPostIds);

    // Update postsCount on social profile
    await db
      .update(socialProfiles)
      .set({ postsCount: userPostIds.length, updatedAt: new Date() })
      .where(eq(socialProfiles.userId, userId));

    console.log(`  ✅ ${userPostIds.length} posts created for user ${userId.slice(0, 8)}…`);
  }

  return allPostIds;
}

/**
 * Seed likes on posts — each user likes ~30–60% of all posts.
 */
async function seedPostLikes(userIds, postIds) {
  console.log('\n❤️   Seeding post likes...');

  if (postIds.length === 0) {
    console.log('  ⚠️  No posts to like, skipping');
    return;
  }

  // Check existing likes to avoid conflicts
  const existingLikes = await db.query.postLikes.findMany({
    columns: { postId: true, userId: true },
  });
  const existingSet = new Set(existingLikes.map(l => `${l.postId}:${l.userId}`));

  const toInsert = [];
  const likeCounts = new Map(); // postId → count

  for (const userId of userIds) {
    const postsToLike = sample(
      postIds,
      rand(Math.floor(postIds.length * 0.3), Math.floor(postIds.length * 0.6))
    );

    for (const postId of postsToLike) {
      const key = `${postId}:${userId}`;
      if (!existingSet.has(key)) {
        toInsert.push({ postId, userId, createdAt: pastDate(30) });
        existingSet.add(key);
        likeCounts.set(postId, (likeCounts.get(postId) || 0) + 1);
      }
    }
  }

  if (toInsert.length > 0) {
    for (let i = 0; i < toInsert.length; i += 200) {
      await db
        .insert(postLikes)
        .values(toInsert.slice(i, i + 200))
        .onConflictDoNothing();
    }

    // Update likesCount on each post
    for (const [postId, count] of likeCounts.entries()) {
      await db
        .update(posts)
        .set({ likesCount: sql`${posts.likesCount} + ${count}` })
        .where(eq(posts.id, postId));
    }

    console.log(`  ✅ ${toInsert.length} post likes created`);
  } else {
    console.log('  ⚠️  All post likes already exist, skipping');
  }
}

/**
 * Seed comments on posts — each user comments on ~10–25% of posts.
 */
async function seedPostComments(userIds, postIds) {
  console.log('\n💬  Seeding post comments...');

  if (postIds.length === 0) {
    console.log('  ⚠️  No posts to comment on, skipping');
    return;
  }

  // Fetch existing postUserComments to avoid unique constraint violations
  const existingCommented = await db.query.postUserComments.findMany({
    columns: { postId: true, userId: true },
  });
  const commentedSet = new Set(existingCommented.map(c => `${c.postId}:${c.userId}`));

  let totalComments = 0;

  for (const userId of userIds) {
    const postsToComment = sample(
      postIds,
      rand(Math.floor(postIds.length * 0.1), Math.floor(postIds.length * 0.25))
    );

    for (const postId of postsToComment) {
      const commentKey = `${postId}:${userId}`;
      if (commentedSet.has(commentKey)) continue;

      const content = COMMENT_TEXTS[rand(0, COMMENT_TEXTS.length - 1)];
      const createdAt = pastDate(20);

      // Insert comment
      const [comment] = await db
        .insert(postComments)
        .values({
          postId,
          userId,
          content,
          createdAt,
          updatedAt: createdAt,
        })
        .returning({ id: postComments.id });

      // Insert postUserComments tracking row (unique per post+user)
      await db
        .insert(postUserComments)
        .values({
          postId,
          userId,
          commentId: comment.id,
          commentedAt: createdAt,
        })
        .onConflictDoNothing();

      commentedSet.add(commentKey);
      totalComments++;

      // Increment commentsCount
      await db
        .update(posts)
        .set({ commentsCount: sql`${posts.commentsCount} + 1` })
        .where(eq(posts.id, postId));
    }
  }

  if (totalComments > 0) {
    console.log(`  ✅ ${totalComments} post comments created`);
  } else {
    console.log('  ⚠️  All comments already exist, skipping');
  }
}

/**
 * Seed stories for each user (1–4 stories, skip if already has active stories).
 */
async function seedStories(userIds) {
  console.log('\n📸  Seeding stories...');

  let totalCreated = 0;

  for (const userId of userIds) {
    // Skip if user already has active (non-expired) stories
    const existingStory = await db.query.stories.findFirst({
      where: eq(stories.userId, userId),
      columns: { id: true },
    });
    if (existingStory) continue;

    const storyCount = rand(1, 4);
    const storyImages = sample(STORY_IMAGES, storyCount);

    for (const mediaUrl of storyImages) {
      // Spread stories: some active (within 24h), some nearly expired
      const hoursAgo = rand(1, 23);
      const createdAt = new Date();
      createdAt.setHours(createdAt.getHours() - hoursAgo);
      const expiresAt = new Date(createdAt);
      expiresAt.setHours(expiresAt.getHours() + 24);

      const captions = [
        null,
        "Today's vibe ✨",
        'Living in the moment 🙌',
        'Good things are coming 🌟',
        'Grateful for days like this',
        '📍 Here right now',
        null,
        null,
      ];
      const caption = captions[rand(0, captions.length - 1)];
      const visibility = Math.random() > 0.2 ? 'public' : 'followers';

      await db.insert(stories).values({
        userId,
        mediaUrl,
        mediaType: 'image',
        caption,
        meta: null,
        visibility,
        viewsCount: rand(5, 200),
        likesCount: rand(0, 30),
        commentsCount: 0,
        sharesCount: 0,
        expiresAt,
        createdAt,
      });

      totalCreated++;
    }
  }

  if (totalCreated > 0) {
    console.log(`  ✅ ${totalCreated} stories created`);
  } else {
    console.log('  ⚠️  All users already have stories, skipping');
  }
}

/**
 * Seed story views — each user views ~50–80% of others' stories.
 */
async function seedStoryViews(userIds) {
  console.log('\n👁️   Seeding story views...');

  const allStories = await db.query.stories.findMany({
    where: inArray(stories.userId, userIds),
    columns: { id: true, userId: true },
  });

  if (allStories.length === 0) {
    console.log('  ⚠️  No stories to view, skipping');
    return;
  }

  const existing = await db.query.storyViews.findMany({
    columns: { storyId: true, userId: true },
  });
  const existingSet = new Set(existing.map(v => `${v.storyId}:${v.userId}`));

  const toInsert = [];

  for (const userId of userIds) {
    const otherStories = allStories.filter(s => s.userId !== userId);
    const toView = sample(
      otherStories,
      rand(Math.floor(otherStories.length * 0.5), Math.floor(otherStories.length * 0.8))
    );

    for (const story of toView) {
      const key = `${story.id}:${userId}`;
      if (!existingSet.has(key)) {
        toInsert.push({ storyId: story.id, userId, viewedAt: pastDate(1) });
        existingSet.add(key);
      }
    }
  }

  if (toInsert.length > 0) {
    for (let i = 0; i < toInsert.length; i += 200) {
      await db
        .insert(storyViews)
        .values(toInsert.slice(i, i + 200))
        .onConflictDoNothing();
    }
    console.log(`  ✅ ${toInsert.length} story views created`);
  } else {
    console.log('  ⚠️  All story views already exist, skipping');
  }
}

/**
 * Seed story likes — each user likes ~20–40% of others' stories.
 */
async function seedStoryLikes(userIds) {
  console.log('\n💖  Seeding story likes...');

  const allStories = await db.query.stories.findMany({
    where: inArray(stories.userId, userIds),
    columns: { id: true, userId: true },
  });

  if (allStories.length === 0) {
    console.log('  ⚠️  No stories to like, skipping');
    return;
  }

  const existing = await db.query.storyLikes.findMany({
    columns: { storyId: true, userId: true },
  });
  const existingSet = new Set(existing.map(l => `${l.storyId}:${l.userId}`));

  const toInsert = [];
  const likeCounts = new Map();

  for (const userId of userIds) {
    const otherStories = allStories.filter(s => s.userId !== userId);
    const toLike = sample(
      otherStories,
      rand(Math.floor(otherStories.length * 0.2), Math.floor(otherStories.length * 0.4))
    );

    for (const story of toLike) {
      const key = `${story.id}:${userId}`;
      if (!existingSet.has(key)) {
        toInsert.push({ storyId: story.id, userId, createdAt: pastDate(1) });
        existingSet.add(key);
        likeCounts.set(story.id, (likeCounts.get(story.id) || 0) + 1);
      }
    }
  }

  if (toInsert.length > 0) {
    for (let i = 0; i < toInsert.length; i += 200) {
      await db
        .insert(storyLikes)
        .values(toInsert.slice(i, i + 200))
        .onConflictDoNothing();
    }

    // Update likesCount on stories
    for (const [storyId, count] of likeCounts.entries()) {
      await db
        .update(stories)
        .set({ likesCount: sql`${stories.likesCount} + ${count}` })
        .where(eq(stories.id, storyId));
    }

    console.log(`  ✅ ${toInsert.length} story likes created`);
  } else {
    console.log('  ⚠️  All story likes already exist, skipping');
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function seedSocial() {
  console.log('\n🌱  Starting social seed (posts + stories)...\n');

  // ── 1. Load all users ────────────────────────────────────────────────────
  const allUsers = await db.query.users.findMany({
    columns: { id: true, username: true },
  });

  if (allUsers.length === 0) {
    console.log('❌  No users found. Run seed:users first.');
    return;
  }

  const userIds = allUsers.map(u => u.id);
  console.log(`Found ${userIds.length} users to seed social content for.`);

  // ── 2. Ensure social profiles ────────────────────────────────────────────
  await ensureSocialProfiles(userIds);

  // ── 3. Follows ───────────────────────────────────────────────────────────
  await seedFollows(userIds);

  // ── 4. Posts ─────────────────────────────────────────────────────────────
  const allPostIds = await seedPosts(userIds);
  console.log(`\n  📊 Total posts in DB: ${allPostIds.length}`);

  // ── 5. Likes on posts ────────────────────────────────────────────────────
  await seedPostLikes(userIds, allPostIds);

  // ── 6. Comments on posts ─────────────────────────────────────────────────
  await seedPostComments(userIds, allPostIds);

  // ── 7. Stories ───────────────────────────────────────────────────────────
  await seedStories(userIds);

  // ── 8. Story views ───────────────────────────────────────────────────────
  await seedStoryViews(userIds);

  // ── 9. Story likes ───────────────────────────────────────────────────────
  await seedStoryLikes(userIds);

  console.log('\n🎉  Social seed complete!\n');
  console.log('────────────────────────────────────────────────────────');
  console.log(`  Users seeded   : ${userIds.length}`);
  console.log(`  Posts created  : varies (3–8 per user)`);
  console.log(`  Stories created: varies (1–4 per user, active 24h)`);
  console.log('  Likes, comments, views, follows: distributed randomly');
  console.log('────────────────────────────────────────────────────────\n');
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main() {
  try {
    await seedSocial();
    process.exit(0);
  } catch (err) {
    console.error('\n❌  Error seeding social content:', err);
    process.exit(1);
  }
}

if (process.argv[1] === __filename) {
  main();
}

export { seedSocial };
