/**
 * Booking Email Templates
 * Covers: booking confirmation, reminder (1 hr), cancellation, rescheduled
 */

import { header, footer, ctaButton, appUrl } from './emailLayout.js';

const BOOKINGS_URL = appUrl('/bookings');
const HELP_URL = appUrl('/help');
const CONTACT_URL = appUrl('/contact');
const MESSAGES_URL = appUrl('/messages');
const SERVICES_URL = appUrl('/services');
// Purchase History — session refunds show up there with their status.
const ORDERS_URL = appUrl('/profile/orders');
// Session call lobby; falls back to the bookings list when no id was passed.
const sessionUrl = sessionId => (sessionId ? appUrl(`/session/${sessionId}`) : BOOKINGS_URL);
// Booking flow for a specific talent (expects their username), else browse talent.
const bookTalentUrl = username =>
  username ? appUrl('/book-1-on-1', { talentId: username }) : SERVICES_URL;
const footerLink = (label, url) => `<a href="${url}" style="color:#999;">${label}</a>`;

export const bookingTemplates = {
  // ── Booking Confirmation ────────────────────────────────────────────────
  bookingConfirmation: {
    id: 'booking-confirmation',
    subject: ({ creator_name }) => `Your 1:1 session with ${creator_name} is confirmed`,
    html: ({
      user_name,
      creator_name,
      session_date,
      session_time,
      timezone,
      duration,
      amount,
      cancellation_policy,
      join_link,
      session_id,
    }) => `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        ${header}
        <div style="padding:30px 20px;">
          <p>Hi ${user_name},</p>
          <h2 style="color:#333;">Your 1:1 session is confirmed! 🎥</h2>
          <div style="background:#f8f8f8;border-radius:6px;padding:16px;margin:16px 0;">
            <div>👤 <strong>Creator:</strong> ${creator_name}</div>
            <div>📅 <strong>Date:</strong> ${session_date}</div>
            <div>🕐 <strong>Time:</strong> ${session_time} (${timezone})</div>
            <div>⏱️ <strong>Duration:</strong> ${duration} minutes</div>
            <div>💰 <strong>Amount Paid:</strong> ${amount}</div>
          </div>
          <p>You can join the video call up to <strong>5 minutes before</strong> the scheduled time using the link below.</p>
          <div style="text-align:center;margin:16px 0;">${ctaButton('Join Video Call', join_link || sessionUrl(session_id))}</div>
          <p><strong>Prepare for Your Session:</strong></p>
          <ul>
            <li>Test your camera and microphone beforehand</li>
            <li>Find a quiet, well-lit space</li>
            <li>Prepare any questions you'd like to ask</li>
            <li>Join a few minutes early</li>
          </ul>
          <p><strong>Cancellation Policy:</strong> ${cancellation_policy}</p>
          <div style="text-align:center;margin:24px 0;">
            ${ctaButton('Manage Booking', BOOKINGS_URL)}
            ${ctaButton(`Contact ${creator_name}`, MESSAGES_URL)}
          </div>
          <p>Looking forward to your session!<br/><strong>The Briteside Team</strong></p>
        </div>
        ${footer(`Booking confirmation for session on ${session_date}.<br/>${footerLink('View your bookings', BOOKINGS_URL)} | ${footerLink('Get help', HELP_URL)}`)}
      </div>`,
  },

  // ── Booking Reminder – 1 Hour ───────────────────────────────────────────
  bookingReminder: {
    id: 'booking-reminder',
    subject: ({ creator_name }) => `Your session with ${creator_name} starts in 1 hour`,
    html: ({ user_name, creator_name, session_time, timezone, duration, join_link, session_id }) => `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        ${header}
        <div style="padding:30px 20px;">
          <p>Hi ${user_name},</p>
          <h2 style="color:#333;">Your 1:1 session starts in 1 HOUR! ⏰</h2>
          <div style="background:#f8f8f8;border-radius:6px;padding:16px;margin:16px 0;">
            <div>👤 <strong>Creator:</strong> ${creator_name}</div>
            <div>🕐 <strong>Time:</strong> ${session_time} (${timezone})</div>
            <div>⏱️ <strong>Duration:</strong> ${duration} minutes</div>
          </div>
          <p><strong>Quick Checklist:</strong></p>
          <ul>
            <li>✓ Camera working?</li>
            <li>✓ Microphone working?</li>
            <li>✓ Stable internet connection?</li>
            <li>✓ Quiet environment?</li>
          </ul>
          <div style="text-align:center;margin:24px 0;">
            ${ctaButton('Join Session Now', join_link || sessionUrl(session_id))}
          </div>
          <p style="font-size:13px;color:#666;">The session link will be active 10 minutes before the scheduled time.</p>
          <p><strong>Need Help?</strong> If you're having technical difficulties, please contact our support team immediately.</p>
          <div style="text-align:center;margin:16px 0;">${ctaButton('Get Technical Help', HELP_URL)}</div>
          <p>See you soon!<br/><strong>The Briteside Team</strong></p>
        </div>
        ${footer(`This is a reminder for your upcoming session.<br/>${footerLink('View booking details', BOOKINGS_URL)} | ${footerLink('Contact support', CONTACT_URL)}`)}
      </div>`,
  },

  // ── Booking Cancellation ────────────────────────────────────────────────
  bookingCancellation: {
    id: 'booking-cancellation',
    subject: ({ creator_name }) => `Your session with ${creator_name} has been cancelled`,
    html: ({
      user_name,
      creator_name,
      session_date,
      session_time,
      cancelled_by,
      cancellation_reason,
      amount,
      refund_reference,
      creator_username,
    }) => `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        ${header}
        <div style="padding:30px 20px;">
          <p>Hi ${user_name},</p>
          <h2 style="color:#c0392b;">Session Cancelled</h2>
          <p>We're sorry to inform you that your 1:1 session has been cancelled.</p>
          <div style="background:#f8f8f8;border-radius:6px;padding:16px;margin:16px 0;">
            <div>👤 <strong>Creator:</strong> ${creator_name}</div>
            <div>📅 <strong>Originally Scheduled:</strong> ${session_date} at ${session_time}</div>
            <div>❌ <strong>Cancelled by:</strong> ${cancelled_by}</div>
            <div>📝 <strong>Reason:</strong> ${cancellation_reason}</div>
          </div>
          <div style="background:#fff8e1;border-radius:6px;padding:16px;margin:16px 0;">
            <strong>Refund Information:</strong><br/>
            A full refund of <strong>${amount}</strong> will be processed to your original payment method within 5–10 business days.<br/>
            Refund Reference: ${refund_reference}
          </div>
          <div style="text-align:center;margin:24px 0;">
            ${ctaButton('Book New Session', bookTalentUrl(creator_username))}
            ${ctaButton('Browse Creators', SERVICES_URL)}
          </div>
          <p>We apologize for any inconvenience.<br/><strong>The Briteside Team</strong></p>
        </div>
        ${footer(`Cancellation notice for session originally scheduled on ${session_date}.<br/>${footerLink('View refund status', ORDERS_URL)} | ${footerLink('Contact support', CONTACT_URL)}`)}
      </div>`,
  },

  // ── Booking Rescheduled ─────────────────────────────────────────────────
  bookingRescheduled: {
    id: 'booking-rescheduled',
    subject: ({ creator_name }) => `Your session with ${creator_name} has been rescheduled`,
    html: ({
      user_name,
      creator_name,
      old_date,
      old_time,
      new_date,
      new_time,
      timezone,
      duration,
      reschedule_reason,
      recipient_role,
    }) => `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        ${header}
        <div style="padding:30px 20px;">
          <p>Hi ${user_name},</p>
          <h2 style="color:#333;">Your session has been rescheduled</h2>
          <div style="background:#f8f8f8;border-radius:6px;padding:16px;margin:16px 0;">
            <div>👤 <strong>Creator:</strong> ${creator_name}</div>
            <div>❌ <strong>Original Time:</strong> ${old_date} at ${old_time}</div>
            <div>✅ <strong>New Time:</strong> ${new_date} at ${new_time} (${timezone})</div>
            <div>⏱️ <strong>Duration:</strong> ${duration} minutes</div>
            <div>📝 <strong>Reason:</strong> ${reschedule_reason}</div>
          </div>
          <div style="text-align:center;margin:24px 0;">
            ${
              // Only the talent re-confirms a reschedule (from their Requests tab).
              recipient_role === 'talent'
                ? ctaButton('Confirm New Time', appUrl('/bookings', { tab: 'requests' }))
                : ''
            }
            ${ctaButton('Request Different Time', BOOKINGS_URL)}
            ${ctaButton('Cancel Booking', BOOKINGS_URL)}
          </div>
          <p>Thank you for your understanding!<br/><strong>The Briteside Team</strong></p>
        </div>
        ${footer(`Schedule change notice for your session with ${creator_name}.<br/>${footerLink('View booking details', BOOKINGS_URL)} | ${footerLink('Contact support', CONTACT_URL)}`)}
      </div>`,
  },
};
