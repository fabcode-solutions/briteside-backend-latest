import { describe, it, expect, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

// mediaModeration.service.js imports streamClient.js, which constructs a
// GetStream client at module load time — irrelevant to this file's pure
// SQL/logic tests, and must not require real GetStream credentials to run.
vi.mock('../src/utils/streamClient.js', () => ({ streamClient: {} }));

import {
  isHeldFromViewer,
  postsModerationGate,
  postsModerationGateStrict,
  storiesModerationGate,
  storiesModerationGateStrict,
  discussionsModerationGate,
} from '../src/services/moderation/mediaModeration.service.js';

const dialect = new PgDialect();
const compile = frag => dialect.sqlToQuery(frag).sql;

describe('isHeldFromViewer — a copyright match never holds content from anyone', () => {
  const uploader = 'uploader-1';
  const otherUser = 'other-user-2';

  it('uploader (owner) sees their own content regardless of copyright case status', () => {
    expect(
      isHeldFromViewer({ moderationStatus: 'approved', ownerId: uploader, viewerId: uploader })
    ).toBe(false);
  });

  it('a different user still sees content with a pending copyright case — only audio is muted client-side', () => {
    expect(
      isHeldFromViewer({ moderationStatus: 'approved', ownerId: uploader, viewerId: otherUser })
    ).toBe(false);
  });

  it('a different user still sees content once infringement is confirmed', () => {
    // isHeldFromViewer no longer takes a copyrightStatus param at all — a
    // confirmed match is purely an "audio unavailable" badge, never a hold.
    expect(
      isHeldFromViewer({ moderationStatus: 'approved', ownerId: uploader, viewerId: otherUser })
    ).toBe(false);
  });

  it('a different user cannot see content held by GetStream moderation', () => {
    expect(
      isHeldFromViewer({ moderationStatus: 'rejected', ownerId: uploader, viewerId: otherUser })
    ).toBe(true);
  });

  it('a different user sees normal, unheld content', () => {
    expect(
      isHeldFromViewer({ moderationStatus: 'approved', ownerId: uploader, viewerId: otherUser })
    ).toBe(false);
  });

  it('does not treat two null/undefined owner-vs-viewer ids as an "owner match"', () => {
    // System/legacy content with no owner must not bypass the held check just
    // because both ownerId and viewerId happen to be null/undefined.
    expect(
      isHeldFromViewer({ moderationStatus: 'rejected', ownerId: null, viewerId: undefined })
    ).toBe(true);
  });
});

describe('SQL gates — no copyright EXISTS clause (a match never affects feed visibility)', () => {
  it('postsModerationGate only checks content_moderation', () => {
    const sql = compile(postsModerationGate('11111111-1111-1111-1111-111111111111'));
    expect(sql).not.toContain('acr_copyright_review_cases');
    expect(sql).toContain('content_moderation');
  });

  it('postsModerationGateStrict has no owner exception and no copyright clause', () => {
    const sql = compile(postsModerationGateStrict());
    expect(sql).not.toContain('acr_copyright_review_cases');
    expect(sql).not.toContain('!=');
  });

  it('storiesModerationGate only checks content_moderation', () => {
    const sql = compile(storiesModerationGate('11111111-1111-1111-1111-111111111111'));
    expect(sql).not.toContain('acr_copyright_review_cases');
  });

  it('storiesModerationGateStrict has no owner exception and no copyright clause', () => {
    const sql = compile(storiesModerationGateStrict());
    expect(sql).not.toContain('acr_copyright_review_cases');
    expect(sql).not.toContain('!=');
  });

  it('discussionsModerationGate only checks content_moderation', () => {
    const sql = compile(discussionsModerationGate('11111111-1111-1111-1111-111111111111'));
    expect(sql).not.toContain('acr_copyright_review_cases');
  });
});
