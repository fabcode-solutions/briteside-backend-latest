import { randomUUID } from 'crypto';
import { eq, and, inArray } from 'drizzle-orm';
import { streamClient } from '../../utils/streamClient.js';
import { db } from '../../db/index.js';
import { textModeration } from '../../db/schema/moderation.js';
import { users } from '../../db/schema/users.js';
import { maskProfanity } from './textMasking.service.js';
import logger from '../../config/logger.js';
import ApiError from '../../utils/api-error.js';

// Sync policy (block-before-send surfaces). Created by scripts/setup-moderation-config.js
export const TEXT_CONFIG_KEY = 'gokiro_text';
// Async policy (flag-only surfaces: reports, support, organizer content)
export const TEXT_ASYNC_CONFIG_KEY = 'gokiro_text_async';

// Entity types — used for filtering in the moderation dashboard (Stream + custom).
// Also reused as the text_moderation.entityType key (see recordFlag/maskFlaggedText
// below) — USER_PROFILE and TALENT_PROFILE exist alongside PROFILE specifically so
// the users table's bio/name fields and a talent_profiles row don't collide with a
// social_profiles row when all three are naturally keyed by the same userId.
export const TEXT_ENTITY = {
  MESSAGE: 'gokiro:text:message',
  COMMENT: 'gokiro:text:comment',
  POST: 'gokiro:text:post',
  STORY: 'gokiro:text:story',
  PROFILE: 'gokiro:text:profile',
  USER_PROFILE: 'gokiro:text:profile:user',
  TALENT_PROFILE: 'gokiro:text:profile:talent',
  DISCUSSION: 'gokiro:text:discussion',
  REVIEW: 'gokiro:text:review',
  GROUP: 'gokiro:text:group',
  EVENT: 'gokiro:text:event',
  LIVESTREAM: 'gokiro:text:livestream',
  SUPPORT: 'gokiro:text:support',
};

// Local PII masking. Stream's own `mask_flag` action only works for Stream Chat,
// not the custom-content Check API, so masking must happen app-side.
const PHONE_RE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/g;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

export function maskPII(text) {
  if (typeof text !== 'string' || !text) return text;
  return text
    .replace(EMAIL_RE, '****@****')
    .replace(PHONE_RE, match => (match.replace(/\D/g, '').length >= 10 ? '**********' : match));
}

const CHECK_TIMEOUT_MS = 4000;

const withTimeout = (promise, ms) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`moderation check timed out after ${ms}ms`)), ms)
    ),
  ]);

export class TextModerationService {
  /**
   * Synchronous text check against Stream Moderation.
   * Fail-open: on Stream error/timeout the content is allowed and a
   * fire-and-forget async check still routes it to the review queue.
   *
   * @returns {Promise<{ action: 'keep'|'flag'|'remove', failedOpen?: boolean }>}
   */
  static async check({ entityType, entityId, entityCreatorId, texts }) {
    const cleaned = (texts || []).filter(t => typeof t === 'string' && t.trim().length > 0);
    if (cleaned.length === 0) return { action: 'keep' };

    const request = {
      entity_type: entityType,
      entity_id: entityId || randomUUID(),
      entity_creator_id: String(entityCreatorId),
      moderation_payload: { texts: cleaned },
      config_key: TEXT_CONFIG_KEY,
      options: { force_sync: true },
    };

    try {
      const res = await withTimeout(streamClient.moderation.check(request), CHECK_TIMEOUT_MS);
      const action = res?.recommended_action || 'keep';
      const item = res?.item || null;
      const severity = item?.ai_text_severity ?? null;
      const labels = item ? [...new Set((item.flags || []).flatMap(f => f.labels || []))] : [];
      if (action !== 'keep') {
        logger.warn('Text moderation verdict', {
          module: 'text-moderation',
          entityType,
          entityId: request.entity_id,
          entityCreatorId,
          action,
          severity,
          labels,
        });
      }
      return { action, severity, labels };
    } catch (error) {
      logger.error('Text moderation check failed — failing open', {
        module: 'text-moderation',
        entityType,
        entityCreatorId,
        error: error.message,
      });
      // Content still reaches the review queue via async check
      this.flagAsync({ entityType, entityId: request.entity_id, entityCreatorId, texts: cleaned });
      return { action: 'keep', failedOpen: true, severity: null, labels: [] };
    }
  }

