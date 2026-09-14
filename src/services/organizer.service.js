import { db } from '../db/index.js';
import { organizers } from '../db/schema/index.js';
import { eq } from 'drizzle-orm';
import { generateOrganizerCode } from '../utils/code-generator.js';
import ApiError from '../utils/api-error.js';
import { sql } from 'drizzle-orm';
import { StripeConnectService } from './stripeConnect.service.js';
import { organizerSocialLinks } from '../db/schema/index.js';
export class OrganizerService {
  static async createOrganizer(userId, organizerData) {
    const organizerCode = generateOrganizerCode();

    const [organizer] = await db
      .insert(organizers)
      .values({
        ...organizerData,
        organizerCode,
        userId,
        totalEvents: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    // Fire-and-forget: create Connect account and prefill with known data.
    // Don't block profile creation on Stripe availability.
    StripeConnectService.createAccount(userId, organizerData.country || 'US')
      .then(account =>
        StripeConnectService.prefillAccount(account.stripeAccountId, {
          email: organizerData.contactEmail,
          businessName: organizerData.businessName,
          websiteUrl: organizerData.websiteUrl,
          contactPhone: organizerData.contactPhone,
          businessType: organizerData.businessType,
        })
      )
      .catch(err => {
        if (!err.message?.includes('already exists')) {
          console.error('[Stripe] Auto connect account setup failed for organizer:', err.message);
        }
      });

    return organizer;
  }

  static async getOrganizers() {
    const allOrganizers = await db.query.organizers.findMany({
      with: {
        user: {
          columns: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
      orderBy: (organizers, { desc }) => [desc(organizers.createdAt)],
    });

    return allOrganizers;
  }

  static async getOrganizerByUserId(userId) {
    const organizer = await db.query.organizers.findFirst({
      where: eq(organizers.userId, userId),
    });

    return organizer;
  }

  static async getOrganizerProfile(userId) {
    const profile = await db.query.organizers.findFirst({
      where: eq(organizers.userId, userId),
      with: {
        user: {
          columns: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            username: true,
          },
          with: {
            userInformation: true,
          },
        },
        socialLinks: true,
      },
    });

    return profile;
  }

  static async updateOrganizerProfile(userId, profileData) {
    const organizer = await db.query.organizers.findFirst({
      where: eq(organizers.userId, userId),
    });
    if (!organizer) throw new ApiError(404, 'Organizer profile not found');

    // Update main organizer fields
    const allowed = {};
    const fields = [
      'businessName',
      'businessDescription',
      'websiteUrl',
      'about',
      'specialities',
      'logoUrl',
      'coverImageUrl',
      'contactEmail',
      'contactPhone',
      'showTicketsSold',
    ];
    fields.forEach(key => {
      if (profileData[key] !== undefined) allowed[key] = profileData[key];
    });

    // Ensure array columns stay as arrays
    if (allowed.coverImageUrl !== undefined) {
      allowed.coverImageUrl = Array.isArray(allowed.coverImageUrl)
        ? allowed.coverImageUrl
        : [allowed.coverImageUrl];
    }
    if (allowed.specialities !== undefined) {
      allowed.specialities = Array.isArray(allowed.specialities)
        ? allowed.specialities
        : [allowed.specialities];
    }

    const [updatedProfile] = await db
      .update(organizers)
      .set({ ...allowed, updatedAt: new Date() })
      .where(eq(organizers.userId, userId))
      .returning();

    // ✅ Upsert social links into the separate table
    if (profileData.socialLinks) {
      const { instagram, twitter, facebook, linkedin, youtube } = profileData.socialLinks;
      await db
        .insert(organizerSocialLinks)
        .values({
          organizerId: organizer.id,
          instagram: instagram || null,
          twitter: twitter || null,
          facebook: facebook || null,
          linkedin: linkedin || null,
          youtube: youtube || null,
        })
        .onConflictDoUpdate({
          target: organizerSocialLinks.organizerId,
          set: {
            instagram: instagram || null,
            twitter: twitter || null,
            facebook: facebook || null,
            linkedin: linkedin || null,
            youtube: youtube || null,
            updatedAt: new Date(),
          },
        });
    }

    return updatedProfile;
  }

  static async incrementEventCount(userId) {
    await db
      .update(organizers)
      .set({
        totalEvents: sql`${organizers.totalEvents} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(organizers.userId, userId));
  }

  static async decrementEventCount(userId) {
    await db
      .update(organizers)
      .set({
        totalEvents: sql`GREATEST(${organizers.totalEvents} - 1, 0)`,
        updatedAt: new Date(),
      })
      .where(eq(organizers.userId, userId));
  }
}
