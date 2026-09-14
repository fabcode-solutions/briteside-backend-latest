/**
 * Moderation & Notification Email Templates
 * Covers: community guidelines violation, appeal approved/denied,
 *         account suspension, reinstated, permanent suspension,
 *         priority message request/reply, notification digest, abandoned cart
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

// ─── Moderation ──────────────────────────────────────────────────────────────

export const moderationTemplates = {
  guidelinesViolation: {
    id: 'community-guidelines-violation',
    subject: () => 'Important: Your post has been removed',
    html: ({
      user_name,
      post_excerpt,
      post_date,
      violation_type,
      policy_description,
      is_first_offense,
      offense_count,
      notice_date,
    }) => `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        ${header}
        <div style="padding:30px 20px;">
          <p>Hi ${user_name},</p>
          <h2 style="color:#c0392b;">Your post has been removed</h2>
          <div style="background:#fff3f3;border-radius:6px;padding:16px;margin:16px 0;">
            <div>📝 <strong>Post Content:</strong> "${post_excerpt}..."</div>
            <div>📅 <strong>Posted on:</strong> ${post_date}</div>
            <div>🚫 <strong>Violation Type:</strong> ${violation_type}</div>
          </div>
          <p><strong>Policy Violated:</strong> ${policy_description}</p>
          ${
            is_first_offense
              ? `<p>This is your first violation. We encourage you to review our Community Guidelines to avoid future issues.</p>`
              : `<p>This is your <strong>${offense_count}</strong> violation. Continued violations may result in temporary or permanent suspension.</p>`
          }
          <div style="text-align:center;margin:24px 0;">
            ${ctaButton('Review Community Guidelines')}
            ${ctaButton('Submit an Appeal')}
          </div>
          <p><strong>The Briteside Trust & Safety Team</strong></p>
        </div>
        ${footer(`Violation notice issued on ${notice_date}.<br/><a href="#">Review guidelines</a> | <a href="#">Submit appeal</a> | <a href="#">Contact support</a>`)}
      </div>`,
  },

  appealApproved: {
    id: 'appeal-approved',
    subject: () => 'Good news: Your appeal has been approved',
    html: ({ user_name, post_excerpt, appeal_date, decision_date, review_notes }) => `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        ${header}
        <div style="padding:30px 20px;">
          <p>Hi ${user_name},</p>
          <h2 style="color:#27ae60;">Appeal Approved ✅</h2>
          <p>We've reviewed your appeal and your content has been restored.</p>
          <div style="background:#e8f5e9;border-radius:6px;padding:16px;margin:16px 0;">
            <div>📝 <strong>Original Post:</strong> "${post_excerpt}..."</div>
            <div>📅 <strong>Appeal Submitted:</strong> ${appeal_date}</div>
            <div>✅ <strong>Decision Date:</strong> ${decision_date}</div>
            <div>🔍 <strong>Reviewed by:</strong> Briteside Trust & Safety Team</div>
          </div>
          ${review_notes ? `<p><strong>Our Findings:</strong> ${review_notes}</p>` : ''}
          <p>Your post has been restored and is now visible. Any restrictions have been lifted. This incident will not count against your account standing.</p>
          <div style="text-align:center;margin:24px 0;">
            ${ctaButton('View Your Restored Post')}
            ${ctaButton('Share Feedback')}
          </div>
          <p><strong>The Briteside Trust & Safety Team</strong></p>
        </div>
        ${footer(`Appeal decision issued on ${decision_date}.<br/><a href="#">View community guidelines</a> | <a href="#">Contact support</a>`)}
      </div>`,
  },

  appealDenied: {
    id: 'appeal-denied',
    subject: () => 'Update on your appeal',
    html: ({
      user_name,
      post_excerpt,
      appeal_date,
      decision_date,
      policy_name,
      policy_description,
      detailed_explanation,
      is_warning_only,
      account_status_update,
    }) => `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        ${header}
        <div style="padding:30px 20px;">
          <p>Hi ${user_name},</p>
          <h2 style="color:#c0392b;">Appeal Denied ❌</h2>
          <p>After careful review, we've determined that our original decision was correct.</p>
          <div style="background:#fff3f3;border-radius:6px;padding:16px;margin:16px 0;">
            <div>📝 <strong>Original Post:</strong> "${post_excerpt}..."</div>
            <div>📅 <strong>Appeal Submitted:</strong> ${appeal_date}</div>
            <div>❌ <strong>Decision Date:</strong> ${decision_date}</div>
          </div>
          <p><strong>Policy Violated:</strong> ${policy_name} – ${policy_description}</p>
          ${detailed_explanation ? `<p><strong>Why this decision stands:</strong> ${detailed_explanation}</p>` : ''}
          ${
            is_warning_only
              ? `<p>This violation remains on your account record. Please review our Community Guidelines to avoid future issues.</p>`
              : `<p>${account_status_update}</p>`
          }
          <div style="text-align:center;margin:24px 0;">
            ${ctaButton('Review Community Guidelines')}
            ${ctaButton('View Help Center')}
            ${ctaButton('Contact Support')}
          </div>
          <p><strong>The Briteside Trust & Safety Team</strong></p>
        </div>
        ${footer(`Appeal decision issued on ${decision_date}.<br/><a href="#">Review guidelines</a> | <a href="#">Contact support</a>`)}
      </div>`,
  },

  accountSuspension: {
    id: 'account-suspension',
    subject: () => 'Your Briteside account has been suspended',
    html: ({
      user_name,
      user_email,
      suspension_type,
      suspension_date,
      suspension_duration,
      suspension_reason,
      violations = [],
      is_temporary,
      reinstatement_date,
    }) => `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        ${header}
        <div style="padding:30px 20px;">
          <p>Hi ${user_name},</p>
          <h2 style="color:#c0392b;">Account Suspended</h2>
          <div style="background:#fff3f3;border-radius:6px;padding:16px;margin:16px 0;">
            <div>👤 <strong>Account:</strong> ${user_email}</div>
            <div>🚫 <strong>Suspension Type:</strong> ${suspension_type}</div>
            <div>📅 <strong>Effective Date:</strong> ${suspension_date}</div>
            <div>⏱️ <strong>Duration:</strong> ${suspension_duration}</div>
          </div>
          <p><strong>Reason:</strong> ${suspension_reason}</p>
          ${
            violations.length
              ? `
          <p><strong>Violation History:</strong></p>
          <ul>${violations.map(v => `<li>${v.date}: ${v.violation_type}</li>`).join('')}</ul>`
              : ''
          }
          <p>During your suspension you will not be able to log in, post, message, attend events, or access groups.</p>
          ${
            is_temporary
              ? `<p>Your suspension will be automatically lifted on <strong>${reinstatement_date}</strong>. You'll receive an email confirmation when your account is restored.</p>`
              : `<p>This suspension is <strong>permanent</strong> due to severe or repeated violations.</p>`
          }
          <div style="text-align:center;margin:24px 0;">
            ${ctaButton('Submit an Appeal')}
            ${ctaButton('Request Data Export')}
            ${ctaButton('Contact Trust & Safety')}
          </div>
          <p><strong>The Briteside Trust & Safety Team</strong></p>
        </div>
        ${footer(`Suspension notice issued on ${suspension_date}.<br/><a href="#">Submit appeal</a> | <a href="#">Request data</a> | <a href="#">Contact support</a>`)}
      </div>`,
  },

  accountReinstated: {
    id: 'account-reinstated',
    subject: () => 'Welcome back! Your Briteside account has been reinstated',
    html: ({ user_name, user_email, reinstatement_date, appeal_approved }) => `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        ${header}
        <div style="padding:30px 20px;">
          <p>Hi ${user_name},</p>
          <h2 style="color:#27ae60;">Welcome back to Briteside! 🎉</h2>
          <div style="background:#e8f5e9;border-radius:6px;padding:16px;margin:16px 0;">
            <div>👤 <strong>Account:</strong> ${user_email}</div>
            <div>📅 <strong>Reinstated on:</strong> ${reinstatement_date}</div>
            <div>✅ <strong>Reason:</strong> ${appeal_approved ? 'Appeal approved' : 'Suspension period completed'}</div>
          </div>
          <p>You now have full access to your Briteside account. All previously hidden content has been restored.</p>
          <div style="text-align:center;margin:24px 0;">
            ${ctaButton('Log In to Your Account')}
            ${ctaButton('Review Community Guidelines')}
          </div>
          <p>We're glad to have you back!<br/><strong>The Briteside Trust & Safety Team</strong></p>
        </div>
        ${footer(`Account reinstated on ${reinstatement_date}.<br/><a href="#">View community guidelines</a> | <a href="#">Contact support</a>`)}
      </div>`,
  },

  permanentSuspension: {
    id: 'permanent-suspension',
    subject: () => 'Your Briteside account has been permanently suspended',
    html: ({
      user_name,
      user_email,
      suspension_date,
      suspension_reason,
      severe_violations = [],
      violation_history = [],
      has_pending_refunds,
    }) => `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        ${header}
        <div style="padding:30px 20px;">
          <p>Hi ${user_name},</p>
          <h2 style="color:#c0392b;">Permanent Account Suspension</h2>
          <div style="background:#fff3f3;border-radius:6px;padding:16px;margin:16px 0;">
            <div>👤 <strong>Account:</strong> ${user_email}</div>
            <div>🚫 <strong>Status:</strong> Permanently Suspended</div>
            <div>📅 <strong>Effective Date:</strong> ${suspension_date}</div>
          </div>
          <p><strong>Reason:</strong> ${suspension_reason}</p>
          ${severe_violations.length ? `<ul>${severe_violations.map(v => `<li>${v.description}</li>`).join('')}</ul>` : ''}
          ${
            violation_history.length
              ? `
          <p><strong>Violation History:</strong></p>
          <ul>${violation_history.map(v => `<li>${v.date} – ${v.type}: ${v.description}</li>`).join('')}</ul>`
              : ''
          }
          ${
            has_pending_refunds
              ? `<p>💰 Any eligible refunds for upcoming paid events or bookings will be processed within 10 business days.</p>`
              : ''
          }
          <p>You may submit one final appeal within 30 days. You also have 30 days to request a copy of your personal data before it is permanently deleted.</p>
          <div style="text-align:center;margin:24px 0;">
            ${ctaButton('Submit Final Appeal')}
            ${ctaButton('Request Data Export')}
            ${ctaButton('Contact Trust & Safety')}
          </div>
          <p><strong>The Briteside Trust & Safety Team</strong></p>
        </div>
        ${footer(`Permanent suspension notice issued on ${suspension_date}.<br/><a href="#">Submit appeal</a> | <a href="#">Request data</a> | <a href="#">Contact support</a>`)}
      </div>`,
  },
};

// ─── Notifications ───────────────────────────────────────────────────────────

export const notificationTemplates = {
  priorityMessageRequest: {
    id: 'priority-message-request',
    subject: ({ sender_name }) => `${sender_name} wants to send you a priority message`,
    html: ({ user_name, sender_name, sender_bio, sender_followers, sender_mutual_connections }) => `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        ${header}
        <div style="padding:30px 20px;">
          <p>Hi ${user_name},</p>
          <h2 style="color:#333;">New Priority Message Request! 📩</h2>
          <p><strong>${sender_name}</strong> would like to send you a priority message.</p>
          <div style="background:#f8f8f8;border-radius:6px;padding:16px;margin:16px 0;">
            <p style="margin:0 0 8px;">${sender_bio}</p>
            <div>👥 ${sender_followers} followers</div>
            <div>✨ ${sender_mutual_connections} mutual connections</div>
          </div>
          <p>Priority messages ensure your message gets noticed. ${sender_name} has paid a fee to contact you, showing they value your time.</p>
          <div style="text-align:center;margin:24px 0;">
            ${ctaButton('Accept Request')}
            ${ctaButton('Decline')}
            ${ctaButton('View Profile')}
          </div>
          <p style="font-size:13px;color:#666;">This request will expire in 48 hours.</p>
          <p><strong>The Briteside Team</strong></p>
        </div>
        ${footer(`Priority message request from ${sender_name}.<br/><a href="#">Manage message settings</a> | <a href="#">Block this user</a>`)}
      </div>`,
  },

  priorityMessage: {
    id: 'priority-message',
    subject: ({ sender_name }) => `You have a priority message from ${sender_name}`,
    html: ({ user_name, sender_name, message_content, message_time, message_date, sender_bio }) => `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        ${header}
        <div style="padding:30px 20px;">
          <p>Hi ${user_name},</p>
          <h2 style="color:#333;">You have a priority message! ⭐</h2>
          <p><strong>${sender_name}</strong> sent you a priority message:</p>
          <div style="border-left:3px solid #6c47ff;padding:12px 16px;background:#f8f8f8;border-radius:0 6px 6px 0;margin:16px 0;">
            <p style="margin:0;">${message_content}</p>
            <p style="margin:8px 0 0;font-size:12px;color:#666;">Sent: ${message_time}</p>
          </div>
          <div style="text-align:center;margin:24px 0;">
            ${ctaButton(`Reply to ${sender_name}`)}
            ${ctaButton('View Full Message')}
            ${ctaButton('View Profile')}
          </div>
          ${sender_bio ? `<p><strong>About ${sender_name}:</strong> ${sender_bio}</p>` : ''}
          <p><strong>The Briteside Team</strong></p>
        </div>
        ${footer(`Priority message received on ${message_date}.<br/><a href="#">Manage notifications</a> | <a href="#">Message settings</a>`)}
      </div>`,
  },

  notificationDigest: {
    id: 'notification-digest',
    subject: ({ week_start, week_end }) =>
      `Your weekly Briteside update (${week_start} – ${week_end})`,
    html: ({
      user_name,
      week_start,
      week_end,
      profile_views,
      new_followers,
      likes_received,
      comments_received,
      upcoming_events = [],
      trending_events = [],
      suggested_groups = [],
      suggested_users = [],
    }) => `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        ${header}
        <div style="padding:30px 20px;">
          <p>Hi ${user_name},</p>
          <h2 style="color:#333;">Your weekly Briteside digest! 📊</h2>
          <p><strong>Week of ${week_start} – ${week_end}</strong></p>

          <div style="background:#f8f8f8;border-radius:6px;padding:16px;margin:16px 0;">
            <strong>Your Activity</strong><br/>
            👁️ Profile views: ${profile_views}<br/>
            👥 New followers: ${new_followers}<br/>
            ❤️ Likes received: ${likes_received}<br/>
            💬 Comments received: ${comments_received}
          </div>

          ${
            upcoming_events.length
              ? `
          <p><strong>Upcoming Events (${upcoming_events.length}):</strong></p>
          <ul>${upcoming_events.map(e => `<li>📅 ${e.name} – ${e.date}</li>`).join('')}</ul>
          <div style="text-align:center;margin:12px 0;">${ctaButton('View All Events')}</div>`
              : ''
          }

          ${
            trending_events.length
              ? `
          <p><strong>Trending in Your Area:</strong></p>
          <ul>${trending_events.map(e => `<li>🔥 ${e.name} – ${e.attendees} attending</li>`).join('')}</ul>
          <div style="text-align:center;margin:12px 0;">${ctaButton('Explore Trending Events')}</div>`
              : ''
          }

          ${
            suggested_groups.length
              ? `
          <p><strong>Groups You Might Like:</strong></p>
          <ul>${suggested_groups.map(g => `<li>👥 ${g.name} – ${g.members} members</li>`).join('')}</ul>
          <div style="text-align:center;margin:12px 0;">${ctaButton('Discover Groups')}</div>`
              : ''
          }

          ${
            suggested_users.length
              ? `
          <p><strong>People to Follow:</strong></p>
          <ul>${suggested_users.map(u => `<li>✨ ${u.name} – ${u.followers} followers</li>`).join('')}</ul>
          <div style="text-align:center;margin:12px 0;">${ctaButton('Find More People')}</div>`
              : ''
          }

          <p>Have a great week!<br/><strong>The Briteside Team</strong></p>
        </div>
        ${footer(`Weekly digest for ${week_start} – ${week_end}.<br/><a href="#">Manage digest preferences</a> | <a href="#">Unsubscribe from digest</a>`)}
      </div>`,
  },

  abandonedCart: {
    id: 'abandoned-cart',
    subject: ({ event_name }) => `You left tickets in your cart! – ${event_name}`,
    html: ({
      user_name,
      ticket_quantity,
      ticket_type,
      event_name,
      event_location,
      event_date,
      event_time,
      cart_items = [],
      subtotal,
      fees,
      total,
      remaining_tickets,
      low_stock,
      event_description,
      reminder_date,
    }) => `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        ${header}
        <div style="padding:30px 20px;">
          <p>Hi ${user_name},</p>
          <h2 style="color:#333;">Your cart is waiting! 🎟️</h2>
          <p>We noticed you left some amazing tickets in your cart. Don't let them slip away.</p>
          <div style="background:#f8f8f8;border-radius:6px;padding:16px;margin:16px 0;">
            <div>🎟️ <strong>${ticket_quantity}x ${ticket_type} tickets</strong></div>
            <div>📅 <strong>${event_name}</strong></div>
            <div>📍 ${event_location}</div>
            <div>🗓️ ${event_date} at ${event_time}</div>
          </div>
          <div style="background:#fff;border:1px solid #eee;border-radius:6px;padding:16px;margin:16px 0;font-size:14px;">
            ${cart_items.map(item => `<div>${item.quantity}x ${item.ticket_type} – ${item.price}</div>`).join('')}
            <hr style="border:none;border-top:1px solid #eee;margin:8px 0;"/>
            <div>Subtotal: ${subtotal}</div>
            <div>Fees: ${fees}</div>
            <div><strong>TOTAL: ${total}</strong></div>
          </div>
          ${low_stock ? `<p style="color:#c0392b;font-weight:bold;">⚠️ Only ${remaining_tickets} tickets left at this price!</p>` : ''}
          <div style="text-align:center;margin:24px 0;">
            ${ctaButton('Complete My Purchase')}
          </div>
          ${event_description ? `<p>${event_description}</p>` : ''}
          <p>See you at the event!<br/><strong>The Briteside Events Team</strong></p>
        </div>
        ${footer(`Cart reminder sent on ${reminder_date}.<br/><a href="#">Browse more events</a> | <a href="#">Unsubscribe from cart reminders</a>`)}
      </div>`,
  },
};
