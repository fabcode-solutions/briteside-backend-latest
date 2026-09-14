const EMAIL_HEADER = `┌─────────────────────────────────┐
│         [BRITESIDE LOGO]        │
│        www.briteside.app        │
└─────────────────────────────────┘

`;

const emailTemplates = [
  {
    id: 'welcome',
    name: 'Welcome Email',
    description: 'Sent to new users upon successful registration',
    category: 'Onboarding',
    icon: UserPlus,
    subject: 'Welcome to Briteside! 🎉',
    preview:
      "Thank you for joining Briteside. We're excited to have you as part of our community...",
    body:
      EMAIL_HEADER +
      `Hi {{user_name}},

Welcome to Briteside! 🎉

We're thrilled to have you join our community of event enthusiasts, creators, and like-minded individuals.

Here's what you can do on Briteside:

• Discover Events - Find amazing events happening near you
• Join Groups - Connect with people who share your interests
• Book 1:1 Sessions - Get personalized time with your favorite creators
• Create & Share - Post updates and engage with the community

Ready to get started? Here are some quick actions:

[Browse Events] [Find Groups] [Complete Your Profile]

If you have any questions, our support team is always here to help.

Welcome aboard!

The Briteside Team

---
You received this email because you signed up for Briteside.
Manage your email preferences | Unsubscribe`,
  },
  {
    id: 'email-verification',
    name: 'Email Verification',
    description: 'Verify user email address during signup',
    category: 'Authentication',
    icon: ShieldCheck,
    subject: 'Verify your email address',
    preview:
      'Please click the link below to verify your email address and complete your registration...',
    body:
      EMAIL_HEADER +
      `Hi {{user_name}},

Thanks for signing up for Briteside!

Please verify your email address by clicking the button below:

[Verify Email Address]

This link will expire in 24 hours.

If you didn't create an account with Briteside, you can safely ignore this email.

For security, this request was received from:
• IP Address: {{ip_address}}
• Location: {{location}}
• Time: {{timestamp}}

Thanks,
The Briteside Team

---
This is an automated message. Please do not reply directly to this email.`,
  },
  {
    id: 'password-reset',
    name: 'Password Reset',
    description: 'Sent when a user requests to reset their password',
    category: 'Authentication',
    icon: ShieldCheck,
    subject: 'Reset your password',
    preview:
      'We received a request to reset your password. Click the link below to create a new password...',
    body:
      EMAIL_HEADER +
      `Hi {{user_name}},

We received a request to reset your password for your Briteside account.

Click the button below to create a new password:

[Reset Password]

This link will expire in 1 hour for security reasons.

If you didn't request a password reset, please ignore this email or contact our support team if you have concerns about your account security.

For security, this request was received from:
• IP Address: {{ip_address}}
• Location: {{location}}
• Time: {{timestamp}}

Stay safe,
The Briteside Security Team

---
This is an automated security message. Please do not reply directly to this email.`,
  },
  {
    id: 'event-registration',
    name: 'Event Registration Confirmation',
    description: 'Confirms successful registration for a free event',
    category: 'Events',
    icon: Calendar,
    subject: "You're registered for {{event_name}}!",
    preview:
      "You're all set! Your registration for {{event_name}} has been confirmed. We look forward to seeing you...",
    body:
      EMAIL_HEADER +
      `Hi {{user_name}},

You're all set! 🎉

Your registration for {{event_name}} has been confirmed.

[EVENT COVER IMAGE]
┌─────────────────────────────────┐
│                                 │
│      {{event_cover_image}}      │
│                                 │
└─────────────────────────────────┘

EVENT DETAILS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📅 Date: {{event_date}}
🕐 Time: {{event_time}}
📍 Location: {{event_location}}
👤 Organizer: {{organizer_name}}

WHAT TO BRING
• Your confirmation email or QR code
• Valid ID for check-in
• Any items mentioned in the event description

[View Event Details] [Add to Calendar] [Get Directions]

NEED TO MAKE CHANGES?
You can manage your registration or cancel at any time from your Briteside account.

We look forward to seeing you there!

The Briteside Team

---
You registered for this event on {{registration_date}}.
Manage your bookings | Contact organizer`,
  },
  {
    id: 'ticket-purchase',
    name: 'Ticket Purchase Confirmation',
    description: 'Confirms successful ticket purchase for a paid event',
    category: 'Events',
    icon: Ticket,
    subject: 'Your ticket for {{event_name}}',
    preview:
      'Thank you for your purchase! Your ticket for {{event_name}} is attached. Order total: {{amount}}...',
    body:
      EMAIL_HEADER +
      `Hi {{user_name}},

Thank you for your purchase! 🎟️

Your ticket for {{event_name}} is confirmed.

ORDER SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Order #: {{order_number}}
Ticket Type: {{ticket_type}}
Quantity: {{quantity}}
Subtotal: {{subtotal}}
Fees: {{fees}}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total: {{amount}}

Payment Method: {{payment_method}} ending in {{card_last_four}}

EVENT DETAILS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📅 Date: {{event_date}}
🕐 Time: {{event_time}}
📍 Location: {{event_location}}
👤 Organizer: {{organizer_name}}

YOUR TICKET
[View Ticket] [Download PDF] [Add to Wallet]

Show the QR code below at the event entrance for quick check-in.

[QR CODE]

REFUND POLICY
{{refund_policy}}

Questions? Contact the event organizer or our support team.

The Briteside Team

---
Receipt for order #{{order_number}} placed on {{purchase_date}}.
View order details | Contact support`,
  },
  {
    id: 'event-reminder-week',
    name: 'Event Reminder (1 Week)',
    description: 'Sent 1 week before the event starts',
    category: 'Events',
    icon: Calendar,
    subject: '{{event_name}} is coming up next week!',
    preview:
      'Just a heads up! {{event_name}} is happening in one week on {{event_date}}. Make sure to mark your calendar...',
    body:
      EMAIL_HEADER +
      `Hi {{user_name}},

Just a friendly reminder! 📅

{{event_name}} is happening in ONE WEEK!

EVENT DETAILS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📅 Date: {{event_date}}
🕐 Time: {{event_time}}
📍 Location: {{event_location}}

PREPARE FOR THE EVENT
✓ Save the date to your calendar
✓ Check the event details for any updates
✓ Plan your transportation
✓ Review what to bring

[View Event Details] [Add to Calendar] [Get Directions]

INVITE FRIENDS
Know someone who'd love this event? Share it with them!

[Share Event]

We can't wait to see you there!

The Briteside Team

---
You're registered for this event.
Manage your registration | Contact organizer`,
  },
  {
    id: 'event-reminder',
    name: 'Event Reminder (24 Hours)',
    description: 'Sent 24 hours before the event starts',
    category: 'Events',
    icon: Calendar,
    subject: 'Reminder: {{event_name}} is tomorrow!',
    preview:
      "Don't forget! {{event_name}} is happening tomorrow at {{event_time}}. Here's what you need to know...",
    body:
      EMAIL_HEADER +
      `Hi {{user_name}},

This is it! {{event_name}} is TOMORROW! 🎉

EVENT DETAILS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📅 Date: {{event_date}}
🕐 Time: {{event_time}}
📍 Location: {{event_location}}
🚪 Doors Open: {{doors_open_time}}

DON'T FORGET TO BRING
• Your ticket or confirmation QR code
• Valid ID for check-in
• {{additional_items}}

GETTING THERE
{{directions}}

[View Your Ticket] [Get Directions] [Contact Organizer]

LAST-MINUTE UPDATES
Check the event page for any final announcements from the organizer.

See you tomorrow!

The Briteside Team

---
You're registered for this event.
View event details | Manage your registration`,
  },
  {
    id: 'booking-confirmation',
    name: 'Booking Confirmation',
    description: 'Confirms 1:1 video chat booking with a creator',
    category: 'Bookings',
    icon: MessageSquare,
    subject: 'Your 1:1 session with {{creator_name}} is confirmed',
    preview:
      'Great news! Your 1:1 video chat session with {{creator_name}} has been confirmed for {{date_time}}...',
    body:
      EMAIL_HEADER +
      `Hi {{user_name}},

Great news! Your 1:1 session is confirmed! 🎥

SESSION DETAILS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 Creator: {{creator_name}}
📅 Date: {{session_date}}
🕐 Time: {{session_time}} ({{timezone}})
⏱️ Duration: {{duration}} minutes
💰 Amount Paid: {{amount}}

HOW TO JOIN
You'll receive a link to join the video call 10 minutes before your session starts.

[Add to Calendar]

PREPARE FOR YOUR SESSION
• Test your camera and microphone beforehand
• Find a quiet, well-lit space
• Prepare any questions you'd like to ask
• Join a few minutes early to ensure everything works

CANCELLATION POLICY
{{cancellation_policy}}

Need to reschedule? You can manage your booking from your account.

[Manage Booking] [Contact {{creator_name}}]

Looking forward to your session!

The Briteside Team

---
Booking confirmation for session on {{session_date}}.
View your bookings | Get help`,
  },
  {
    id: 'booking-reminder',
    name: 'Booking Reminder',
    description: 'Sent 1 hour before scheduled 1:1 session',
    category: 'Bookings',
    icon: Bell,
    subject: 'Your session with {{creator_name}} starts in 1 hour',
    preview:
      'Get ready! Your 1:1 video chat with {{creator_name}} begins in 1 hour. Click below to join...',
    body:
      EMAIL_HEADER +
      `Hi {{user_name}},

Your 1:1 session starts in 1 HOUR! ⏰

SESSION DETAILS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 Creator: {{creator_name}}
🕐 Time: {{session_time}} ({{timezone}})
⏱️ Duration: {{duration}} minutes

QUICK CHECKLIST
✓ Camera working?
✓ Microphone working?
✓ Stable internet connection?
✓ Quiet environment?

[Join Session Now]

The session link will be active 10 minutes before the scheduled time.

NEED HELP?
If you're having technical difficulties, please contact our support team immediately.

[Get Technical Help]

See you soon!

The Briteside Team

---
This is a reminder for your upcoming session.
View booking details | Contact support`,
  },
  {
    id: 'booking-cancellation',
    name: 'Booking Cancellation',
    description: 'Notifies when a 1:1 session has been cancelled',
    category: 'Bookings',
    icon: MessageSquare,
    subject: 'Your session with {{creator_name}} has been cancelled',
    preview:
      'Unfortunately, your 1:1 session with {{creator_name}} scheduled for {{date_time}} has been cancelled. A refund will be processed...',
    body:
      EMAIL_HEADER +
      `Hi {{user_name}},

We're sorry to inform you that your 1:1 session has been cancelled.

CANCELLED SESSION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 Creator: {{creator_name}}
📅 Originally Scheduled: {{session_date}} at {{session_time}}
❌ Cancelled by: {{cancelled_by}}
📝 Reason: {{cancellation_reason}}

REFUND INFORMATION
A full refund of {{amount}} will be processed to your original payment method within 5-10 business days.

Refund Reference: {{refund_reference}}

WHAT'S NEXT?
Would you like to book another session with {{creator_name}} or explore other creators?

[Book New Session] [Browse Creators]

We apologize for any inconvenience this may have caused.

The Briteside Team

---
Cancellation notice for session originally scheduled on {{session_date}}.
View refund status | Contact support`,
  },
  {
    id: 'booking-rescheduled',
    name: 'Booking Rescheduled',
    description: 'Notifies when a 1:1 session has been moved to a new time',
    category: 'Bookings',
    icon: MessageSquare,
    subject: 'Your session with {{creator_name}} has been rescheduled',
    preview:
      'Your 1:1 session with {{creator_name}} has been moved from {{old_time}} to {{new_time}}. Please update your calendar...',
    body:
      EMAIL_HEADER +
      `Hi {{user_name}},

Your 1:1 session has been rescheduled.

UPDATED SESSION DETAILS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 Creator: {{creator_name}}

❌ Original Time:
   {{old_date}} at {{old_time}}

✅ New Time:
   {{new_date}} at {{new_time}} ({{timezone}})

⏱️ Duration: {{duration}} minutes

📝 Reason for change: {{reschedule_reason}}

PLEASE CONFIRM
Please update your calendar with the new time.

[Add to Calendar] [Confirm New Time]

CAN'T MAKE THE NEW TIME?
If the new time doesn't work for you, you can request a different time or cancel for a full refund.

[Request Different Time] [Cancel Booking]

Thank you for your understanding!

The Briteside Team

---
Schedule change notice for your session with {{creator_name}}.
View booking details | Contact support`,
  },
  {
    id: 'payment-receipt',
    name: 'Payment Receipt',
    description: 'Sent after successful payment for any purchase',
    category: 'Payments',
    icon: CreditCard,
    subject: 'Receipt for your purchase',
    preview: "Thank you for your purchase! Here's your receipt for {{amount}} paid on {{date}}...",
    body:
      EMAIL_HEADER +
      `Hi {{user_name}},

Thank you for your purchase! 💳

RECEIPT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Receipt #: {{receipt_number}}
Date: {{purchase_date}}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ITEMS
{{item_name}}
   Qty: {{quantity}} × {{unit_price}}     {{line_total}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Subtotal:                          {{subtotal}}
Service Fee:                       {{service_fee}}
Tax:                               {{tax}}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TOTAL:                             {{amount}}

PAYMENT METHOD
{{payment_method}} ending in {{card_last_four}}

BILLING ADDRESS
{{billing_name}}
{{billing_address}}

[Download PDF Receipt] [View Order Details]

Questions about this charge? Contact our support team.

Thank you for using Briteside!

The Briteside Team

---
Receipt for transaction on {{purchase_date}}.
View transaction history | Contact support`,
  },
  {
    id: 'refund-confirmation',
    name: 'Refund Confirmation',
    description: 'Confirms when a ticket refund has been processed',
    category: 'Payments',
    icon: CreditCard,
    subject: 'Your refund has been processed',
    preview:
      'Your refund of {{amount}} for {{event_name}} has been processed. Please allow 5-10 business days for the funds to appear...',
    body:
      EMAIL_HEADER +
      `Hi {{user_name}},

Good news! Your refund has been processed. 💰

REFUND DETAILS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Refund Reference: {{refund_reference}}
Original Order: #{{order_number}}
Refund Amount: {{amount}}
Refund Date: {{refund_date}}

ORIGINAL PURCHASE
{{item_name}}
Purchased on: {{original_purchase_date}}
Reason for refund: {{refund_reason}}

WHEN WILL I RECEIVE MY REFUND?
The refund has been sent to your original payment method:
{{payment_method}} ending in {{card_last_four}}

Please allow 5-10 business days for the funds to appear in your account. The exact timing depends on your bank or card issuer.

REFUND BREAKDOWN
Original Amount:                   {{original_amount}}
Amount Refunded:                   {{amount}}
Non-refundable Fees:               {{non_refundable_fees}}

[View Refund Status]

If you don't see the refund after 10 business days, please contact our support team.

Thank you for your patience!

The Briteside Team

---
Refund confirmation for order #{{order_number}}.
View transaction history | Contact support`,
  },
  {
    id: 'group-invitation',
    name: 'Group Invitation',
    description: 'Invite users to join a private group',
    category: 'Groups',
    icon: UserPlus,
    subject: "You've been invited to join {{group_name}}",
    preview:
      "{{inviter_name}} has invited you to join the group '{{group_name}}'. Click below to accept...",
    body:
      EMAIL_HEADER +
      `Hi {{user_name}},

You've been invited to join a group! 👥

{{inviter_name}} thinks you'd be a great addition to:

{{group_name}}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{{group_description}}

👥 {{member_count}} members
📍 {{group_location}}
🏷️ {{group_category}}

PERSONAL MESSAGE FROM {{inviter_name}}
"{{personal_message}}"

[Accept Invitation] [View Group] [Decline]

WHAT YOU'LL GET
• Connect with like-minded people
• Access to exclusive group discussions
• Invitations to group events
• A supportive community

This invitation will expire in 7 days.

The Briteside Team

---
Invitation sent by {{inviter_name}} on {{invite_date}}.
Manage invitations | Block invitations from this user`,
  },
  {
    id: 'event-invitation',
    name: 'Event Invitation',
    description: 'Invite users to attend an upcoming event',
    category: 'Events',
    icon: Calendar,
    subject: "You're invited to {{event_name}}!",
    preview:
      "{{inviter_name}} thinks you'd love {{event_name}}! Join them on {{event_date}} at {{event_location}}...",
    body:
      EMAIL_HEADER +
      `Hi {{user_name}},

You're invited! 🎉

{{inviter_name}} thinks you'd love this event:

{{event_name}}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📅 Date: {{event_date}}
🕐 Time: {{event_time}}
📍 Location: {{event_location}}
🎟️ Price: {{ticket_price}}

{{event_description}}

PERSONAL MESSAGE FROM {{inviter_name}}
"{{personal_message}}"

[View Event] [Register Now] [Maybe Later]

WHO ELSE IS GOING?
{{attending_friends_count}} of your connections are attending this event.

Don't miss out – spots are filling up fast!

The Briteside Team

---
Invitation sent by {{inviter_name}}.
Manage invitations | Event details`,
  },
  {
    id: 'event-cancellation',
    name: 'Event Cancellation',
    description: 'Notifies attendees when an event has been cancelled',
    category: 'Events',
    icon: Calendar,
    subject: '{{event_name}} has been cancelled',
    preview:
      "We're sorry to inform you that {{event_name}} scheduled for {{event_date}} has been cancelled. If you purchased a ticket, a refund will be processed...",
    body:
      EMAIL_HEADER +
      `Hi {{user_name}},

We're sorry to inform you that the following event has been cancelled:

{{event_name}}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📅 Originally Scheduled: {{event_date}} at {{event_time}}
📍 Location: {{event_location}}

REASON FOR CANCELLATION
{{cancellation_reason}}

MESSAGE FROM THE ORGANIZER
"{{organizer_message}}"

REFUND INFORMATION
{{#if paid_event}}
Your ticket purchase of {{amount}} will be automatically refunded to your original payment method within 5-10 business days.

Refund Reference: {{refund_reference}}
{{else}}
As this was a free event, no refund is necessary.
{{/if}}

FIND SIMILAR EVENTS
Don't let this dampen your spirits! Check out these similar events:

[Browse Similar Events]

We apologize for any inconvenience this may have caused.

The Briteside Team

---
Cancellation notice for {{event_name}}.
View refund status | Contact organizer | Browse events`,
  },
  {
    id: 'event-rescheduled',
    name: 'Event Rescheduled',
    description: 'Notifies attendees when an event date or time has changed',
    category: 'Events',
    icon: Calendar,
    subject: '{{event_name}} has been rescheduled',
    preview:
      'Important update: {{event_name}} has been rescheduled from {{old_date}} to {{new_date}}. Your registration remains valid...',
    body:
      EMAIL_HEADER +
      `Hi {{user_name}},

Important update about an event you're attending:

{{event_name}} HAS BEEN RESCHEDULED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

❌ Original Date & Time:
   {{old_date}} at {{old_time}}

✅ New Date & Time:
   {{new_date}} at {{new_time}}

📍 Location: {{event_location}} (unchanged)

REASON FOR CHANGE
{{reschedule_reason}}

MESSAGE FROM THE ORGANIZER
"{{organizer_message}}"

YOUR REGISTRATION
Good news! Your registration is still valid for the new date. No action is required unless you need to cancel.

[Update Calendar] [View Event Details]

CAN'T MAKE THE NEW DATE?
If you can no longer attend, you can cancel your registration and receive a full refund.

[Cancel & Get Refund]

Thank you for your understanding!

The Briteside Team

---
Schedule change notice for {{event_name}}.
View event details | Contact organizer`,
  },
  {
    id: 'priority-message-request',
    name: 'Priority Message Request',
    description: 'Notifies users when someone requests to send them a priority message',
    category: 'Notifications',
    icon: MessageSquare,
    subject: '{{sender_name}} wants to send you a priority message',
    preview:
      '{{sender_name}} has requested to send you a priority message. Accept or decline this request to continue...',
    body:
      EMAIL_HEADER +
      `Hi {{user_name}},

You have a new priority message request! 📩

{{sender_name}} would like to send you a priority message.

ABOUT {{sender_name}}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{{sender_bio}}

👥 {{sender_followers}} followers
✨ {{sender_mutual_connections}} mutual connections

REQUEST DETAILS
Priority messages ensure your message gets noticed. {{sender_name}} has paid a fee to send you this priority message, showing they value your time.

[Accept Request] [Decline] [View Profile]

WHAT HAPPENS NEXT?
• Accept: {{sender_name}} can send their message, and you'll receive a notification
• Decline: The request is cancelled and {{sender_name}} is refunded

This request will expire in 48 hours.

The Briteside Team

---
Priority message request from {{sender_name}}.
Manage message settings | Block this user`,
  },
  {
    id: 'priority-message',
    name: 'Priority Message Reply',
    description: 'Notifies users when they receive a priority message requiring attention',
    category: 'Notifications',
    icon: MessageSquare,
    subject: 'You have a priority message from {{sender_name}}',
    preview:
      '{{sender_name}} sent you a priority message that needs your attention: "{{message_preview}}" Click below to reply...',
    body:
      EMAIL_HEADER +
      `Hi {{user_name}},

You have a priority message! ⭐

{{sender_name}} sent you a priority message:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"{{message_content}}"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Sent: {{message_time}}

[Reply to {{sender_name}}] [View Full Message]

ABOUT PRIORITY MESSAGES
Priority messages are from users who paid a fee to ensure their message reaches you. This indicates they value connecting with you.

You can reply at no cost to you.

ABOUT {{sender_name}}
{{sender_bio}}

[View Profile]

The Briteside Team

---
Priority message received on {{message_date}}.
Manage notifications | Message settings`,
  },
  {
    id: 'notification-digest',
    name: 'Notification Digest',
    description: 'Weekly summary of activity and notifications',
    category: 'Notifications',
    icon: Bell,
    subject: 'Your weekly Briteside update',
    preview:
      "Here's what you missed this week: {{new_events}} new events, {{new_followers}} new followers...",
    body:
      EMAIL_HEADER +
      `Hi {{user_name}},

Here's your weekly Briteside digest! 📊

WEEK OF {{week_start}} - {{week_end}}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

YOUR ACTIVITY
👁️ Profile views: {{profile_views}}
👥 New followers: {{new_followers}}
❤️ Likes received: {{likes_received}}
💬 Comments received: {{comments_received}}

UPCOMING EVENTS
You have {{upcoming_events_count}} events coming up:

{{#each upcoming_events}}
📅 {{this.name}} - {{this.date}}
{{/each}}

[View All Events]

TRENDING IN YOUR AREA
{{#each trending_events}}
🔥 {{this.name}} - {{this.attendees}} attending
{{/each}}

[Explore Trending Events]

GROUPS YOU MIGHT LIKE
Based on your interests:
{{#each suggested_groups}}
👥 {{this.name}} - {{this.members}} members
{{/each}}

[Discover Groups]

PEOPLE TO FOLLOW
{{#each suggested_users}}
✨ {{this.name}} - {{this.followers}} followers
{{/each}}

[Find More People]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Have a great week!

The Briteside Team

---
Weekly digest for {{week_start}} - {{week_end}}.
Manage digest preferences | Unsubscribe from digest`,
  },
  {
    id: 'community-guidelines-violation',
    name: 'Community Guidelines Violation',
    description: "Sent when a user's post violates community guidelines",
    category: 'Moderation',
    icon: ShieldCheck,
    subject: 'Important: Your post has been removed',
    preview:
      'Your recent post has been removed for violating our community guidelines. Please review our policies...',
    body:
      EMAIL_HEADER +
      `Hi {{user_name}},

We're reaching out because your recent post on Briteside has been removed for violating our Community Guidelines.

POST REMOVED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 Post Content: "{{post_excerpt}}..."
📅 Posted on: {{post_date}}
🚫 Violation Type: {{violation_type}}

POLICY VIOLATED
{{policy_description}}

WHY THIS MATTERS
Our community guidelines exist to keep Briteside a safe, welcoming, and respectful space for everyone. We take these policies seriously to protect all members of our community.

WHAT HAPPENS NEXT
{{#if first_offense}}
This is your first violation. We understand that mistakes happen, and we encourage you to review our Community Guidelines to avoid future issues.
{{else}}
This is your {{offense_count}} violation. Continued violations may result in:
• Temporary suspension of your account
• Permanent removal from the platform
{{/if}}

[Review Community Guidelines]

APPEAL THIS DECISION
If you believe this removal was made in error, you can submit an appeal within 7 days.

[Submit an Appeal]

We're here to help if you have questions about our policies or need clarification on what content is allowed.

Thank you for helping us maintain a positive community.

The Briteside Trust & Safety Team

---
Violation notice issued on {{notice_date}}.
Review guidelines | Submit appeal | Contact support`,
  },
  {
    id: 'appeal-approved',
    name: 'Appeal Decision - Approved',
    description: "Sent when a user's content appeal is approved",
    category: 'Moderation',
    icon: ShieldCheck,
    subject: 'Good news: Your appeal has been approved',
    preview:
      "We've reviewed your appeal and decided to restore your content. Thank you for your patience...",
    body:
      EMAIL_HEADER +
      `Hi {{user_name}},

Good news! We've reviewed your appeal, and your content has been restored. ✅

APPEAL DECISION: APPROVED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 Original Post: "{{post_excerpt}}..."
📅 Appeal Submitted: {{appeal_date}}
✅ Decision Date: {{decision_date}}
🔍 Reviewed by: Briteside Trust & Safety Team

OUR FINDINGS
After a thorough review, we determined that your content does not violate our Community Guidelines. We apologize for any inconvenience this may have caused.

{{review_notes}}

WHAT HAPPENS NOW
• Your post has been restored and is now visible to the community
• Any restrictions placed on your account have been lifted
• This incident will not count against your account standing

[View Your Restored Post]

WE VALUE YOUR FEEDBACK
Your appeal helped us improve our moderation process. If you have additional feedback about this experience, we'd love to hear from you.

[Share Feedback]

Thank you for your patience and for being part of the Briteside community.

The Briteside Trust & Safety Team

---
Appeal decision issued on {{decision_date}}.
View community guidelines | Contact support`,
  },
  {
    id: 'appeal-denied',
    name: 'Appeal Decision - Denied',
    description: "Sent when a user's content appeal is denied",
    category: 'Moderation',
    icon: ShieldCheck,
    subject: 'Update on your appeal',
    preview:
      "We've completed our review of your appeal. After careful consideration, we've upheld our original decision...",
    body:
      EMAIL_HEADER +
      `Hi {{user_name}},

We've completed our review of your appeal.

APPEAL DECISION: DENIED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 Original Post: "{{post_excerpt}}..."
📅 Appeal Submitted: {{appeal_date}}
❌ Decision Date: {{decision_date}}
🔍 Reviewed by: Briteside Trust & Safety Team

OUR DECISION
After careful review by our Trust & Safety team, we've determined that our original decision was correct. Your content violated the following policy:

POLICY VIOLATED
{{policy_name}}
{{policy_description}}

WHY THIS DECISION STANDS
{{detailed_explanation}}

WHAT THIS MEANS FOR YOUR ACCOUNT
{{#if warning_only}}
This violation remains on your account record. Please review our Community Guidelines to avoid future issues.
{{else}}
{{account_status_update}}
{{/if}}

[Review Community Guidelines]

UNDERSTANDING OUR POLICIES
We know this may be disappointing. Here are some resources to help you understand what content is allowed:

• Community Guidelines FAQ
• Content Policy Examples
• Best Practices for Posting

[View Help Center]

FURTHER QUESTIONS
While this decision is final for this specific appeal, our support team is available if you have questions about our policies.

[Contact Support]

Thank you for your understanding.

The Briteside Trust & Safety Team

---
Appeal decision issued on {{decision_date}}.
Review guidelines | Contact support`,
  },
  {
    id: 'account-suspension',
    name: 'Account Suspension Notice',
    description: "Sent when a user's account has been suspended",
    category: 'Moderation',
    icon: ShieldCheck,
    subject: 'Your Briteside account has been suspended',
    preview:
      'Your account has been temporarily suspended due to repeated violations of our Community Guidelines...',
    body:
      EMAIL_HEADER +
      `Hi {{user_name}},

We're writing to inform you that your Briteside account has been suspended.

ACCOUNT SUSPENSION NOTICE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 Account: {{user_email}}
🚫 Suspension Type: {{suspension_type}}
📅 Effective Date: {{suspension_date}}
⏱️ Duration: {{suspension_duration}}

REASON FOR SUSPENSION
{{suspension_reason}}

VIOLATION HISTORY
{{#each violations}}
• {{this.date}}: {{this.violation_type}}
{{/each}}

WHAT THIS MEANS
During your suspension, you will not be able to:
• Log in to your account
• Post content or comments
• Send or receive messages
• Attend or create events
• Access your groups

Your existing content will remain hidden until your suspension is lifted.

{{#if temporary}}
WHEN CAN I RETURN?
Your suspension will be automatically lifted on {{reinstatement_date}}. You will receive an email confirmation when your account is restored.
{{else}}
PERMANENT SUSPENSION
After careful review, we have determined that your account will be permanently suspended. This decision was made due to severe or repeated violations of our Community Guidelines.
{{/if}}

APPEAL THIS DECISION
If you believe this suspension was made in error, you may submit one appeal within 14 days.

[Submit an Appeal]

DOWNLOAD YOUR DATA
You can request a copy of your data even while suspended.

[Request Data Export]

QUESTIONS?
For questions about this suspension, please contact our Trust & Safety team.

[Contact Trust & Safety]

The Briteside Trust & Safety Team

---
Suspension notice issued on {{suspension_date}}.
Submit appeal | Request data | Contact support`,
  },
  {
    id: 'account-reinstated',
    name: 'Account Reinstated',
    description: "Sent when a user's account suspension has been lifted",
    category: 'Moderation',
    icon: ShieldCheck,
    subject: 'Welcome back! Your Briteside account has been reinstated',
    preview:
      'Great news! Your account suspension has been lifted and you can now access all Briteside features again...',
    body:
      EMAIL_HEADER +
      `Hi {{user_name}},

Welcome back to Briteside! 🎉

We're pleased to inform you that your account has been reinstated.

ACCOUNT REINSTATED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 Account: {{user_email}}
📅 Reinstated on: {{reinstatement_date}}
{{#if appeal_approved}}
✅ Reason: Appeal approved
{{else}}
✅ Reason: Suspension period completed
{{/if}}

WHAT THIS MEANS
You now have full access to your Briteside account, including:
• Posting content and comments
• Sending and receiving messages
• Attending and creating events
• Accessing your groups
• All previously hidden content has been restored

[Log In to Your Account]

MOVING FORWARD
We encourage you to review our Community Guidelines to ensure a positive experience for yourself and others on the platform.

[Review Community Guidelines]

IMPORTANT REMINDERS
• Your account standing has been noted
• Future violations may result in longer or permanent suspensions
• We're here to help if you have questions about our policies

NEED HELP?
If you experience any issues accessing your account or notice any missing content, please contact our support team.

[Contact Support]

We're glad to have you back in the community!

The Briteside Trust & Safety Team

---
Account reinstated on {{reinstatement_date}}.
View community guidelines | Contact support`,
  },
  {
    id: 'permanent-suspension',
    name: 'Permanent Account Suspension',
    description: "Sent when a user's account is permanently banned",
    category: 'Moderation',
    icon: ShieldCheck,
    subject: 'Your Briteside account has been permanently suspended',
    preview:
      'After careful review, we have made the decision to permanently suspend your Briteside account...',
    body:
      EMAIL_HEADER +
      `Hi {{user_name}},

We regret to inform you that your Briteside account has been permanently suspended.

PERMANENT SUSPENSION NOTICE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 Account: {{user_email}}
🚫 Status: Permanently Suspended
📅 Effective Date: {{suspension_date}}

REASON FOR PERMANENT SUSPENSION
{{suspension_reason}}

This decision was made after careful review due to:
{{#each severe_violations}}
• {{this.description}}
{{/each}}

VIOLATION HISTORY
Your account has accumulated the following violations:
{{#each violation_history}}
📅 {{this.date}} - {{this.type}}: {{this.description}}
{{/each}}

WHAT THIS MEANS
Your account access has been permanently revoked. You will no longer be able to:
• Access your Briteside account
• Create new accounts using this email address
• Post content, comments, or messages
• Attend or organize events
• Participate in groups or discussions

All your content has been removed from the platform.

APPEAL PROCESS
If you believe this decision was made in error, you may submit one final appeal within 30 days. Please note that permanent suspension appeals undergo extensive review and are only overturned in exceptional circumstances.

[Submit Final Appeal]

DOWNLOAD YOUR DATA
You have 30 days to request a copy of your personal data before it is permanently deleted.

[Request Data Export]

REFUNDS
{{#if pending_refunds}}
Any eligible refunds for upcoming paid events or bookings will be processed within 10 business days to your original payment method.
{{else}}
You have no pending transactions requiring refunds.
{{/if}}

QUESTIONS ABOUT THIS DECISION
For questions regarding this permanent suspension, you may contact our Trust & Safety team. Please note that this decision is final unless successfully appealed.

[Contact Trust & Safety]

The Briteside Trust & Safety Team

---
Permanent suspension notice issued on {{suspension_date}}.
Submit appeal | Request data | Contact support`,
  },
  {
    id: 'abandoned-cart',
    name: 'Abandoned Cart - Event Tickets',
    description: 'Sent when a user leaves tickets in their cart without completing purchase',
    category: 'Transactions',
    icon: ShoppingCart,
    subject: "You left tickets in your cart! Complete your purchase before they're gone",
    preview: "Don't miss out! You have tickets waiting in your cart for {{event_name}}...",
    body:
      EMAIL_HEADER +
      `Hi {{user_name}},

We noticed you left some amazing tickets in your cart! Don't let them slip away.

YOUR CART IS WAITING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎟️ {{ticket_quantity}}x {{ticket_type}} tickets
📅 {{event_name}}
📍 {{event_location}}
🗓️ {{event_date}} at {{event_time}}

CART SUMMARY
{{#each cart_items}}
• {{this.quantity}}x {{this.ticket_type}} - {{this.price}}
{{/each}}
───────────────────────────────
Subtotal: {{subtotal}}
Fees: {{fees}}
TOTAL: {{total}}

⏰ HURRY - LIMITED AVAILABILITY
{{#if low_stock}}
⚠️ Only {{remaining_tickets}} tickets left at this price!
{{/if}}

Tickets for popular events sell out fast. Complete your purchase now to secure your spot!

[Complete My Purchase]

WHY YOU'LL LOVE THIS EVENT
{{event_description}}

NEED HELP?
Having trouble completing your purchase? Our support team is here to help.

[Contact Support] | [View Event Details]

See you at the event!
The Briteside Events Team

---
Cart reminder sent on {{reminder_date}}.
Complete purchase | Browse more events | Unsubscribe from cart reminders`,
  },
  {
    id: 'group-fee-change',
    name: 'Group Membership Fee Change',
    description: 'Sent to group members when the membership fee is updated',
    category: 'Groups',
    icon: CreditCard,
    subject: 'Membership fee update for {{group_name}}',
    preview: "The membership fee for {{group_name}} is changing. Here's what you need to know...",
    body:
      EMAIL_HEADER +
      `Hi {{user_name}},

We're writing to let you know about an upcoming change to the membership fee for {{group_name}}.

MEMBERSHIP FEE UPDATE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👥 Group: {{group_name}}
📅 Effective Date: {{effective_date}}

PRICING CHANGE
Previous Fee: {{old_fee}}/{{billing_cycle}}
New Fee: {{new_fee}}/{{billing_cycle}}

{{#if price_increase}}
This represents a {{change_percentage}}% increase from your current rate.
{{else}}
Great news! This represents a {{change_percentage}}% decrease from your current rate.
{{/if}}

WHY THIS CHANGE?
{{fee_change_reason}}

WHAT THIS MEANS FOR YOU
{{#if grandfathered}}
✅ As a valued existing member, you'll continue paying {{old_fee}}/{{billing_cycle}} until {{grandfather_end_date}}.
{{else}}
Your next billing on {{next_billing_date}} will reflect the new fee of {{new_fee}}.
{{/if}}

YOUR OPTIONS
• Stay a Member - Continue enjoying all group benefits at the new rate
• Cancel Membership - You can cancel anytime before {{next_billing_date}}

[Manage My Membership]

WHAT'S INCLUDED
As a reminder, your membership includes:
{{#each membership_benefits}}
• {{this}}
{{/each}}

QUESTIONS?
If you have any questions about this change, please reach out to the group organizer or our support team.

[Contact Organizer] | [Contact Support]

Thank you for being part of {{group_name}}!
The Briteside Team

---
Fee change notification sent on {{notification_date}}.
Manage membership | View group | Unsubscribe`,
  },
  {
    id: 'virtual-event-registration',
    name: 'Virtual Event Registration Confirmation',
    description: 'Sent when a user registers for a virtual/online event',
    category: 'Events',
    icon: Calendar,
    subject: "You're registered for {{event_name}} 🎉",
    preview:
      "You're all set! Here's your access link and everything you need to join {{event_name}}...",
    body:
      EMAIL_HEADER +
      `Hi {{user_name}},

Great news! You're registered for an upcoming virtual event. 🎉

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 {{event_name}}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

EVENT DETAILS
📅 Date: {{event_date}}
🕐 Time: {{event_time}} ({{timezone}})
⏱️ Duration: {{event_duration}}
👤 Host: {{host_name}}

🔗 YOUR ACCESS LINK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[Join Virtual Event]
{{access_link}}

💡 Save this link - you'll need it to join the event!

BEFORE THE EVENT
• Test your audio and video
• Ensure a stable internet connection
• Join 5-10 minutes early
• Have questions ready for Q&A

{{#if requires_password}}
🔐 Event Password: {{event_password}}
{{/if}}

ABOUT THIS EVENT
{{event_description}}

WHAT TO EXPECT
{{#each event_agenda}}
• {{time}} - {{topic}}
{{/each}}

ADD TO YOUR CALENDAR
[Google Calendar] | [Apple Calendar] | [Outlook]

NEED HELP?
If you have trouble accessing the event, contact the host or our support team.

[Contact Host] | [Get Support]

See you there!
The Briteside Team

---
Registration confirmed on {{registration_date}}.
View event details | Manage registration | Unsubscribe`,
  },
  {
    id: 'virtual-event-reminder-1-week',
    name: 'Virtual Event Reminder - 1 Week',
    description: 'Sent to registered attendees 1 week before a virtual event',
    category: 'Events',
    icon: Bell,
    subject: '{{event_name}} is 1 week away! 📅',
    preview: "Your virtual event is coming up in 1 week. Here's everything you need to prepare...",
    body:
      EMAIL_HEADER +
      `Hi {{user_name}},

Just a friendly reminder - you're registered for an upcoming virtual event in 1 week!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 {{event_name}}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📅 Date: {{event_date}}
🕐 Time: {{event_time}} ({{timezone}})
⏱️ Duration: {{event_duration}}
👤 Host: {{host_name}}

🔗 YOUR ACCESS LINK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[Join Virtual Event]
{{access_link}}

{{#if requires_password}}
🔐 Event Password: {{event_password}}
{{/if}}

PREPARE FOR THE EVENT
Now's a great time to:
✅ Add the event to your calendar
✅ Test your audio and video setup
✅ Review the event agenda
✅ Prepare any questions for the Q&A

ABOUT THIS EVENT
{{event_description}}

ADD TO YOUR CALENDAR
[Google Calendar] | [Apple Calendar] | [Outlook]

CAN'T MAKE IT?
If your plans have changed, please cancel your registration so others can attend.

[Cancel Registration]

QUESTIONS?
[Contact Host] | [Get Support]

See you in 1 week!
The Briteside Team

---
Reminder sent on {{reminder_date}}.
View event details | Manage registration | Unsubscribe`,
  },
  {
    id: 'virtual-event-reminder-1-day',
    name: 'Virtual Event Reminder - 1 Day',
    description: 'Sent to registered attendees 24 hours before a virtual event',
    category: 'Events',
    icon: Bell,
    subject: '{{event_name}} is TOMORROW! 🔔',
    preview: "Your virtual event is tomorrow! Here's your access link and final details...",
    body:
      EMAIL_HEADER +
      `Hi {{user_name}},

Your virtual event is TOMORROW! 🎉

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 {{event_name}}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📅 Date: {{event_date}}
🕐 Time: {{event_time}} ({{timezone}})
⏱️ Duration: {{event_duration}}
👤 Host: {{host_name}}

🔗 YOUR ACCESS LINK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[Join Virtual Event]
{{access_link}}

{{#if requires_password}}
🔐 Event Password: {{event_password}}
{{/if}}

LAST-MINUTE CHECKLIST
☑️ Test your camera and microphone
☑️ Check your internet connection
☑️ Find a quiet space with good lighting
☑️ Join 5-10 minutes early
☑️ Have pen and paper ready for notes

ABOUT THIS EVENT
{{event_description}}

EVENT AGENDA
{{#each event_agenda}}
• {{time}} - {{topic}}
{{/each}}

QUICK CALENDAR ADD
[Google Calendar] | [Apple Calendar] | [Outlook]

CAN'T MAKE IT?
Please let us know so others can join.

[Cancel Registration]

NEED HELP?
[Contact Host] | [Get Support]

See you tomorrow!
The Briteside Team

---
Reminder sent on {{reminder_date}}.
View event details | Manage registration | Unsubscribe`,
  },
  {
    id: 'briteside-plus-signup',
    name: 'Briteside Plus Signup',
    description: 'Sent when a user subscribes to Briteside Plus',
    category: 'Subscription',
    icon: Crown,
    subject: 'Welcome to Briteside Plus! 👑',
    preview:
      "You've unlocked premium creator tools. Here's everything included in your Briteside Plus membership...",
    body:
      EMAIL_HEADER +
      `Hi {{user_name}},

Welcome to Briteside Plus! 👑

You've just unlocked the full suite of premium creator tools. We're excited to have you on board as a Briteside Plus member.

HERE'S WHAT'S NOW AVAILABLE TO YOU:

✅ 1-on-1 video booking tools
✅ Paid messages
✅ Unlimited live streams
✅ Advanced audience analytics
✅ Priority in search & discovery
✅ Early access to new features

YOUR PLAN DETAILS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 Plan: Briteside Plus
💰 Amount: $35/month
📅 Next Billing Date: {{next_billing_date}}
💎 Creator Earnings: You keep 95% of everything you earn
━━━━━━━━━━━━━━━━━━━━━━━━━━━

QUICK START GUIDE:

📅 Set Up Bookings
Offer paid 1-on-1 sessions and start monetizing your expertise.
[Manage Bookings]

🎥 Go Live
Start your first live stream and connect with your audience in real-time.
[Go Live Now]

📊 View Analytics
Explore your audience insights, engagement trends, and growth metrics.
[Open Analytics]

🎫 Create Premium Events
Host exclusive ticketed events and keep 95% of your earnings.
[Create Event]

NEED HELP?
Our dedicated creator support team is here for you.
[Contact Creator Support] | [Briteside Plus FAQ]

Here's to your growth!
The Briteside Team

---
You received this email because you subscribed to Briteside Plus.
Manage subscription | Billing history | Unsubscribe`,
  },
  {
    id: 'briteside-plus-cancellation',
    name: 'Briteside Plus Cancellation',
    description: 'Sent when a user cancels their Briteside Plus subscription',
    category: 'Subscription',
    icon: Crown,
    subject: 'Your Briteside Plus Subscription Has Been Cancelled',
    preview:
      "We're sorry to see you go. Your Briteside Plus benefits will remain active until the end of your billing period...",
    body:
      EMAIL_HEADER +
      `Hi {{user_name}},

We're sorry to see you go. Your Briteside Plus subscription has been cancelled.

YOUR CANCELLATION DETAILS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 Plan: Briteside Plus
📅 Access Until: {{access_end_date}}
💰 Final Charge: $35 (already billed)
━━━━━━━━━━━━━━━━━━━━━━━━━━━

WHAT HAPPENS NEXT:

✅ You'll keep full access to all Briteside Plus features until {{access_end_date}}.
⬇️ After that date, your account will revert to a free plan.

HERE'S WHAT YOU'LL LOSE ACCESS TO:

❌ 1-on-1 video booking tools
❌ Paid messages
❌ Unlimited live streams
❌ Advanced audience analytics
❌ Priority in search & discovery
❌ Early access to new features
❌ 95% creator earnings (reverts to standard rate)

BEFORE YOU GO:

💰 Unsettled Earnings
If you have any pending earnings, they will still be paid out on your next scheduled payout date. No earnings will be lost.

📊 Your Data
All your content, followers, and event history will remain on your profile. Nothing is deleted.

CHANGED YOUR MIND?

You can resubscribe anytime before {{access_end_date}} to keep your benefits without interruption.

[Resubscribe to Briteside Plus]

We'd love to know why you cancelled so we can improve. Your feedback matters to us.

[Share Feedback]

Thank you for being a Briteside Plus member. We hope to see you back soon!

The Briteside Team

---
You received this email because you cancelled your Briteside Plus subscription.
Manage subscription | Billing history | Unsubscribe`,
  },
  {
    id: 'briteside-plus-payment-failed',
    name: 'Briteside Plus Payment Failed',
    description: 'Sent when a Briteside Plus subscription payment fails',
    category: 'Subscription',
    icon: Crown,
    subject: '⚠️ Action Required: Your Briteside Plus Payment Failed',
    preview:
      'We were unable to process your Briteside Plus payment. Please update your payment method to avoid losing access...',
    body:
      EMAIL_HEADER +
      `Hi {{user_name}},

We were unable to process your payment for Briteside Plus.

PAYMENT DETAILS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 Plan: Briteside Plus
💰 Amount Due: $35.00
💳 Payment Method: {{payment_method_last4}}
📅 Failed On: {{failed_date}}
🔄 Next Retry: {{next_retry_date}}
━━━━━━━━━━━━━━━━━━━━━━━━━━━

WHAT'S HAPPENING:

We'll automatically retry your payment on {{next_retry_date}}. If the payment continues to fail after {{max_retries}} attempts, your Briteside Plus subscription will be suspended on {{suspension_date}}.

⚠️ DON'T LOSE ACCESS TO:

• 1-on-1 video booking tools
• Paid messages
• Unlimited live streams
• Advanced audience analytics
• 95% creator earnings rate

HOW TO FIX THIS:

The most common reasons for a failed payment are an expired card, insufficient funds, or a bank hold. You can resolve this quickly by updating your payment method.

[Update Payment Method]

NEED HELP?

If you believe this is an error or need assistance, our support team is ready to help.

[Contact Support]

The Briteside Team

---
You received this email because your Briteside Plus payment could not be processed.
Manage subscription | Billing history | Unsubscribe`,
  },
  {
    id: 'paid-group-subscription',
    name: 'Paid Group Subscription',
    description: 'Sent when a user subscribes to a paid group',
    category: 'Groups',
    icon: Users,
    subject: 'Welcome to {{group_name}}! 🎉',
    preview: "You're now a member of {{group_name}}. Here's everything you need to get started...",
    body:
      EMAIL_HEADER +
      `Hi {{user_name}},

Welcome to {{group_name}}! 🎉

Your membership is now active and you have full access to everything this group has to offer.

YOUR MEMBERSHIP DETAILS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━
👥 Group: {{group_name}}
📋 Organized by: {{organizer_name}}
💰 Membership: {{membership_price}}/month
📅 Next Billing Date: {{next_billing_date}}
━━━━━━━━━━━━━━━━━━━━━━━━━━━

WHAT'S INCLUDED:

✅ Access to all group posts & discussions
✅ Exclusive group events & meetups
✅ Member-only content & resources
✅ Direct messaging with group members
✅ Group live streams & recordings

GET STARTED:

💬 Introduce Yourself
Say hello to the community and let everyone know a little about you.
[Go to Group]

📅 Upcoming Events
Check out what's coming up in the group.
[View Events]

👥 Meet the Members
Browse the member directory and start connecting.
[View Members]

The {{group_name}} Team

---
You received this email because you subscribed to {{group_name}}.
Manage membership | Billing history | Unsubscribe`,
  },
  {
    id: 'group-membership-cancellation',
    name: 'Group Membership Cancellation',
    description: 'Sent when a user cancels their paid group membership',
    category: 'Groups',
    icon: Users,
    subject: 'Your {{group_name}} Membership Has Been Cancelled',
    preview:
      "Your membership to {{group_name}} has been cancelled. You'll retain access until the end of your billing period...",
    body:
      EMAIL_HEADER +
      `Hi {{user_name}},

Your membership to {{group_name}} has been cancelled.

CANCELLATION DETAILS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━
👥 Group: {{group_name}}
📅 Access Until: {{access_end_date}}
💰 Final Charge: {{final_charge}} (already billed)
━━━━━━━━━━━━━━━━━━━━━━━━━━━

WHAT HAPPENS NEXT:

✅ You'll keep full access to {{group_name}} until {{access_end_date}}.
⬇️ After that date, you'll lose access to member-only content and features.

HERE'S WHAT YOU'LL LOSE ACCESS TO:

❌ Group posts & discussions
❌ Exclusive group events & meetups
❌ Member-only content & resources
❌ Direct messaging with group members
❌ Group live streams & recordings

YOUR DATA:

Any posts or comments you've made in the group will remain visible to other members. Your interaction history is preserved.

CHANGED YOUR MIND?

You can rejoin anytime before {{access_end_date}} to keep your membership without interruption.

[Rejoin {{group_name}}]

We'd love to hear your feedback on how we can improve the group experience.

[Share Feedback]

The Briteside Team

---
You received this email because you cancelled your membership to {{group_name}}.
Manage memberships | Billing history | Unsubscribe`,
  },
  {
    id: 'group-payment-failed',
    name: 'Group Payment Failed',
    description: 'Sent when a group membership payment fails',
    category: 'Groups',
    icon: Users,
    subject: '⚠️ Action Required: Your {{group_name}} Payment Failed',
    preview:
      'We were unable to process your payment for {{group_name}}. Please update your payment method to avoid losing access...',
    body:
      EMAIL_HEADER +
      `Hi {{user_name}},

We were unable to process your membership payment for {{group_name}}.

PAYMENT DETAILS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━
👥 Group: {{group_name}}
💰 Amount Due: {{membership_price}}
💳 Payment Method: {{payment_method_last4}}
📅 Failed On: {{failed_date}}
🔄 Next Retry: {{next_retry_date}}
━━━━━━━━━━━━━━━━━━━━━━━━━━━

WHAT'S HAPPENING:

We'll automatically retry your payment on {{next_retry_date}}. If the payment continues to fail after {{max_retries}} attempts, your membership to {{group_name}} will be suspended on {{suspension_date}}.

⚠️ DON'T LOSE ACCESS TO:

• Group posts & discussions
• Exclusive group events & meetups
• Member-only content & resources
• Direct messaging with group members
• Group live streams & recordings

HOW TO FIX THIS:

The most common reasons for a failed payment are an expired card, insufficient funds, or a bank hold. You can resolve this quickly by updating your payment method.

[Update Payment Method]

NEED HELP?

If you believe this is an error or need assistance, our support team is ready to help.

[Contact Support]

The Briteside Team

---
You received this email because your {{group_name}} membership payment could not be processed.
Manage memberships | Billing history | Unsubscribe`,
  },
  {
    id: 'paid-message-refund',
    name: 'Paid Message Auto-Refund',
    description:
      'Notifies the sender when their paid message is automatically refunded after 48 hours with no reply',
    category: 'Payments',
    icon: RefreshCw,
    subject: 'Your paid message to {{recipient_name}} has been refunded',
    preview:
      'Your $' +
      '{{refund_amount}} paid message was automatically refunded because {{recipient_name}} did not reply within 48 hours...',
    body:
      EMAIL_HEADER +
      `Hi {{user_name}},

We wanted to let you know that your paid message has been automatically refunded because the recipient did not reply within 48 hours. 🔄

REFUND DETAILS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💬 Recipient: {{recipient_name}}
💰 Refund Amount: \${{refund_amount}}
📅 Original Message Sent: {{message_date}}
🔄 Refund Processed: {{refund_date}}

WHAT HAPPENED?
When you send a paid message on Briteside, the recipient has 48 hours to reply. If they don't respond within that window, your payment is automatically refunded in full.

WHAT'S NEXT?
Your refund of \${{refund_amount}} has been processed and will be returned to your original payment method.

💡 Tip: Some creators receive many messages. Try sending your message at a different time, or check if the creator offers 1:1 video bookings for a guaranteed connection.

[Try Again] [Browse Talent]

If you have any questions about this refund, please don't hesitate to reach out to our support team.

The Briteside Team

---
Refund for paid message sent on {{message_date}}.
View messages | Contact support | Unsubscribe`,
  },
  {
    id: 'event-rating',
    name: 'Event Rating Request',
    description: 'Sent 24 hours after the event ends to collect attendee feedback and ratings',
    category: 'Events',
    icon: Star,
    subject: 'How was {{event_name}}? Share your experience ⭐',
    preview:
      "We'd love to hear your thoughts on {{event_name}}! Rate the event and help future attendees and the organizer...",
    body:
      EMAIL_HEADER +
      `Hi {{user_name}},

Thanks for attending {{event_name}}! 🎉

We'd love to know how it went — your feedback helps {{organizer_name}} make future events even better.

HOW WOULD YOU RATE THIS EVENT?

⭐⭐⭐⭐⭐
[1 - Poor] [2 - Fair] [3 - Good] [4 - Great] [5 - Amazing]

[Rate This Event]

Thanks for helping the community! 💙

The Briteside Team

---
You attended {{event_name}} on {{event_date}}.
Manage your email preferences | Unsubscribe`,
  },
];
