import dayjs from 'dayjs';
import { FRONTEND_URL, BRAND_COLOR, header, footer, ctaButton, infoBox } from '../templates/emailLayout.js';

/**
 * Email templates for cron job notifications
 */

/**
 * Generate event reminder email HTML
 * @param {Object} event - Event object
 * @param {Object} user - User object
 * @param {number} hoursBefore - Hours before event
 * @returns {Object} - Email content object with html and text
 */
export const generateEventReminderEmail = (event, user, hoursBefore) => {
  const reminderType = hoursBefore === 24 ? '24-hour' : '1-hour';
  const subject = `Event Reminder: ${event.title} starts in ${reminderType}`;

  const eventDate = dayjs(event.startDate).format('dddd, MMMM D, YYYY');
  const eventTime = dayjs(event.startDate).format('h:mm A');

  const html = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
      ${header}
      <div style="padding: 32px 40px;">
        <h2 style="color: #333;">Event Reminder</h2>
        <p>Hi ${user.firstName},</p>
        <p>This is a friendly reminder that the event you're attending is coming up soon!</p>

        ${infoBox([
          ['Event', event.title],
          ['Date', eventDate],
          ['Time', eventTime],
          ['Venue', event.venue?.name || 'TBD'],
          ['Event Code', event.eventCode],
        ])}

        <p>We can't wait to see you there! Don't forget to bring your ticket.</p>

        <div style="text-align: center; margin: 30px 0;">
          ${ctaButton('View Event Details', `${FRONTEND_URL}/events/${event.slug}`)}
        </div>

        <p>Best regards,<br>The Briteside Team</p>
      </div>
      ${footer()}
    </div>
  `;

  const text = `
    Event Reminder

    Hi ${user.firstName},

    This is a friendly reminder that the event you're attending is coming up soon!

    Event: ${event.title}
    Date: ${eventDate}
    Time: ${eventTime}
    Venue: ${event.venue?.name || 'TBD'}
    Event Code: ${event.eventCode}

    We can't wait to see you there!

    Best regards,
    The Briteside Team
  `;

  return { subject, html, text };
};

/**
 * Generate merchandise upsell email HTML
 * @param {Object} event - Event object
 * @param {Object} user - User object
 * @param {Array} merchandise - Array of available merchandise
 * @param {number} ticketCount - Number of tickets user has for this event
 * @returns {Object} - Email content object with html and text
 */
export const generateMerchandiseUpsellEmail = (event, user, merchandise, ticketCount) => {
  const subject = `Don't Miss Out: Exclusive ${event.title} Merchandise!`;

  // Create merchandise list HTML
  const merchandiseHtml = merchandise
    .map(
      item => `
    <div style="border: 1px solid #ddd; border-radius: 8px; padding: 15px; margin: 10px 0; background-color: #fafafa;">
      <div style="display: flex; align-items: center;">
        ${
          item.imageUrl
            ? `<img src="${item.imageUrl}" alt="${item.name}" style="width: 80px; height: 80px; object-fit: cover; border-radius: 5px; margin-right: 15px;">`
            : ''
        }
        <div style="flex: 1;">
          <h4 style="margin: 0 0 5px 0; color: #333;">${item.name}</h4>
          <p style="margin: 0 0 8px 0; color: #666; font-size: 14px;">${
            item.description || 'Limited edition merchandise'
          }</p>
          <p style="margin: 0; font-weight: bold; color: ${BRAND_COLOR}; font-size: 16px;">$${
            item.price
          }</p>
          ${
            item.quantityAvailable > 0
              ? `<p style="margin: 5px 0 0 0; color: ${BRAND_COLOR}; font-size: 12px;">${item.quantityAvailable} available</p>`
              : '<p style="margin: 5px 0 0 0; color: #dc3545; font-size: 12px;">Limited stock!</p>'
          }
        </div>
      </div>
    </div>
  `
    )
    .join('');

  const html = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
      ${header}
      <div style="padding: 32px 40px;">
        <h2 style="color: #333;">Exclusive Event Merchandise Available!</h2>
        <p>Hi ${user.firstName},</p>
        <p>Since you're attending <strong>${
          event.title
        }</strong>, we thought you'd love these exclusive merchandise items!</p>

        ${
          ticketCount > 1
            ? `<div style="background-color: #f8f9fa; border-left: 4px solid ${BRAND_COLOR}; border-radius: 0 8px 8px 0; padding: 15px 20px; margin: 20px 0;">
          <p style="margin: 0; color: #333;"><strong>🎉 Bulk Purchase Bonus:</strong> As a valued attendee with ${ticketCount} tickets, enjoy special pricing on merchandise!</p>
        </div>`
            : ''
        }

        <h3 style="color: ${BRAND_COLOR}; margin-top: 30px;">Available Merchandise:</h3>
        ${merchandiseHtml}

        <div style="text-align: center; margin: 30px 0;">
          ${ctaButton('Shop Merchandise Now', `${FRONTEND_URL}/events/${event.slug}/merchandise`)}
        </div>

        <p style="font-size: 12px; color: #666; text-align: center;">
          Limited quantities available. Prices may change. Don't miss out on these exclusive items!
        </p>

        <p>Best regards,<br>The Briteside Team</p>
      </div>
      ${footer()}
    </div>
  `;

  const text = `
    Exclusive Event Merchandise Available!

    Hi ${user.firstName},

    Since you're attending ${event.title}, check out these exclusive merchandise items!

    ${merchandise
      .map(item => `- ${item.name}: $${item.price} (${item.quantityAvailable} available)`)
      .join('\n')}

    Shop now: ${FRONTEND_URL}/events/${event.slug}/merchandise

    Best regards,
    The Briteside Team
  `;

  return { subject, html, text };
};

/**
 * Generate promotional email for non-attendees
 * @param {Object} user - User object
 * @param {Array} events - Array of upcoming events
 * @returns {Object} - Email content object with html and text
 */
export const generatePromotionalEmail = (user, events) => {
  const subject = 'Discover Amazing Events Happening Soon!';

  // Create events list HTML
  const eventsHtml = events
    .slice(0, 3)
    .map(event => {
      const eventDate = dayjs(event.startDate).format('MMM D, YYYY');
      const eventTime = dayjs(event.startDate).format('h:mm A');

      return `
      <div style="border: 1px solid #e0e0e0; border-radius: 8px; padding: 15px; margin: 10px 0; background-color: #fafafa;">
        <h4 style="margin: 0 0 8px 0; color: #333;">${event.title}</h4>
        <p style="margin: 0 0 4px 0; color: #666; font-size: 14px;"><strong>Date:</strong> ${eventDate} at ${eventTime}</p>
        <p style="margin: 0 0 4px 0; color: #666; font-size: 14px;"><strong>Venue:</strong> ${
          event.venue?.name || 'TBD'
        }</p>
        <p style="margin: 0 0 4px 0; color: #666; font-size: 14px;"><strong>Category:</strong> ${
          event.category?.name || 'General'
        }</p>
        <p style="margin: 0 0 8px 0; color: #666; font-size: 13px;">${
          event.description
            ? event.description.substring(0, 100) + '...'
            : 'Join us for an amazing experience!'
        }</p>
      </div>
    `;
    })
    .join('');

  const html = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
      ${header}
      <div style="padding: 32px 40px;">
        <h2 style="color: #333;">Discover Amazing Events Near You!</h2>
        <p>Hi ${user.firstName},</p>
        <p>We noticed you haven't purchased tickets for any upcoming events. Here are some exciting events happening soon that you might enjoy:</p>

        ${eventsHtml}

        <div style="text-align: center; margin: 30px 0;">
          ${ctaButton('Browse All Events', `${FRONTEND_URL}/events`)}
        </div>

        <p style="font-size: 12px; color: #666; text-align: center;">
          Don't miss out on these amazing experiences! Early bird pricing available on select events.
        </p>

        <p>Best regards,<br>The Briteside Team</p>
      </div>
      ${footer()}
    </div>
  `;

  const text = `
    Discover Amazing Events Near You!

    Hi ${user.firstName},

    We noticed you haven't purchased tickets for any upcoming events. Here are some exciting events happening soon:

    ${events
      .map(event => {
        const eventDate = dayjs(event.startDate).format('MMM D, YYYY');
        const eventTime = dayjs(event.startDate).format('h:mm A');
        return `- ${event.title} on ${eventDate} at ${eventTime}`;
      })
      .join('\n')}

    Browse all events: ${FRONTEND_URL}/events

    Best regards,
    The Briteside Team
  `;

  return { subject, html, text };
};
