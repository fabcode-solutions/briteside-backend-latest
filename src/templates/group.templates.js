/**
 * Group Email Templates
 * Covers: group invitation, paid group subscription, membership cancellation,
 *         group payment failed, group fee change
 */

import { header, footer, ctaButton, infoBox, calloutBox } from './emailLayout.js';

export const groupTemplates = {
  // ── Group Invitation ────────────────────────────────────────────────────
  groupInvitation: {
    id: 'group-invitation',
    subject: ({ group_name }) => `You've been invited to join ${group_name}`,
    html: ({
      user_name,
      inviter_name,
      group_name,
      group_description,
      member_count,
      group_location,
      group_category,
      personal_message,
      invite_date,
    }) => `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        ${header}
        <div style="padding:30px 20px;">
          <p>Hi ${user_name},</p>
          <h2 style="color:#333;">You've been invited to join a group! 👥</h2>
          <p><strong>${inviter_name}</strong> thinks you'd be a great addition to:</p>
          <div style="background:#f8f8f8;border-radius:6px;padding:16px;margin:16px 0;">
            <h3 style="margin:0 0 8px;color:#00D16E;">${group_name}</h3>
            <p style="margin:0 0 12px;">${group_description}</p>
            <div>👥 ${member_count} members</div>
            <div>📍 ${group_location}</div>
            <div>🏷️ ${group_category}</div>
          </div>
          ${personal_message ? calloutBox(`"${personal_message}"<br/><small>– ${inviter_name}</small>`, 'neutral') : ''}
          <div style="text-align:center;margin:24px 0;">
            ${ctaButton('Accept Invitation')}
            ${ctaButton('View Group')}
            ${ctaButton('Decline')}
          </div>
          <p style="font-size:13px;color:#666;">This invitation will expire in 7 days.</p>
          <p><strong>The Briteside Team</strong></p>
        </div>
        ${footer(`Invitation sent by ${inviter_name} on ${invite_date}.<br/><a href="#">Manage invitations</a> | <a href="#">Block invitations from this user</a>`)}
      </div>`,
  },

  // ── Paid Group Subscription ─────────────────────────────────────────────
  paidGroupSubscription: {
    id: 'paid-group-subscription',
    subject: ({ group_name }) => `Welcome to ${group_name}! 🎉`,
    html: ({ user_name, group_name, organizer_name, membership_price, next_billing_date }) => `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        ${header}
        <div style="padding:30px 20px;">
          <p>Hi ${user_name},</p>
          <h2 style="color:#333;">Welcome to ${group_name}! 🎉</h2>
          <p>Your membership is now active and you have full access to everything this group has to offer.</p>
          ${infoBox([
            ['Group', `👥 ${group_name}`],
            ['Organized by', `📋 ${organizer_name}`],
            ['Membership', `💰 ${membership_price}/month`],
            ['Next Billing Date', `📅 ${next_billing_date}`],
          ])}
          <p><strong>What's Included:</strong></p>
          <ul>
            <li>✅ Access to all group posts & discussions</li>
            <li>✅ Exclusive group events & meetups</li>
            <li>✅ Member-only content & resources</li>
            <li>✅ Direct messaging with group members</li>
            <li>✅ Group live streams & recordings</li>
          </ul>
          <div style="text-align:center;margin:24px 0;">
            ${ctaButton('Go to Group')}
            ${ctaButton('View Events')}
            ${ctaButton('View Members')}
          </div>
          <p><strong>The ${group_name} Team</strong></p>
        </div>
        ${footer(`You received this email because you subscribed to ${group_name}.<br/><a href="#">Manage membership</a> | <a href="#">Unsubscribe</a>`)}
      </div>`,
  },

  // ── Group Membership Cancellation ───────────────────────────────────────
  groupMembershipCancellation: {
    id: 'group-membership-cancellation',
    subject: ({ group_name }) => `Your ${group_name} Membership Has Been Cancelled`,
    html: ({ user_name, group_name, access_end_date, final_charge }) => `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        ${header}
        <div style="padding:30px 20px;">
          <p>Hi ${user_name},</p>
          <h2 style="color:#333;">Membership Cancelled</h2>
          <p>Your membership to <strong>${group_name}</strong> has been cancelled.</p>
          ${infoBox([
            ['Group', `👥 ${group_name}`],
            ['Access Until', `📅 ${access_end_date}`],
            ['Final Charge', `💰 ${final_charge} (already billed)`],
          ])}
          <p>✅ You'll keep full access to <strong>${group_name}</strong> until <strong>${access_end_date}</strong>.<br/>
          After that date, you'll lose access to member-only content and features.</p>
          <p><strong>You'll Lose Access To:</strong></p>
          <ul>
            <li>❌ Group posts & discussions</li>
            <li>❌ Exclusive group events & meetups</li>
            <li>❌ Member-only content & resources</li>
            <li>❌ Direct messaging with group members</li>
            <li>❌ Group live streams & recordings</li>
          </ul>
          <div style="text-align:center;margin:24px 0;">
            ${ctaButton(`Rejoin ${group_name}`)}
            ${ctaButton('Share Feedback')}
          </div>
          <p><strong>The Briteside Team</strong></p>
        </div>
        ${footer(`You received this email because you cancelled your membership to ${group_name}.<br/><a href="#">Manage memberships</a> | <a href="#">Unsubscribe</a>`)}
      </div>`,
  },

  // ── Group Payment Failed ────────────────────────────────────────────────
  groupPaymentFailed: {
    id: 'group-payment-failed',
    subject: ({ group_name }) => `⚠️ Action Required: Your ${group_name} Payment Failed`,
    html: ({
      user_name,
      group_name,
      membership_price,
      payment_method_last4,
      failed_date,
      next_retry_date,
      max_retries,
      suspension_date,
    }) => `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        ${header}
        <div style="padding:30px 20px;">
          <p>Hi ${user_name},</p>
          <h2 style="color:#c0392b;">⚠️ Payment Failed</h2>
          <p>We were unable to process your membership payment for <strong>${group_name}</strong>.</p>
          ${calloutBox(
            `<div>👥 <strong>Group:</strong> ${group_name}</div>
             <div>💰 <strong>Amount Due:</strong> ${membership_price}</div>
             <div>💳 <strong>Payment Method:</strong> ending in ${payment_method_last4}</div>
             <div>📅 <strong>Failed On:</strong> ${failed_date}</div>
             <div>🔄 <strong>Next Retry:</strong> ${next_retry_date}</div>`,
            'danger'
          )}
          <p>We'll automatically retry on <strong>${next_retry_date}</strong>. If payment continues to fail after <strong>${max_retries}</strong> attempts, your membership will be suspended on <strong>${suspension_date}</strong>.</p>
          <div style="text-align:center;margin:24px 0;">
            ${ctaButton('Update Payment Method')}
            ${ctaButton('Contact Support')}
          </div>
          <p><strong>The Briteside Team</strong></p>
        </div>
        ${footer(`Payment failure notice for ${group_name}.<br/><a href="#">Manage memberships</a> | <a href="#">Unsubscribe</a>`)}
      </div>`,
  },

  // ── Group Fee Change ────────────────────────────────────────────────────
  groupFeeChange: {
    id: 'group-fee-change',
    subject: ({ group_name }) => `Membership fee update for ${group_name}`,
    html: ({
      user_name,
      group_name,
      effective_date,
      old_fee,
      new_fee,
      billing_cycle,
      is_price_increase,
      change_percentage,
      fee_change_reason,
      is_grandfathered,
      grandfather_end_date,
      next_billing_date,
      membership_benefits = [],
    }) => `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        ${header}
        <div style="padding:30px 20px;">
          <p>Hi ${user_name},</p>
          <h2 style="color:#333;">Membership Fee Update for ${group_name}</h2>
          ${infoBox([
            ['Group', `👥 ${group_name}`],
            ['Effective Date', `📅 ${effective_date}`],
            ['Previous Fee', `💰 ${old_fee}/${billing_cycle}`],
            ['New Fee', `💰 ${new_fee}/${billing_cycle}`],
          ])}
          <p>${
            is_price_increase
              ? `This represents a <strong>${change_percentage}% increase</strong> from your current rate.`
              : `🎉 Great news! This represents a <strong>${change_percentage}% decrease</strong> from your current rate.`
          }</p>
          <p><strong>Why this change?</strong> ${fee_change_reason}</p>
          ${
            is_grandfathered
              ? calloutBox(`✅ As a valued existing member, you'll continue paying <strong>${old_fee}/${billing_cycle}</strong> until ${grandfather_end_date}.`, 'success')
              : `<p>Your next billing on <strong>${next_billing_date}</strong> will reflect the new fee of <strong>${new_fee}</strong>.</p>`
          }
          ${
            membership_benefits.length
              ? `
          <p><strong>Your Membership Includes:</strong></p>
          <ul>${membership_benefits.map(b => `<li>${b}</li>`).join('')}</ul>`
              : ''
          }
          <div style="text-align:center;margin:24px 0;">${ctaButton('Manage My Membership')}</div>
          <p>Thank you for being part of <strong>${group_name}</strong>!<br/><strong>The Briteside Team</strong></p>
        </div>
        ${footer(`Fee change notification for ${group_name}.<br/><a href="#">Manage membership</a> | <a href="#">Unsubscribe</a>`)}
      </div>`,
  },
};
