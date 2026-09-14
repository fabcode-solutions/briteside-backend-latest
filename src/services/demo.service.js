import { db } from '../db/index.js';
import { demoSessions } from '../db/schema/demoSessions.js';
import { demoRegistrations } from '../db/schema/demoRegistrations.js';
import { eq, sql, and } from 'drizzle-orm';
import { streamClient } from './stream.service.js';
import { sendDemoConfirmationEmail } from './mail.service.js';

export class DemoSessionService {
  static async create({
    title,
    description,
    scheduledAt,
    durationMinutes,
    maxParticipants,
    notes,
    meetingType = 'stream',
    externalMeetingLink,
    sessionType,
  }) {
    let streamCallId = null;
    const streamCallType = 'default';
    let inviteLink;

    if (meetingType === 'stream') {
      const callId = `demo-${crypto.randomUUID()}`;
      const call = streamClient.video.call(streamCallType, callId);
      await call.getOrCreate({
        data: {
          created_by_id: 'admin',
          starts_at: new Date(scheduledAt).toISOString(),
          custom: { purpose: 'demo', title },
          settings_override: {
            limits: {
              max_duration_seconds: (durationMinutes ?? 60) * 60,
            },
          },
        },
      });
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      streamCallId = callId;
      inviteLink = `${frontendUrl}/demo/join/${callId}`;
    } else {
      inviteLink = externalMeetingLink;
    }

    const [session] = await db
      .insert(demoSessions)
      .values({
        title,
        description: description ?? null,
        scheduledAt: new Date(scheduledAt),
        durationMinutes: durationMinutes ?? 60,
        sessionType: sessionType ?? null,
        meetingType,
        streamCallId,
        streamCallType: meetingType === 'stream' ? streamCallType : null,
        externalMeetingLink: externalMeetingLink ?? null,
        inviteLink,
        maxParticipants: maxParticipants ?? null,
        notes: notes ?? null,
        status: 'upcoming',
      })
      .returning();

    return session;
  }

  static async list({ page = 1, limit = 20, status } = {}) {
    const selectFields = {
      id: demoSessions.id,
      title: demoSessions.title,
      description: demoSessions.description,
      scheduledAt: demoSessions.scheduledAt,
      durationMinutes: demoSessions.durationMinutes,
      sessionType: demoSessions.sessionType,
      streamCallId: demoSessions.streamCallId,
      streamCallType: demoSessions.streamCallType,
      inviteLink: demoSessions.inviteLink,
      maxParticipants: demoSessions.maxParticipants,
      status: demoSessions.status,
      notes: demoSessions.notes,
      createdAt: demoSessions.createdAt,
      updatedAt: demoSessions.updatedAt,
      registrationCount:
        sql`(SELECT COUNT(*) FROM demo_registrations WHERE demo_registrations.demo_session_id = demo_sessions.id)`.mapWith(
          Number
        ),
    };
    let query = db.select(selectFields).from(demoSessions).orderBy(demoSessions.scheduledAt);
    if (status) {
      query = query.where(eq(demoSessions.status, status));
    }
    return query.limit(limit).offset((page - 1) * limit);
  }

  static async getById(sessionId) {
    const [session] = await db.select().from(demoSessions).where(eq(demoSessions.id, sessionId));
    return session ?? null;
  }

  static async getNextUpcoming({ sessionType } = {}) {
    const [session] = await db
      .select({
        id: demoSessions.id,
        title: demoSessions.title,
        description: demoSessions.description,
        scheduledAt: demoSessions.scheduledAt,
        durationMinutes: demoSessions.durationMinutes,
        sessionType: demoSessions.sessionType,
        streamCallId: demoSessions.streamCallId,
        streamCallType: demoSessions.streamCallType,
        inviteLink: demoSessions.inviteLink,
        maxParticipants: demoSessions.maxParticipants,
        status: demoSessions.status,
        notes: demoSessions.notes,
        createdAt: demoSessions.createdAt,
        updatedAt: demoSessions.updatedAt,
        registrationCount:
          sql`(SELECT COUNT(*) FROM demo_registrations WHERE demo_registrations.demo_session_id = demo_sessions.id)`.mapWith(
            Number
          ),
      })
      .from(demoSessions)
      .where(
        sessionType
          ? and(eq(demoSessions.status, 'upcoming'), eq(demoSessions.sessionType, sessionType))
          : eq(demoSessions.status, 'upcoming')
      )
      .orderBy(demoSessions.scheduledAt)
      .limit(1);
    return session ?? null;
  }

