/**
 * Briteside Email Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Usage:
 *   import { sendWelcomeEmail, sendTicketPurchaseEmail, ... } from './emails';
 *
 * Every sendXxx function accepts (to, params) where:
 *   to     – recipient email address (string) or array of addresses
 *   params – plain object with the dynamic values for that template
 *
 * All HTML is generated in-memory; no template files to maintain.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

// const sesClient = new SESClient({ region: process.env.AWS_SES_REGION || 'us-east-1' });
// const FROM_ADDRESS = process.env.AWS_SES_FROM_MAIL;

// ── Core sendMail ─────────────────────────────────────────────────────────────

// export const sendMail = async (to, subject, html, text = '') => {
//   const params = {
//     Source: FROM_ADDRESS,
//     Destination: { ToAddresses: Array.isArray(to) ? to : [to] },
//     Message: {
//       Subject: { Data: subject, Charset: 'UTF-8' },
//       Body: {
//         Html: { Data: html, Charset: 'UTF-8' },
//         ...(text && { Text: { Data: text, Charset: 'UTF-8' } }),
//       },
//     },
//   };
//   const command = new SendEmailCommand(params);
//   return sesClient.send(command);
// };

// ── Template runner ──────────────────────────────────────────────────────────

/**
 * Render a template and send.
 * @param {object} template  – { subject: (params) => string, html: (params) => string }
 * @param {string|string[]} to
 * @param {object} params    – dynamic values
 */
const sendTemplate = (template, to, params) => {
  const subject = template.subject(params);
  const html = template.html(params);
  return sendMail(to, subject, html);
};

// ─────────────────────────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────────────────────────

import { authTemplates } from './auth.templates.js';

/**
 * @param {string} to
 * @param {{ user_name: string }} params
 */
export const sendWelcomeEmail = (to, params) => sendTemplate(authTemplates.welcome, to, params);

/**
 * @param {string} to
 * @param {{ user_name: string, verification_link: string, ip_address: string, location: string, timestamp: string }} params
 */
export const sendEmailVerification = (to, params) =>
  sendTemplate(authTemplates.emailVerification, to, params);

/**
 * @param {string} to
 * @param {{ user_name: string, reset_link: string, ip_address: string, location: string, timestamp: string }} params
 */
export const sendPasswordResetEmail = (to, params) =>
  sendTemplate(authTemplates.passwordReset, to, params);

// ─────────────────────────────────────────────────────────────────────────────
// EVENTS
// ─────────────────────────────────────────────────────────────────────────────

import { eventTemplates } from './event.templates.js';

/**
 * @param {string} to
 * @param {{ user_name, event_name, event_date, event_time, event_location, organizer_name, registration_date }} params
 */
export const sendEventRegistrationEmail = (to, params) =>
  sendTemplate(eventTemplates.eventRegistration, to, params);

/**
 * @param {string} to
 * @param {{ user_name, event_name, order_number, ticket_type, quantity, subtotal, fees, amount,
 *           payment_method, card_last_four, event_date, event_time, event_location, organizer_name,
 *           refund_policy, purchase_date }} params
 */
export const sendTicketPurchaseEmail = (to, params) =>
  sendTemplate(eventTemplates.ticketPurchase, to, params);

/**
 * @param {string} to
 * @param {{ user_name, event_name, event_date, event_time, event_location }} params
 */
export const sendEventReminderWeekEmail = (to, params) =>
  sendTemplate(eventTemplates.eventReminderWeek, to, params);

/**
 * @param {string} to
 * @param {{ user_name, event_name, event_date, event_time, event_location, doors_open_time, directions, additional_items? }} params
 */
export const sendEventReminder24hEmail = (to, params) =>
  sendTemplate(eventTemplates.eventReminder24h, to, params);

/**
 * @param {string} to
 * @param {{ user_name, event_name, organizer_name, event_date, event_time, event_location, feedback_link }} params
 */
export const sendEventRatingEmail = (to, params) =>
  sendTemplate(eventTemplates.eventRating, to, params);

/**
 * @param {string} to
 * @param {{ user_name, inviter_name, event_name, event_date, event_time, event_location,
 *           ticket_price, event_description, personal_message, attending_friends_count? }} params
 */
export const sendEventInvitationEmail = (to, params) =>
  sendTemplate(eventTemplates.eventInvitation, to, params);

/**
 * @param {string} to
 * @param {{ user_name, event_name, event_date, event_time, event_location, cancellation_reason,
 *           organizer_message?, is_paid_event, amount?, refund_reference? }} params
 */
export const sendEventCancellationEmail = (to, params) =>
  sendTemplate(eventTemplates.eventCancellation, to, params);

/**
 * @param {string} to
 * @param {{ user_name, event_name, old_date, old_time, new_date, new_time, event_location,
 *           reschedule_reason, organizer_message? }} params
 */
export const sendEventRescheduledEmail = (to, params) =>
  sendTemplate(eventTemplates.eventRescheduled, to, params);

