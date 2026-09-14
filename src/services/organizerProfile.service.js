import { db } from '../db/index.js';
import {
  organizers,
  events,
  eventReviews,
  organizerMembers,
  ticketScans,
  purchasedTickets,
  userInformation,
} from '../db/schema/index.js';
import { eq, and, desc, count, avg, gte, lte, sql } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import ApiError from '../utils/api-error.js';
import { generateMemberCode } from '../utils/codeGenerator.js';

export class OrganizerProfileService {
  /**
   * Get public organizer profile
   */
  static async getPublicProfile(organizerId) {
    try {
      const organizer = await db.query.organizers.findFirst({
        where: eq(organizers.id, organizerId),
        with: {
          user: {
            columns: {
              id: true,
              firstName: true,
              lastName: true,
              profilePicture: true,
              username:true,
            },
            with: {
              userInformation: true,
            },
          },
          socialLinks: {
            columns: {
              instagram: true,
              twitter: true,
              facebook: true,
              linkedin: true,
              youtube: true,
            },
          },
        },
      });

      if (!organizer) {
        throw new ApiError(404, 'Organizer not found');
      }

      // Get organizer statistics
      const stats = await this.getOrganizerStats(organizerId);

      // Get recent events
      const recentEvents = await this.getOrganizerEvents(organizerId, {
        limit: 6,
        status: 'published',
      });

      // Get reviews
      const reviews = await this.getOrganizerReviews(organizerId, {
        limit: 10,
      });

      return {
        organizer: {
          id: organizer.id,
          organizerCode: organizer.organizerCode,
          organizationName: organizer.businessName,
          description: organizer.businessDescription,
          website: organizer.websiteUrl,
          socialLinks: organizer.socialLinks,
          profilePicture: organizer.logoUrl,
          coverImage: organizer.coverImageUrl,
          isVerified: organizer.isVerified,
          showTicketsSold: organizer.showTicketsSold,
          about: organizer.about,
          createdAt: organizer.createdAt,
          user: organizer.user,
          about: organizer.about,
          specialities: organizer.specialities,
        },
        stats,
        recentEvents: recentEvents.events,
        reviews: reviews.reviews,
      };
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      console.error('Get organizer profile error:', error);
      throw new ApiError(500, 'Failed to get organizer profile');
    }
  }

  /**
   * Get organizer statistics
   */
  static async getOrganizerStats(organizerId) {
    try {
      // Total events
      const totalEventsQuery = await db
        .select({ count: count() })
        .from(events)
        .where(eq(events.organizerId, organizerId));

      // Published events
      const publishedEventsQuery = await db
        .select({ count: count() })
        .from(events)
        .where(and(eq(events.organizerId, organizerId), eq(events.eventStatus, 'published')));

      // Upcoming events
      const upcomingEventsQuery = await db
        .select({ count: count() })
        .from(events)
        .where(
          and(
            eq(events.organizerId, organizerId),
            eq(events.eventStatus, 'published'),
            gte(events.startDate, new Date())
          )
        );

      // Average rating
      const ratingQuery = await db
        .select({
          avgRating: avg(eventReviews.overallRating),
          totalReviews: count(eventReviews.id),
        })
        .from(events)
        .leftJoin(eventReviews, eq(events.id, eventReviews.eventId))
        .where(eq(events.organizerId, organizerId));

      // Total tickets sold
      const ticketsSoldQuery = await db
        .select({ count: count() })
        .from(purchasedTickets)
        .where(eq(purchasedTickets.organizerId, organizerId));

      return {
        totalEvents: totalEventsQuery[0].count,
        publishedEvents: publishedEventsQuery[0].count,
        upcomingEvents: upcomingEventsQuery[0].count,
        averageRating: parseFloat(ratingQuery[0].avgRating || 0),
        totalReviews: ratingQuery[0].totalReviews,
        totalTicketsSold: ticketsSoldQuery[0].count,
      };
    } catch (error) {
      console.error('Get organizer stats error:', error);
      throw new ApiError(500, 'Failed to get organizer statistics');
    }
  }

