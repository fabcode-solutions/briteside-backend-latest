/**
 * Event Email Templates
 * Covers: event registration, ticket purchase, reminders (1 week / 24hr),
 *         invitations, cancellations, rescheduled, virtual events
 */

const divider = `<hr style="border:none;border-top:1px solid #eee;margin:20px 0;"/>`;

const eventDetailsBlock = ({ event_date, event_time, event_location, organizer_name }) => `
  <div style="background:#f8f8f8;border-radius:6px;padding:16px;margin:16px 0;">
    <div>📅 <strong>Date:</strong> ${event_date}</div>
    <div>🕐 <strong>Time:</strong> ${event_time}</div>
    <div>📍 <strong>Location:</strong> ${event_location}</div>
    ${organizer_name ? `<div>👤 <strong>Organizer:</strong> ${organizer_name}</div>` : ''}
  </div>`;

const ctaButton = (label, href = '#') =>
  `<a href="${href}" style="background:#6c47ff;color:#fff;padding:11px 22px;border-radius:6px;text-decoration:none;margin:0 6px;display:inline-block;">${label}</a>`;

const header = `
  <div style="text-align:center;padding:20px 0;border-bottom:1px solid #eee;">
    <strong>BRITESIDE</strong><br/>
    <a href="https://www.briteside.app" style="color:#666;font-size:12px;">www.briteside.app</a>
  </div>`;

const footer = text => `
  <div style="padding:15px 20px;border-top:1px solid #eee;font-size:12px;color:#999;text-align:center;">
    ${text}
  </div>`;

