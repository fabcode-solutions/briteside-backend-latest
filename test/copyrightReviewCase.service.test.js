import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const mockFindFirst = vi.fn();
const mockWhere = vi.fn().mockResolvedValue(undefined);
const mockSet = vi.fn(() => ({ where: mockWhere }));
const mockUpdate = vi.fn(() => ({ set: mockSet }));
const mockWriteAuditLog = vi.fn().mockResolvedValue(undefined);

vi.mock('../src/db/index.js', () => ({
  db: {
    query: {
      acrCopyrightReviewCases: { findFirst: (...args) => mockFindFirst(...args) },
    },
    update: (...args) => mockUpdate(...args),
  },
}));

vi.mock('../src/services/admin.service.js', () => ({
  writeAuditLog: (...args) => mockWriteAuditLog(...args),
}));

const { CopyrightReviewCaseService, buildCaseValues, REVIEW_ACTIONS } = await import(
  '../src/services/copyrightReviewCase.service.js'
);

describe('buildCaseValues', () => {
  it('maps a full ACRCloud match entry to the case row fields', () => {
    const values = buildCaseValues({
      mediaId: 'media-1',
      scanId: 'scan-1',
      userId: 'user-1',
      match: {
        title: 'Hello',
        artists: [{ name: 'Adele' }],
        label: 'XL Recording',
        score: 100,
        acrid: 'abc123',
      },
    });
    expect(values).toEqual({
      mediaId: 'media-1',
      scanId: 'scan-1',
      userId: 'user-1',
      songTitle: 'Hello',
      artist: 'Adele',
      label: 'XL Recording',
      score: 100,
      acrid: 'abc123',
      matchDetails: {
        title: 'Hello',
        artists: [{ name: 'Adele' }],
        label: 'XL Recording',
        score: 100,
        acrid: 'abc123',
      },
    });
  });

  it('falls back to null for missing artist/label/score/acrid rather than throwing', () => {
    const values = buildCaseValues({
      mediaId: 'media-1',
      scanId: 'scan-1',
      userId: null,
      match: { title: 'Untitled' },
    });
    expect(values.artist).toBeNull();
    expect(values.label).toBeNull();
    expect(values.score).toBeNull();
    expect(values.acrid).toBeNull();
    expect(values.userId).toBeNull();
  });

  it('does not mistake a non-numeric score for a valid one', () => {
    const values = buildCaseValues({
      mediaId: 'media-1',
      scanId: 'scan-1',
      userId: 'user-1',
      match: { title: 'Hello', score: '100' },
    });
    expect(values.score).toBeNull();
  });
});

describe('CopyrightReviewCaseService.review', () => {
  beforeEach(() => {
    mockFindFirst.mockReset();
    mockWhere.mockClear();
    mockSet.mockClear();
    mockUpdate.mockClear();
    mockWriteAuditLog.mockClear();
  });

  it('rejects an action outside the allowed set without touching the database', async () => {
    await expect(
      CopyrightReviewCaseService.review({ id: 'case-1', action: 'bogus', adminId: 'admin-1' })
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND when the case does not exist', async () => {
    mockFindFirst.mockResolvedValueOnce(null);
    await expect(
      CopyrightReviewCaseService.review({ id: 'missing', action: 'dismissed', adminId: 'admin-1' })
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it.each(REVIEW_ACTIONS)('accepts the valid action "%s", updates, and audit-logs it', async action => {
    mockFindFirst
      .mockResolvedValueOnce({ id: 'case-1', status: 'pending' }) // existence check
      .mockResolvedValueOnce({ id: 'case-1', status: action }); // re-fetch after update

    const result = await CopyrightReviewCaseService.review({
      id: 'case-1',
      action,
      adminId: 'admin-1',
      notes: 'reviewed manually',
    });

    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: action,
        reviewedBy: 'admin-1',
        reviewNotes: 'reviewed manually',
      })
    );
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      'admin-1',
      'COPYRIGHT_CASE_REVIEW',
      'acr_copyright_review_cases',
      'case-1',
      {
        previousValues: { status: 'pending' },
        newValues: { status: action, notes: 'reviewed manually' },
      }
    );
    expect(result).toEqual({ id: 'case-1', status: action });
  });
});

describe('duplicate-case prevention (schema guarantee)', () => {
  it('the generated migration enforces a unique index on acr_copyright_review_cases.media_id', () => {
    const drizzleDir = path.resolve(import.meta.dirname, '../drizzle');
    const files = fs.readdirSync(drizzleDir).filter(f => f.endsWith('.sql'));
    const migrationFile = files.find(f => {
      const content = fs.readFileSync(path.join(drizzleDir, f), 'utf8');
      return content.includes('CREATE TABLE "acr_copyright_review_cases"');
    });
    expect(migrationFile, 'no migration creates acr_copyright_review_cases').toBeDefined();

    const content = fs.readFileSync(path.join(drizzleDir, migrationFile), 'utf8');
    expect(content).toMatch(
      /CREATE UNIQUE INDEX "idx_acr_review_cases_media" ON "acr_copyright_review_cases" USING btree \("media_id"\)/
    );
  });
});
