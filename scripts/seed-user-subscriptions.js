import 'dotenv/config';
import { db } from '../src/db/index.js';
import {
  stripeCustomers,
  subscriptionPlans,
  userSubscriptions,
  subscriptionAuditLogs,
  users,
} from '../src/db/schema/index.js';
import { eq, and } from 'drizzle-orm';

function addDays(d, days) {
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}

const targets = [
  {
    email: 'peter.parker@gmail.com',
    planName: 'BriteSide Plus Monthly',
    status: 'active',
    periodDays: 30,
  },
  {
    email: 'tony.stark@gmail.com',
    planName: 'BriteSide Plus Yearly',
    status: 'active',
    periodDays: 365,
  },
  {
    email: 'steve.rogers@gmail.com',
    planName: 'BriteSide Plus Monthly',
    status: 'canceled',
    periodDays: 30,
    cancelAtPeriodEnd: true,
    canceledAtNow: true,
  },
  {
    email: 'natasha.romanoff@gmail.com',
    planName: 'BriteSide Plus Monthly',
    status: 'comped',
    periodDays: 30,
    grantReason: 'Comped for QA',
  },
];

export async function seedUserSubscriptions() {
  console.log('Seeding user subscriptions...');
  const now = new Date();

  // Ensure plans exist (create minimal fallback if missing)
  let monthlyPlan = await db.query.subscriptionPlans.findFirst({
    where: eq(subscriptionPlans.name, 'BriteSide Plus Monthly'),
  });
  let yearlyPlan = await db.query.subscriptionPlans.findFirst({
    where: eq(subscriptionPlans.name, 'BriteSide Plus Yearly'),
  });

  if (!monthlyPlan) {
    const [p] = await db
      .insert(subscriptionPlans)
      .values({
        name: 'BriteSide Plus Monthly',
        description: 'Auto-generated monthly plan (seed)',
        price: '9.99',
        interval: 'month',
        currency: 'usd',
        isActive: true,
        displayOrder: 1,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    monthlyPlan = p;
    console.log('  Created missing plan: BriteSide Plus Monthly');
  }

  if (!yearlyPlan) {
    const [p] = await db
      .insert(subscriptionPlans)
      .values({
        name: 'BriteSide Plus Yearly',
        description: 'Auto-generated yearly plan (seed)',
        price: '99.99',
        interval: 'year',
        currency: 'usd',
        isActive: true,
        displayOrder: 2,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    yearlyPlan = p;
    console.log('  Created missing plan: BriteSide Plus Yearly');
  }

  for (const t of targets) {
    try {
      const user = await db.query.users.findFirst({
        where: eq(users.email, t.email),
      });

      if (!user) {
        console.warn(`  User not found: ${t.email}, skipping`);
        continue;
      }

      // Ensure stripe customer
      let cust = await db.query.stripeCustomers.findFirst({
        where: eq(stripeCustomers.userId, user.id),
      });

      if (!cust) {
        const [createdCust] = await db
          .insert(stripeCustomers)
          .values({
            userId: user.id,
            stripeCustomerId: `test_cust_${user.id}`,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        cust = createdCust;
        console.log(`  Created stripe_customer for ${user.email}`);
      }

      const plan = t.planName.includes('Yearly') ? yearlyPlan : monthlyPlan;

      const existing = await db.query.userSubscriptions.findFirst({
        where: and(eq(userSubscriptions.userId, user.id), eq(userSubscriptions.planId, plan.id)),
      });

      if (existing) {
        console.log(`  Subscription already exists for ${user.email} -> ${plan.name}, skipping`);
        continue;
      }

      const start = now;
      const end = addDays(start, t.periodDays || 30);

      const subPayload = {
        userId: user.id,
        planId: plan.id,
        stripeSubscriptionId: `test_sub_${Math.random().toString(36).slice(2, 10)}`,
        status: t.status,
        currentPeriodStart: start,
        currentPeriodEnd: end,
        cancelAtPeriodEnd: !!t.cancelAtPeriodEnd,
        canceledAt: t.canceledAtNow ? now : null,
        grantedBy: null,
        grantReason: t.grantReason || null,
        metadata: {},
        createdAt: now,
        updatedAt: now,
      };

      const [createdSub] = await db.insert(userSubscriptions).values(subPayload).returning();
      console.log(`  Created subscription for ${user.email} -> ${plan.name} (${t.status})`);

      // Audit log
      await db.insert(subscriptionAuditLogs).values({
        userSubscriptionId: createdSub.id,
        planId: plan.id,
        actorId: null,
        actorType: 'system',
        action: t.status === 'comped' ? 'comped' : 'subscribed',
        previousValues: null,
        newValues: { status: createdSub.status },
        createdAt: now,
      });
    } catch (err) {
      console.error(`  Failed for ${t.email}:`, err.message || err);
    }
  }

  console.log('User subscription seeding complete.');
}

async function main() {
  try {
    await seedUserSubscriptions();
    process.exit(0);
  } catch (err) {
    console.error('Error seeding user subscriptions:', err);
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith('seed-user-subscriptions.js')) {
  main();
}
