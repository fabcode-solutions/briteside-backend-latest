/**
 * Handles the full gift code lifecycle:
 *   generate()  — called when a gifter completes a gift booking
 *   sendEmail() — sends the gift email to the recipient
 *   validate()  — called from BookOneOnOne "Apply" button
 *   redeem()    — called inside TalentSessionService.book() when giftCode is present
 */

import { randomBytes } from 'crypto';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { talentGiftCodes } from '../db/schema/talentGiftCodes.js';
import { talentProfiles } from '../db/schema/talentProfiles.js';
import { talentSessions } from '../db/schema/talentSessions.js';
import { users } from '../db/schema/index.js';
import ApiError from '../utils/api-error.js';
import * as mailService from './mail.service.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Generate a unique gift code in the format GIFT-XXXXXXXX
 * e.g. GIFT-A3K9B2MQ
 * Retries up to 5 times to guarantee uniqueness.
 */
async function generateUniqueCode() {
  for (let attempt = 0; attempt < 5; attempt++) {
    const raw = randomBytes(5).toString('hex').toUpperCase(); // 10 hex chars
    const code = `GIFT-${raw.slice(0, 8)}`; // GIFT-XXXXXXXX

    const existing = await db.query.talentGiftCodes.findFirst({
      where: eq(talentGiftCodes.code, code),
      columns: { id: true },
    });

    if (!existing) return code;
  }
  throw new Error('Failed to generate a unique gift code after 5 attempts');
}

// ─── Email template ───────────────────────────────────────────────────────────

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://briteside.app';
const BRAND_COLOR = '#00D16E';
const BRAND_NAME = 'Briteside';

