import { db } from '../db/index.js';
import { organizerMembers, users, organizers } from '../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { generateMemberCode } from '../utils/code-generator.js';
import { createUser } from './user.service.js';
import ApiError from '../utils/api-error.js';
import bcrypt from 'bcryptjs';

export class OrganizerMemberService {
  static async createMember(organizerId, creatorId, memberData) {
    // Check if creator owns the organizer
    const organizer = await db.query.organizers.findFirst({
      where: eq(organizers.userId, creatorId),
    });

    if (!organizer || organizer.id !== organizerId) {
      throw new ApiError(403, 'Unauthorized to create members for this organizer');
    }

    const memberCode = generateMemberCode();
    const tempPassword = Math.random().toString(36).slice(-8);
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    // Create user account for member
    const newUser = await createUser({
      email: memberData.email,
      passwordHash,
      firstName: memberData.firstName,
      lastName: memberData.lastName,
      username: memberData.email.split('@')[0] + '_' + Date.now(),
      name: `${memberData.firstName} ${memberData.lastName}`,
      role: 'member',
    });

    // Create organizer member
    const [member] = await db
      .insert(organizerMembers)
      .values({
        memberCode,
        organizerId,
        userId: newUser.id,
        role: memberData.role || 'staff',
        permissions: memberData.permissions || [],
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return {
      member,
      user: {
        id: newUser.id,
        email: newUser.email,
        firstName: newUser.firstName,
        lastName: newUser.lastName,
      },
      credentials: {
        email: newUser.email,
        password: tempPassword,
      },
    };
  }

  static async getOrganizerMembers(organizerId, userId) {
    // Check if user owns the organizer
    const organizer = await db.query.organizers.findFirst({
      where: eq(organizers.userId, userId),
    });

    if (!organizer || organizer.id !== organizerId) {
      throw new ApiError(403, 'Unauthorized to view members for this organizer');
    }

    const members = await db.query.organizerMembers.findMany({
      where: eq(organizerMembers.organizerId, organizerId),
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
      orderBy: (organizerMembers, { desc }) => [desc(organizerMembers.createdAt)],
    });

    return members;
  }
}