  /**
   * Get organizer events with filters
   */
  static async getOrganizerEvents(organizerId, filters = {}) {
    try {
      const { page = 1, limit = 12, status, timeFilter = 'all', search } = filters;

      const offset = (page - 1) * limit;
      let conditions = [eq(events.organizerId, organizerId)];

      if (status) {
        conditions.push(eq(events.eventStatus, status));
      }

      if (search) {
        conditions.push(sql`${events.title} ILIKE ${`%${search}%`}`);
      }

      // Time filter
      const now = new Date();
      if (timeFilter === 'upcoming') {
        conditions.push(gte(events.startDate, now));
      } else if (timeFilter === 'past') {
        conditions.push(lte(events.endDate, now));
      }

      const [eventsResult, totalCount] = await Promise.all([
        db.query.events.findMany({
          where: and(...conditions),
          with: {
            venue: true,
          },
          orderBy: desc(events.startDate),
          limit,
          offset,
        }),
        db
          .select({ count: count() })
          .from(events)
          .where(and(...conditions)),
      ]);

      return {
        events: eventsResult,
        pagination: {
          page,
          limit,
          total: totalCount[0].count,
          pages: Math.ceil(totalCount[0].count / limit),
        },
      };
    } catch (error) {
      console.error('Get organizer events error:', error);
      throw new ApiError(500, 'Failed to get organizer events');
    }
  }

  /**
   * Get organizer reviews
   */
  static async getOrganizerReviews(organizerId, filters = {}) {
    try {
      const { page = 1, limit = 10, rating } = filters;
      const offset = (page - 1) * limit;

      let conditions = [eq(events.organizerId, organizerId)];

      if (rating) {
        conditions.push(eq(eventReviews.overallRating, rating));
      }

      const [reviewsResult, totalCount] = await Promise.all([
        db
          .select({
            id: eventReviews.id,
            overallRating: eventReviews.overallRating,
            venueRating: eventReviews.venueRating,
            organizationRating: eventReviews.organizationRating,
            valueRating: eventReviews.valueRating,
            comment: eventReviews.comment,
            createdAt: eventReviews.createdAt,
            event: {
              id: events.id,
              title: events.title,
              startDate: events.startDate,
            },
            user: {
              id: eventReviews.userId,
              firstName: sql`(SELECT first_name FROM users WHERE id = ${eventReviews.userId})`,
              lastName: sql`(SELECT last_name FROM users WHERE id = ${eventReviews.userId})`,
              username: sql`(SELECT username FROM users WHERE id = ${eventReviews.userId})`,
            },
          })
          .from(eventReviews)
          .innerJoin(events, eq(eventReviews.eventId, events.id))
          .where(and(...conditions))
          .orderBy(desc(eventReviews.createdAt))
          .limit(limit)
          .offset(offset),
        db
          .select({ count: count() })
          .from(eventReviews)
          .innerJoin(events, eq(eventReviews.eventId, events.id))
          .where(and(...conditions)),
      ]);

      return {
        reviews: reviewsResult,
        pagination: {
          page,
          limit,
          total: totalCount[0].count,
          pages: Math.ceil(totalCount[0].count / limit),
        },
      };
    } catch (error) {
      console.error('Get organizer reviews error:', error);
      throw new ApiError(500, 'Failed to get organizer reviews');
    }
  }

