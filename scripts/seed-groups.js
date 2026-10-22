import 'dotenv/config';
import { db } from '../src/db/index.js';
import {
  users,
  groups,
  groupMembers,
  groupCategories,
  groupSubscriptionTiers,
} from '../src/db/schema/index.js';
import { eq, inArray, sql } from 'drizzle-orm';

/**
 * Seeds a handful of free and paid groups (idempotent: matched by slug).
 *
 * - Owner: SEED_GROUP_OWNER_EMAIL, else the first seeded user (run `npm run seed:users` first).
 * - Members: the other seeded users are added to the free groups so member counts look real.
 * - Paid groups follow the app's rules (private, no approval step) and get a default
 *   "Membership" tier. The tier is inserted WITHOUT Stripe ids, so listing/detail pages work but
 *   real checkout needs the tier recreated through the app (GroupSubscriptionService.createTier).
 */

const GROUP_CATEGORIES = [
  { name: 'Fitness & Wellness', emoji: '💪', description: 'Workouts, running clubs and wellbeing' },
  { name: 'Tech & Startups', emoji: '💻', description: 'Developers, founders and builders' },
  { name: 'Arts & Creativity', emoji: '🎨', description: 'Photography, design and making things' },
  { name: 'Food & Drink', emoji: '🍜', description: 'Cooking, tasting and dining out' },
];

const location = {
  nyc: {
    address: 'Midtown Manhattan, New York, NY',
    city: 'New York',
    state: 'NY',
    country: 'USA',
    countryCode: 'US',
    postalCode: '10001',
    latitude: '40.75060000',
    longitude: '-73.99340000',
  },
  sf: {
    address: 'SoMa, San Francisco, CA',
    city: 'San Francisco',
    state: 'CA',
    country: 'USA',
    countryCode: 'US',
    postalCode: '94103',
    latitude: '37.77490000',
    longitude: '-122.41940000',
  },
  austin: {
    address: 'Downtown Austin, TX',
    city: 'Austin',
    state: 'TX',
    country: 'USA',
    countryCode: 'US',
    postalCode: '78701',
    latitude: '30.26720000',
    longitude: '-97.74310000',
  },
  la: {
    address: 'Downtown Los Angeles, CA',
    city: 'Los Angeles',
    state: 'CA',
    country: 'USA',
    countryCode: 'US',
    postalCode: '90012',
    latitude: '34.05220000',
    longitude: '-118.24370000',
  },
};

const GROUPS = [
  // ───── Free (public) ─────
  {
    slug: 'nyc-morning-runners',
    name: 'NYC Morning Runners',
    description:
      'Early-bird runners meeting in Central Park every weekday at 6:30am. All paces welcome, from first 5K to marathon training.',
    category: 'Fitness & Wellness',
    location: location.nyc,
    maxMembers: 500,
  },
  {
    slug: 'sf-indie-hackers',
    name: 'SF Indie Hackers',
    description:
      'Solo founders and side-project builders sharing progress, feedback and launch tips. Monthly demo nights in SoMa.',
    category: 'Tech & Startups',
    location: location.sf,
  },
  {
    slug: 'austin-street-photographers',
    name: 'Austin Street Photographers',
    description:
      'Weekend photo walks, gear talk and monthly critiques for photographers of every level.',
    category: 'Arts & Creativity',
    location: location.austin,
  },
  {
    slug: 'la-home-cooks-collective',
    name: 'LA Home Cooks Collective',
    description:
      'Swap recipes, host potlucks and explore LA markets together. Beginners and seasoned cooks both welcome.',
    category: 'Food & Drink',
    location: location.la,
    requiresApproval: true,
  },

  // ───── Paid (private, subscription) ─────
  {
    slug: 'nyc-elite-fitness-club',
    name: 'NYC Elite Fitness Club',
    description:
      'Members-only training programs, weekly coached sessions and a private community with nutrition guidance.',
    category: 'Fitness & Wellness',
    location: location.nyc,
    paid: {
      price: '19.99',
      interval: 'monthly',
      description: 'Weekly coached sessions and full program access',
      features: 'Weekly coached sessions, Training programs, Nutrition guidance, Private community',
    },
  },
  {
    slug: 'founders-circle-sf',
    name: "Founders' Circle SF",
    description:
      'A curated, paid mastermind for early-stage founders: peer advisory, investor intros and private AMAs.',
    category: 'Tech & Startups',
    location: location.sf,
    maxMembers: 150,
    paid: {
      price: '49.00',
      interval: 'monthly',
      description: 'Peer advisory, investor intros and private AMAs',
      features: 'Peer advisory pods, Investor introductions, Monthly AMAs, Member directory',
    },
  },
  {
    slug: 'pro-photography-masterclass',
    name: 'Pro Photography Masterclass',
    description:
      'In-depth lessons, RAW editing walkthroughs and portfolio reviews from working professionals.',
    category: 'Arts & Creativity',
    location: location.austin,
    paid: {
      price: '149.00',
      interval: 'yearly',
      description: 'Full year of lessons, editing walkthroughs and portfolio reviews',
      features: 'Video lessons, RAW editing walkthroughs, Portfolio reviews, Presets library',
    },
  },
];

