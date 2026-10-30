import dayjs from 'dayjs';
import { FRONTEND_URL, BRAND_COLOR, BRAND_NAME, emailWrapper, infoBox, ctaRow, ctaButton as ctaLink } from '../templates/emailLayout.js';

const baseLayout = content =>
  emailWrapper(
    content,
    `${BRAND_NAME} · 1:1 Sessions Platform · <a href="${FRONTEND_URL}" style="color: ${BRAND_COLOR}; text-decoration: none;">briteside.app</a>`
  );

const sessionInfoBlock = (session, tz = 'UTC') => {
  const date = dayjs(session.scheduledAt).tz(tz).format('dddd, MMMM D, YYYY');
  const time = `${dayjs(session.scheduledAt).tz(tz).format('h:mm A')} (${tz})`;
  const price = `$${(session.priceCents / 100).toFixed(2)}`;

  return infoBox([
    ['Date', date],
    ['Time', time],
    ['Duration', `${session.durationMins} minutes`],
    ['Subject', session.subject],
    ['Price', price],
  ]);
};

const ctaButton = (label, url) => ctaRow(ctaLink(label, url));

// ─── BOOKING CONFIRMATION ─────────────────────────────────────────────────────

/**
 * Sent to the BOOKER immediately after submitting a booking request.
 */
export const bookingConfirmationForBooker = (booker, talent, session) => {
  const subject = `Your booking request with ${talent.name} is pending`;
  const html = baseLayout(`
    <h2 style="color: #333; margin-top: 0;">Booking request sent!</h2>
    <p style="color: #555;">Hi ${booker.firstName},</p>
    <p style="color: #555;">Your request to book a 1:1 session with <strong>${talent.name}</strong> has been received.
    They have <strong>48 hours</strong> to confirm or decline your request.</p>
    ${sessionInfoBlock(session)}
    <p style="color: #555;">We'll notify you by email and in-app as soon as ${talent.name} responds.</p>
    ${ctaButton('View Your Booking', `${FRONTEND_URL}/bookings`)}
    <p style="color: #999; font-size: 13px;">If you need to cancel, please do so at least 48 hours in advance for a full refund.</p>
  `);
  return { subject, html };
};

/**
 * Sent to the TALENT immediately when a new booking request arrives.
 */
export const newBookingRequestForTalent = (talent, booker, session, tz = 'UTC') => {
  const subject = `New 1:1 session request from ${booker.firstName} ${booker.lastName}`;
  const html = baseLayout(`
    <h2 style="color: #333; margin-top: 0;">You have a new session request</h2>
    <p style="color: #555;">Hi ${talent.firstName},</p>
    <p style="color: #555;"><strong>${booker.firstName} ${booker.lastName}</strong> wants to book a 1:1 session with you.</p>
     ${sessionInfoBlock(session, tz)}
    <p style="color: #555;"><strong>What they'd like to discuss:</strong><br>
    <span style="color: #666;">${session.discussion || 'Not specified'}</span></p>
    <p style="color: #555;">Please respond within <strong>48 hours</strong> — unconfirmed requests expire automatically.</p>
    ${ctaButton('Accept or Decline', `${FRONTEND_URL}/bookings`)}
  `);
  return { subject, html };
};

// ─── TALENT ACCEPTS / DECLINES ────────────────────────────────────────────────

export const sessionConfirmedForBooker = (booker, talent, session, tz = 'UTC') => {
  const subject = `Confirmed: Your session with ${talent.name}`;
  const joinUrl = `${FRONTEND_URL}/session/${session.id}`;
  const html = baseLayout(`
    <h2 style="color: #333; margin-top: 0;">Your session is confirmed!</h2>
    <p style="color: #555;">Hi ${booker.firstName},</p>
    <p style="color: #555;"><strong>${talent.name}</strong> has confirmed your 1:1 session. Get ready!</p>
    ${sessionInfoBlock(session, tz)}
    <p style="color: #555;">You can join the video call up to <strong>5 minutes before</strong> the scheduled time.
    The call room will open automatically.</p>
    ${ctaButton('Join Video Call', joinUrl)}
    <p style="color: #999; font-size: 13px;">Add this to your calendar so you don't miss it.</p>
  `);
  return { subject, html };
};

export const sessionDeclinedForBooker = (booker, talent, session, tz = 'UTC') => {
  const subject = `Session request declined by ${talent.name}`;
  const html = baseLayout(`
    <h2 style="color: #333; margin-top: 0;">Session request not accepted</h2>
    <p style="color: #555;">Hi ${booker.firstName},</p>
    <p style="color: #555;">Unfortunately, <strong>${talent.name}</strong> was unable to accept your session request.
    A full refund has been issued to your original payment method and will appear within 3–5 business days.</p>
     ${sessionInfoBlock(session, tz)}
    ${ctaButton('Discover Other Talent', `${FRONTEND_URL}/discover`)}
  `);
  return { subject, html };
};

// ─── REMINDERS ────────────────────────────────────────────────────────────────

