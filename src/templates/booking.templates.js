/**
 * Booking Email Templates
 * Covers: booking confirmation, reminder (1 hr), cancellation, rescheduled
 */

const header = `
  <div style="text-align:center;padding:20px 0;border-bottom:1px solid #eee;">
    <strong>BRITESIDE</strong><br/>
    <a href="https://www.briteside.app" style="color:#666;font-size:12px;">www.briteside.app</a>
  </div>`;

const footer = text => `
  <div style="padding:15px 20px;border-top:1px solid #eee;font-size:12px;color:#999;text-align:center;">
    ${text}
  </div>`;

const ctaButton = (label, href = '#') =>
  `<a href="${href}" style="background:#6c47ff;color:#fff;padding:11px 22px;border-radius:6px;text-decoration:none;margin:0 6px;display:inline-block;">${label}</a>`;

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
          <div style="text-align:center;margin:16px 0;">${ctaButton('Join Video Call', join_link || '#')}</div>
          <div style="text-align:center;margin:16px 0;">${ctaButton('Add to Calendar')}</div>
          <p><strong>Prepare for Your Session:</strong></p>
          <ul>
            <li>Test your camera and microphone beforehand</li>
            <li>Find a quiet, well-lit space</li>
            <li>Prepare any questions you'd like to ask</li>
            <li>Join a few minutes early</li>
          </ul>
          <p><strong>Cancellation Policy:</strong> ${cancellation_policy}</p>
          <div style="text-align:center;margin:24px 0;">
            ${ctaButton('Manage Booking')}
            ${ctaButton(`Contact ${creator_name}`)}
          </div>
          <p>Looking forward to your session!<br/><strong>The Briteside Team</strong></p>
        </div>
        ${footer(`Booking confirmation for session on ${session_date}.<br/><a href="#">View your bookings</a> | <a href="#">Get help</a>`)}
      </div>`,
  },

  // ── Booking Reminder – 1 Hour ───────────────────────────────────────────
  bookingReminder: {
    id: 'booking-reminder',
    subject: ({ creator_name }) => `Your session with ${creator_name} starts in 1 hour`,
    html: ({ user_name, creator_name, session_time, timezone, duration, join_link }) => `
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
            ${ctaButton('Join Session Now', join_link || '#')}
          </div>
          <p style="font-size:13px;color:#666;">The session link will be active 10 minutes before the scheduled time.</p>
          <p><strong>Need Help?</strong> If you're having technical difficulties, please contact our support team immediately.</p>
          <div style="text-align:center;margin:16px 0;">${ctaButton('Get Technical Help')}</div>
          <p>See you soon!<br/><strong>The Briteside Team</strong></p>
        </div>
        ${footer(`This is a reminder for your upcoming session.<br/><a href="#">View booking details</a> | <a href="#">Contact support</a>`)}
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
            ${ctaButton('Book New Session')}
            ${ctaButton('Browse Creators')}
          </div>
          <p>We apologize for any inconvenience.<br/><strong>The Briteside Team</strong></p>
        </div>
        ${footer(`Cancellation notice for session originally scheduled on ${session_date}.<br/><a href="#">View refund status</a> | <a href="#">Contact support</a>`)}
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
            ${ctaButton('Add to Calendar')}
            ${ctaButton('Confirm New Time')}
            ${ctaButton('Request Different Time')}
            ${ctaButton('Cancel Booking')}
          </div>
          <p>Thank you for your understanding!<br/><strong>The Briteside Team</strong></p>
        </div>
        ${footer(`Schedule change notice for your session with ${creator_name}.<br/><a href="#">View booking details</a> | <a href="#">Contact support</a>`)}
      </div>`,
  },
};
