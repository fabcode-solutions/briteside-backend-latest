// Helper to send event-related emails
import { sendMail } from './mail.service.js';
import { sendBulkTemplatedEmail } from './bulkMail.service.js';
import {
  generateEventReminderEmail,
  generateMerchandiseUpsellEmail,
  generatePromotionalEmail,
} from '../cron/emailTemplates.js';
import { FRONTEND_URL, BRAND_COLOR, header, footer, infoBox } from '../templates/emailLayout.js';

/**
 * Send email to organizer when event is published
 */
export async function sendEventPublishedEmail(organizerEmail, event) {
  const subject = `Your event "${event.title}" is now published!`;
  const html = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
      ${header}
      <div style="padding: 32px 40px;">
        <h2 style="color: #333;">Event Published</h2>
        <p>Dear Organizer,</p>
        <p>Your event <strong>${
          event.title
        }</strong> has been published and is now visible to users on Briteside.</p>
        <p>Event Date: <strong>${new Date(event.startDate).toLocaleString()}</strong></p>
        <p>Thank you for using Briteside!</p>
        <p>Best regards,<br>Briteside Team</p>
      </div>
      ${footer()}
    </div>
  `;
  const text = `Your event "${event.title}" is now published!\nEvent Date: ${new Date(
    event.startDate
  ).toLocaleString()}`;
  return sendMail(organizerEmail, subject, html, text);
}

/**
 * Send ticket purchase confirmation to user
 */
export async function sendTicketPurchaseEmail(
  userEmail,
  event,
  tickets,
  venue,
  downloadUrl,
  options = {}
) {
  const { receiptUrl, orderId } = options;
  venue = venue || {};
  const subject = `Your tickets for ${event.title}`;
  // Group tickets by holderName
  const ticketsByHolder = tickets.reduce((acc, t) => {
    if (!acc[t.holderName]) acc[t.holderName] = [];
    acc[t.holderName].push(t.ticketCode);
    return acc;
  }, {});

  const ticketList = Object.entries(ticketsByHolder)
    .map(
      ([holder, codes]) =>
        `<li>
          <strong>Holder:</strong> ${holder}<br/>
          <strong>Status:</strong> active<br/>
          <strong>Ticket Codes:</strong> ${codes.join(', ')}
        </li>`
    )
    .join('');

  const BRAND_GREEN = BRAND_COLOR;
  const TEXT_DARK = '#1a1a1a';
  const TEXT_MUTED = '#6b7280';
  const BORDER = '#e5e7eb';

  const ticketCardsHtml = Object.entries(ticketsByHolder)
    .map(
      ([holder, codes]) => `
        <tr>
          <td style="padding: 14px 18px; border: 1px solid ${BORDER}; border-radius: 10px; background: #f9fafb;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="font-family: 'Inter', Arial, sans-serif; font-size: 14px; color: ${TEXT_MUTED};">Holder</td>
                <td align="right" style="font-family: 'Inter', Arial, sans-serif; font-size: 14px; color: ${TEXT_DARK}; font-weight: 600;">${holder}</td>
              </tr>
              <tr>
                <td style="font-family: 'Inter', Arial, sans-serif; font-size: 14px; color: ${TEXT_MUTED}; padding-top: 6px;">Status</td>
                <td align="right" style="padding-top: 6px;">
                  <span style="font-family: 'Inter', Arial, sans-serif; font-size: 12px; font-weight: 600; color: ${BRAND_GREEN}; background: rgba(9,195,117,0.12); border-radius: 999px; padding: 2px 10px; display: inline-block;">Active</span>
                </td>
              </tr>
              <tr>
                <td colspan="2" style="font-family: 'Inter', Arial, sans-serif; font-size: 14px; color: ${TEXT_MUTED}; padding-top: 6px;">
                  Ticket Code${codes.length > 1 ? 's' : ''}: <span style="color: ${TEXT_DARK}; font-weight: 600; font-family: 'Courier New', monospace;">${codes.join(', ')}</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr><td style="height: 10px; line-height: 10px; font-size: 0;">&nbsp;</td></tr>`
    )
    .join('');

  const detailRow = (label, value) =>
    value
      ? `<tr>
          <td style="padding: 6px 0; font-family: 'Inter', Arial, sans-serif; font-size: 14px; color: ${TEXT_MUTED}; width: 110px; vertical-align: top;">${label}</td>
          <td style="padding: 6px 0; font-family: 'Inter', Arial, sans-serif; font-size: 14px; color: ${TEXT_DARK}; font-weight: 500;">${value}</td>
        </tr>`
      : '';

  const html = `
  <div style="background: #f3f4f6; padding: 32px 16px; font-family: 'Inter', Arial, sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto;">
      <tr>
        <td style="padding-bottom: 24px;">${header}</td>
      </tr>
      <tr>
        <td style="background: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid ${BORDER};">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="background: ${BRAND_GREEN}; padding: 28px 32px;">
                <p style="margin: 0; font-family: 'Inter', Arial, sans-serif; font-size: 13px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: rgba(255,255,255,0.85);">Ticket Purchase Confirmed</p>
                <h1 style="margin: 6px 0 0; font-family: 'Inter', Arial, sans-serif; font-size: 22px; color: #ffffff;">${event.title}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding: 28px 32px 8px;">
                <p style="margin: 0 0 20px; font-family: 'Inter', Arial, sans-serif; font-size: 15px; color: ${TEXT_DARK};">Thank you for your purchase! Your tickets are confirmed — here are the details.</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  ${ticketCardsHtml}
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding: 8px 32px 0;">
                <p style="margin: 20px 0 10px; font-family: 'Inter', Arial, sans-serif; font-size: 13px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: ${TEXT_MUTED};">Event Details</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  ${detailRow('Date', new Date(event.startDate).toLocaleString())}
                  ${detailRow('Venue', venue.name ? `${venue.name}${venue.address ? `, ${venue.address}` : ''}` : '')}
                  ${detailRow('Location', venue.city ? `${venue.city}, ${venue.state}, ${venue.country}, ${venue.postalCode}` : '')}
                  ${detailRow('Order ID', orderId)}
                </table>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding: 28px 32px 32px;">
                <a href="${downloadUrl}" style="display: inline-block; background: ${BRAND_GREEN}; color: #ffffff; font-family: 'Inter', Arial, sans-serif; font-size: 15px; font-weight: 600; text-decoration: none; padding: 13px 32px; border-radius: 10px;">View &amp; Download Tickets</a>
                ${receiptUrl ? `<p style="margin: 16px 0 0; font-family: 'Inter', Arial, sans-serif; font-size: 13px;"><a href="${receiptUrl}" style="color: ${TEXT_MUTED}; text-decoration: underline;">View payment receipt</a></p>` : ''}
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding-top: 24px;">${footer()}</td>
      </tr>
    </table>
  </div>
  `;

  const text = `Your tickets for ${event.title}${
    venue.name ? `\nVenue: ${venue.name}${venue.address ? `, ${venue.address}` : ''}` : ''
  }${
    venue.city ? `\nLocation: ${venue.city}, ${venue.state}, ${venue.country}, ${venue.postalCode}` : ''
  }\nDate: ${new Date(
    event.startDate
  ).toLocaleString()}${orderId ? `\nOrder ID: ${orderId}` : ''}${receiptUrl ? `\nPayment Receipt: ${receiptUrl}` : ''}\nView & Download Tickets: ${downloadUrl}\n\nTickets:\n${Object.entries(
    ticketsByHolder
  )
    .map(([holder, codes]) => `Holder: ${holder}, Status: active, Codes: ${codes.join(', ')}`)
    .join('\n')}`;
  return sendMail(userEmail, subject, html, text);
}

/**
 * Send event reminder email to user
 * @param {Object} event - Event object
 * @param {Object} user - User object
 * @param {number} hoursBefore - Hours before event
 */
export async function sendEventReminderEmail(event, user, hoursBefore) {
  const { subject, html, text } = generateEventReminderEmail(event, user, hoursBefore);

  try {
    await sendMail(user.email, subject, html, text);
    console.log(`Event reminder email sent to ${user.email} for event ${event.title}`);
  } catch (error) {
    console.error(`Failed to send reminder email to ${user.email}:`, error);
  }
}

/**
 * Send merchandise upsell email to ticket holders
 * @param {Object} event - Event object
 * @param {Object} user - User object
 * @param {Array} merchandise - Array of available merchandise
 * @param {number} ticketCount - Number of tickets user has for this event
 */
export async function sendMerchandiseUpsellEmail(event, user, merchandise, ticketCount) {
  if (!merchandise || merchandise.length === 0) return;

  const { subject, html, text } = generateMerchandiseUpsellEmail(
    event,
    user,
    merchandise,
    ticketCount
  );

  try {
    await sendMail(user.email, subject, html, text);
    console.log(`Merchandise upsell email sent to ${user.email} for event ${event.title}`);
  } catch (error) {
    console.error(`Failed to send merchandise upsell email to ${user.email}:`, error);
  }
}

/**
 * Send promotional email for upcoming events to non-attendees
 * @param {Object} user - User object
 * @param {Array} events - Array of upcoming events
 */
export async function sendPromotionalEmail(user, events) {
  const { subject, html, text } = generatePromotionalEmail(user, events);

  try {
    await sendMail(user.email, subject, html, text);
    console.log(`Promotional email sent to ${user.email} for upcoming events`);
  } catch (error) {
    console.error(`Failed to send promotional email to ${user.email}:`, error);
  }
}

/**
 * Send refund confirmation email to user
 * @param {string} userEmail - User's email address
 * @param {Object} order - Order object
 * @param {Object} refund - Refund object with refundedItems
 * @param {Object} event - Event object
 */
export async function sendRefundConfirmationEmail(userEmail, order, refund, event) {
  const subject = `Refund Confirmation - ${event?.title || 'Your Order'}`;

  // Parse refunded items
  const refundedItems = Array.isArray(refund.refundedItems) ? refund.refundedItems : [];
  const ticketCount = refundedItems.filter(item => item.type === 'ticket').length;
  const merchCount = refundedItems.filter(item => item.type === 'merch').length;

  const itemsSummary = [];
  if (ticketCount > 0) itemsSummary.push(`${ticketCount} ticket${ticketCount > 1 ? 's' : ''}`);
  if (merchCount > 0)
    itemsSummary.push(`${merchCount} merchandise item${merchCount > 1 ? 's' : ''}`);

  const html = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
      ${header}
      <div style="padding: 32px 40px;">
        <h2 style="color: #00D16E;">Refund Confirmation</h2>
        <p>Dear Customer,</p>
        <p>Your refund has been successfully processed.</p>

        ${infoBox([
          ['Order ID', order.id],
          ['Refund Amount', `$${refund.amount}`],
          ['Refund Type', refund.refundType === 'full' ? 'Full Refund' : 'Partial Refund'],
          ['Status', refund.status],
          event && ['Event', event.title],
          itemsSummary.length > 0 && ['Items Refunded', itemsSummary.join(' and ')],
        ])}

        <p>The refund will be credited back to your original payment method within 5-10 business days.</p>

        ${refund.reason ? `<p><strong>Reason:</strong> ${refund.reason}</p>` : ''}

        <p>If you have any questions about this refund, please contact our support team.</p>

        <p>Best regards,<br/>Briteside Team</p>
      </div>
      ${footer()}
    </div>
  `;

  const text = `
Refund Confirmation\n\nDear Customer,\n\nYour refund has been successfully processed.\n\nRefund Details:\nOrder ID: ${
    order.id
  }\nRefund Amount: $${refund.amount}\nRefund Type: ${
    refund.refundType === 'full' ? 'Full Refund' : 'Partial Refund'
  }\nStatus: ${refund.status}\n${event ? `Event: ${event.title}\n` : ''}${
    itemsSummary.length > 0 ? `Items Refunded: ${itemsSummary.join(' and ')}\n` : ''
  }\nThe refund will be credited back to your original payment method within 5-10 business days.\n${
    refund.reason ? `\nReason: ${refund.reason}\n` : ''
  }\nIf you have any questions about this refund, please contact our support team.\n\nBest regards,\nBriteside Team
  `;

  try {
    await sendMail(userEmail, subject, html, text);
    console.log(`Refund confirmation email sent to ${userEmail} for order ${order.id}`);
  } catch (error) {
    console.error(`Failed to send refund confirmation email to ${userEmail}:`, error);
    throw error;
  }
}

