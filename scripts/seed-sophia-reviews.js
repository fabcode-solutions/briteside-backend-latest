import 'dotenv/config';
/**
 * scripts/seed-sophia-reviews.js
 *
 * Seeds 20 realistic talent reviews for Sophia Martinez
 * (sophia.martinez@briteside.dev — Music / Vocal & Songwriting Coach).
 *
 * What it does:
 *   1. Finds Sophia's user + talent profile
 *   2. Uses existing seeded users as reviewers (from seed-users.js + seed-talent.js)
 *   3. Creates a completed talent_session per review (unique constraint: 1 review per session)
 *   4. Inserts talent_reviews rows
 *   5. Recomputes rating + reviewCount on her talent profile from the aggregate
 *
 * Safe to re-run — skips reviews that already exist for a session.
 *
 * Usage:
 *   node scripts/seed-sophia-reviews.js
 *
 * Add to package.json:
 *   "seed:sophia-reviews": "node scripts/seed-sophia-reviews.js"
 */

import { eq, and, sql, isNull } from 'drizzle-orm';
import { fileURLToPath } from 'url';
import { db } from '../src/db/index.js';
import { users } from '../src/db/schema/index.js';
import { talentProfiles } from '../src/db/schema/talentProfiles.js';
import { talentSessions } from '../src/db/schema/talentSessions.js';
import { talentReviews } from '../src/db/schema/talentReviews.js';

const __filename = fileURLToPath(import.meta.url);

// ─── Review content library ────────────────────────────────────────────────────

