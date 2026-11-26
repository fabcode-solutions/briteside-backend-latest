/**
 * Business clients added by the business itself (dashboard → Import & Invite
 * Clients): a CSV import or one contact typed in. Each is saved as a client
 * and, optionally, invited to book by email and / or SMS.
 *
 * Invite limits (contacting people who didn't sign up themselves):
 *   • The business must confirm the clients agreed to be contacted (validation).
 *   • At most one invite per contact per channel every INVITE_COOLDOWN_DAYS.
 *   • Daily caps per business: EMAIL_INVITES_PER_DAY / SMS_INVITES_PER_DAY.
 *   • Texts say "Reply STOP to opt out" (AWS SNS handles the opt-out).
 *   • No invites while the business page is unpublished (the link would 404).
 */
import httpStatus from 'http-status';
import { and, desc, eq, gte, inArray, or, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { businessClients } from '../db/schema/index.js';
import ApiError from '../utils/api-error.js';
import logger from '../config/logger.js';
import { sendMail } from './mail.service.js';
import { sendSMS } from '../utils/aws.util.js';
import { emailWrapper, ctaRow, ctaButton, appUrl } from '../templates/emailLayout.js';

export const INVITE_COOLDOWN_DAYS = 30;
export const EMAIL_INVITES_PER_DAY = 300;
export const SMS_INVITES_PER_DAY = 100;
const DAY_MS = 86_400_000;

const escapeHtml = s =>
  String(s ?? '').replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

const serialize = c => ({
  id: c.id,
  name: c.name ?? null,
  email: c.email ?? null,
  phone: c.phone ?? null,
  source: c.source,
  emailInvitedAt: c.emailInvitedAt ?? null,
  smsInvitedAt: c.smsInvitedAt ?? null,
  createdAt: c.createdAt,
});

/** Invites already sent on a channel by this business in the last 24 hours. */
async function sentToday(businessId, column) {
  const [{ n }] = await db
    .select({ n: sql`count(*)`.mapWith(Number) })
    .from(businessClients)
    .where(
      and(eq(businessClients.businessId, businessId), gte(column, new Date(Date.now() - DAY_MS)))
    );
  return n;
}

const recentlyInvited = at =>
  !!at && new Date(at).getTime() > Date.now() - INVITE_COOLDOWN_DAYS * DAY_MS;

function sendEmailInvite(business, client) {
  const url = appUrl(`/business/${business.slug}`);
  const greeting = client.name ? `Hi ${escapeHtml(client.name)},` : 'Hi,';
  return sendMail(
    client.email,
    `${business.name} invited you to book on Briteside`,
    emailWrapper(`
      <p>${greeting}</p>
      <p><strong>${escapeHtml(business.name)}</strong> is now taking bookings on Briteside.
      See their services, pick a time that suits you and book online.</p>
      ${ctaRow(ctaButton(`Book with ${escapeHtml(business.name)}`, url))}
      <p style="color:#6b7280;font-size:13px">You're getting this email because
      ${escapeHtml(business.name)} added you as a client. If that's a mistake, you can ignore it.</p>
    `)
  );
}

function sendSmsInvite(business, client) {
  const url = appUrl(`/business/${business.slug}`);
  return sendSMS(
    client.phone,
    `${business.name} invited you to book with them on Briteside: ${url} Reply STOP to opt out.`
  );
}

export class BusinessClientService {
  /** Newest first. */
  static async list(business) {
    const rows = await db.query.businessClients.findMany({
      where: eq(businessClients.businessId, business.id),
      orderBy: [desc(businessClients.createdAt)],
      limit: 5000,
    });
    return rows.map(serialize);
  }

  /**
   * Save clients (new ones added, known ones — same email or phone — filled in)
   * and invite them when `invite` is on. Returns what happened, for the dialog.
   */
  static async add(business, user, { clients, source, invite }) {
    // Collapse duplicates inside the request (same email or same phone)
    const input = [];
    for (const c of clients) {
      const email = c.email || null;
      const phone = c.phone || null;
      const name = c.name?.trim() || null;
      const dup = input.find(x => (email && x.email === email) || (phone && x.phone === phone));
      if (dup) {
        dup.email ??= email;
        dup.phone ??= phone;
        dup.name ??= name;
      } else {
        input.push({ email, phone, name });
      }
    }

    const emails = input.map(c => c.email).filter(Boolean);
    const phones = input.map(c => c.phone).filter(Boolean);
    const existing = await db.query.businessClients.findMany({
      where: and(
        eq(businessClients.businessId, business.id),
        or(
          emails.length ? inArray(businessClients.email, emails) : sql`false`,
          phones.length ? inArray(businessClients.phone, phones) : sql`false`
        )
      ),
    });
    const byEmail = new Map(existing.filter(c => c.email).map(c => [c.email, c]));
    const byPhone = new Map(existing.filter(c => c.phone).map(c => [c.phone, c]));

    let added = 0;
    let updated = 0;
    const touched = [];

    await db.transaction(async tx => {
      for (const c of input) {
        const match = (c.email && byEmail.get(c.email)) || (c.phone && byPhone.get(c.phone));
        if (match) {
          // Fill in what's missing, never take an email / phone another client has
          const patch = {};
          if (!match.name && c.name) patch.name = c.name;
          if (!match.email && c.email && !byEmail.has(c.email)) patch.email = c.email;
          if (!match.phone && c.phone && !byPhone.has(c.phone)) patch.phone = c.phone;
          if (Object.keys(patch).length) {
            const [row] = await tx
              .update(businessClients)
              .set({ ...patch, updatedAt: new Date() })
              .where(eq(businessClients.id, match.id))
              .returning();
            if (patch.email) byEmail.set(patch.email, row);
            if (patch.phone) byPhone.set(patch.phone, row);
            updated += 1;
            touched.push(row);
          } else {
            touched.push(match);
          }
        } else {
          const [row] = await tx
            .insert(businessClients)
            .values({
              businessId: business.id,
              name: c.name,
              email: c.email,
              phone: c.phone,
              source,
              addedBy: user.id,
            })
            .returning();
          if (row.email) byEmail.set(row.email, row);
          if (row.phone) byPhone.set(row.phone, row);
          added += 1;
          touched.push(row);
        }
      }
    });

    // One row can be touched twice (e.g. its email on one line, its phone on another)
    const unique = [...new Map(touched.map(r => [r.id, r])).values()];

    const result = {
      added,
      updated,
      invited: { email: 0, sms: 0 },
      skippedRecentlyInvited: 0,
      limitReached: { email: false, sms: false },
      notPublished: false,
      clients: [],
    };

    if (invite && !business.isPublished) result.notPublished = true;

    if (invite && business.isPublished) {
      let emailBudget = Math.max(
        0,
        EMAIL_INVITES_PER_DAY - (await sentToday(business.id, businessClients.emailInvitedAt))
      );
      let smsBudget = Math.max(
        0,
        SMS_INVITES_PER_DAY - (await sentToday(business.id, businessClients.smsInvitedAt))
      );
      const emailIds = [];
      const smsIds = [];

      for (const c of unique) {
        let recent = false;
        if (c.email) {
          if (recentlyInvited(c.emailInvitedAt)) recent = true;
          else if (emailBudget > 0) {
            emailBudget -= 1;
            emailIds.push(c.id);
          } else result.limitReached.email = true;
        }
        if (c.phone) {
          if (recentlyInvited(c.smsInvitedAt)) recent = true;
          else if (smsBudget > 0) {
            smsBudget -= 1;
            smsIds.push(c.id);
          } else result.limitReached.sms = true;
        }
        // Counted once per client, and only when nothing went out to them
        if (recent && !emailIds.includes(c.id) && !smsIds.includes(c.id)) {
          result.skippedRecentlyInvited += 1;
        }
      }

      // Record first (so the cooldown / daily cap hold even if sending is slow), then send
      const now = new Date();
      if (emailIds.length) {
        await db
          .update(businessClients)
          .set({ emailInvitedAt: now })
          .where(inArray(businessClients.id, emailIds));
      }
      if (smsIds.length) {
        await db
          .update(businessClients)
          .set({ smsInvitedAt: now })
          .where(inArray(businessClients.id, smsIds));
      }
      result.invited = { email: emailIds.length, sms: smsIds.length };

      for (const c of unique) {
        if (emailIds.includes(c.id)) c.emailInvitedAt = now;
        if (smsIds.includes(c.id)) c.smsInvitedAt = now;
      }

      const emailSet = new Set(emailIds);
      const smsSet = new Set(smsIds);
      // Sent in the background, one at a time — a big import shouldn't hold the request
      (async () => {
        for (const c of unique) {
          if (emailSet.has(c.id)) {
            await sendEmailInvite(business, c).catch(err =>
              logger.error(`[businessClients] email invite failed: ${err.message}`)
            );
          }
          if (smsSet.has(c.id)) {
            await sendSmsInvite(business, c).catch(err =>
              logger.error(`[businessClients] SMS invite failed: ${err.message}`)
            );
          }
        }
      })();
    }

    result.clients = unique.map(serialize);
    return result;
  }

  static async remove(business, clientId) {
    const [row] = await db
      .delete(businessClients)
      .where(and(eq(businessClients.id, clientId), eq(businessClients.businessId, business.id)))
      .returning({ id: businessClients.id });
    if (!row) throw new ApiError(httpStatus.NOT_FOUND, 'Client not found');
    return { removed: true };
  }
}
