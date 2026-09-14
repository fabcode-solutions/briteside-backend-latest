import 'dotenv/config';
import { FEATURE_REGISTRY } from '../src/constants/features.js';
import { loadSecrets } from '../src/config/secrets.js';

// config.js parses process.env at module load, and the real Stripe key lives in AWS
// Secrets Manager (.env is a stub) — so secrets must be populated before anything
// that reads config is imported. Static imports hoist above statements, so these have
// to be dynamic. Skip this and the script silently takes the stub-plan branch below,
// writing plan rows with no Stripe product or price attached.
await loadSecrets();

const { db } = await import('../src/db/index.js');
const { subscriptionPlans, subscriptionFeatures } = await import('../src/db/schema/index.js');
const { SubscriptionService } = await import('../src/services/subscription.service.js');
const { default: config } = await import('../src/config/config.js');

// All features from the registry are included in every plan by default.
// Admin can remove individual features per plan via the admin API.
const ALL_FEATURES = FEATURE_REGISTRY.map(f => ({ featureKey: f.key, featureLabel: f.label }));

const plans = [
  {
    name: 'BriteSide Plus Monthly',
    description: 'Unlock premium features with BriteSide Plus — billed monthly.',
    price: '35.00',
    interval: 'month',
    isActive: true,
    displayOrder: 1,
    features: ALL_FEATURES,
  },
];

async function seedSubscriptionPlans() {
  console.log('Seeding subscription plans...');

  const existing = await db.query.subscriptionPlans.findMany();
  if (existing.length > 0) {
    console.log('Subscription plans already exist, skipping seed');
    return;
  }

  const hasStripe = Boolean(config.stripe?.secretKey);

  for (const planData of plans) {
    if (hasStripe) {
      // Create plan via service so Stripe product + price are provisioned
      const plan = await SubscriptionService.createPlan(planData, null);
      console.log(
        `  Created plan (with Stripe): ${plan.name} (${planData.features.length} features)`
      );
    } else {
      // Stripe not configured — insert stub plan for local development
      console.warn('  STRIPE_SECRET_KEY not set — creating stub plan without Stripe price.');
      const { features, ...rest } = planData;
      const now = new Date();
      const [plan] = await db
        .insert(subscriptionPlans)
        .values({ ...rest, createdAt: now, updatedAt: now })
        .returning();

      if (features?.length) {
        await db.insert(subscriptionFeatures).values(
          features.map(f => ({
            planId: plan.id,
            ...f,
            createdAt: now,
          }))
        );
      }

      console.log(
        `  Created stub plan: ${plan.name} (${features.length} features) — no Stripe price`
      );
    }
  }

  console.log('Subscription plans seeded successfully');
}

async function main() {
  try {
    await seedSubscriptionPlans();
    process.exit(0);
  } catch (error) {
    console.error('Error seeding subscription plans:', error);
    process.exit(1);
  }
}

main();
