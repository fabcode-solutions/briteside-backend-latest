import Stripe from 'stripe';
import { eq, desc, and, notInArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { talentIssues } from '../db/schema/talentIssues.js';
import { talentSessions } from '../db/schema/talentSessions.js';
import { priorityMessagePayments } from '../db/schema/priorityMessagePayments.js';
import { users } from '../db/schema/users.js';
import config from '../config/config.js';
import ApiError from '../utils/api-error.js';
import * as mailService from './mail.service.js';
import { UserSpendService } from './userSpend.service.js';
import { talentProfiles } from '../db/schema/talentProfiles.js';
import { TextModerationService, TEXT_ENTITY } from './moderation/textModeration.service.js';
const stripe = config.stripe?.secretKey ? new Stripe(config.stripe.secretKey) : null;

const VALID_ENTITY_TYPES = ['session', 'priority_message'];
const VALID_REASONS = ['no_reply', 'no_show', 'no_attend', 'other'];

export class TalentIssueService {
  // ── Customer: raise an issue ───────────────────────────────────────────────

  /**
   * POST /talent-issues
   *
   * @param {string} reporterId — authenticated customer user id
   * @param {{ entityType, entityId, reason, message }} input
   */
  static async createIssue(reporterId, { entityType, entityId, reason, message }) {
    if (!VALID_ENTITY_TYPES.includes(entityType))
      throw new ApiError(400, `entityType must be one of: ${VALID_ENTITY_TYPES.join(', ')}`);
    if (!VALID_REASONS.includes(reason))
      throw new ApiError(400, `reason must be one of: ${VALID_REASONS.join(', ')}`);
    if (!message?.trim()) throw new ApiError(400, 'message is required');

    let talentUserId, talentProfileId, amountCents, stripePaymentIntentId;

    if (entityType === 'session') {
      const session = await db.query.talentSessions.findFirst({
        where: eq(talentSessions.id, entityId),
      });
      if (!session) throw new ApiError(404, 'Session not found');
      if (session.bookerId !== reporterId) throw new ApiError(403, 'Not your booking');
      if (!['confirmed', 'completed', 'live'].includes(session.status))
        throw new ApiError(400, 'Issue can only be raised for a confirmed or completed session');

      const talentProfile = await db.query.talentProfiles.findFirst({
        where: eq(talentProfiles.id, session.talentProfileId),
        columns: { userId: true },
      });
      if (!talentProfile) throw new ApiError(404, 'Talent profile not found for this session');

      talentUserId = talentProfile.userId;
      talentProfileId = session.talentProfileId;
      amountCents = session.priceCents;
      stripePaymentIntentId = session.stripePaymentIntentId ?? null;
    } else {
      // priority_message branch — unchanged for now, see note below
      const payment = await db.query.priorityMessagePayments.findFirst({
        where: eq(priorityMessagePayments.id, entityId),
      });
      if (!payment) throw new ApiError(404, 'Priority message payment not found');
      if (payment.senderId !== reporterId) throw new ApiError(403, 'Not your payment');
      if (payment.status !== 'paid')
        throw new ApiError(400, 'Issue can only be raised for a paid priority message');

      talentUserId = payment.talentUserId;
      talentProfileId = payment.talentProfileId;
      amountCents = payment.amountCents;
      stripePaymentIntentId = payment.stripePaymentIntent ?? null;
    }

    // Prevent duplicate open issue for same entity
    const existing = await db.query.talentIssues.findFirst({
      where: and(
        eq(talentIssues.reporterId, reporterId),
        eq(talentIssues.entityId, entityId),
        eq(talentIssues.status, 'pending')
      ),
    });
    if (existing) throw new ApiError(409, 'An open issue already exists for this item');

    const [issue] = await db
      .insert(talentIssues)
      .values({
        reporterId,
        talentUserId,
        talentProfileId,
        entityType,
        entityId,
        reason,
        message: message.trim(),
        amountCents,
        stripePaymentIntentId,
      })
      .returning();

    TextModerationService.flagAsync({
      entityType: TEXT_ENTITY.SUPPORT,
      entityId: issue.id,
      entityCreatorId: reporterId,
      texts: [reason, message],
    });

    // Notify reporter — fire-and-forget
    const reporter = await db.query.users.findFirst({ where: eq(users.id, reporterId) });
    if (reporter?.email) {
      mailService
        .sendIssueSubmittedEmail({
          to: reporter.email,
          reporterName: reporter.firstName || reporter.username || 'Customer',
          entityType,
          amountCents,
          issueId: issue.id,
        })
        .catch(err => console.error('[TalentIssue] issue-submitted email failed:', err.message));
    }

    return issue;
  }

  // ── Customer: list my issues ───────────────────────────────────────────────

  static async listMyIssues(reporterId) {
    return db.query.talentIssues.findMany({
      where: eq(talentIssues.reporterId, reporterId),
      orderBy: [desc(talentIssues.createdAt)],
    });
  }

  // ── Admin: list all issues ─────────────────────────────────────────────────

  static async adminListIssues({ status, entityType, page = 1, limit = 20 } = {}) {
    const conditions = [];
    if (status) conditions.push(eq(talentIssues.status, status));
    if (entityType) conditions.push(eq(talentIssues.entityType, entityType));

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (page - 1) * limit;

    return db.query.talentIssues.findMany({
      where,
      orderBy: [desc(talentIssues.createdAt)],
      limit,
      offset,
      with: {
        reporter: {
          columns: { id: true, firstName: true, lastName: true, email: true, username: true },
        },
        talentUser: {
          columns: { id: true, firstName: true, lastName: true, email: true, username: true },
        },
      },
    });
  }

  // ── Admin: get single issue ────────────────────────────────────────────────

  static async adminGetIssue(issueId) {
    const issue = await db.query.talentIssues.findFirst({
      where: eq(talentIssues.id, issueId),
      with: {
        reporter: {
          columns: { id: true, firstName: true, lastName: true, email: true, username: true },
        },
        talentUser: {
          columns: { id: true, firstName: true, lastName: true, email: true, username: true },
        },
        admin: { columns: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!issue) throw new ApiError(404, 'Issue not found');
    return issue;
  }

  // ── Admin: resolve issue ───────────────────────────────────────────────────

  /**
   * PATCH /admin/talent-issues/:issueId/resolve
   *
   * action: 'refund'  — issue Stripe refund + warn talent
   *         'warn'    — warn talent only, no refund
   *         'dismiss' — close without action
   *
   * @param {string} adminId
   * @param {string} issueId
   * @param {{ action, adminNote?, refundFullAmount? }} input
   */
  static async adminResolveIssue(adminId, issueId, { action, adminNote, refundFullAmount = true }) {
    const VALID_ACTIONS = ['refund', 'warn', 'dismiss'];
    if (!VALID_ACTIONS.includes(action))
      throw new ApiError(400, `action must be one of: ${VALID_ACTIONS.join(', ')}`);

    const issue = await db.query.talentIssues.findFirst({
      where: eq(talentIssues.id, issueId),
    });
    if (!issue) throw new ApiError(404, 'Issue not found');
    if (issue.status !== 'pending') throw new ApiError(400, 'Issue already resolved or dismissed');

    const [reporter, talentUser] = await Promise.all([
      db.query.users.findFirst({ where: eq(users.id, issue.reporterId) }),
      db.query.users.findFirst({ where: eq(users.id, issue.talentUserId) }),
    ]);

    let refundIssued = false;
    let refundAmountCents = null;
    let stripeRefundId = null;
    let warningIssued = action === 'refund' || action === 'warn';
    const newStatus = action === 'dismiss' ? 'dismissed' : 'resolved';

    // ── Stripe refund ──────────────────────────────────────────────────────
    if (action === 'refund' && refundFullAmount && issue.stripePaymentIntentId) {
      if (!stripe) throw new ApiError(503, 'Payment processing is not configured');
      try {
        const stripeRefund = await stripe.refunds.create({
          payment_intent: issue.stripePaymentIntentId,
          reason: 'requested_by_customer',
          metadata: {
            issueId: issue.id,
            entityType: issue.entityType,
            entityId: issue.entityId,
            adminId,
          },
        });
        refundIssued = true;
        refundAmountCents = stripeRefund.amount;
        stripeRefundId = stripeRefund.id;

        // Sync status on the source entity
        if (issue.entityType === 'session') {
          await db
            .update(talentSessions)
            .set({ status: 'cancelled', updatedAt: new Date() })
            .where(eq(talentSessions.id, issue.entityId));
        } else {
          await db
            .update(priorityMessagePayments)
            .set({ status: 'refunded', refundedAt: new Date(), updatedAt: new Date() })
            .where(eq(priorityMessagePayments.id, issue.entityId));
        }

        // Mark spend ledger refunded — fire-and-forget
        UserSpendService.markSpendRefunded({
          userId: issue.reporterId,
          referenceId: issue.entityId,
          referenceType:
            issue.entityType === 'session' ? 'talent_session' : 'priority_message_payment',
          spendType: issue.entityType === 'session' ? 'talent_session' : 'priority_message',
          refundMeta: {
            source: 'talent_issue_refund',
            issueId: issue.id,
            stripeRefundId: stripeRefund.id,
            refundStatus: stripeRefund.status,
            refundedAmountCents: stripeRefund.amount,
            adminId,
          },
        }).catch(err => console.error('[TalentIssue] markSpendRefunded failed:', err.message));
      } catch (err) {
        console.error('[TalentIssue] Stripe refund failed:', err.message);
        throw new ApiError(502, `Stripe refund failed: ${err.message}`);
      }
    }

    const [updated] = await db
      .update(talentIssues)
      .set({
        status: newStatus,
        adminId,
        adminNote: adminNote?.trim() ?? null,
        refundIssued,
        refundAmountCents,
        stripeRefundId,
        warningIssued,
        resolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(talentIssues.id, issueId))
      .returning();

    // ── Emails ─────────────────────────────────────────────────────────────
    const emailMeta = {
      entityType: issue.entityType,
      amountCents: issue.amountCents,
      refundIssued,
      refundAmountCents,
      adminNote: adminNote?.trim() ?? null,
      issueId: issue.id,
    };

    if (reporter?.email) {
      mailService
        .sendIssueResolvedToReporterEmail({
          to: reporter.email,
          reporterName: reporter.firstName || reporter.username || 'Customer',
          action: newStatus,
          ...emailMeta,
        })
        .catch(err => console.error('[TalentIssue] reporter resolved email failed:', err.message));
    }

    if (talentUser?.email && warningIssued) {
      mailService
        .sendIssueWarningToTalentEmail({
          to: talentUser.email,
          talentName: talentUser.firstName || talentUser.username || 'Talent',
          entityType: issue.entityType,
          adminNote: adminNote?.trim() ?? null,
        })
        .catch(err => console.error('[TalentIssue] talent warning email failed:', err.message));
    }

    return updated;
  }

  // ── Customer: eligible entities to raise issue on ──────────────────────────

  /**
   * GET /talent-issues/eligible
   *
   * Returns customer's paid sessions + priority messages that:
   *   - belong to them
   *   - are in a reportable status
   *   - have no existing pending issue
   *
   * Frontend shows this list; user picks one; UUID sent automatically.
   */
  static async getEligibleEntities(reporterId, type = null) {
    // type: 'session' | 'priority_message' | null (both)
    // IDs already under a pending issue — exclude these
    const openIssues = await db.query.talentIssues.findMany({
      where: and(eq(talentIssues.reporterId, reporterId), eq(talentIssues.status, 'pending')),
      columns: { entityId: true },
    });
    const blockedIds = openIssues.map(i => i.entityId);

    // ── Sessions ─────────────────────────────────────────────────────────────
    const sessionWhere =
      blockedIds.length > 0
        ? and(eq(talentSessions.bookerId, reporterId), notInArray(talentSessions.id, blockedIds))
        : eq(talentSessions.bookerId, reporterId);

    const sessions = await db.query.talentSessions.findMany({
      where: sessionWhere,
      columns: {
        id: true,
        scheduledAt: true,
        durationMins: true,
        priceCents: true,
        status: true,
        subject: true,
      },
      with: {
        talentProfile: {
          columns: { id: true, title: true, category: true },
          with: {
            user: { columns: { firstName: true, lastName: true, username: true, image: true } },
          },
        },
      },
      orderBy: [desc(talentSessions.scheduledAt)],
    });

    const eligibleSessions = sessions
      .filter(s => ['confirmed', 'completed', 'live'].includes(s.status))
      .map(s => ({
        entityType: 'session',
        entityId: s.id,
        scheduledAt: s.scheduledAt,
        durationMins: s.durationMins,
        amountCents: s.priceCents,
        amountDisplay: `$${(s.priceCents / 100).toFixed(2)}`,
        status: s.status,
        subject: s.subject,
        talent: {
          profileId: s.talentProfile?.id ?? null,
          name: s.talentProfile?.user
            ? `${s.talentProfile.user.firstName} ${s.talentProfile.user.lastName}`.trim()
            : 'Unknown',
          username: s.talentProfile?.user?.username ?? null,
          avatar: s.talentProfile?.user?.image ?? null,
          title: s.talentProfile?.title ?? null,
          category: s.talentProfile?.category ?? null,
        },
      }));

    // ── Priority messages ─────────────────────────────────────────────────────
    const pmWhere =
      blockedIds.length > 0
        ? and(
            eq(priorityMessagePayments.senderId, reporterId),
            eq(priorityMessagePayments.status, 'paid'),
            notInArray(priorityMessagePayments.id, blockedIds)
          )
        : and(
            eq(priorityMessagePayments.senderId, reporterId),
            eq(priorityMessagePayments.status, 'paid')
          );

    const payments = await db.query.priorityMessagePayments.findMany({
      where: pmWhere,
      columns: {
        id: true,
        amountCents: true,
        paidAt: true,
        subject: true,
        messageCount: true,
      },
      with: {
        talentProfile: {
          columns: { id: true, title: true, category: true },
          with: {
            user: { columns: { firstName: true, lastName: true, username: true, image: true } },
          },
        },
      },
      orderBy: [desc(priorityMessagePayments.paidAt)],
    });

    const eligibleMessages = payments.map(p => ({
      entityType: 'priority_message',
      entityId: p.id,
      paidAt: p.paidAt,
      amountCents: p.amountCents,
      amountDisplay: `$${(p.amountCents / 100).toFixed(2)}`,
      subject: p.subject ?? null,
      messageCount: p.messageCount,
      talent: {
        profileId: p.talentProfile?.id ?? null,
        name: p.talentProfile?.user
          ? `${p.talentProfile.user.firstName} ${p.talentProfile.user.lastName}`.trim()
          : 'Unknown',
        username: p.talentProfile?.user?.username ?? null,
        avatar: p.talentProfile?.user?.image ?? null,
        title: p.talentProfile?.title ?? null,
        category: p.talentProfile?.category ?? null,
      },
    }));

    return {
      sessions: type === 'priority_message' ? [] : eligibleSessions,
      priorityMessages: type === 'session' ? [] : eligibleMessages,
    };
  }
}
