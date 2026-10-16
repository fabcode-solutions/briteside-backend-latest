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

describe('applyPostModeration — a copyright match never hides a post, only tags it for client-side audio muting', () => {
  const uploaderId = 'uploader-1';
  const otherUserId = 'other-user-2';

  const matchedPost = {
    id: 'post-matched',
    userId: uploaderId,
    mediaUrls: ['https://cdn.example.com/matched-video.mp4'],
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
      copyright: [{ url: 'https://cdn.example.com/matched-video.mp4', status: 'pending' }],
    });
  });

  it('uploader viewing their own feed sees their own pending-copyright-case post, stamped for muting', async () => {
    const result = await MediaModerationService.applyPostModeration(
      [{ ...matchedPost }, { ...cleanPost }],
      uploaderId
    );
    const ids = result.map(p => p.id);
    expect(ids).toContain('post-matched');
    expect(ids).toContain('post-clean');
    const matched = result.find(p => p.id === 'post-matched');
    expect(matched.copyrightStatus).toBe('pending');
  });

  it('a different user still sees the pending-copyright-case post, stamped for muting', async () => {
    const result = await MediaModerationService.applyPostModeration(
      [{ ...matchedPost }, { ...cleanPost }],
      otherUserId
    );
    const ids = result.map(p => p.id);
    expect(ids).toContain('post-matched');
    expect(ids).toContain('post-clean');
    const matched = result.find(p => p.id === 'post-matched');
    expect(matched.copyrightStatus).toBe('pending');
  });

  it('a different user sees the post with no copyright tag once the case is dismissed', async () => {
    setMockRows({
      contentModeration: [],
      copyright: [{ url: 'https://cdn.example.com/matched-video.mp4', status: 'dismissed' }],
    });
    const result = await MediaModerationService.applyPostModeration(
      [{ ...matchedPost }, { ...cleanPost }],
      otherUserId
    );
    const ids = result.map(p => p.id);
    expect(ids).toContain('post-matched');
    const dismissed = result.find(p => p.id === 'post-matched');
    expect(dismissed.copyrightStatus).toBe('dismissed');
  });

  it('a different user still sees the post once infringement is confirmed, stamped for muting', async () => {
    setMockRows({
      contentModeration: [],
      copyright: [
        { url: 'https://cdn.example.com/matched-video.mp4', status: 'confirmed_infringement' },
      ],
    });
    const result = await MediaModerationService.applyPostModeration(
      [{ ...matchedPost }, { ...cleanPost }],
      otherUserId
    );
    const ids = result.map(p => p.id);
    expect(ids).toContain('post-matched');
    const confirmed = result.find(p => p.id === 'post-matched');
    expect(confirmed.copyrightStatus).toBe('confirmed_infringement');
  });
});
