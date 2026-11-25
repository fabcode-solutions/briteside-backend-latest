import { describe, it, expect } from 'vitest';
import {
  normalizeMessage,
  isUnreadFor,
  otherSide,
  applyMediaVerdict,
  replyPreview,
  teamPreview,
} from '../src/utils/businessInbox.js';
import { BUSINESS_PERMISSIONS as P, permissionsForMember } from '../src/config/business-permissions.js';

const OFFER_ID = '4b0f6a7e-2c1d-4e8f-9a3b-5c6d7e8f9a0b';
const FILE_URL = 'https://cdn.example.com/uploads/photo.jpg';

describe('business inbox messages', () => {
  it('keeps text, trimmed, and rejects empty or oversized text', () => {
    expect(normalizeMessage({ content: '  Hi there  ' }, 'customer')).toEqual({
      messageType: 'text',
      content: 'Hi there',
      metadata: {},
    });
    expect(() => normalizeMessage({ content: '   ' }, 'customer')).toThrow('Write a message');
    expect(() => normalizeMessage({ content: 'x'.repeat(4001) }, 'business')).toThrow('up to 4000');
  });

  it('only lets customers send inquiries, keeping subject + service', () => {
    const msg = normalizeMessage(
      {
        messageType: 'inquiry',
        content: 'Do you do bridal hair?',
        metadata: { inquirySubject: ' Wedding ', serviceId: OFFER_ID, businessId: 'ignored', evil: 1 },
      },
      'customer'
    );
    expect(msg.metadata).toEqual({ inquirySubject: 'Wedding', serviceId: OFFER_ID });
    expect(() => normalizeMessage({ messageType: 'inquiry', content: 'hi' }, 'business')).toThrow(
      'Only customers'
    );
  });

  it('lets only the business attach a custom price card, which needs no text', () => {
    expect(normalizeMessage({ metadata: { businessOfferId: OFFER_ID } }, 'business')).toEqual({
      messageType: 'text',
      content: null,
      metadata: { businessOfferId: OFFER_ID },
    });
    // From a customer the card id is dropped, so an empty message is refused
    expect(() => normalizeMessage({ metadata: { businessOfferId: OFFER_ID } }, 'customer')).toThrow();
    expect(() => normalizeMessage({ metadata: { businessOfferId: 'nope' } }, 'business')).toThrow();
  });

  it('requires an https file URL for attachments and keeps only file details', () => {
    const msg = normalizeMessage(
      {
        messageType: 'image',
        content: FILE_URL,
        metadata: { fileName: 'photo.jpg', mimeType: 'image/jpeg', size: 1200, width: 'wide', x: 1 },
      },
      'customer'
    );
    expect(msg).toEqual({
      messageType: 'image',
      content: FILE_URL,
      metadata: { fileName: 'photo.jpg', mimeType: 'image/jpeg', size: 1200 },
    });
    expect(() => normalizeMessage({ messageType: 'file', content: 'http://x.com/a.pdf' }, 'customer')).toThrow();
    expect(() => normalizeMessage({ messageType: 'video', content: 'javascript:alert(1)' }, 'customer')).toThrow();
  });

  it('rejects unknown types', () => {
    expect(() => normalizeMessage({ messageType: 'location', content: 'x' }, 'customer')).toThrow('Unsupported');
  });
});

describe('business inbox read state', () => {
  const at = iso => ({ senderSide: 'customer', createdAt: iso });

  it('counts only the other side’s messages after lastReadAt', () => {
    expect(isUnreadFor(at('2026-11-25T10:00:00Z'), 'business', null)).toBe(true);
    expect(isUnreadFor(at('2026-11-25T10:00:00Z'), 'business', '2026-11-25T10:00:01Z')).toBe(false);
    expect(isUnreadFor(at('2026-11-25T10:00:02Z'), 'business', '2026-11-25T10:00:01Z')).toBe(true);
    // Your own messages are never unread for you
    expect(isUnreadFor(at('2026-11-25T10:00:02Z'), 'customer', null)).toBe(false);
    expect(otherSide('customer')).toBe('business');
  });
});

describe('business inbox photos', () => {
  const HELD = new Set(['pending', 'rejected', 'shadowed', 'skipped', 'error']);
  const photo = () => ({ senderSide: 'customer', messageType: 'image', content: FILE_URL });

  it('hides a photo under review from the other side but not from the sender', () => {
    expect(applyMediaVerdict(photo(), 'pending', 'business', HELD)).toMatchObject({
      content: null,
      moderationStatus: 'pending',
    });
    expect(applyMediaVerdict(photo(), 'pending', 'customer', HELD).content).toBe(FILE_URL);
    expect(applyMediaVerdict(photo(), 'rejected', 'business', HELD).content).toBe(null);
  });

  it('shows approved and flagged photos (flagged ones are blurred by the app)', () => {
    expect(applyMediaVerdict(photo(), undefined, 'business', HELD)).toMatchObject({
      content: FILE_URL,
      moderationStatus: 'approved',
    });
    expect(applyMediaVerdict(photo(), 'flagged', 'business', HELD).content).toBe(FILE_URL);
  });
});

describe('business reply notifications', () => {
  it('describes the reply without leaking files', () => {
    expect(replyPreview({ messageType: 'text', content: '  See you\n Tuesday  ', metadata: {} })).toBe(
      'See you Tuesday'
    );
    expect(replyPreview({ messageType: 'image', content: FILE_URL, metadata: {} })).toBe('Sent you a photo');
    expect(replyPreview({ messageType: 'text', content: null, metadata: { businessOfferId: OFFER_ID } })).toBe(
      'Sent you a custom price'
    );
    const long = replyPreview({ messageType: 'text', content: 'x'.repeat(300), metadata: {} });
    expect(long).toHaveLength(200);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('team notifications', () => {
  it('previews the customer message for the team', () => {
    expect(teamPreview({ messageType: 'text', content: 'Do you have Friday?', metadata: {} })).toBe(
      'Do you have Friday?'
    );
    expect(teamPreview({ messageType: 'image', content: FILE_URL, metadata: {} })).toBe('Sent a photo');
    expect(teamPreview({ messageType: 'text', content: '   ', metadata: {} })).toBe('Sent a message');
  });
});

describe('business inbox access', () => {
  it('goes to admins and managers (even location-limited ones), not staff', () => {
    expect(permissionsForMember('admin')).toContain(P.INBOX_MANAGE);
    expect(permissionsForMember('manager')).toContain(P.INBOX_MANAGE);
    expect(permissionsForMember('manager', ['loc-1'])).toContain(P.INBOX_MANAGE);
    expect(permissionsForMember('staff')).not.toContain(P.INBOX_MANAGE);
  });
});