export const eventTemplates = {
  // ── Free Event Registration ─────────────────────────────────────────────
  eventRegistration: {
    id: 'event-registration',
    subject: ({ event_name }) => `You're registered for ${event_name}!`,
    html: ({
      user_name,
      event_name,
      event_date,
      event_time,
      event_location,
      organizer_name,
      registration_date,
    }) => `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        ${header}
        <div style="padding:30px 20px;">
          <p>Hi ${user_name},</p>
          <h2 style="color:#333;">You're all set! 🎉</h2>
          <p>Your registration for <strong>${event_name}</strong> has been confirmed.</p>
          ${eventDetailsBlock({ event_date, event_time, event_location, organizer_name })}
          <p><strong>What to Bring:</strong></p>
          <ul>
            <li>Your confirmation email or QR code</li>
            <li>Valid ID for check-in</li>
          </ul>
          <div style="text-align:center;margin:24px 0;">
            ${ctaButton('View Event Details')}
            ${ctaButton('Add to Calendar')}
            ${ctaButton('Get Directions')}
          </div>
          <p>We look forward to seeing you there!<br/><strong>The Briteside Team</strong></p>
        </div>
        ${footer(`You registered for this event on ${registration_date}.<br/><a href="#">Manage your bookings</a> | <a href="#">Contact organizer</a>`)}
      </div>`,
  },

  // ── Paid Ticket Purchase ────────────────────────────────────────────────
  ticketPurchase: {
    id: 'ticket-purchase',
    subject: ({ event_name }) => `Your ticket for ${event_name}`,
    html: ({
      user_name,
      event_name,
      order_number,
      ticket_type,
      quantity,
      subtotal,
      fees,
      amount,
      payment_method,
      card_last_four,
      event_date,
      event_time,
      event_location,
      organizer_name,
      refund_policy,
      purchase_date,
    }) => `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        ${header}
        <div style="padding:30px 20px;">
          <p>Hi ${user_name},</p>
          <h2 style="color:#333;">Thank you for your purchase! 🎟️</h2>
          <p>Your ticket for <strong>${event_name}</strong> is confirmed.</p>

          <div style="background:#f8f8f8;border-radius:6px;padding:16px;margin:16px 0;">
            <strong>Order Summary</strong><br/>${divider}
            Order #: ${order_number}<br/>
            Ticket Type: ${ticket_type}<br/>
            Quantity: ${quantity}<br/>
            Subtotal: ${subtotal}<br/>
            Fees: ${fees}<br/>
            ${divider}
            <strong>Total: ${amount}</strong><br/>
            Payment: ${payment_method} ending in ${card_last_four}
          </div>

          ${eventDetailsBlock({ event_date, event_time, event_location, organizer_name })}

          <div style="text-align:center;margin:24px 0;">
            ${ctaButton('View Ticket')}
            ${ctaButton('Download PDF')}
            ${ctaButton('Add to Wallet')}
          </div>

          <p><strong>Refund Policy:</strong> ${refund_policy}</p>
          <p>Questions? Contact the event organizer or our support team.<br/><strong>The Briteside Team</strong></p>
        </div>
        ${footer(`Receipt for order #${order_number} placed on ${purchase_date}.<br/><a href="#">View order details</a> | <a href="#">Contact support</a>`)}
      </div>`,
  },

  // ── Event Reminder – 1 Week ─────────────────────────────────────────────
  eventReminderWeek: {
    id: 'event-reminder-week',
    subject: ({ event_name }) => `${event_name} is coming up next week!`,
    html: ({ user_name, event_name, event_date, event_time, event_location }) => `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        ${header}
        <div style="padding:30px 20px;">
          <p>Hi ${user_name},</p>
          <h2 style="color:#333;">Just a friendly reminder! 📅</h2>
          <p><strong>${event_name}</strong> is happening in <strong>ONE WEEK!</strong></p>
          ${eventDetailsBlock({ event_date, event_time, event_location })}
          <p><strong>Prepare for the Event:</strong></p>
          <ul>
            <li>Save the date to your calendar</li>
            <li>Check the event details for any updates</li>
            <li>Plan your transportation</li>
          </ul>
          <div style="text-align:center;margin:24px 0;">
            ${ctaButton('View Event Details')}
            ${ctaButton('Add to Calendar')}
            ${ctaButton('Share Event')}
          </div>
          <p>We can't wait to see you there!<br/><strong>The Briteside Team</strong></p>
        </div>
        ${footer(`You're registered for this event.<br/><a href="#">Manage your registration</a> | <a href="#">Contact organizer</a>`)}
      </div>`,
  },

  // ── Event Reminder – 24 Hours ───────────────────────────────────────────
  eventReminder24h: {
    id: 'event-reminder',
    subject: ({ event_name }) => `Reminder: ${event_name} is tomorrow!`,
    html: ({
      user_name,
      event_name,
      event_date,
      event_time,
      event_location,
      doors_open_time,
      directions,
      additional_items = '',
    }) => `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        ${header}
        <div style="padding:30px 20px;">
          <p>Hi ${user_name},</p>
          <h2 style="color:#333;">This is it! ${event_name} is TOMORROW! 🎉</h2>
          <div style="background:#f8f8f8;border-radius:6px;padding:16px;margin:16px 0;">
            <div>📅 <strong>Date:</strong> ${event_date}</div>
            <div>🕐 <strong>Time:</strong> ${event_time}</div>
            <div>📍 <strong>Location:</strong> ${event_location}</div>
            <div>🚪 <strong>Doors Open:</strong> ${doors_open_time}</div>
          </div>
          <p><strong>Don't Forget to Bring:</strong></p>
          <ul>
            <li>Your ticket or confirmation QR code</li>
            <li>Valid ID for check-in</li>
            ${additional_items ? `<li>${additional_items}</li>` : ''}
          </ul>
          <p><strong>Getting There:</strong> ${directions}</p>
          <div style="text-align:center;margin:24px 0;">
            ${ctaButton('View Your Ticket')}
            ${ctaButton('Get Directions')}
            ${ctaButton('Contact Organizer')}
          </div>
          <p>See you tomorrow!<br/><strong>The Briteside Team</strong></p>
        </div>
        ${footer(`<a href="#">View event details</a> | <a href="#">Manage your registration</a>`)}
      </div>`,
  },

  // ── Event Invitation ────────────────────────────────────────────────────
  eventInvitation: {
    id: 'event-invitation',
    subject: ({ event_name }) => `You're invited to ${event_name}!`,
    html: ({
      user_name,
      inviter_name,
      event_name,
      event_date,
      event_time,
      event_location,
      ticket_price,
      event_description,
      personal_message,
      attending_friends_count,
    }) => `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        ${header}
        <div style="padding:30px 20px;">
          <p>Hi ${user_name},</p>
          <h2 style="color:#333;">You're invited! 🎉</h2>
          <p><strong>${inviter_name}</strong> thinks you'd love this event:</p>
          <h3 style="color:#6c47ff;">${event_name}</h3>
          ${eventDetailsBlock({ event_date, event_time, event_location })}
          <div style="background:#f8f8f8;border-radius:6px;padding:12px;margin:12px 0;">
            🎟️ <strong>Price:</strong> ${ticket_price}
          </div>
          <p>${event_description}</p>
          <div style="border-left:3px solid #6c47ff;padding-left:12px;margin:16px 0;font-style:italic;">
            "${personal_message}"<br/><small>– ${inviter_name}</small>
          </div>
          ${attending_friends_count ? `<p>👥 <strong>${attending_friends_count}</strong> of your connections are attending this event.</p>` : ''}
          <div style="text-align:center;margin:24px 0;">
            ${ctaButton('View Event')}
            ${ctaButton('Register Now')}
          </div>
          <p><strong>The Briteside Team</strong></p>
        </div>
        ${footer(`Invitation sent by ${inviter_name}.<br/><a href="#">Manage invitations</a>`)}
      </div>`,
  },

  // ── Event Cancellation ──────────────────────────────────────────────────
  eventCancellation: {
    id: 'event-cancellation',
    subject: ({ event_name }) => `${event_name} has been cancelled`,
    html: ({
      user_name,
      event_name,
      event_date,
      event_time,
      event_location,
      cancellation_reason,
      organizer_message,
      is_paid_event,
      amount,
      refund_reference,
    }) => `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        ${header}
        <div style="padding:30px 20px;">
          <p>Hi ${user_name},</p>
          <h2 style="color:#c0392b;">Event Cancelled 😔</h2>
          <p>We're sorry to inform you that <strong>${event_name}</strong> has been cancelled.</p>
          ${eventDetailsBlock({ event_date, event_time, event_location })}
          <p><strong>Reason for Cancellation:</strong> ${cancellation_reason}</p>
          ${organizer_message ? `<div style="border-left:3px solid #ccc;padding-left:12px;margin:16px 0;font-style:italic;">"${organizer_message}"</div>` : ''}
          ${
            is_paid_event
              ? `<div style="background:#fff8e1;border-radius:6px;padding:16px;margin:16px 0;">
                <strong>Refund Information:</strong><br/>
                Your ticket purchase of <strong>${amount}</strong> will be automatically refunded within 5–10 business days.<br/>
                Refund Reference: ${refund_reference}
               </div>`
              : `<p>As this was a free event, no refund is necessary.</p>`
          }
          <div style="text-align:center;margin:24px 0;">
            ${ctaButton('Browse Similar Events')}
          </div>
          <p>We apologize for any inconvenience.<br/><strong>The Briteside Team</strong></p>
        </div>
        ${footer(`<a href="#">View refund status</a> | <a href="#">Contact organizer</a> | <a href="#">Browse events</a>`)}
      </div>`,
  },

  // ── Event Rescheduled ───────────────────────────────────────────────────
  eventRescheduled: {
    id: 'event-rescheduled',
    subject: ({ event_name }) => `${event_name} has been rescheduled`,
    html: ({
      user_name,
      event_name,
      old_date,
      old_time,
      new_date,
      new_time,
      event_location,
      reschedule_reason,
      organizer_message,
    }) => `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        ${header}
        <div style="padding:30px 20px;">
          <p>Hi ${user_name},</p>
          <h2 style="color:#333;">Important update: ${event_name} has been rescheduled</h2>
          <div style="background:#f8f8f8;border-radius:6px;padding:16px;margin:16px 0;">
            <div>❌ <strong>Original:</strong> ${old_date} at ${old_time}</div>
            <div>✅ <strong>New Date:</strong> ${new_date} at ${new_time}</div>
            <div>📍 <strong>Location:</strong> ${event_location} (unchanged)</div>
          </div>
          <p><strong>Reason:</strong> ${reschedule_reason}</p>
          ${organizer_message ? `<div style="border-left:3px solid #6c47ff;padding-left:12px;margin:16px 0;font-style:italic;">"${organizer_message}"</div>` : ''}
          <p>✅ Your registration is still valid for the new date. No action required unless you need to cancel.</p>
          <div style="text-align:center;margin:24px 0;">
            ${ctaButton('Update Calendar')}
            ${ctaButton('View Event Details')}
            ${ctaButton('Cancel & Get Refund')}
          </div>
          <p>Thank you for your understanding!<br/><strong>The Briteside Team</strong></p>
        </div>
        ${footer(`<a href="#">View event details</a> | <a href="#">Contact organizer</a>`)}
      </div>`,
  },

  // ── Virtual Event Registration ──────────────────────────────────────────
  virtualEventRegistration: {
    id: 'virtual-event-registration',
    subject: ({ event_name }) => `You're registered for ${event_name} 🎉`,
    html: ({
      user_name,
      event_name,
      event_date,
      event_time,
      timezone,
      event_duration,
      host_name,
      access_link,
      event_password,
      requires_password,
      event_description,
      registration_date,
    }) => `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        ${header}
        <div style="padding:30px 20px;">
          <p>Hi ${user_name},</p>
          <h2 style="color:#333;">You're registered for ${event_name}! 🎉</h2>
          <div style="background:#f8f8f8;border-radius:6px;padding:16px;margin:16px 0;">
            <div>📅 <strong>Date:</strong> ${event_date}</div>
            <div>🕐 <strong>Time:</strong> ${event_time} (${timezone})</div>
            <div>⏱️ <strong>Duration:</strong> ${event_duration}</div>
            <div>👤 <strong>Host:</strong> ${host_name}</div>
          </div>
          <div style="background:#eef2ff;border-radius:6px;padding:16px;margin:16px 0;">
            <strong>🔗 Your Access Link:</strong><br/>
            <div style="text-align:center;margin:12px 0;">
              ${ctaButton('Join Virtual Event', access_link)}
            </div>
            <p style="font-size:12px;color:#666;word-break:break-all;">${access_link}</p>
            ${requires_password ? `<p>🔐 <strong>Event Password:</strong> ${event_password}</p>` : ''}
          </div>
          ${event_description ? `<p>${event_description}</p>` : ''}
          <p><strong>Before the Event:</strong></p>
          <ul>
            <li>Test your audio and video</li>
            <li>Ensure a stable internet connection</li>
            <li>Join 5–10 minutes early</li>
          </ul>
          <p>See you there!<br/><strong>The Briteside Team</strong></p>
        </div>
        ${footer(`Registration confirmed on ${registration_date}.<br/><a href="#">View event details</a> | <a href="#">Manage registration</a>`)}
      </div>`,
  },

  // ── Virtual Event Reminder – 1 Week ────────────────────────────────────
  virtualEventReminderWeek: {
    id: 'virtual-event-reminder-1-week',
    subject: ({ event_name }) => `${event_name} is 1 week away! 📅`,
    html: ({
      user_name,
      event_name,
      event_date,
      event_time,
      timezone,
      event_duration,
      host_name,
      access_link,
      event_password,
      requires_password,
      event_description,
    }) => `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        ${header}
        <div style="padding:30px 20px;">
          <p>Hi ${user_name},</p>
          <h2 style="color:#333;">Just a reminder – ${event_name} is in 1 week! 📅</h2>
          <div style="background:#f8f8f8;border-radius:6px;padding:16px;margin:16px 0;">
            <div>📅 <strong>Date:</strong> ${event_date}</div>
            <div>🕐 <strong>Time:</strong> ${event_time} (${timezone})</div>
            <div>⏱️ <strong>Duration:</strong> ${event_duration}</div>
            <div>👤 <strong>Host:</strong> ${host_name}</div>
          </div>
          <div style="background:#eef2ff;border-radius:6px;padding:16px;margin:16px 0;">
            <strong>🔗 Your Access Link:</strong><br/>
            <div style="text-align:center;margin:12px 0;">${ctaButton('Join Virtual Event', access_link)}</div>
            ${requires_password ? `<p>🔐 <strong>Event Password:</strong> ${event_password}</p>` : ''}
          </div>
          ${event_description ? `<p>${event_description}</p>` : ''}
          <div style="text-align:center;margin:24px 0;">${ctaButton('Cancel Registration', '#')}</div>
          <p>See you in 1 week!<br/><strong>The Briteside Team</strong></p>
        </div>
        ${footer(`<a href="#">View event details</a> | <a href="#">Manage registration</a>`)}
      </div>`,
  },

  // ── Virtual Event Reminder – 1 Day ─────────────────────────────────────
  virtualEventReminder1Day: {
    id: 'virtual-event-reminder-1-day',
    subject: ({ event_name }) => `${event_name} is TOMORROW! 🔔`,
    html: ({
      user_name,
      event_name,
      event_date,
      event_time,
      timezone,
      event_duration,
      host_name,
      access_link,
      event_password,
      requires_password,
      event_description,
      event_agenda = [],
    }) => `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        ${header}
        <div style="padding:30px 20px;">
          <p>Hi ${user_name},</p>
          <h2 style="color:#333;">Your virtual event is TOMORROW! 🎉</h2>
          <div style="background:#f8f8f8;border-radius:6px;padding:16px;margin:16px 0;">
            <div>📅 <strong>Date:</strong> ${event_date}</div>
            <div>🕐 <strong>Time:</strong> ${event_time} (${timezone})</div>
            <div>⏱️ <strong>Duration:</strong> ${event_duration}</div>
            <div>👤 <strong>Host:</strong> ${host_name}</div>
          </div>
          <div style="background:#eef2ff;border-radius:6px;padding:16px;margin:16px 0;">
            <strong>🔗 Your Access Link:</strong><br/>
            <div style="text-align:center;margin:12px 0;">${ctaButton('Join Virtual Event', access_link)}</div>
            ${requires_password ? `<p>🔐 <strong>Event Password:</strong> ${event_password}</p>` : ''}
          </div>
          <p><strong>Last-Minute Checklist:</strong></p>
          <ul>
            <li>☑️ Test your camera and microphone</li>
            <li>☑️ Check your internet connection</li>
            <li>☑️ Find a quiet space with good lighting</li>
            <li>☑️ Join 5–10 minutes early</li>
          </ul>
          ${event_agenda.length ? `<p><strong>Event Agenda:</strong></p><ul>${event_agenda.map(a => `<li>${a.time} – ${a.topic}</li>`).join('')}</ul>` : ''}
          <p>See you tomorrow!<br/><strong>The Briteside Team</strong></p>
        </div>
        ${footer(`<a href="#">View event details</a> | <a href="#">Manage registration</a>`)}
      </div>`,
  },
  // ── Event Rating Request ─────────────────────────────────────────────────
  eventRating: {
    id: 'event-rating',
    subject: ({ event_name }) => `How was ${event_name}? Share your experience ⭐`,
    html: ({
      user_name,
      event_name,
      organizer_name,
      event_date,
      event_time,
      event_location,
      feedback_link,
    }) => `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        ${header}
        <div style="padding:30px 20px;">
          <p>Hi ${user_name},</p>
          <h2 style="color:#333;">How was ${event_name}? We'd love your feedback.</h2>
          <p>Thanks for attending! Your rating helps ${organizer_name ? organizer_name : 'the organizer'} make future events even better.</p>
          ${eventDetailsBlock({ event_date, event_time, event_location, organizer_name })}
          <p><strong>Rate your experience:</strong></p>
          <div style="text-align:center;font-size:24px;letter-spacing:4px;margin:16px 0;">
            ⭐ ⭐ ⭐ ⭐ ⭐
          </div>
          <p style="margin:0 0 16px;">Share your thoughts on what went well and how we can improve.</p>
          <div style="text-align:center;margin:24px 0;">
            ${ctaButton('Rate This Event', feedback_link)}
          </div>
          <p>Thanks for helping the community!<br/><strong>The Briteside Team</strong></p>
        </div>
        ${footer(`You attended this event on ${event_date}.<br/><a href="#">Manage your preferences</a> | <a href="#">Contact organizer</a>`)}
      </div>`,
  },
};