  static async updateStatus(sessionId, status) {
    const [updated] = await db
      .update(demoSessions)
      .set({ status, updatedAt: new Date() })
      .where(eq(demoSessions.id, sessionId))
      .returning();
    return updated ?? null;
  }

  static async updateStatusByCallId(streamCallId, status) {
    await db
      .update(demoSessions)
      .set({ status, updatedAt: new Date() })
      .where(eq(demoSessions.streamCallId, streamCallId));
  }

  static async update(sessionId, data) {
    const {
      title,
      description,
      scheduledAt,
      durationMinutes,
      maxParticipants,
      notes,
      externalMeetingLink,
      sessionType,
    } = data;

    const session = await DemoSessionService.getById(sessionId);
    if (!session) return null;

    if (
      session.meetingType === 'stream' &&
      session.streamCallId &&
      (scheduledAt !== undefined || durationMinutes !== undefined)
    ) {
      try {
        const call = streamClient.video.call(
          session.streamCallType || 'default',
          session.streamCallId
        );
        const streamUpdate = {};
        if (scheduledAt !== undefined) streamUpdate.starts_at = new Date(scheduledAt).toISOString();
        if (durationMinutes !== undefined) {
          streamUpdate.settings_override = {
            limits: { max_duration_seconds: durationMinutes * 60 },
          };
        }
        await call.update({ data: streamUpdate });
      } catch (err) {
        console.error('Stream call update failed:', err.message);
      }
    }

    const updateValues = { updatedAt: new Date() };
    if (title !== undefined) updateValues.title = title;
    if (description !== undefined) updateValues.description = description;
    if (scheduledAt !== undefined) updateValues.scheduledAt = new Date(scheduledAt);
    if (durationMinutes !== undefined) updateValues.durationMinutes = durationMinutes;
    if (maxParticipants !== undefined) updateValues.maxParticipants = maxParticipants;
    if (notes !== undefined) updateValues.notes = notes;
    if (sessionType !== undefined) updateValues.sessionType = sessionType;
    if (externalMeetingLink !== undefined) {
      updateValues.externalMeetingLink = externalMeetingLink;
      if (session.meetingType === 'external') updateValues.inviteLink = externalMeetingLink;
    }

    const [updated] = await db
      .update(demoSessions)
      .set(updateValues)
      .where(eq(demoSessions.id, sessionId))
      .returning();

    return updated ?? null;
  }

  static async delete(sessionId) {
    const session = await DemoSessionService.getById(sessionId);
    if (!session) return false;

    if (session.streamCallId) {
      try {
        const call = streamClient.video.call(
          session.streamCallType || 'default',
          session.streamCallId
        );
        await call.delete();
      } catch (err) {
        console.error('Stream call delete failed:', err.message);
      }
    }

    await db.delete(demoSessions).where(eq(demoSessions.id, sessionId));
    return true;
  }
}

export class DemoRegistrationService {
  static async register(sessionId, data) {
    const {
      firstName,
      lastName,
      email,
      audience,
      audienceType,
      primaryCategory,
      scaleMetric,
      currentPlatform,
      goals,
    } = data;

    const session = await DemoSessionService.getById(sessionId);
    if (!session) throw new Error('Demo session not found');
    if (session.status === 'cancelled' || session.status === 'completed') {
      throw new Error('This demo session is no longer available for registration');
    }

    const [registration] = await db
      .insert(demoRegistrations)
      .values({
        demoSessionId: sessionId,
        firstName,
        lastName,
        email,
        audience,
        audienceType: audienceType ?? null,
        primaryCategory,
        scaleMetric,
        currentPlatform: currentPlatform ?? null,
        goals: goals ?? null,
        status: 'pending',
      })
      .returning();

    await sendDemoConfirmationEmail({
      to: email,
      firstName,
      inviteLink: session.inviteLink,
      scheduledAt: session.scheduledAt,
    });

    return registration;
  }

  static async listBySession(sessionId, { page = 1, limit = 50 } = {}) {
    return db
      .select()
      .from(demoRegistrations)
      .where(eq(demoRegistrations.demoSessionId, sessionId))
      .orderBy(demoRegistrations.createdAt)
      .limit(limit)
      .offset((page - 1) * limit);
  }
}
