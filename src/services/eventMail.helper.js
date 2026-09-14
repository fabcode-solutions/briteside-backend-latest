// Helper to send event-related emails
import { sendMail } from './mail.service.js';
import { sendBulkTemplatedEmail } from './bulkMail.service.js';
import {
  generateEventReminderEmail,
  generateMerchandiseUpsellEmail,
  generatePromotionalEmail,
} from '../cron/emailTemplates.js';

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://briteside.app';

/**
 * Send email to organizer when event is published
 */
export async function sendEventPublishedEmail(organizerEmail, event) {
  const subject = `Your event "${event.title}" is now published!`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #333;">Event Published</h2>
      <p>Dear Organizer,</p>
      <p>Your event <strong>${
        event.title
      }</strong> has been published and is now visible to users on GoKyro.</p>
      <p>Event Date: <strong>${new Date(event.startDate).toLocaleString()}</strong></p>
      <p>Thank you for using GoKyro!</p>
      <p>Best regards,<br>GoKyro Team</p>
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

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #333;">Ticket Purchase Confirmation</h2>
      <p>Thank you for your purchase! Here are your ticket details:</p>
      <ul>${ticketList}</ul>
      <h3>Event Details</h3>
      <p><strong>${event.title}</strong></p>
      <p>Date: ${new Date(event.startDate).toLocaleString()}</p>
      <p>Venue: ${venue.name}, ${venue.address}</p>
      <p>Location: ${venue.city}, ${venue.state}, ${venue.country}, ${venue.postalCode}</p>
      ${orderId ? `<p><strong>Order ID:</strong> ${orderId}</p>` : ''}
      ${receiptUrl ? `<p><strong>Payment Receipt:</strong> <a href="${receiptUrl}">${receiptUrl}</a></p>` : ''}
      <p>View and download your tickets: <a href="${downloadUrl}">${downloadUrl}</a></p>
      <p>Best regards,<br/>GoKyro Team</p>
    </div>
  `;

  const text = `Your tickets for ${event.title}\nVenue: ${venue.name}, ${
    venue.address
  }\nLocation: ${venue.city}, ${venue.state}, ${venue.country}, ${
    venue.postalCode
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
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #333;">Refund Confirmation</h2>
      <p>Dear Customer,</p>
      <p>Your refund has been successfully processed.</p>

      <div style="background-color: #f5f5f5; padding: 20px; margin: 20px 0; border-radius: 5px;">
        <h3 style="margin-top: 0;">Refund Details:</h3>
        <p><strong>Order ID:</strong> ${order.id}</p>
        <p><strong>Refund Amount:</strong> $${refund.amount}</p>
        <p><strong>Refund Type:</strong> ${
          refund.refundType === 'full' ? 'Full Refund' : 'Partial Refund'
        }</p>
        <p><strong>Status:</strong> ${refund.status}</p>
        ${event ? `<p><strong>Event:</strong> ${event.title}</p>` : ''}
        ${
          itemsSummary.length > 0
            ? `<p><strong>Items Refunded:</strong> ${itemsSummary.join(' and ')}</p>`
            : ''
        }
      </div>

      <p>The refund will be credited back to your original payment method within 5-10 business days.</p>

      ${refund.reason ? `<p><strong>Reason:</strong> ${refund.reason}</p>` : ''}

      <p>If you have any questions about this refund, please contact our support team.</p>

      <p>Best regards,<br/>GoKyro Team</p>
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
  }\nIf you have any questions about this refund, please contact our support team.\n\nBest regards,\nGoKyro Team
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
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #e53e3e;">Event Cancelled</h2>
      <p>We're sorry to let you know that <strong>${event.title}</strong> has been cancelled by the organizer.</p>
      <p>A <strong>full refund</strong> has been issued to your original payment method. Please allow 5–10 business days for the funds to appear.</p>
      ${event.cancellationReason ? `<p><strong>Cancellation reason:</strong> ${event.cancellationReason}</p>` : ''}
      <p>We apologize for any inconvenience.</p>
      <p>Best regards,<br>The Briteside Team</p>
    </div>
  `;
  const text = `Event Cancelled: ${event.title}\n\nA full refund has been issued to your original payment method. Please allow 5–10 business days.${event.cancellationReason ? `\n\nCancellation reason: ${event.cancellationReason}` : ''}`;
  return sendMail(userEmail, subject, html, text);
}
