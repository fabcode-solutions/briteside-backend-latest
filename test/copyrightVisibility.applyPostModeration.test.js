import { describe, it, expect, vi, beforeEach } from 'vitest';
import { contentModeration } from '../src/db/schema/moderation.js';
import { acrCopyrightReviewCases } from '../src/db/schema/acrCopyrightReviewCases.js';

// mediaModeration.service.js imports streamClient.js, which constructs a
// GetStream client at module load time — irrelevant here and must not
// require real GetStream credentials to run this test.
vi.mock('../src/utils/streamClient.js', () => ({ streamClient: {} }));

// Canned rows returned per-table, set per test via setMockRows().
let contentModerationRows = [];
let copyrightRows = [];

function setMockRows({ contentModeration: cm = [], copyright = [] } = {}) {
  contentModerationRows = cm;
  copyrightRows = copyright;
}

vi.mock('../src/db/index.js', () => ({
  db: {
    select: () => ({
      from: table => {
        if (table === contentModeration) {
          return { where: () => Promise.resolve(contentModerationRows) };
        }
        if (table === acrCopyrightReviewCases) {
          return { innerJoin: () => ({ where: () => Promise.resolve(copyrightRows) }) };
        }
        throw new Error('Unexpected table in applyPostModeration test mock');
      },
    }),
    query: {},
  },
}));

const { MediaModerationService } = await import('../src/services/moderation/mediaModeration.service.js');

describe('applyPostModeration — uploader, admin, and other-user visibility (relational listings)', () => {
  const uploaderId = 'uploader-1';
  const otherUserId = 'other-user-2';

  const heldPost = {
    id: 'post-held',
    userId: uploaderId,
    mediaUrls: ['https://cdn.example.com/held-video.mp4'],
  };
  const cleanPost = {
    id: 'post-clean',
    userId: otherUserId,
    mediaUrls: ['https://cdn.example.com/clean-video.mp4'],
  };

  beforeEach(() => {
    // No GetStream hold on either post — only the copyright case drives this.
    setMockRows({
      contentModeration: [],
      copyright: [{ url: 'https://cdn.example.com/held-video.mp4', status: 'pending' }],
    });
  });

  it('uploader viewing their own feed still sees their own pending-copyright-case post', async () => {
    const result = await MediaModerationService.applyPostModeration(
      [{ ...heldPost }, { ...cleanPost }],
      uploaderId
    );
    const ids = result.map(p => p.id);
    expect(ids).toContain('post-held');
    expect(ids).toContain('post-clean');
    const held = result.find(p => p.id === 'post-held');
    expect(held.copyrightStatus).toBe('pending');
  });

  it('a different user cannot see the pending-copyright-case post, but sees the clean one', async () => {
    const result = await MediaModerationService.applyPostModeration(
      [{ ...heldPost }, { ...cleanPost }],
      otherUserId
    );
    const ids = result.map(p => p.id);
    expect(ids).not.toContain('post-held');
    expect(ids).toContain('post-clean');
  });

  it('a different user can see the post again once the case is dismissed', async () => {
    setMockRows({
      contentModeration: [],
      copyright: [{ url: 'https://cdn.example.com/held-video.mp4', status: 'dismissed' }],
    });
    const result = await MediaModerationService.applyPostModeration(
      [{ ...heldPost }, { ...cleanPost }],
      otherUserId
    );
    const ids = result.map(p => p.id);
    expect(ids).toContain('post-held');
    const dismissed = result.find(p => p.id === 'post-held');
    expect(dismissed.copyrightStatus).toBe('dismissed');
  });

  it('a different user still cannot see the post once infringement is confirmed', async () => {
    setMockRows({
      contentModeration: [],
      copyright: [
        { url: 'https://cdn.example.com/held-video.mp4', status: 'confirmed_infringement' },
      ],
    });
    const result = await MediaModerationService.applyPostModeration(
      [{ ...heldPost }, { ...cleanPost }],
      otherUserId
    );
    expect(result.map(p => p.id)).not.toContain('post-held');
  });
});