/**
 * @param {Array<{email: string, name: string}>} recipients
 * @param {object} event - full event object from getEventById
 * @param {string} organizerName
 */
export async function sendEventRescheduledEmail(recipients, event, organizerName) {
  const eventUrl = `${FRONTEND_URL}/events/${event.slug}`;
  const newStartDate = new Date(event.startDate).toLocaleString();
  const newEndDate = new Date(event.endDate).toLocaleString();

  const defaultData = {
    user_name: 'there',
    event_name: event.title,
    new_start_date: newStartDate,
    new_end_date: newEndDate,
    organizer_name: organizerName,
    event_url: eventUrl,
  };

  const mapped = recipients.map(r => ({
    email: r.email,
    data: { ...defaultData, user_name: r.name || 'there' },
  }));

  return sendBulkTemplatedEmail('Briteside-event-rescheduled', defaultData, mapped);
}

/**
 * @param {Array<{email: string, name: string}>} recipients
 * @param {object} event
 * @param {object|null} venue
 * @param {string} organizerName
 */
export async function sendEventVenueChangedEmail(recipients, event, venue, organizerName) {
  const eventUrl = `${FRONTEND_URL}/events/${event.slug}`;
  const newVenue = venue
    ? [venue.name, venue.address, venue.city, venue.state].filter(Boolean).join(', ')
    : 'See event details';

  const defaultData = {
    user_name: 'there',
    event_name: event.title,
    new_venue: newVenue,
    organizer_name: organizerName,
    event_url: eventUrl,
  };

  const mapped = recipients.map(r => ({
    email: r.email,
    data: { ...defaultData, user_name: r.name || 'there' },
  }));

  return sendBulkTemplatedEmail('Briteside-event-venue-changed', defaultData, mapped);
}

