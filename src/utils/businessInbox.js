/**
 * Rules for business inbox messages (see db/schema/businessInbox.js) that
 * don't need the database — kept here so they can be unit tested.
 */

export const SIDES = ['customer', 'business'];
// The business's three inboxes (db/schema/businessInbox.js)
export const KINDS = ['inquiry', 'general', 'paid'];
export const MESSAGE_TYPES = ['text', 'inquiry', 'image', 'video', 'file'];
export const MEDIA_TYPES = ['image', 'video', 'file'];

export const MAX_TEXT_LENGTH = 4000;
export const MAX_SUBJECT_LENGTH = 200;
export const MAX_FILE_NAME_LENGTH = 255;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const otherSide = side => (side === 'customer' ? 'business' : 'customer');

/**
 * Checks a message body and returns the values to store. Throws an Error with
 * a user-facing message when it isn't valid.
 *   - text / inquiry: `content` is the text (an inquiry may carry a subject)
 *   - image / video / file: `content` is an https URL of an uploaded file
 *   - only the business can attach a custom price card (businessOfferId)
 */
export function normalizeMessage({ messageType = 'text', content, metadata } = {}, side) {
  if (!SIDES.includes(side)) throw new Error('Unknown sender');
  if (!MESSAGE_TYPES.includes(messageType)) throw new Error('Unsupported message type');
  if (messageType === 'inquiry' && side !== 'customer') {
    throw new Error('Only customers send inquiries');
  }

  const meta = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
  const out = {};
  let body = typeof content === 'string' ? content.trim() : '';

  if (MEDIA_TYPES.includes(messageType)) {
    if (!isHttpsUrl(body)) throw new Error('Attach a file to send');
    if (typeof meta.fileName === 'string' && meta.fileName.trim()) {
      out.fileName = meta.fileName.trim().slice(0, MAX_FILE_NAME_LENGTH);
    }
    if (typeof meta.mimeType === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(meta.mimeType)) {
      out.mimeType = meta.mimeType;
    }
    for (const k of ['size', 'width', 'height', 'duration']) {
      if (Number.isFinite(meta[k]) && meta[k] >= 0) out[k] = meta[k];
    }
  } else {
    if (body.length > MAX_TEXT_LENGTH) {
      throw new Error(`Messages can be up to ${MAX_TEXT_LENGTH} characters`);
    }
    const offerCard = side === 'business' && isUuid(meta.businessOfferId);
    if (!body && !offerCard) throw new Error('Write a message to send');
    if (offerCard) out.businessOfferId = meta.businessOfferId;
  }

  if (messageType === 'inquiry') {
    if (typeof meta.inquirySubject === 'string' && meta.inquirySubject.trim()) {
      out.inquirySubject = meta.inquirySubject.trim().slice(0, MAX_SUBJECT_LENGTH);
    }
    // The "Inquire for pricing" service the customer asked about
    if (isUuid(meta.serviceId)) out.serviceId = meta.serviceId;
  }

  return { messageType, content: body || null, metadata: out };
}

/**
 * Stamps a photo/video message view with its moderation verdict. While the
 * verdict holds it from others (pending review, rejected…) the other side gets
 * no file URL; the sender's side keeps it. Mutates and returns the view.
 */
export function applyMediaVerdict(view, status, viewerSide, heldStatuses) {
  view.moderationStatus = status ?? 'approved';
  if (view.senderSide !== viewerSide && heldStatuses.has(view.moderationStatus)) view.content = null;
  return view;
}

/**
 * Notification text for a business reply, from the customer's view of the
 * message (so a photo still under review never puts its URL in a notification).
 */
export function replyPreview(message) {
  if (message.metadata?.priority) return 'Sent you a priority message';
  if (message.messageType === 'image') return 'Sent you a photo';
  if (message.messageType === 'video') return 'Sent you a video';
  if (message.messageType === 'file') return 'Sent you a file';
  if (message.metadata?.businessOfferId && !message.content) return 'Sent you a custom price';
  const text = String(message.content ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return 'Sent you a message';
  return text.length > 200 ? `${text.slice(0, 199)}…` : text;
}

/** Notification text for the business team about a customer's message. */
export function teamPreview(message) {
  if (message.messageType === 'image') return 'Sent a photo';
  if (message.messageType === 'video') return 'Sent a video';
  if (message.messageType === 'file') return 'Sent a file';
  const text = String(message.content ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return 'Sent a message';
  return text.length > 200 ? `${text.slice(0, 199)}…` : text;
}

/** Whether a message is unread for `side`, given that side's lastReadAt. */
export function isUnreadFor(message, side, lastReadAt) {
  if (message.senderSide === side) return false;
  if (!lastReadAt) return true;
  return new Date(message.createdAt).getTime() > new Date(lastReadAt).getTime();
}

export function isUuid(v) {
  return typeof v === 'string' && UUID_RE.test(v);
}

function isHttpsUrl(v) {
  if (typeof v !== 'string' || v.length > 2048) return false;
  try {
    return new URL(v).protocol === 'https:';
  } catch {
    return false;
  }
}
