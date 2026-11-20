/**
 * Booking questionnaires: typed questions a business asks when a customer books
 * a service, and turning the customer's answers into the text snapshot stored on
 * business_bookings.answers ([{ question, answer }]).
 *
 * Pure functions — no DB — so the rules are unit-tested directly.
 */
import httpStatus from 'http-status';
import ApiError from './api-error.js';

export const QUESTION_TYPES = [
  'short_text',
  'long_text',
  'multiple_choice',
  'dropdown',
  'checkboxes',
  'yes_no',
];
export const OPTION_QUESTION_TYPES = ['multiple_choice', 'dropdown', 'checkboxes'];

export const MAX_QUESTIONNAIRES = 20;
export const MAX_QUESTIONS = 30;
export const MAX_OPTIONS = 20;
export const SHORT_ANSWER_MAX = 300;
export const LONG_ANSWER_MAX = 2000;
// Customer attachments (see BusinessAttachmentService)
export const ATTACHMENT_MAX_FILES = 3;
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Clean a question from the dashboard. Options only for choice types (trimmed,
 * blanks and case-insensitive duplicates dropped); placeholder only for text.
 */
export function normalizeQuestion(q) {
  const type = QUESTION_TYPES.includes(q.type) ? q.type : 'short_text';
  const seen = new Set();
  const options = OPTION_QUESTION_TYPES.includes(type)
    ? (q.options ?? [])
        .map(o => String(o ?? '').trim())
        .filter(o => {
          const k = o.toLowerCase();
          if (!o || seen.has(k)) return false;
          seen.add(k);
          return true;
        })
    : [];
  const placeholder =
    type === 'short_text' || type === 'long_text' ? String(q.placeholder ?? '').trim() || null : null;
  return {
    id: String(q.id),
    label: String(q.label ?? '').trim(),
    type,
    options,
    required: !!q.required,
    active: q.active !== false,
    placeholder,
  };
}

/**
 * The business's older free-text booking questions ([{ id, question, required }])
 * in questionnaire form, so checkout handles both with one code path.
 */
export const legacyQuestions = (bookingQuestions = []) =>
  (bookingQuestions ?? []).map(q => ({
    id: q.id,
    label: q.question,
    type: 'long_text',
    options: [],
    required: !!q.required,
    active: true,
    placeholder: null,
  }));

const invalid = (q, message) =>
  new ApiError(httpStatus.BAD_REQUEST, message, true, '', {
    code: 'QUESTION_INVALID',
    questionId: q.id,
  });

/**
 * Check the customer's answers against the active questions and return the
 * snapshot [{ question, answer }] (answers as readable text, in question order).
 * Unknown question ids are ignored; errors carry details.questionId so the
 * booking page can point at the exact field.
 *
 * @param {Array} questions   normalized questions
 * @param {Array} raw         [{ questionId, answer: string | string[] | boolean }]
 */
export function resolveAnswers(questions, raw = []) {
  const byId = new Map((raw ?? []).map(a => [String(a.questionId), a.answer]));
  const out = [];
  for (const q of questions) {
    if (!q.active) continue;
    const value = byId.get(String(q.id));
    let text = '';

    switch (q.type) {
      case 'short_text':
      case 'long_text': {
        if (value != null && typeof value !== 'string') throw invalid(q, `Please type an answer for: ${q.label}`);
        text = (value ?? '').trim();
        const max = q.type === 'short_text' ? SHORT_ANSWER_MAX : LONG_ANSWER_MAX;
        if (text.length > max) {
          throw invalid(q, `Please keep your answer to "${q.label}" under ${max} characters`);
        }
        break;
      }
      case 'multiple_choice':
      case 'dropdown': {
        if (value != null && typeof value !== 'string') throw invalid(q, `Please pick one option for: ${q.label}`);
        const v = (value ?? '').trim();
        if (v && !q.options.includes(v)) {
          throw invalid(q, `The options for "${q.label}" have changed. Please choose again.`);
        }
        text = v;
        break;
      }
      case 'checkboxes': {
        if (value != null && !Array.isArray(value)) throw invalid(q, `Please tick your choices for: ${q.label}`);
        const picked = [...new Set((value ?? []).map(v => String(v).trim()).filter(Boolean))];
        if (picked.some(v => !q.options.includes(v))) {
          throw invalid(q, `The options for "${q.label}" have changed. Please choose again.`);
        }
        // Business's order, not click order
        text = q.options.filter(o => picked.includes(o)).join(', ');
        break;
      }
      case 'yes_no': {
        if (value != null && typeof value !== 'boolean') throw invalid(q, `Please answer yes or no: ${q.label}`);
        text = value == null ? '' : value ? 'Yes' : 'No';
        break;
      }
      default:
        continue;
    }

    if (!text) {
      if (q.required) throw invalid(q, `Please answer: ${q.label}`);
      continue;
    }
    out.push({ question: q.label, answer: text });
  }
  return out;
}
