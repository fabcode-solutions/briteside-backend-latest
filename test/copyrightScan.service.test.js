import { describe, it, expect } from 'vitest';
import {
  buildSignature,
  parseAcrResult,
  shouldCreateReviewCase,
} from '../src/services/copyrightScan.service.js';

describe('buildSignature', () => {
  it('matches the documented ACRCloud HMAC-SHA1 string-to-sign format', () => {
    const signature = buildSignature({
      accessKey: 'test_access_key',
      accessSecret: 'test_access_secret',
      dataType: 'audio',
      timestamp: 1700000000,
    });
    expect(signature).toBe('xwvNQha1a/XfBw69Lbh8HKwitms=');
  });

  it('is deterministic for identical inputs', () => {
    const args = {
      accessKey: 'key',
      accessSecret: 'secret',
      dataType: 'audio',
      timestamp: 1,
    };
    expect(buildSignature(args)).toBe(buildSignature({ ...args }));
  });

  it('changes when the timestamp changes', () => {
    const base = { accessKey: 'key', accessSecret: 'secret', dataType: 'audio' };
    const a = buildSignature({ ...base, timestamp: 1 });
    const b = buildSignature({ ...base, timestamp: 2 });
    expect(a).not.toBe(b);
  });
});

describe('parseAcrResult', () => {
  it('reports a match when ACRCloud returns code 0 with music metadata', () => {
    const json = {
      status: { code: 0, msg: 'Success' },
      metadata: { music: [{ title: 'Hello', artists: [{ name: 'Adele' }] }] },
    };
    const result = parseAcrResult(json);
    expect(result.status).toBe('match');
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].title).toBe('Hello');
  });

  it('reports clean when ACRCloud returns code 1001 (no result)', () => {
    const json = { status: { code: 1001, msg: 'No result' } };
    const result = parseAcrResult(json);
    expect(result.status).toBe('clean');
    expect(result.matches).toEqual([]);
  });

  it('reports error for any other status code, carrying the message and code through', () => {
    const json = { status: { code: 3001, msg: 'Missing parameters' } };
    const result = parseAcrResult(json);
    expect(result.status).toBe('error');
    expect(result.errorMessage).toBe('Missing parameters (code 3001)');
  });

  it('falls back to a generic error message when none is provided', () => {
    const result = parseAcrResult({ status: { code: 2004 } });
    expect(result.status).toBe('error');
    expect(result.errorMessage).toBe('ACRCloud error (code 2004)');
  });
});

describe('shouldCreateReviewCase', () => {
  it('opens a case for a real match with at least one matched track', () => {
    expect(shouldCreateReviewCase('match', [{ title: 'Hello' }])).toBe(true);
  });

  it('does not open a case when there is no match (clean)', () => {
    expect(shouldCreateReviewCase('clean', [])).toBe(false);
  });

  it('does not open a case for a silent/video-only upload (no_audio)', () => {
    expect(shouldCreateReviewCase('no_audio', [])).toBe(false);
  });

  it('does not open a case when the scan itself errored', () => {
    expect(shouldCreateReviewCase('error', [])).toBe(false);
  });

  it('does not open a case for a "match" status with an empty matches array (defensive)', () => {
    expect(shouldCreateReviewCase('match', [])).toBe(false);
  });
});
