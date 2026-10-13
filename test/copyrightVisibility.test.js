import { describe, it, expect, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

// mediaModeration.service.js imports streamClient.js, which constructs a
// GetStream client at module load time — irrelevant to this file's pure
// SQL/logic tests, and must not require real GetStream credentials to run.
vi.mock('../src/utils/streamClient.js', () => ({ streamClient: {} }));

import {
  isHeldFromViewer,
  COPYRIGHT_HELD_FROM_OTHERS,
  postsModerationGate,
  postsModerationGateStrict,
  storiesModerationGate,
  storiesModerationGateStrict,
  discussionsModerationGate,
} from '../src/services/moderation/mediaModeration.service.js';

const dialect = new PgDialect();
const compile = frag => dialect.sqlToQuery(frag).sql;

describe('COPYRIGHT_HELD_FROM_OTHERS', () => {
  it('holds pending and confirmed_infringement, nothing else', () => {
    expect(COPYRIGHT_HELD_FROM_OTHERS.has('pending')).toBe(true);
    expect(COPYRIGHT_HELD_FROM_OTHERS.has('confirmed_infringement')).toBe(true);
    expect(COPYRIGHT_HELD_FROM_OTHERS.has('reviewed')).toBe(false);
    expect(COPYRIGHT_HELD_FROM_OTHERS.has('dismissed')).toBe(false);
    expect(COPYRIGHT_HELD_FROM_OTHERS.has(null)).toBe(false);
  });
});

describe('isHeldFromViewer — uploader, admin, and other-user visibility', () => {
  const uploader = 'uploader-1';
  const otherUser = 'other-user-2';

  it('uploader (owner) sees their own content while a copyright case is pending', () => {
    expect(
      isHeldFromViewer({
        moderationStatus: 'approved',
        copyrightStatus: 'pending',
        ownerId: uploader,
        viewerId: uploader,
      })
    ).toBe(false);
  });

  it('uploader (owner) sees their own content after confirmed_infringement', () => {
    expect(
      isHeldFromViewer({
        moderationStatus: 'approved',
        copyrightStatus: 'confirmed_infringement',
        ownerId: uploader,
        viewerId: uploader,
      })
    ).toBe(false);
  });

  it('a different user cannot see content with a pending copyright case', () => {
    expect(
      isHeldFromViewer({
        moderationStatus: 'approved',
        copyrightStatus: 'pending',
        ownerId: uploader,
        viewerId: otherUser,
      })
    ).toBe(true);
  });

  it('a different user cannot see content once infringement is confirmed', () => {
    expect(
      isHeldFromViewer({
        moderationStatus: 'approved',
        copyrightStatus: 'confirmed_infringement',
        ownerId: uploader,
        viewerId: otherUser,
      })
    ).toBe(true);
  });

  it('a different user CAN see content again once the case is dismissed', () => {
    expect(
      isHeldFromViewer({
        moderationStatus: 'approved',
        copyrightStatus: 'dismissed',
        ownerId: uploader,
        viewerId: otherUser,
      })
    ).toBe(false);
  });

  it('a different user CAN see content once marked reviewed (no issue found)', () => {
    expect(
      isHeldFromViewer({
        moderationStatus: 'approved',
        copyrightStatus: 'reviewed',
        ownerId: uploader,
        viewerId: otherUser,
      })
    ).toBe(false);
  });

  it('a different user cannot see content with no copyright case but held by GetStream', () => {
    expect(
      isHeldFromViewer({
        moderationStatus: 'rejected',
        copyrightStatus: null,
        ownerId: uploader,
        viewerId: otherUser,
      })
    ).toBe(true);
  });

  it('a different user sees normal, unheld content', () => {
    expect(
      isHeldFromViewer({
        moderationStatus: 'approved',
        copyrightStatus: null,
        ownerId: uploader,
        viewerId: otherUser,
      })
    ).toBe(false);
  });

  it('does not treat two null/undefined owner-vs-viewer ids as an "owner match"', () => {
    // System/legacy content with no owner must not bypass the held check just
    // because both ownerId and viewerId happen to be null/undefined.
    expect(
      isHeldFromViewer({
        moderationStatus: 'approved',
        copyrightStatus: 'pending',
        ownerId: null,
        viewerId: undefined,
      })
    ).toBe(true);
  });
});

describe('SQL gates compile with the copyright EXISTS clause', () => {
  it('postsModerationGate excludes a post the viewer does not own', () => {
    const sql = compile(postsModerationGate('11111111-1111-1111-1111-111111111111'));
    expect(sql).toContain('acr_copyright_review_cases');
    expect(sql).toContain("('pending', 'confirmed_infringement')");
    // Owner-exception clause must be present for the copyright EXISTS too
    const copyrightClause = sql.split('acr_copyright_review_cases')[1];
    expect(copyrightClause).toContain('!=');
  });

  it('postsModerationGateStrict has no owner exception for either system', () => {
    const sql = compile(postsModerationGateStrict());
    expect(sql).toContain('acr_copyright_review_cases');
    // No viewer param at all in the strict variant
    expect(sql).not.toContain('!=');
  });

  it('storiesModerationGate uses exact equality (not LIKE) against the single media_url column', () => {
    const sql = compile(storiesModerationGate('11111111-1111-1111-1111-111111111111'));
    expect(sql).toContain('acr_copyright_review_cases');
    expect(sql).toMatch(/m\.url = "stories"\."media_url"/);
  });

  it('storiesModerationGateStrict has no owner exception', () => {
    const sql = compile(storiesModerationGateStrict());
    expect(sql).toContain('acr_copyright_review_cases');
    expect(sql).not.toContain('!=');
  });

  it('discussionsModerationGate includes the copyright EXISTS clause', () => {
    const sql = compile(discussionsModerationGate('11111111-1111-1111-1111-111111111111'));
    expect(sql).toContain('acr_copyright_review_cases');
    expect(sql).toContain("('pending', 'confirmed_infringement')");
  });
});