  /**
   * Create organizer member
   */
  static async createMember(organizerId, memberData) {
    try {
      const { memberName, memberPassword, role = 'scanner' } = memberData;

      // Generate unique member code
      let memberCode;
      let isUnique = false;
      let attempts = 0;

      while (!isUnique && attempts < 10) {
        memberCode = generateMemberCode();
        const existing = await db.query.organizerMembers.findFirst({
          where: eq(organizerMembers.memberCode, memberCode),
        });
        isUnique = !existing;
        attempts++;
      }

      if (!isUnique) {
        throw new ApiError(500, 'Failed to generate unique member code');
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(memberPassword, 12);

      // Create member
      const [newMember] = await db
        .insert(organizerMembers)
        .values({
          organizerId,
          memberCode,
          memberName,
          memberPassword: hashedPassword,
          role,
          permissions: ['scan_tickets'],
        })
        .returning();

      return {
        id: newMember.id,
        memberCode: newMember.memberCode,
        memberName: newMember.memberName,
        role: newMember.role,
        permissions: newMember.permissions,
        isActive: newMember.isActive,
        createdAt: newMember.createdAt,
      };
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      console.error('Create organizer member error:', error);
      throw new ApiError(500, 'Failed to create organizer member');
    }
  }

  /**
   * Get organizer members
   */
  static async getMembers(organizerId, filters = {}) {
    try {
      const { page = 1, limit = 10, isActive } = filters;
      const offset = (page - 1) * limit;

      let conditions = [eq(organizerMembers.organizerId, organizerId)];

      if (isActive !== undefined) {
        conditions.push(eq(organizerMembers.isActive, isActive));
      }

      const [membersResult, totalCount] = await Promise.all([
        db.query.organizerMembers.findMany({
          where: and(...conditions),
          columns: {
            memberPassword: false, // Exclude password from results
          },
          orderBy: desc(organizerMembers.createdAt),
          limit,
          offset,
        }),
        db
          .select({ count: count() })
          .from(organizerMembers)
          .where(and(...conditions)),
      ]);

      return {
        members: membersResult,
        pagination: {
          page,
          limit,
          total: totalCount[0].count,
          pages: Math.ceil(totalCount[0].count / limit),
        },
      };
    } catch (error) {
      console.error('Get organizer members error:', error);
      throw new ApiError(500, 'Failed to get organizer members');
    }
  }

  /**
   * Update member status
   */
  static async updateMemberStatus(organizerId, memberId, isActive) {
    try {
      const [updatedMember] = await db
        .update(organizerMembers)
        .set({
          isActive,
          updatedAt: new Date(),
        })
        .where(
          and(eq(organizerMembers.id, memberId), eq(organizerMembers.organizerId, organizerId))
        )
        .returning();

      if (!updatedMember) {
        throw new ApiError(404, 'Member not found');
      }

      return updatedMember;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      console.error('Update member status error:', error);
      throw new ApiError(500, 'Failed to update member status');
    }
  }

  /**
   * Get single member details (only organizer owner)
   */
  static async getMember(organizerId, memberId, userId) {
    try {
      // Verify ownership
      const organizer = await db.query.organizers.findFirst({
        where: eq(organizers.userId, userId),
      });

      if (!organizer || organizer.id !== organizerId) {
        throw new ApiError(403, 'Unauthorized to view member');
      }

      const member = await db.query.organizerMembers.findFirst({
        where: and(
          eq(organizerMembers.id, memberId),
          eq(organizerMembers.organizerId, organizerId)
        ),
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
      });

      if (!member) throw new ApiError(404, 'Member not found');

      // Remove sensitive fields
      const { memberPassword, ...safeMember } = member;

      return safeMember;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      console.error('Get member error:', error);
      throw new ApiError(500, 'Failed to get member');
    }
  }

  /**
   * Update member fields
   */
  static async updateMember(organizerId, memberId, updates, userId) {
    try {
      // Verify ownership
      const organizer = await db.query.organizers.findFirst({
        where: eq(organizers.userId, userId),
      });

      if (!organizer || organizer.id !== organizerId) {
        throw new ApiError(403, 'Unauthorized to update member');
      }

      const allowed = {};
      if (typeof updates.memberName === 'string') allowed.memberName = updates.memberName;
      if (typeof updates.role === 'string') allowed.role = updates.role;
      if (Array.isArray(updates.permissions)) allowed.permissions = updates.permissions;

      if (Object.keys(allowed).length === 0) {
        throw new ApiError(400, 'No valid fields to update');
      }

      allowed.updatedAt = new Date();

      const [updatedMember] = await db
        .update(organizerMembers)
        .set(allowed)
        .where(
          and(eq(organizerMembers.id, memberId), eq(organizerMembers.organizerId, organizerId))
        )
        .returning();

      if (!updatedMember) throw new ApiError(404, 'Member not found');

      // Remove sensitive fields
      const { memberPassword, ...safeMember } = updatedMember;

      return safeMember;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      console.error('Update member error:', error);
      throw new ApiError(500, 'Failed to update member');
    }
  }

  /**
   * Regenerate member password
   */
  static async regeneratePassword(organizerId, memberId, customPassword = null) {
    try {
      // Use custom password or generate new one
      const newPassword = customPassword || Math.random().toString(36).slice(-8);
      const hashedPassword = await bcrypt.hash(newPassword, 12);

      const [updatedMember] = await db
        .update(organizerMembers)
        .set({
          memberPassword: hashedPassword,
          updatedAt: new Date(),
        })
        .where(
          and(eq(organizerMembers.id, memberId), eq(organizerMembers.organizerId, organizerId))
        )
        .returning();

      if (!updatedMember) {
        throw new ApiError(404, 'Member not found');
      }

      return {
        memberCode: updatedMember.memberCode,
        newPassword: newPassword, // Return plain password for display
      };
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      console.error('Regenerate member password error:', error);
      throw new ApiError(500, 'Failed to regenerate member password');
    }
  }

  /**
   * Delete organizer member
   */
  static async deleteMember(organizerId, memberId) {
    try {
      const [deletedMember] = await db
        .delete(organizerMembers)
        .where(
          and(eq(organizerMembers.id, memberId), eq(organizerMembers.organizerId, organizerId))
        )
        .returning();

      if (!deletedMember) {
        throw new ApiError(404, 'Member not found');
      }

      return { success: true };
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      console.error('Delete organizer member error:', error);
      throw new ApiError(500, 'Failed to delete organizer member');
    }
  }
}