const reminderTemplate = (
  recipientFirstName,
  otherPartyName,
  session,
  timeLabel,
  joinUrl,
  tz = 'UTC'
) => {
  const subject = `Reminder: Your session starts ${timeLabel}`;
  const html = baseLayout(`
    <h2 style="color: #333; margin-top: 0;">Your session is coming up ${timeLabel}</h2>
    <p style="color: #555;">Hi ${recipientFirstName},</p>
    <p style="color: #555;">This is a friendly reminder that your 1:1 session with <strong>${otherPartyName}</strong> starts ${timeLabel}.</p>
    ${sessionInfoBlock(session, tz)}
    <p style="color: #555;">You can join the call up to <strong>5 minutes before</strong> the start time.
    Make sure you have a stable internet connection and your camera/microphone ready.</p>
    ${ctaButton('Join Video Call', joinUrl)}
    <p style="color: #999; font-size: 13px;">The billing clock starts only when <strong>both parties</strong> have joined.</p>
  `);
  return { subject, html };
};

export const reminder24h = (recipient, otherPartyName, session, tz = 'UTC') => {
  const joinUrl = `${FRONTEND_URL}/session/${session.id}`;
  return reminderTemplate(recipient.firstName, otherPartyName, session, 'in 24 hours', joinUrl, tz);
};

export const reminder1h = (recipient, otherPartyName, session, tz = 'UTC') => {
  const joinUrl = `${FRONTEND_URL}/session/${session.id}`;
  return reminderTemplate(recipient.firstName, otherPartyName, session, 'in 1 hour', joinUrl, tz);
};

export const reminder15m = (recipient, otherPartyName, session, tz = 'UTC') => {
  const joinUrl = `${FRONTEND_URL}/session/${session.id}`;
  return reminderTemplate(
    recipient.firstName,
    otherPartyName,
    session,
    'in 15 minutes',
    joinUrl,
    tz
  );
};

// ─── NO-SHOW / CANCELLATION ───────────────────────────────────────────────────

export const talentNoShowForBooker = (booker, talent, session, tz = 'UTC') => {
  const subject = `Session cancelled — ${talent.name} didn't join`;
  const html = baseLayout(`
    <h2 style="color: #333; margin-top: 0;">Session auto-cancelled</h2>
    <p style="color: #555;">Hi ${booker.firstName},</p>
    <p style="color: #555;">We're sorry — <strong>${talent.name}</strong> did not join the session within the grace period.
    Your session has been automatically cancelled and a <strong>full refund</strong> has been issued.</p>
    ${sessionInfoBlock(session, tz)}
    <p style="color: #555;">The refund will appear on your original payment method within 3–5 business days.</p>
    ${ctaButton('Discover Other Talent', `${FRONTEND_URL}/discover`)}
  `);
  return { subject, html };
};

export const sessionCancelledByBooker = (talent, booker, session, refundNote, tz = 'UTC') => {
  const subject = `Session cancelled by ${booker.firstName} ${booker.lastName}`;
  const html = baseLayout(`
    <h2 style="color: #333; margin-top: 0;">Session cancelled</h2>
    <p style="color: #555;">Hi ${talent.firstName},</p>
    <p style="color: #555;"><strong>${booker.firstName} ${booker.lastName}</strong> has cancelled their upcoming session with you.</p>
    ${sessionInfoBlock(session, tz)}
    <p style="color: #999; font-size: 13px;">${refundNote}</p>
    ${ctaButton('View Your Schedule', `${FRONTEND_URL}/bookings`)}
  `);
  return { subject, html };
};

// ─── REVIEW REMINDER (24h post-session) ──────────────────────────────────────

export const reviewReminder24h = (booker, talentName, talentUsername, session) => {
  const bookUrl = `${FRONTEND_URL}/book-1-on-1?talentId=${talentUsername}`;
  const subject = `How was your session with ${talentName}?`;
  const html = baseLayout(`
    <h2 style="color: #333; margin-top: 0;">How was your session?</h2>
    <p style="color: #555;">Hi ${booker.firstName},</p>
    <p style="color: #555;">Your 1:1 session with <strong>${talentName}</strong> was yesterday. We hope it was great!</p>
    ${sessionInfoBlock(session)}
    <p style="color: #555;">Take a moment to share your experience — your review helps others find amazing talent.</p>
    ${ctaButton('Leave a Review', bookUrl)}
  `);
  return { subject, html };
};

export const sessionCompletedForBoth = (recipient, otherPartyName, session, tz = 'UTC') => {
  const subject = 'Your 1:1 session is complete — leave a review!';
  const reviewUrl = `${FRONTEND_URL}/bookings`;
  const html = baseLayout(`
    <h2 style="color: #333; margin-top: 0;">Session complete!</h2>
    <p style="color: #555;">Hi ${recipient.firstName},</p>
    <p style="color: #555;">Your session with <strong>${otherPartyName}</strong> has ended. We hope it was valuable!</p>
     ${sessionInfoBlock(session, tz)}
    <p style="color: #555;">Got a moment? Your feedback helps the community.</p>
    ${ctaButton('Leave a Review', reviewUrl)}
  `);
  return { subject, html };
};
