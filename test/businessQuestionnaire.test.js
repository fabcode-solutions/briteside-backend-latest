import { describe, expect, it } from 'vitest';
import {
  legacyQuestions,
  normalizeQuestion,
  resolveAnswers,
} from '../src/utils/businessQuestionnaire.js';
import { matchesSignature, safeFileName, attachmentPrefix } from '../src/services/businessAttachment.service.js';

const q = (over = {}) =>
  normalizeQuestion({ id: 'q1', label: 'Question', type: 'short_text', required: false, ...over });

describe('normalizeQuestion', () => {
  it('keeps options only for choice types, trimmed and de-duplicated', () => {
    expect(q({ type: 'dropdown', options: [' A ', 'a', '', 'B'] }).options).toEqual(['A', 'B']);
    expect(q({ type: 'short_text', options: ['A'] }).options).toEqual([]);
  });

  it('keeps a placeholder only for text questions', () => {
    expect(q({ placeholder: ' e.g. ' }).placeholder).toBe('e.g.');
    expect(q({ type: 'yes_no', placeholder: 'x' }).placeholder).toBeNull();
  });

  it('defaults unknown types to short answer and active to true', () => {
    const n = q({ type: 'weird' });
    expect(n.type).toBe('short_text');
    expect(n.active).toBe(true);
  });
});

describe('resolveAnswers', () => {
  it('turns typed answers into readable text in question order', () => {
    const questions = [
      q({ id: 'a', label: 'First visit?', type: 'yes_no' }),
      q({ id: 'b', label: 'Concerns', type: 'checkboxes', options: ['Allergies', 'Sensitive skin', 'None'] }),
      q({ id: 'c', label: 'Style', type: 'multiple_choice', options: ['Classic', 'Modern'] }),
      q({ id: 'd', label: 'Notes', type: 'long_text' }),
    ];
    expect(
      resolveAnswers(questions, [
        { questionId: 'd', answer: '  Left-handed  ' },
        { questionId: 'b', answer: ['Sensitive skin', 'Allergies', 'Allergies'] },
        { questionId: 'a', answer: false },
        { questionId: 'c', answer: 'Modern' },
      ])
    ).toEqual([
      { question: 'First visit?', answer: 'No' },
      { question: 'Concerns', answer: 'Allergies, Sensitive skin' },
      { question: 'Style', answer: 'Modern' },
      { question: 'Notes', answer: 'Left-handed' },
    ]);
  });

  it('requires required questions and points at the question', () => {
    const questions = [q({ id: 'x', label: 'Phone', required: true })];
    try {
      resolveAnswers(questions, [{ questionId: 'x', answer: '   ' }]);
      expect.unreachable();
    } catch (err) {
      expect(err.statusCode ?? err.status).toBe(400);
      expect(err.message).toBe('Please answer: Phone');
      expect(err.details).toEqual({ code: 'QUESTION_INVALID', questionId: 'x' });
    }
  });

  it('rejects options that are not offered (questionnaire changed mid-booking)', () => {
    const questions = [q({ id: 'c', label: 'Style', type: 'dropdown', options: ['Classic'] })];
    expect(() => resolveAnswers(questions, [{ questionId: 'c', answer: 'Modern' }])).toThrow(/have changed/);
  });

  it('rejects the wrong kind of answer', () => {
    expect(() => resolveAnswers([q({ type: 'yes_no' })], [{ questionId: 'q1', answer: 'Yes' }])).toThrow(/yes or no/);
    expect(() =>
      resolveAnswers([q({ type: 'checkboxes', options: ['A'] })], [{ questionId: 'q1', answer: 'A' }])
    ).toThrow(/tick/);
  });

  it('caps text length by type', () => {
    expect(() => resolveAnswers([q()], [{ questionId: 'q1', answer: 'x'.repeat(301) }])).toThrow(/under 300/);
    expect(
      resolveAnswers([q({ type: 'long_text' })], [{ questionId: 'q1', answer: 'x'.repeat(301) }])
    ).toHaveLength(1);
  });

  it('skips inactive questions, unanswered optional ones and unknown ids', () => {
    const questions = [q({ id: 'off', active: false, required: true }), q({ id: 'opt' })];
    expect(resolveAnswers(questions, [{ questionId: 'nope', answer: 'x' }])).toEqual([]);
  });

  it('handles the older free-text booking questions', () => {
    const questions = legacyQuestions([{ id: 'l1', question: 'Allergies?', required: true }]);
    expect(resolveAnswers(questions, [{ questionId: 'l1', answer: 'Nuts' }])).toEqual([
      { question: 'Allergies?', answer: 'Nuts' },
    ]);
    expect(() => resolveAnswers(questions, [])).toThrow('Please answer: Allergies?');
  });
});

describe('attachments', () => {
  const pad = buf => Buffer.concat([buf, Buffer.alloc(16)]);

  it('checks the file starts with the bytes of its type', () => {
    expect(matchesSignature(pad(Buffer.from('%PDF-1.7')), 'application/pdf')).toBe(true);
    expect(matchesSignature(pad(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg')).toBe(true);
    expect(
      matchesSignature(pad(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'image/png')
    ).toBe(true);
    expect(matchesSignature(pad(Buffer.from('RIFF\0\0\0\0WEBP')), 'image/webp')).toBe(true);
    // An HTML page renamed to .png
    expect(matchesSignature(pad(Buffer.from('<html><script>')), 'image/png')).toBe(false);
    expect(matchesSignature(Buffer.from('%PDF'), 'application/pdf')).toBe(false);
  });

  it('makes names safe for storage and headers', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('my "photo".png')).toBe('my _photo_.png');
    expect(safeFileName('')).toBe('file');
  });

  it('scopes keys to the business and the uploader', () => {
    expect(attachmentPrefix('b1', 'u1')).toBe('business-booking-attachments/b1/u1/');
  });
});
