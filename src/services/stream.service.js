import { db } from '../db/index.js';
import { streamCalls } from '../db/schema/streamCalls.js';
import { eq } from 'drizzle-orm';
import { StreamClient } from '@stream-io/node-sdk';
import { getUserInformation } from '../utils/helper.js';

// Initialize Stream client (should be moved to config later)
export const streamClient = new StreamClient(
  process.env.STREAM_API_KEY || 'demo-api-key',
  process.env.STREAM_API_SECRET || 'demo-secret'
);

export class StreamCallService {
  // Create a new call
  static async createCall({
    cid,
    type,
    created_by_user_id,
    starts_at,
    backstage = false,
    members = [],
    custom = {},
  }) {
    const [call] = await db
      .insert(streamCalls)
      .values({
        cid,
        type,
        created_by_user_id,
        starts_at,
        backstage,
        members,
        custom,
        ongoing: false,
      })
      .returning();
    return call;
  }

  // Update call status (ongoing, ended_at, etc.)
  static async updateCallStatus(id, { ongoing, ended_at, updated_at }) {
    const [call] = await db
      .update(streamCalls)
      .set({ ongoing, ended_at, updated_at: updated_at || new Date() })
      .where(eq(streamCalls.id, id))
      .returning();
    return call;
  }

  // Log call events (append to custom field)
  static async logCallEvent(id, event) {
    const [call] = await db.select().from(streamCalls).where(eq(streamCalls.id, id));
    const custom = call?.custom || {};
    custom.events = Array.isArray(custom.events) ? custom.events : [];
    custom.events.push({ ...event, timestamp: new Date() });
    const [updated] = await db
      .update(streamCalls)
      .set({ custom })
      .where(eq(streamCalls.id, id))
      .returning();
    return updated;
  }

  // Get call by ID
  static async getCall(cid) {
    const [call] = await db.select().from(streamCalls).where(eq(streamCalls.cid, cid));
    return call;
  }

  // List calls (optionally filter by user)
  static async listCalls({ created_by_user_id } = {}) {
    let query = db.select().from(streamCalls);
    if (created_by_user_id) {
      query = query.where(eq(streamCalls.created_by_user_id, created_by_user_id));
    }
    return await query;
  }

  // Initiate call with Stream SDK
  // static async initiateCall({ cid, type, created_by_user_id, members, custom, callId }) {
  //   try {
  //     // Create call via Stream SDK
  //     const call = streamClient.video.call(type, callId);

  //     await call.getOrCreate({
  //       ring: true,
  //       // notify: true, both can not be true at the same time
  //       data: {
  //         created_by_id: created_by_user_id,
  //         members: members,
  //         custom: custom,
  //       },
  //     });

  //     // Store call in database
  //     const [dbCall] = await db
  //       .insert(streamCalls)
  //       .values({
  //         cid,
  //         type,
  //         created_by_user_id,
  //         members,
  //         custom: {
  //           ...custom,
  //           streamCallId: callId,
  //         },
  //         ongoing: false,
  //       })
  //       .returning();

  //     return {
  //       ...dbCall,
  //       callType: type,
  //       callId: callId,
  //     };
  //   } catch (error) {
  //     console.error('Stream call creation error:', error);
  //     // Fallback: still create DB record even if Stream fails
  //     const [dbCall] = await db
  //       .insert(streamCalls)
  //       .values({
  //         cid,
  //         type,
  //         created_by_user_id,
  //         members,
  //         custom: {
  //           ...custom,
  //           streamCallId: callId,
  //           error: error.message,
  //         },
  //         ongoing: false,
  //       })
  //       .returning();

  //     return { dbCall, error: error.message };
  //   }
  // }

  static async initiateCall({ cid, type, created_by_user_id, members, custom, callId }) {
    try {
      const call = streamClient.video.call(type, callId);
      const callData = await call.getOrCreate({
        // Remove ring: true for livestreams
        data: {
          created_by_id: created_by_user_id,
          members: members,
          custom: custom,
          // For livestreams, enable backstage mode
          settings_override:
            type === 'livestream'
              ? {
                  backstage: { enabled: true },
                }
              : undefined,
        },
      });

      const [dbCall] = await db
        .insert(streamCalls)
        .values({
          cid,
          type,
          created_by_user_id,
          members,
          custom: {
            ...custom,
            streamCallId: callId,
          },
          ongoing: false,
        })
        .returning();

      return {
        ...dbCall,
        callType: type,
        callId: callId,
      };
    } catch (error) {
      console.error('Stream call creation error:', error);
      const [dbCall] = await db
        .insert(streamCalls)
        .values({
          cid,
          type,
          created_by_user_id,
          members,
          custom: {
            ...custom,
            streamCallId: callId,
            error: error.message,
          },
          ongoing: false,
        })
        .returning();

      return { dbCall, error: error.message };
    }
  }
  static async registerOnStream({
    callId,
    type = 'default',
    created_by_user_id,
    members,
    custom = {},
    starts_at,
    max_duration_seconds,
  }) {
    const call = streamClient.video.call(type, callId);
    const response = await call.getOrCreate({
      data: {
        created_by_id: created_by_user_id,
        members,
        custom,
        // ...(starts_at && { starts_at: new Date(starts_at).toISOString() }),
        ...(max_duration_seconds && {
          settings_override: { limits: { max_duration_seconds } },
        }),
      },
    });
    return response;
  }

  static async generateToken(userId) {
    const newUser = await getUserInformation(userId);
    await streamClient.upsertUsers([newUser]);

    // 1. Get current Unix timestamp in seconds
    const now = Math.floor(Date.now() / 1000);

    // 2. Backdate by 60 seconds to account for India -> Ohio clock skew
    const issuedAt = now - 60;

    // 3. Set expiration (e.g., 1 hour from the issued time)
    const expiration = issuedAt + 3600;

    const token = streamClient.generateUserToken({
      user_id: userId,
      validity_in_seconds: 3600, // 1 hour
      iat: issuedAt,
    });

    return token;
  }
}
