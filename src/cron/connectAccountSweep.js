import { isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { talentProfiles } from '../db/schema/talentProfiles.js';
import { organizers } from '../db/schema/organizers.js';
import { StripeConnectService } from '../services/stripeConnect.service.js';
import { cronLogger as logger } from '../config/logger.js';

/**
 * Talent/organizer creation fires-and-forgets a Stripe Connect account create.
 * If that call fails (network blip, Stripe outage, etc.) nobody retries it —
 * the user is left with no connect account at all, so every future charge of
 * theirs silently skips the transfer and sits in the platform balance.
 *
 * Finds talents/organizers with no stripeConnectAccounts row and retries.
 */
export const sweepMissingConnectAccounts = async () => {
  const connected = await db.query.stripeConnectAccounts.findMany({
    columns: { userId: true },
  });
  const connectedIds = new Set(connected.map(c => c.userId));

  const talents = await db.query.talentProfiles.findMany({
    where: isNull(talentProfiles.deletedAt),
    columns: { userId: true },
    with: { user: { columns: { email: true } } },
  });
  const missingTalents = talents.filter(t => !connectedIds.has(t.userId));

  const allOrganizers = await db.query.organizers.findMany({
    columns: {
      userId: true,
      country: true,
      contactEmail: true,
      businessName: true,
      websiteUrl: true,
      contactPhone: true,
      businessType: true,
    },
  });
  const missingOrganizers = allOrganizers.filter(o => !connectedIds.has(o.userId));

  let talentsFixed = 0;
  for (const t of missingTalents) {
    try {
      const account = await StripeConnectService.createAccount(t.userId);
      await StripeConnectService.prefillAccount(account.stripeAccountId, {
        email: t.user?.email,
        businessType: 'individual',
      });
      talentsFixed++;
    } catch (err) {
      if (!err.message?.includes('already exists')) {
        logger.error('[ConnectSweep] talent connect account create failed', {
          userId: t.userId,
          error: err.message,
        });
      }
    }
  }

  let organizersFixed = 0;
  for (const o of missingOrganizers) {
    try {
      const account = await StripeConnectService.createAccount(o.userId, o.country || 'US');
      await StripeConnectService.prefillAccount(account.stripeAccountId, {
        email: o.contactEmail,
        businessName: o.businessName,
        websiteUrl: o.websiteUrl,
        contactPhone: o.contactPhone,
        businessType: o.businessType,
      });
      organizersFixed++;
    } catch (err) {
      if (!err.message?.includes('already exists')) {
        logger.error('[ConnectSweep] organizer connect account create failed', {
          userId: o.userId,
          error: err.message,
        });
      }
    }
  }

  if (talentsFixed || organizersFixed) {
    logger.info('[ConnectSweep] backfilled missing connect accounts', {
      talentsFixed,
      organizersFixed,
    });
  }

  return { talentsFixed, organizersFixed };
};
