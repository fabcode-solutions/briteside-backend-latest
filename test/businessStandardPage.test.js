import { describe, it, expect } from 'vitest';
import {
  createBusinessSchema,
  updateBusinessSchema,
  createWallPostSchema,
  listWallPostsSchema,
  moderateWallPostSchema,
  createWallCommentSchema,
  listWallCommentsSchema,
  wallCommentIdSchema,
  updateWallCommentSchema,
  listWallRepliesSchema,
} from '../src/validations/business.validation.js';

const POST = '22222222-2222-4222-8222-222222222222';

const BID = '11111111-1111-4111-8111-111111111111';
const base = { name: 'Corner Café', category: 'beauty', city: 'Austin' };

describe('business pageType validation', () => {
  it('defaults new businesses to appointments', () => {
    const parsed = createBusinessSchema.safeParse({ body: { ...base } });
    expect(parsed.success).toBe(true);
    expect(parsed.data.body.pageType).toBe('appointments');
  });

  it('accepts a standard page on create', () => {
    const parsed = createBusinessSchema.safeParse({ body: { ...base, pageType: 'standard' } });
    expect(parsed.success).toBe(true);
    expect(parsed.data.body.pageType).toBe('standard');
  });

  it.each(['appointments', 'standard'])('accepts pageType %s on update', pageType => {
    const parsed = updateBusinessSchema.safeParse({ params: { businessId: BID }, body: { pageType } });
    expect(parsed.success).toBe(true);
  });

  it('rejects an unknown pageType', () => {
    const parsed = updateBusinessSchema.safeParse({
      params: { businessId: BID },
      body: { pageType: 'shop' },
    });
    expect(parsed.success).toBe(false);
  });
});

describe('wall post validation', () => {
  const post = text => createWallPostSchema.safeParse({ params: { idOrSlug: 'corner-cafe' }, body: { text } });

  it('trims and accepts normal text', () => {
    const parsed = post('  Great coffee!  ');
    expect(parsed.success).toBe(true);
    expect(parsed.data.body.text).toBe('Great coffee!');
  });

  it.each(['', '   ', 'x'.repeat(2001)])('rejects empty or over-long text', text => {
    expect(post(text).success).toBe(false);
  });

  it.each(['approved', 'rejected'])('accepts moderation status %s', status => {
    const parsed = moderateWallPostSchema.safeParse({
      params: { idOrSlug: 'corner-cafe', postId: POST },
      body: { status },
    });
    expect(parsed.success).toBe(true);
  });

  it.each(['pending', 'deleted', ''])('rejects moderation status %s', status => {
    const parsed = moderateWallPostSchema.safeParse({
      params: { idOrSlug: 'corner-cafe', postId: POST },
      body: { status },
    });
    expect(parsed.success).toBe(false);
  });

  it('caps the page size', () => {
    const q = limit => listWallPostsSchema.safeParse({ params: { idOrSlug: 'x' }, query: { limit } });
    expect(q('20').success).toBe(true);
    expect(q('51').success).toBe(false);
  });
});

describe('wall comment validation', () => {
  const COMMENT = '33333333-3333-4333-8333-333333333333';
  const comment = text =>
    createWallCommentSchema.safeParse({ params: { idOrSlug: 'corner-cafe', postId: POST }, body: { text } });

  it('trims and accepts normal text', () => {
    const parsed = comment('  Love this place  ');
    expect(parsed.success).toBe(true);
    expect(parsed.data.body.text).toBe('Love this place');
  });

  it.each(['', '   ', 'x'.repeat(1001)])('rejects empty or over-long text', text => {
    expect(comment(text).success).toBe(false);
  });

  it('requires a uuid post id', () => {
    const parsed = createWallCommentSchema.safeParse({
      params: { idOrSlug: 'corner-cafe', postId: 'nope' },
      body: { text: 'hi' },
    });
    expect(parsed.success).toBe(false);
  });

  it('requires uuid ids to delete a comment', () => {
    const ok = wallCommentIdSchema.safeParse({ params: { idOrSlug: 'x', postId: POST, commentId: COMMENT } });
    const bad = wallCommentIdSchema.safeParse({ params: { idOrSlug: 'x', postId: POST, commentId: '1' } });
    expect(ok.success).toBe(true);
    expect(bad.success).toBe(false);
  });

  it('accepts a reply with mentions and defaults mentions to []', () => {
    const reply = createWallCommentSchema.safeParse({
      params: { idOrSlug: 'x', postId: POST },
      body: { text: '@ben hi', parentId: COMMENT, mentionedUserIds: [POST] },
    });
    expect(reply.success).toBe(true);
    const plain = comment('hi');
    expect(plain.data.body.mentionedUserIds).toEqual([]);
    const badParent = createWallCommentSchema.safeParse({
      params: { idOrSlug: 'x', postId: POST },
      body: { text: 'hi', parentId: 'nope' },
    });
    expect(badParent.success).toBe(false);
  });

  it('validates comment edits', () => {
    const edit = text =>
      updateWallCommentSchema.safeParse({
        params: { idOrSlug: 'x', postId: POST, commentId: COMMENT },
        body: { text },
      });
    expect(edit('  fixed typo ').data.body.text).toBe('fixed typo');
    expect(edit('').success).toBe(false);
    expect(edit('x'.repeat(1001)).success).toBe(false);
  });

  it('defaults and caps the replies page size', () => {
    const q = query =>
      listWallRepliesSchema.safeParse({ params: { idOrSlug: 'x', postId: POST, commentId: COMMENT }, query });
    expect(q({}).data.query).toEqual({ page: 1, limit: 20 });
    expect(q({ limit: '51' }).success).toBe(false);
  });

  it('defaults and caps the comment page size', () => {
    const q = query => listWallCommentsSchema.safeParse({ params: { idOrSlug: 'x', postId: POST }, query });
    expect(q({}).data.query).toEqual({ page: 1, limit: 20 });
    expect(q({ limit: '51' }).success).toBe(false);
  });
});