const REVIEWS = [
  {
    rating: 5,
    communicationRating: 5,
    valueRating: 5,
    title: 'Life-changing vocal session',
    comment:
      "I came in barely able to hold a note in my chest voice and left with actual technique. Sophia broke down my breathing in a way no YouTube tutorial ever could. She's patient, precise, and genuinely invested in your growth. Already booked a follow-up.",
    durationMins: 60,
    subject: 'Chest voice technique and breath support',
    daysAgo: 3,
  },
  {
    rating: 5,
    communicationRating: 5,
    valueRating: 5,
    title: "Best songwriting session I've had",
    comment:
      'I had a half-finished chorus sitting in my notes app for six months. Sophia helped me unlock the verse structure in 30 minutes flat. She has this incredible ability to ask the right question at exactly the right moment. Highly recommend to any songwriter feeling stuck.',
    durationMins: 30,
    subject: 'Co-writing session — verse structure',
    daysAgo: 7,
  },
  {
    rating: 5,
    communicationRating: 5,
    valueRating: 4,
    title: 'Finally understand mixed voice',
    comment:
      "Sophia is the third vocal coach I've worked with and by far the best at explaining the mixed register. She gave me specific exercises I could practice daily and was clear about what to listen for. The 45-minute session flew by.",
    durationMins: 45,
    subject: 'Mixed voice and head voice blend',
    daysAgo: 12,
  },
  {
    rating: 5,
    communicationRating: 5,
    valueRating: 5,
    title: 'Grammy-caliber teaching, seriously',
    comment:
      "It's not just that she's talented — Sophia actually knows how to teach. She adapted her approach mid-session when she realized my issue was tension rather than technique. Every minute was focused and productive. Worth every cent.",
    durationMins: 60,
    subject: 'Tension release and resonance placement',
    daysAgo: 18,
  },
  {
    rating: 5,
    communicationRating: 4,
    valueRating: 5,
    title: 'My demo is finally submission-ready',
    comment:
      "I had a vocal demo that just was not landing with labels. Sophia listened, gave me specific notes on phrasing and dynamics, and I re-recorded after our session. Three days later I got a callback. Coincidence? Maybe. But I don't think so.",
    durationMins: 60,
    subject: 'Demo vocal prep and performance coaching',
    daysAgo: 22,
  },
  {
    rating: 4,
    communicationRating: 5,
    valueRating: 4,
    title: 'Great session, solid foundation work',
    comment:
      "Sophia is thorough and knowledgeable. My session focused on breath control fundamentals which felt basic at first, but I could hear the difference in my recordings within a week. The only thing I'd say is she covers a lot in 30 minutes — maybe book 60 for your first session.",
    durationMins: 30,
    subject: 'Breath control fundamentals',
    daysAgo: 28,
  },
  {
    rating: 5,
    communicationRating: 5,
    valueRating: 5,
    title: 'Knew exactly what I needed to hear',
    comment:
      "I went in defensive about my songwriting but Sophia has a way of framing critique that makes you excited to improve rather than deflated. She pointed out structural patterns I wasn't even aware of. Session was 45 minutes and I left with a full page of notes.",
    durationMins: 45,
    subject: 'Song structure review and feedback',
    daysAgo: 35,
  },
  {
    rating: 5,
    communicationRating: 5,
    valueRating: 5,
    title: 'Turned my hobby into something real',
    comment:
      'I have been singing in the shower for years and always wondered if I had anything worth developing. Sophia was honest, encouraging, and specific. She mapped out a 3-month practice plan in our 60-minute session. That alone was worth the price.',
    durationMins: 60,
    subject: 'Beginner assessment and roadmap',
    daysAgo: 40,
  },
  {
    rating: 4,
    communicationRating: 4,
    valueRating: 4,
    title: 'Solid technique, very professional',
    comment:
      'Sophia knows her stuff. My session was focused on stage presence — an area I never thought about as a vocalist. She gave me actionable tips I could apply immediately. Would have given 5 stars but we ran slightly over and had to cut the Q&A short.',
    durationMins: 45,
    subject: 'Stage presence for vocalists',
    daysAgo: 47,
  },
  {
    rating: 5,
    communicationRating: 5,
    valueRating: 5,
    title: "Unlocked something I didn't know I had",
    comment:
      "In 30 minutes Sophia found a weakness in my passaggio that I'd been compensating around for years. She didn't just point it out — she gave me three exercises to correct it and explained why each one works. This is what real coaching looks like.",
    durationMins: 30,
    subject: 'Passaggio and register transition',
    daysAgo: 52,
  },
  {
    rating: 5,
    communicationRating: 5,
    valueRating: 5,
    title: 'Incredible music theory explainer',
    comment:
      'I always avoided theory because it felt abstract. Sophia connected every concept directly to songs I know and love. By the end of our 60-minute session I understood chord progressions and Nashville notation well enough to start applying it in my writing the same day.',
    durationMins: 60,
    subject: 'Music theory for non-theory people',
    daysAgo: 58,
  },
  {
    rating: 5,
    communicationRating: 5,
    valueRating: 4,
    title: 'She diagnosed my voice instantly',
    comment:
      "Within the first five minutes of hearing me sing, Sophia identified that I was pulling chest voice too high. I'd been doing it for years without realizing. The rest of the session was dedicated to breaking that habit. She was right — my upper range opened up immediately.",
    durationMins: 45,
    subject: 'Vocal assessment and register balance',
    daysAgo: 63,
  },
  {
    rating: 4,
    communicationRating: 4,
    valueRating: 5,
    title: 'Great value for professional-level coaching',
    comment:
      'For what you get — Grammy-level expertise, structured feedback, and real exercises — the rate is very fair. My session on head voice was practical and measurable. I recorded myself before and after and the difference is clear. Would book again.',
    durationMins: 30,
    subject: 'Head voice development',
    daysAgo: 70,
  },
  {
    rating: 5,
    communicationRating: 5,
    valueRating: 5,
    title: 'The streaming industry insights alone were worth it',
    comment:
      "I asked Sophia about pitching originals to music supervisors and she gave me a 20-minute masterclass on how that world actually works. Then we spent the rest on my vocal performance. Two sessions in one, basically. She's generous with her knowledge.",
    durationMins: 60,
    subject: 'Pitching originals and streaming strategy',
    daysAgo: 75,
  },
  {
    rating: 5,
    communicationRating: 5,
    valueRating: 5,
    title: 'My confidence as a singer is completely different now',
    comment:
      "I always thought confidence was something you either had or didn't. Sophia showed me it's a skill you build with the right technique. When your voice does what you tell it to, the confidence follows. Three sessions in and I'm recording demos I'm actually proud of.",
    durationMins: 60,
    subject: 'Performance confidence and vocal control',
    daysAgo: 82,
  },
  {
    rating: 5,
    communicationRating: 5,
    valueRating: 5,
    title: 'Completely changed how I approach co-writing',
    comment:
      'I used to freeze in co-writes because I was afraid of sounding inexperienced. Sophia gave me frameworks for how to contribute ideas quickly and how to build on what another writer throws at you. Game-changing for anyone trying to break into professional songwriting.',
    durationMins: 45,
    subject: 'Co-writing skills and collaboration techniques',
    daysAgo: 90,
  },
  {
    rating: 4,
    communicationRating: 5,
    valueRating: 4,
    title: 'Really helpful, just need more time',
    comment:
      'Sophia packs a lot into each session. My only note is that 30 minutes goes fast — we barely got through the warmup and one exercise before time was up. The content was excellent and she was incredibly present and engaged. Just book 60 if you can.',
    durationMins: 30,
    subject: 'Vocal warmup routine and resonance',
    daysAgo: 97,
  },
  {
    rating: 5,
    communicationRating: 5,
    valueRating: 5,
    title: 'Found my sound after years of searching',
    comment:
      "I've been trying to find my artistic voice for three years. Sophia didn't tell me what my sound should be — she asked the right questions until I could articulate it myself. Then she showed me how to translate that into my vocal performance and songwriting choices. That's real mentorship.",
    durationMins: 60,
    subject: 'Artistic identity and sound development',
    daysAgo: 105,
  },
  {
    rating: 5,
    communicationRating: 4,
    valueRating: 5,
    title: 'Belting technique completely transformed',
    comment:
      'I could belt but it always felt forced and I knew I was going to lose my voice if I kept doing it. Sophia showed me how to access that power with support rather than strain. My throat thanked me immediately. Every singer who belts should book this session.',
    durationMins: 45,
    subject: 'Healthy belting technique',
    daysAgo: 112,
  },
  {
    rating: 5,
    communicationRating: 5,
    valueRating: 5,
    title: 'Still thinking about this session weeks later',
    comment:
      "We spent 60 minutes on lyric writing and melody relationship — something I'd never thought about systematically before. Sophia explained how the best songs have a conversation between the words and the notes. I've been applying it to every song since. This is the kind of insight you can't Google.",
    durationMins: 60,
    subject: 'Lyric and melody relationship',
    daysAgo: 120,
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Subtract days from now and return a Date */
const daysBack = days => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
};

/** Subtract a few more days for the session (before the review) */
const sessionDate = daysAgo => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo - 2); // session was 2 days before review
  return d;
};

