import { describe, it, expect } from 'vitest';
import { canReviewBooking, REVIEW_WINDOW_DAYS } from '../src/services/businessReview.service.js';
import { permissionsForRole, BUSINESS_PERMISSIONS as P } from '../src/config/business-permissions.js';

const NOW = new Date('2030-03-01T12:00:00Z');
const DAY = 86_400_000;
const booking = (over = {}) => ({
  customerId: 'user-1',
  status: 'completed',
  completedAt: new Date(NOW.getTime() - 2 * DAY),
  endAt: new Date(NOW.getTime() - 2 * DAY),
  ...over,
});

describe('canReviewBooking', () => {
  it('allows the customer to review a recently completed booking', () => {
    expect(canReviewBooking(booking(), 'user-1', NOW)).toBe(true);
  });

  it('rejects other users and guests', () => {
    expect(canReviewBooking(booking(), 'user-2', NOW)).toBe(false);
    expect(canReviewBooking(booking({ customerId: null }), null, NOW)).toBe(false);
  });

  it.each(['pending', 'confirmed', 'cancelled', 'declined', 'no_show', 'expired'])(
    'rejects a %s booking',
    status => {
      expect(canReviewBooking(booking({ status }), 'user-1', NOW)).toBe(false);
    }
  );

  it('closes the window REVIEW_WINDOW_DAYS after completion', () => {
    const edge = new Date(NOW.getTime() - REVIEW_WINDOW_DAYS * DAY);
    expect(canReviewBooking(booking({ completedAt: edge }), 'user-1', NOW)).toBe(true);
    const late = new Date(edge.getTime() - 1000);
    expect(canReviewBooking(booking({ completedAt: late }), 'user-1', NOW)).toBe(false);
  });

  it('falls back to endAt when completedAt is missing', () => {
    expect(canReviewBooking(booking({ completedAt: null }), 'user-1', NOW)).toBe(true);
  });
});

describe('reviews permission', () => {
  it('lets admins and managers reply, not staff', () => {
    expect(permissionsForRole('admin')).toContain(P.REVIEWS_MANAGE);
    expect(permissionsForRole('manager')).toContain(P.REVIEWS_MANAGE);
    expect(permissionsForRole('staff')).not.toContain(P.REVIEWS_MANAGE);
  });
});