  /**
   * Check + throw 422 on `remove`. Returns texts with PII masked when `mask` is set.
   * Callers must persist the returned `texts` (same order as input; null/empty preserved).
   */
  static async assertAllowed({ entityType, entityId, entityCreatorId, texts, mask = false }) {
    const { action, failedOpen, severity, labels } = await this.check({
      entityType,
      entityId,
      entityCreatorId,
      texts,
    });

    if (action === 'remove') {
      throw new ApiError(
        422,
        'This content violates our community guidelines and cannot be posted.',
        true,
        '',
        { code: 'MODERATION_BLOCKED' }
      );
    }

    return {
      action,
      failedOpen: Boolean(failedOpen),
      severity,
      labels,
      texts: mask ? (texts || []).map(t => maskPII(t)) : texts,
    };
  }

  /**
   * Calls Stream's Labels API for its blocklist-driven `masked_content` — this
   * works for any content type (unlike `mask_flag`, which is Stream-Chat-only,
   * see maskPII's comment above). Reuses TEXT_CONFIG_KEY so the same
   * `gokiro_profanity` blocklist Check already applies is what does the masking.
   * Deliberately does NOT fall back to `fully_masked_content` — that redacts
   * the entire message (only present when recommended_action != 'keep'), which
   * is wrong for plain vulgarity caught by the NLP/LLM classifier with no
   * blocklist hit. Word-level masking for that case comes from the local
   * regex fallback in recordFlag() instead. Returns null (never throws) on
   * error/timeout or when no blocklist token matched.
   */
  static async streamMask(text, { entityId, userId } = {}) {
    try {
      const res = await withTimeout(
        streamClient.moderation.labels({
          content: text,
          content_type: 'message',
          policy: TEXT_CONFIG_KEY,
          content_id: entityId,
          user_id: userId ? String(userId) : undefined,
        }),
        CHECK_TIMEOUT_MS
      );
      return res?.masked_content ?? null;
    } catch (error) {
      logger.error('Stream labels masking failed — falling back to local regex mask', {
        module: 'text-moderation',
        entityId,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Persists a flagged-entity row after Stream's check returned `action: 'flag'`.
   * Masks profanity words in each provided text and stores both versions.
   * Never throws — a failure here must not break the caller's request.
   *
   * @param {object} params
   * @param {string} params.entityType - one of TEXT_ENTITY
   * @param {string} params.entityId - the entity's own primary key (post.id, comment.id, etc.)
   * @param {string} [params.userId] - the entity's creator, for dashboard filtering
   * @param {string[]} params.fieldNames - names matching `texts` by index, e.g. ['caption']
   * @param {(string|null|undefined)[]} params.texts - same order/length as fieldNames
   * @param {string} [params.severity] - Stream's item.ai_text_severity (e.g. 'LOW', 'HIGH')
   * @param {string[]} [params.labels] - Stream's flagged category labels (e.g. ['VULGARITY'])
   */
  static async recordFlag({ entityType, entityId, userId, fieldNames, texts, severity, labels }) {
    try {
      const fields = {};

      for (let i = 0; i < fieldNames.length; i++) {
        const original = texts[i];
        if (!original) continue;
        const { masked: localMasked, matchedWords } = maskProfanity(original);
        const streamMasked = await this.streamMask(original, { entityId, userId });
        fields[fieldNames[i]] = { original, masked: streamMasked ?? localMasked, matchedWords };
      }

      if (Object.keys(fields).length === 0) return;

      await db
        .insert(textModeration)
        .values({
          entityType,
          entityId,
          userId,
          status: 'flagged',
          fields,
          severity: severity ?? null,
          labels: labels ?? [],
        })
        .onConflictDoUpdate({
          target: [textModeration.entityType, textModeration.entityId],
          set: {
            fields,
            status: 'flagged',
            updatedAt: new Date(),
            severity: severity ?? null,
            labels: labels ?? [],
          },
        });
    } catch (error) {
      logger.error('Failed to record text moderation flag', {
        module: 'text-moderation',
        entityType,
        entityId,
        error: error.message,
      });
    }
  }

  /**
   * Convenience wrapper around recordFlag: pass the whole object assertAllowed()
   * returned, and this no-ops unless it was actually flagged/masked — callers
   * don't need to destructure severity/labels or write their own action check.
   * `mask` is a distinct recommended_action (blocklist rule configured with
   * action:'mask', see setup-moderation-config.js) — content stays allowed
   * (assertAllowed only blocks on 'remove') but still needs a text_moderation
   * row so `maskFlaggedText` can serve the masked version to filter-enabled
   * viewers. Without this, `mask`-verdict content silently passed through
   * unrecorded and unmasked.
   *
   * @param {{action: string, severity?: string, labels?: string[]}} moderationResult - assertAllowed()'s return value
   * @param {object} params - same shape as recordFlag's params, minus severity/labels
   */
  static recordIfFlagged(moderationResult, { entityType, entityId, userId, fieldNames, texts }) {
    if (!['flag', 'mask'].includes(moderationResult?.action)) return;
    return this.recordFlag({
      entityType,
      entityId,
      userId,
      fieldNames,
      texts,
      severity: moderationResult.severity,
      labels: moderationResult.labels,
    });
  }

  /**
   * Looks up a viewer's own profanityFilterEnabled preference (the viewer,
   * not the content's author). Returns false for missing/anonymous viewers
   * — masking is off by default.
   */
  static async getFilterEnabled(viewerId) {
    if (!viewerId) return false;
    const viewer = await db.query.users.findFirst({
      where: eq(users.id, viewerId),
      columns: { profanityFilterEnabled: true },
    });
    return viewer?.profanityFilterEnabled ?? false;
  }

  /**
   * Read-side: substitutes masked text for original on a list of already-fetched
   * rows, only when `filterEnabled` is true (the VIEWER's own setting) and a
   * flagged row exists for that item. Mutates and returns the same array.
   *
   * @param {object[]} items - rows already fetched, each with an `id` and the given fields
   * @param {object} params
   * @param {string} params.entityType - one of TEXT_ENTITY
   * @param {string[]} params.fields - which properties on each item to check/replace, e.g. ['caption']
   * @param {boolean} [params.filterEnabled] - the viewer's profanityFilterEnabled value
   */
  static async maskFlaggedText(items, { entityType, fields, filterEnabled }) {
    if (!filterEnabled || !Array.isArray(items) || items.length === 0) return items;

    const ids = items.map(i => i.id).filter(Boolean);
    if (ids.length === 0) return items;

    const rows = await db.query.textModeration.findMany({
      where: and(
        eq(textModeration.entityType, entityType),
        inArray(textModeration.entityId, ids),
        eq(textModeration.status, 'flagged')
      ),
    });
    if (rows.length === 0) return items;

    const map = new Map(rows.map(r => [r.entityId, r.fields]));

    for (const item of items) {
      const flaggedFields = map.get(item.id);
      if (!flaggedFields) continue;
      for (const field of fields) {
        if (flaggedFields[field]?.masked !== undefined) {
          item[field] = flaggedFields[field].masked;
        }
      }
    }

    return items;
  }

  /**
   * Single-item convenience wrapper around `maskFlaggedText`.
   */
  static async maskFlaggedTextSingle(item, { entityType, fields, filterEnabled }) {
    if (!item) return item;
    const [result] = await this.maskFlaggedText([item], { entityType, fields, filterEnabled });
    return result;
  }

  /**
   * Fire-and-forget async check (Tier 2 surfaces + fail-open fallback).
   * Never throws; verdicts land in the Stream review queue.
   */
  static flagAsync({ entityType, entityId, entityCreatorId, texts }) {
    const cleaned = (texts || []).filter(t => typeof t === 'string' && t.trim().length > 0);
    if (cleaned.length === 0) return;

    streamClient.moderation
      .check({
        entity_type: entityType,
        entity_id: entityId || randomUUID(),
        entity_creator_id: String(entityCreatorId),
        moderation_payload: { texts: cleaned },
        config_key: TEXT_ASYNC_CONFIG_KEY,
      })
      .catch(error => {
        logger.error('Async text moderation check failed', {
          module: 'text-moderation',
          entityType,
          entityCreatorId,
          error: error.message,
        });
      });
  }
}

export default TextModerationService;