/**
 * @param {string} to
 * @param {{ user_name, event_name, event_date, event_time, timezone, event_duration, host_name,
 *           access_link, event_password?, requires_password, event_description?, registration_date }} params
 */
export const sendVirtualEventRegistrationEmail = (to, params) =>
  sendTemplate(eventTemplates.virtualEventRegistration, to, params);

/**
 * @param {string} to
 * @param {{ user_name, event_name, event_date, event_time, timezone, event_duration, host_name,
 *           access_link, event_password?, requires_password, event_description? }} params
 */
export const sendVirtualEventReminderWeekEmail = (to, params) =>
  sendTemplate(eventTemplates.virtualEventReminderWeek, to, params);

/**
 * @param {string} to
 * @param {{ user_name, event_name, event_date, event_time, timezone, event_duration, host_name,
 *           access_link, event_password?, requires_password, event_description?, event_agenda? }} params
 */
export const sendVirtualEventReminder1DayEmail = (to, params) =>
  sendTemplate(eventTemplates.virtualEventReminder1Day, to, params);

// ─────────────────────────────────────────────────────────────────────────────
// BOOKINGS
// ─────────────────────────────────────────────────────────────────────────────

import { bookingTemplates } from './booking.templates.js';

/**
 * @param {string} to
 * @param {{ user_name, creator_name, session_date, session_time, timezone, duration, amount, cancellation_policy, join_link? }} params
 */
export const sendBookingConfirmationEmail = (to, params) =>
  sendTemplate(bookingTemplates.bookingConfirmation, to, params);

/**
 * @param {string} to
 * @param {{ user_name, creator_name, session_time, timezone, duration, join_link? }} params
 */
export const sendBookingReminderEmail = (to, params) =>
  sendTemplate(bookingTemplates.bookingReminder, to, params);

/**
 * @param {string} to
 * @param {{ user_name, creator_name, session_date, session_time, cancelled_by, cancellation_reason, amount, refund_reference }} params
 */
export const sendBookingCancellationEmail = (to, params) =>
  sendTemplate(bookingTemplates.bookingCancellation, to, params);

/**
 * @param {string} to
 * @param {{ user_name, creator_name, old_date, old_time, new_date, new_time, timezone, duration, reschedule_reason }} params
 */
export const sendBookingRescheduledEmail = (to, params) =>
  sendTemplate(bookingTemplates.bookingRescheduled, to, params);

// ─────────────────────────────────────────────────────────────────────────────
// PAYMENTS & REFUNDS
// ─────────────────────────────────────────────────────────────────────────────

import { paymentTemplates } from './payment.templates.js';

/**
 * @param {string} to
 * @param {{ user_name, receipt_number, purchase_date, item_name, quantity, unit_price,
 *           line_total, subtotal, service_fee, tax, amount, payment_method, card_last_four,
 *           billing_name, billing_address }} params
 */
export const sendPaymentReceiptEmail = (to, params) =>
  sendTemplate(paymentTemplates.paymentReceipt, to, params);

/**
 * @param {string} to
 * @param {{ user_name, refund_reference, order_number, amount, refund_date, item_name,
 *           original_purchase_date, refund_reason, payment_method, card_last_four,
 *           original_amount, non_refundable_fees }} params
 */
export const sendRefundConfirmationEmail = (to, params) =>
  sendTemplate(paymentTemplates.refundConfirmation, to, params);

/**
 * @param {string} to
 * @param {{ user_name, recipient_name, refund_amount, message_date, refund_date }} params
 */
export const sendPaidMessageRefundEmail = (to, params) =>
  sendTemplate(paymentTemplates.paidMessageRefund, to, params);

// ─────────────────────────────────────────────────────────────────────────────
// GROUPS
// ─────────────────────────────────────────────────────────────────────────────

import { groupTemplates } from './group.templates.js';

/**
 * @param {string} to
 * @param {{ user_name, inviter_name, group_name, group_description, member_count,
 *           group_location, group_category, personal_message?, invite_date }} params
 */
export const sendGroupInvitationEmail = (to, params) =>
  sendTemplate(groupTemplates.groupInvitation, to, params);

/**
 * @param {string} to
 * @param {{ user_name, group_name, organizer_name, membership_price, next_billing_date }} params
 */
export const sendPaidGroupSubscriptionEmail = (to, params) =>
  sendTemplate(groupTemplates.paidGroupSubscription, to, params);

/**
 * @param {string} to
 * @param {{ user_name, group_name, access_end_date, final_charge }} params
 */
export const sendGroupMembershipCancellationEmail = (to, params) =>
  sendTemplate(groupTemplates.groupMembershipCancellation, to, params);

/**
 * @param {string} to
 * @param {{ user_name, group_name, membership_price, payment_method_last4,
 *           failed_date, next_retry_date, max_retries, suspension_date }} params
 */
export const sendGroupPaymentFailedEmail = (to, params) =>
  sendTemplate(groupTemplates.groupPaymentFailed, to, params);