/**
 * @param {Array<{email: string, name: string}>} recipients
 * @param {object} event
 * @param {object|null} venue
 * @param {string} organizerName
 */
export async function sendEventDateAndVenueChangedEmail(recipients, event, venue, organizerName) {
  const eventUrl = `${FRONTEND_URL}/events/${event.slug}`;
  const newStartDate = new Date(event.startDate).toLocaleString();
  const newEndDate = new Date(event.endDate).toLocaleString();
  const newVenue = venue
    ? [venue.name, venue.address, venue.city, venue.state].filter(Boolean).join(', ')
    : 'See event details';

  const defaultData = {
    user_name: 'there',
    event_name: event.title,
    new_start_date: newStartDate,
    new_end_date: newEndDate,
    new_venue: newVenue,
    organizer_name: organizerName,
    event_url: eventUrl,
  };

  const mapped = recipients.map(r => ({
    email: r.email,
    data: { ...defaultData, user_name: r.name || 'there' },
  }));

  return sendBulkTemplatedEmail('Briteside-event-date-venue-changed', defaultData, mapped);
}

export async function sendEventCancellationEmail(userEmail, event) {
  const subject = `Event Cancelled: ${event.title}`;
  const html = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
      ${header}
      <div style="padding: 32px 40px;">
        <h2 style="color: #e53e3e;">Event Cancelled</h2>
        <p>We're sorry to let you know that <strong>${event.title}</strong> has been cancelled by the organizer.</p>
        <p>A <strong>full refund</strong> has been issued to your original payment method. Please allow 5–10 business days for the funds to appear.</p>
        ${event.cancellationReason ? `<p><strong>Cancellation reason:</strong> ${event.cancellationReason}</p>` : ''}
        <p>We apologize for any inconvenience.</p>
        <p>Best regards,<br>The Briteside Team</p>
      </div>
      ${footer()}
    </div>
  `;
  const text = `Event Cancelled: ${event.title}\n\nA full refund has been issued to your original payment method. Please allow 5–10 business days.${event.cancellationReason ? `\n\nCancellation reason: ${event.cancellationReason}` : ''}`;
  return sendMail(userEmail, subject, html, text);
}
