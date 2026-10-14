import { describe, it, expect, vi } from 'vitest';
import { acrCopyrightReviewCases } from '../src/db/schema/acrCopyrightReviewCases.js';

// A self-referential "thenable" chain mock: every drizzle query-builder method
// returns another chainable object, so the mock doesn't need to track exact
// call order (list() chains .from().leftJoin().leftJoin().where().orderBy()
// .limit().offset(), while the sibling count query only chains .from().where()).
function chainable(resolveValue) {
  const obj = {
    leftJoin: () => chainable(resolveValue),
    innerJoin: () => chainable(resolveValue),
    where: () => chainable(resolveValue),
    orderBy: () => chainable(resolveValue),
    limit: () => chainable(resolveValue),
    offset: () => chainable(resolveValue),
    then: (resolve, reject) => Promise.resolve(resolveValue).then(resolve, reject),
  };
  return obj;
}

const pendingCaseRow = {
  id: 'case-1',
  mediaId: 'media-1',
  scanId: 'scan-1',
  songTitle: 'Hello',
  artist: 'Adele',
  label: 'XL Recording',
  score: 100,
  status: 'pending',
  createdAt: new Date('2026-01-01'),
  reviewedAt: null,
  mediaUrl: 'https://cdn.example.com/held-video.mp4',
  uploaderId: 'uploader-1',
  uploaderUsername: 'uploader',
};

vi.mock('../src/db/index.js', () => ({
  db: {
    select: fields => ({
      from: table => {
        if (table !== acrCopyrightReviewCases) {
          throw new Error('Unexpected table in admin-visibility test mock');
        }
        const isCountQuery = 'total' in fields;
        return chainable(isCountQuery ? [{ total: 1 }] : [pendingCaseRow]);
      },
    }),
  },
}));

const { CopyrightReviewCaseService } = await import(
  '../src/services/copyrightReviewCase.service.js'
);

describe('CopyrightReviewCaseService.list — admin visibility', () => {
  it('returns a pending case unconditionally — the query takes no viewer/owner id at all', async () => {
    // list() is only reachable through the requireAdmin-gated route (see
    // auth.middleware.test.js); the service itself has no concept of
    // "viewer" to filter by, so a post/story being hidden from other users
    // via isHeldFromViewer has no bearing on what an admin sees here.
    const result = await CopyrightReviewCaseService.list({ status: 'pending' });
    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ id: 'case-1', status: 'pending', songTitle: 'Hello' });
  });
});