// ─── Main ─────────────────────────────────────────────────────────────────────

async function seedSophiaReviews() {
  console.log('\n🎵  Seeding reviews for Sophia Martinez...\n');

  // ── 1. Find Sophia ─────────────────────────────────────────────────────────
  const sophiaUser = await db.query.users.findFirst({
    where: eq(users.email, 'sophia.martinez@briteside.dev'),
  });
  if (!sophiaUser) {
    console.error('❌  Sophia Martinez not found. Run seed:talent first.');
    process.exit(1);
  }

  const sophiaProfile = await db.query.talentProfiles.findFirst({
    where: and(eq(talentProfiles.userId, sophiaUser.id), isNull(talentProfiles.deletedAt)),
  });
  if (!sophiaProfile) {
    console.error("❌  Sophia's talent profile not found. Run seed:talent first.");
    process.exit(1);
  }

  console.log(
    `  ✅ Found Sophia: userId=${sophiaUser.id.slice(0, 8)}… profileId=${sophiaProfile.id.slice(0, 8)}…`
  );

  // ── 2. Load reviewer pool ──────────────────────────────────────────────────
  // Use all seeded users except Sophia herself as reviewers
  const allUsers = await db.query.users.findMany({
    columns: { id: true, email: true, firstName: true, lastName: true },
  });

  const reviewerPool = allUsers.filter(u => u.id !== sophiaUser.id);

  if (reviewerPool.length === 0) {
    console.error('❌  No other users found to act as reviewers. Run seed:users first.');
    process.exit(1);
  }

  console.log(`  Found ${reviewerPool.length} potential reviewers\n`);

  // ── 3. Seed each review ────────────────────────────────────────────────────
  let created = 0;
  let skipped = 0;

  for (let i = 0; i < REVIEWS.length; i++) {
    const review = REVIEWS[i];
    // Rotate through reviewer pool so we don't repeat the same person too much
    const reviewer = reviewerPool[i % reviewerPool.length];
    const scheduledAt = sessionDate(review.daysAgo);
    const reviewedAt = daysBack(review.daysAgo);

    // ── 3a. Create a completed session for this review ─────────────────────
    // The talent_reviews table has a unique constraint on sessionId,
    // so we need one session per review.
    const [session] = await db
      .insert(talentSessions)
      .values({
        talentProfileId: sophiaProfile.id,
        bookerId: reviewer.id,
        scheduledAt,
        durationMins: review.durationMins,
        joinAllowedAt: new Date(scheduledAt.getTime() - 5 * 60 * 1000),
        priceCents: Math.round((sophiaProfile.rates?.[String(review.durationMins)] || 100) * 100),
        status: 'completed',
        subject: review.subject,
        discussion: null,
        isGift: false,
        giftDetails: {},
        streamCallCid: `default:seed-sophia-${i}-${Date.now()}`,
        billingStartedAt: scheduledAt,
        billingEndedAt: new Date(scheduledAt.getTime() + review.durationMins * 60 * 1000),
        actualDurationMins: review.durationMins,
        createdAt: scheduledAt,
        updatedAt: scheduledAt,
      })
      .returning({ id: talentSessions.id });

    // ── 3b. Check if review already exists for this session ────────────────
    const existingReview = await db.query.talentReviews.findFirst({
      where: eq(talentReviews.sessionId, session.id),
    });

    if (existingReview) {
      console.log(`  ⚠️  Review already exists for session ${session.id.slice(0, 8)}…, skipping`);
      skipped++;
      continue;
    }

    // ── 3c. Insert review ──────────────────────────────────────────────────
    await db.insert(talentReviews).values({
      talentProfileId: sophiaProfile.id,
      reviewerId: reviewer.id,
      sessionId: session.id,
      rating: review.rating,
      communicationRating: review.communicationRating ?? null,
      valueRating: review.valueRating ?? null,
      title: review.title,
      comment: review.comment,
      isVisible: true,
      createdAt: reviewedAt,
      updatedAt: reviewedAt,
    });

    console.log(
      `  ✅ [${i + 1}/${REVIEWS.length}] ${review.rating}★ "${review.title.slice(0, 50)}…"` +
        `  — by ${reviewer.firstName} ${reviewer.lastName}`
    );
    created++;
  }

  // ── 4. Recompute Sophia's rating + reviewCount from the aggregate ──────────
  const [agg] = await db
    .select({
      avg: sql`round(avg(${talentReviews.rating})::numeric, 2)`,
      count: sql`count(*)::int`,
    })
    .from(talentReviews)
    .where(
      and(eq(talentReviews.talentProfileId, sophiaProfile.id), eq(talentReviews.isVisible, true))
    );

  await db
    .update(talentProfiles)
    .set({
      rating: String(agg.avg ?? '0.00'),
      reviewCount: agg.count ?? 0,
      updatedAt: new Date(),
    })
    .where(eq(talentProfiles.id, sophiaProfile.id));

  // ── 5. Summary ─────────────────────────────────────────────────────────────
  console.log('\n────────────────────────────────────────────────────────');
  console.log(`  Reviews created : ${created}`);
  console.log(`  Reviews skipped : ${skipped}`);
  console.log(`  New avg rating  : ${agg.avg} (${agg.count} total reviews)`);
  console.log('────────────────────────────────────────────────────────');
  console.log('\n🎉  Sophia Martinez reviews seeded successfully!\n');
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main() {
  try {
    await seedSophiaReviews();
    process.exit(0);
  } catch (err) {
    console.error("\n❌  Error seeding Sophia's reviews:", err);
    process.exit(1);
  }
}

if (process.argv[1] === __filename) {
  main();
}

export { seedSophiaReviews };