/**
 * @param {string} to
 * @param {{ user_name, group_name, effective_date, old_fee, new_fee, billing_cycle,
 *           is_price_increase, change_percentage, fee_change_reason,
 *           is_grandfathered, grandfather_end_date?, next_billing_date?, membership_benefits? }} params
 */
export const sendGroupFeeChangeEmail = (to, params) =>
  sendTemplate(groupTemplates.groupFeeChange, to, params);

// ─────────────────────────────────────────────────────────────────────────────
// SUBSCRIPTIONS (Briteside Plus)
// ─────────────────────────────────────────────────────────────────────────────

import { subscriptionTemplates } from './subscription.templates.js';

/**
 * @param {string} to
 * @param {{ user_name, next_billing_date }} params
 */
export const sendBridesidePlusSignupEmail = (to, params) =>
  sendTemplate(subscriptionTemplates.bridesidePlusSignup, to, params);

/**
 * @param {string} to
 * @param {{ user_name, access_end_date }} params
 */
export const sendBridesidePlusCancellationEmail = (to, params) =>
  sendTemplate(subscriptionTemplates.bridesidePlusCancellation, to, params);

/**
 * @param {string} to
 * @param {{ user_name, payment_method_last4, failed_date, next_retry_date, max_retries, suspension_date }} params
 */
export const sendBridesidePlusPaymentFailedEmail = (to, params) =>
  sendTemplate(subscriptionTemplates.bridesidePlusPaymentFailed, to, params);

// ─────────────────────────────────────────────────────────────────────────────
// MODERATION
// ─────────────────────────────────────────────────────────────────────────────

import { moderationTemplates } from './moderation-notification.templates.js';

/**
 * @param {string} to
 * @param {{ user_name, post_excerpt, post_date, violation_type, policy_description,
 *           is_first_offense, offense_count?, notice_date }} params
 */
export const sendGuidelinesViolationEmail = (to, params) =>
  sendTemplate(moderationTemplates.guidelinesViolation, to, params);

/**
 * @param {string} to
 * @param {{ user_name, post_excerpt, appeal_date, decision_date, review_notes? }} params
 */
export const sendAppealApprovedEmail = (to, params) =>
  sendTemplate(moderationTemplates.appealApproved, to, params);

/**
 * @param {string} to
 * @param {{ user_name, post_excerpt, appeal_date, decision_date, policy_name, policy_description,
 *           detailed_explanation?, is_warning_only, account_status_update? }} params
 */
export const sendAppealDeniedEmail = (to, params) =>
  sendTemplate(moderationTemplates.appealDenied, to, params);

/**
 * @param {string} to
 * @param {{ user_name, user_email, suspension_type, suspension_date, suspension_duration,
 *           suspension_reason, violations?, is_temporary, reinstatement_date? }} params
 */
export const sendAccountSuspensionEmail = (to, params) =>
  sendTemplate(moderationTemplates.accountSuspension, to, params);

/**
 * @param {string} to
 * @param {{ user_name, user_email, reinstatement_date, appeal_approved }} params
 */
export const sendAccountReinstatedEmail = (to, params) =>
  sendTemplate(moderationTemplates.accountReinstated, to, params);

/**
 * @param {string} to
 * @param {{ user_name, user_email, suspension_date, suspension_reason, severe_violations?,
 *           violation_history?, has_pending_refunds }} params
 */
export const sendPermanentSuspensionEmail = (to, params) =>
  sendTemplate(moderationTemplates.permanentSuspension, to, params);

// ─────────────────────────────────────────────────────────────────────────────
// NOTIFICATIONS
// ─────────────────────────────────────────────────────────────────────────────

import { sendMail } from '../services/mail.service.js';
import { notificationTemplates } from './moderation-notification.templates.js';

/**
 * @param {string} to
 * @param {{ user_name, sender_name, sender_bio, sender_followers, sender_mutual_connections }} params
 */
export const sendPriorityMessageRequestEmail = (to, params) =>
  sendTemplate(notificationTemplates.priorityMessageRequest, to, params);

/**
 * @param {string} to
 * @param {{ user_name, sender_name, message_content, message_time, message_date, sender_bio? }} params
 */
export const sendPriorityMessageEmail = (to, params) =>
  sendTemplate(notificationTemplates.priorityMessage, to, params);

/**
 * @param {string} to
 * @param {{ user_name, week_start, week_end, profile_views, new_followers, likes_received,
 *           comments_received, upcoming_events?, trending_events?, suggested_groups?, suggested_users? }} params
 */
export const sendNotificationDigestEmail = (to, params) =>
  sendTemplate(notificationTemplates.notificationDigest, to, params);

/**
 * @param {string} to
 * @param {{ user_name, ticket_quantity, ticket_type, event_name, event_location, event_date,
 *           event_time, cart_items, subtotal, fees, total, remaining_tickets?, low_stock,
 *           event_description?, reminder_date }} params
 */
export const sendAbandonedCartEmail = (to, params) =>
  sendTemplate(notificationTemplates.abandonedCart, to, params);
