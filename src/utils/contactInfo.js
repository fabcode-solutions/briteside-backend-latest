/**
 * Off-platform contact details in inquiries — hidden until the customer books
 * through Briteside (like Upwork). Covers emails (also "name at gmail dot com"),
 * phone numbers written with any spacing / punctuation, and links that move the
 * chat to another messaging app.
 */
export const CONTACT_HIDDEN = '[contact info hidden]';

const PATTERNS = [
  // name@example.com
  /[a-z0-9._%+-]+\s*@\s*[a-z0-9.-]+\.[a-z]{2,}/gi,
  // name [at] example [dot] com · name (at) example (dot) com · name at example dot com
  /[a-z0-9._%+-]+\s*(?:\[at\]|\(at\)|\s+at\s+)\s*[a-z0-9-]+\s*(?:\[dot\]|\(dot\)|\s+dot\s+|\.)\s*(?:com|net|org|co|io|me|us|uk|ca|in|au|edu|info|biz)\b/gi,
  // Messaging-app links / handles
  /\b(?:https?:\/\/)?(?:wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com|t\.me|telegram\.me|m\.me|signal\.me)\/\S*/gi,
  // 9+ digits with any separators: +1 (555) 123-4567 · 555 123 45 67 · 5.5.5.1.2.3.4.5.6.7
  /\+?\d(?:[\s().\-/_]*\d){8,}/g,
];

/** Hides contact details; `hidden` says whether anything was replaced. */
export function hideContactInfo(text) {
  if (typeof text !== 'string' || !text) return { text, hidden: false };
  let out = text;
  for (const re of PATTERNS) out = out.replace(re, CONTACT_HIDDEN);
  return { text: out, hidden: out !== text };
}