function buildGiftEmail({
  recipientName,
  gifterName,
  talentName,
  durationMins,
  occasion,
  personalMessage,
  code,
  expiresAt,
  talentUsername,
}) {
  const redeemUrl = `${FRONTEND_URL}/book-1-on-1?talentId=${talentUsername}`;
  const expiry = new Date(expiresAt).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const durationLabel = `${durationMins}-minute`;

  const subject = `🎁 You've received a gift! A ${durationLabel} session with ${talentName}`;

  const html = `
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;">
  <div style="background-color:${BRAND_COLOR};padding:24px;text-align:center;">
    <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:600;">${BRAND_NAME}</h1>
  </div>
  <div style="padding:32px 40px;">
    <h2 style="color:#333;margin-top:0;">You've got a gift! 🎁</h2>
    <p style="color:#555;">Hi ${recipientName || 'there'},</p>
    <p style="color:#555;">
      <strong>${gifterName}</strong> has gifted you a <strong>${durationLabel} 1:1 video session</strong>
      with <strong>${talentName}</strong>${occasion ? ` for your <strong>${occasion}</strong>` : ''}.
    </p>

    ${
      personalMessage
        ? `
    <div style="background:#f8f9fa;border-left:4px solid ${BRAND_COLOR};padding:16px 20px;border-radius:0 8px 8px 0;margin:20px 0;">
      <p style="color:#555;margin:0;font-style:italic;">"${personalMessage}"</p>
      <p style="color:#888;font-size:13px;margin:8px 0 0;">— ${gifterName}</p>
    </div>`
        : ''
    }

    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:20px;margin:24px 0;text-align:center;">
      <p style="color:#555;margin:0 0 8px;font-size:14px;">Your gift code</p>
      <span style="font-size:28px;font-weight:700;letter-spacing:4px;color:#333;font-family:monospace;">${code}</span>
      <p style="color:#888;font-size:12px;margin:8px 0 0;">Valid until ${expiry}</p>
    </div>

    <p style="color:#555;">To book your session, click the button below and enter your gift code:</p>

    <p style="text-align:center;margin:28px 0;">
      <a href="${redeemUrl}"
        style="background-color:${BRAND_COLOR};color:#fff;padding:14px 32px;text-decoration:none;
               border-radius:8px;font-weight:600;font-size:15px;display:inline-block;">
        Redeem Your Gift
      </a>
    </p>

    <p style="color:#999;font-size:13px;">
      Or go to <a href="${FRONTEND_URL}" style="color:${BRAND_COLOR};">${FRONTEND_URL}</a>,
      find ${talentName}'s profile, click Book a Session, and choose "I want to redeem a gift".
    </p>

    <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
    <p style="color:#999;font-size:12px;margin:0;">
      This gift code can only be used once and is non-transferable.
      It expires on ${expiry}. If you have any questions, contact support at
      <a href="mailto:support@briteside.app" style="color:${BRAND_COLOR};">support@briteside.app</a>.
    </p>
  </div>
  <div style="background:#f5f5f5;padding:16px 40px;text-align:center;">
    <p style="color:#999;font-size:12px;margin:0;">${BRAND_NAME} · 1:1 Sessions Platform</p>
  </div>
</div>`;

  return { subject, html };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class GiftCodeService {
  /**
   * Generate a gift code after a gift booking is placed.
   *
   * Called from TalentSessionService.book() when isGift === true.
   *
   * @param {object} input
   *   gifterId, talentProfileId, durationMins, priceCents,
   *   recipientName, recipientEmail, recipientPhone,
   *   occasion, personalMessage, deliveryDate
   * @returns {object} the new talentGiftCodes row
   */
  static async generate({
    gifterId,
    talentProfileId,
    durationMins,
    priceCents,
    recipientName,
    recipientEmail,
    recipientPhone,
    occasion,
    personalMessage,
    deliveryDate,
  }) {
    const code = await generateUniqueCode();

    // Gift codes expire 1 year from generation
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);

    const [gift] = await db
      .insert(talentGiftCodes)
      .values({
        gifterId,
        talentProfileId,
        code,
        durationMins,
        priceCents,
        recipientName: recipientName ?? null,
        recipientEmail: recipientEmail ?? null,
        recipientPhone: recipientPhone ?? null,
        occasion: occasion ?? null,
        personalMessage: personalMessage ?? null,
        deliveryDate: deliveryDate ? new Date(deliveryDate) : null,
        status: 'active',
        expiresAt,
      })
      .returning();

    // Send email immediately (or schedule for deliveryDate — current impl sends now)
    if (recipientEmail) {
      await GiftCodeService.sendEmail(gift).catch(err =>
        console.error('[GiftCode] Failed to send gift email:', err.message)
      );
    }

    return gift;
  }

  /**
   * Send the gift email to the recipient.
   * Called automatically from generate(); can also be called manually to resend.
   */
  static async sendEmail(gift) {
    if (!gift.recipientEmail) return;

    // Load gifter name and talent name for the email
    const [gifter, talentProfile] = await Promise.all([
      db.query.users.findFirst({
        where: eq(users.id, gift.gifterId),
        columns: { firstName: true, lastName: true },
      }),
      db.query.talentProfiles.findFirst({
        where: eq(talentProfiles.id, gift.talentProfileId),
        with: { user: { columns: { firstName: true, lastName: true, username: true } } },
      }),
    ]);

    const gifterName = gifter ? `${gifter.firstName} ${gifter.lastName}` : 'Someone';
    const talentName = talentProfile
      ? `${talentProfile.user.firstName} ${talentProfile.user.lastName}`
      : 'a Talent';

    const { subject, html } = buildGiftEmail({
      recipientName: gift.recipientName,
      gifterName,
      talentName,
      durationMins: gift.durationMins,
      occasion: gift.occasion,
      personalMessage: gift.personalMessage,
      code: gift.code,
      expiresAt: gift.expiresAt,
      talentUsername: talentProfile.user.username,
    });

    await mailService.sendMail(gift.recipientEmail, subject, html);

    // Mark as delivered
    await db
      .update(talentGiftCodes)
      .set({ deliveredAt: new Date(), updatedAt: new Date() })
      .where(eq(talentGiftCodes.id, gift.id));
  }

  /**
   * Validate a gift code — called from the "Apply" button in BookOneOnOne.
   *
   * Returns gift code details if valid so the frontend can pre-fill
   * the talent + duration without the user having to choose them.
   *
   * @param {string} code        - The code the user typed
   * @param {string} talentProfileId - The talent profile page the user is on
   * @param {number} durationMins    - The duration the user selected
   * @returns {{ valid, gift, talentProfile }}
   */
  static async validate(code, talentProfileId) {
    const gift = await db.query.talentGiftCodes.findFirst({
      where: eq(talentGiftCodes.code, code.trim().toUpperCase()),
    });

    if (!gift) {
      return { valid: false, reason: 'Code not found' };
    }
    if (gift.status === 'redeemed') {
      return { valid: false, reason: 'This gift code has already been used' };
    }
    if (gift.status === 'cancelled') {
      return { valid: false, reason: 'This gift code has been cancelled' };
    }
    if (gift.status === 'expired' || new Date() > new Date(gift.expiresAt)) {
      if (gift.status !== 'expired') {
        await db
          .update(talentGiftCodes)
          .set({ status: 'expired', updatedAt: new Date() })
          .where(eq(talentGiftCodes.id, gift.id));
      }
      return { valid: false, reason: 'This gift code has expired' };
    }
    if (gift.talentProfileId !== talentProfileId) {
      return { valid: false, reason: 'This code is not valid for this talent' };
    }

    return {
      valid: true,
      priceCents: gift.priceCents,
      durationMins: gift.durationMins,
      giftId: gift.id,
    };
  }

  /**
   * Redeem a gift code — called inside TalentSessionService.book()
   * when giftCode is present in the booking request.
   *
   * Marks the code as redeemed and links it to the session.
   * Throws ApiError if the code is invalid so the booking is blocked.
   *
   * @param {string} code
   * @param {string} talentProfileId
   * @param {number} durationMins
   * @param {string} sessionId  - The session that was just created
   */
  static async redeem(code, talentProfileId, durationMins, sessionId) {
    const gift = await db.query.talentGiftCodes.findFirst({
      where: eq(talentGiftCodes.code, code.trim().toUpperCase()),
    });

    if (!gift) throw new ApiError(400, 'Invalid gift code');
    if (gift.status !== 'active') throw new ApiError(400, `Gift code is ${gift.status}`);
    if (new Date() > new Date(gift.expiresAt)) throw new ApiError(400, 'Gift code has expired');
    if (gift.talentProfileId !== talentProfileId)
      throw new ApiError(400, 'Gift code is not valid for this talent');
    if (gift.durationMins !== Number(durationMins))
      throw new ApiError(400, `Gift code is for a ${gift.durationMins}-minute session`);

    await db
      .update(talentGiftCodes)
      .set({
        status: 'redeemed',
        redeemedAt: new Date(),
        redeemedSessionId: sessionId,
        updatedAt: new Date(),
      })
      .where(eq(talentGiftCodes.id, gift.id));
  }

  /**
   * Get all gift codes sent by a user (gifter view).
   */
  static async listByGifter(gifterId, { page = 1, limit = 10 } = {}) {
    limit = Math.min(Number(limit) || 10, 50);
    page = Math.max(Number(page) || 1, 1);
    const offset = (page - 1) * limit;

    const rows = await db.query.talentGiftCodes.findMany({
      where: eq(talentGiftCodes.gifterId, gifterId),
      with: {
        talentProfile: {
          with: { user: { columns: { firstName: true, lastName: true, image: true } } },
        },
      },
      orderBy: (g, { desc }) => [desc(g.createdAt)],
      limit,
      offset,
    });

    return rows;
  }
}