async function getOwner() {
  const email = process.env.SEED_GROUP_OWNER_EMAIL;
  if (email) {
    const u = await db.query.users.findFirst({ where: eq(users.email, email) });
    if (!u) throw new Error(`Owner not found: ${email}`);
    return u;
  }
  const [first] = await db.select().from(users).orderBy(users.createdAt).limit(1);
  if (!first) throw new Error('No users found. Run `npm run seed:users` first.');
  return first;
}

async function ensureCategories() {
  const map = {};
  for (const c of GROUP_CATEGORIES) {
    let row = await db.query.groupCategories.findFirst({ where: eq(groupCategories.name, c.name) });
    if (!row) {
      [row] = await db.insert(groupCategories).values(c).returning();
      console.log(`  + category: ${c.name}`);
    }
    map[c.name] = row.id;
  }
  return map;
}

async function main() {
  console.log('Seeding groups...');
  const owner = await getOwner();
  console.log(`Owner: ${owner.email}`);

  const categoryIds = await ensureCategories();

  const others = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`${users.id} <> ${owner.id}`)
    .limit(10);

  for (const g of GROUPS) {
    const isPaid = Boolean(g.paid);

    let group = await db.query.groups.findFirst({ where: eq(groups.slug, g.slug) });
    if (group) {
      console.log(`  = exists: ${g.name}`);
    } else {
      [group] = await db
        .insert(groups)
        .values({
          name: g.name,
          slug: g.slug,
          description: g.description,
          categoryId: categoryIds[g.category],
          ...g.location,
          maxMembers: g.maxMembers ?? null,
          // Mirrors GroupService.enforceGroupPrivacyRules: paid groups are always private, no approval.
          isPublic: !isPaid,
          requiresApproval: isPaid ? false : (g.requiresApproval ?? false),
          isPaid,
          subscriptionPrice: isPaid ? g.paid.price : null,
          createdBy: owner.id,
        })
        .returning();
      console.log(`  + ${isPaid ? 'paid' : 'free'}: ${g.name}`);
    }

    await db
      .insert(groupMembers)
      .values({ groupId: group.id, userId: owner.id, role: 'admin', status: 'joined' })
      .onConflictDoNothing();

    if (isPaid) {
      const existingTier = await db.query.groupSubscriptionTiers.findFirst({
        where: eq(groupSubscriptionTiers.groupId, group.id),
      });
      if (!existingTier) {
        await db.insert(groupSubscriptionTiers).values({
          groupId: group.id,
          name: 'Membership',
          description: g.paid.description,
          price: g.paid.price,
          billingInterval: g.paid.interval,
          features: g.paid.features,
        });
        console.log('      tier: Membership');
      }
    } else if (others.length) {
      // Free groups get a few joined members; paid groups only get members via real checkout.
      await db
        .insert(groupMembers)
        .values(
          others.slice(0, 6).map(u => ({
            groupId: group.id,
            userId: u.id,
            role: 'member',
            status: 'joined',
          }))
        )
        .onConflictDoNothing();
    }

    // Keep the denormalised counter in sync with the real joined members.
    await db
      .update(groups)
      .set({
        memberCount: sql`(SELECT count(*) FROM group_members WHERE group_id = ${group.id} AND status = 'joined')`,
      })
      .where(eq(groups.id, group.id));
  }

  console.log('Done.');
  process.exit(0);
}

main().catch(err => {
  console.error('Seeding groups failed:', err);
  process.exit(1);
});
