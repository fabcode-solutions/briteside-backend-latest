/**
 * Subscription Email Templates
 * Covers: Briteside Plus signup, cancellation, payment failed
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

export const subscriptionTemplates = {
  // ── Briteside Plus Signup ───────────────────────────────────────────────
  bridesidePlusSignup: {
    id: 'briteside-plus-signup',
    subject: () => 'Welcome to Briteside Plus! 👑',
    html: ({ user_name, next_billing_date }) => `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        ${header}
        <div style="padding:30px 20px;">
          <p>Hi ${user_name},</p>
          <h2 style="color:#333;">Welcome to Briteside Plus! 👑</h2>
          <p>You've just unlocked the full suite of premium creator tools. We're excited to have you on board!</p>
          <p><strong>Here's what's now available to you:</strong></p>
          <ul>
            <li>✅ 1-on-1 video booking tools</li>
            <li>✅ Paid messages</li>
            <li>✅ Unlimited live streams</li>
            <li>✅ Advanced audience analytics</li>
            <li>✅ Priority in search & discovery</li>
            <li>✅ Early access to new features</li>
          </ul>
          <div style="background:#f8f8f8;border-radius:6px;padding:16px;margin:16px 0;">
            <div>📋 <strong>Plan:</strong> Briteside Plus</div>
            <div>💰 <strong>Amount:</strong> $35/month</div>
            <div>📅 <strong>Next Billing Date:</strong> ${next_billing_date}</div>
            <div>💎 <strong>Creator Earnings:</strong> You keep 95% of everything you earn</div>
          </div>
          <p><strong>Quick Start:</strong></p>
          <div style="margin:16px 0;">
            <div style="margin-bottom:12px;">
              📅 <strong>Set Up Bookings</strong> – Offer paid 1-on-1 sessions.<br/>
              <div style="margin-top:6px;">${ctaButton('Manage Bookings')}</div>
            </div>
            <div style="margin-bottom:12px;">
              🎥 <strong>Go Live</strong> – Start your first live stream.<br/>
              <div style="margin-top:6px;">${ctaButton('Go Live Now')}</div>
            </div>
            <div style="margin-bottom:12px;">
              📊 <strong>View Analytics</strong> – Explore your audience insights.<br/>
              <div style="margin-top:6px;">${ctaButton('Open Analytics')}</div>
            </div>
            <div style="margin-bottom:12px;">
              🎫 <strong>Create Premium Events</strong> – Host exclusive ticketed events.<br/>
              <div style="margin-top:6px;">${ctaButton('Create Event')}</div>
            </div>
          </div>
          <p>Here's to your growth!<br/><strong>The Briteside Team</strong></p>
        </div>
        ${footer(`You received this email because you subscribed to Briteside Plus.<br/><a href="#">Manage subscription</a> | <a href="#">Billing history</a> | <a href="#">Unsubscribe</a>`)}
      </div>`,
  },

  // ── Briteside Plus Cancellation ─────────────────────────────────────────
  bridesidePlusCancellation: {
    id: 'briteside-plus-cancellation',
    subject: () => 'Your Briteside Plus Subscription Has Been Cancelled',
    html: ({ user_name, access_end_date }) => `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        ${header}
        <div style="padding:30px 20px;">
          <p>Hi ${user_name},</p>
          <h2 style="color:#333;">We're sorry to see you go</h2>
          <p>Your Briteside Plus subscription has been cancelled.</p>
          <div style="background:#f8f8f8;border-radius:6px;padding:16px;margin:16px 0;">
            <div>📋 <strong>Plan:</strong> Briteside Plus</div>
            <div>📅 <strong>Access Until:</strong> ${access_end_date}</div>
            <div>💰 <strong>Final Charge:</strong> $35 (already billed)</div>
          </div>
          <p>✅ You'll keep full access to all Briteside Plus features until <strong>${access_end_date}</strong>.<br/>
          After that date, your account will revert to a free plan.</p>
          <p><strong>You'll Lose Access To:</strong></p>
          <ul>
            <li>❌ 1-on-1 video booking tools</li>
            <li>❌ Paid messages</li>
            <li>❌ Unlimited live streams</li>
            <li>❌ Advanced audience analytics</li>
            <li>❌ Priority in search & discovery</li>
            <li>❌ Early access to new features</li>
            <li>❌ 95% creator earnings (reverts to standard rate)</li>
          </ul>
          <p>💰 <strong>Unsettled Earnings</strong> – Any pending earnings will still be paid out on your next scheduled payout date.</p>
          <p>📊 <strong>Your Data</strong> – All your content, followers, and event history will remain on your profile.</p>
          <div style="text-align:center;margin:24px 0;">
            ${ctaButton('Resubscribe to Briteside Plus')}
            ${ctaButton('Share Feedback')}
          </div>
          <p>We hope to see you back soon!<br/><strong>The Briteside Team</strong></p>
        </div>
        ${footer(`You cancelled your Briteside Plus subscription.<br/><a href="#">Manage subscription</a> | <a href="#">Billing history</a> | <a href="#">Unsubscribe</a>`)}
      </div>`,
  },

  // ── Briteside Plus Payment Failed ───────────────────────────────────────
  bridesidePlusPaymentFailed: {
    id: 'briteside-plus-payment-failed',
    subject: () => '⚠️ Action Required: Your Briteside Plus Payment Failed',
    html: ({
      user_name,
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
          <p>We were unable to process your payment for Briteside Plus.</p>
          <div style="background:#fff3f3;border-radius:6px;padding:16px;margin:16px 0;">
            <div>📋 <strong>Plan:</strong> Briteside Plus</div>
            <div>💰 <strong>Amount Due:</strong> $35.00</div>
            <div>💳 <strong>Payment Method:</strong> ending in ${payment_method_last4}</div>
            <div>📅 <strong>Failed On:</strong> ${failed_date}</div>
            <div>🔄 <strong>Next Retry:</strong> ${next_retry_date}</div>
          </div>
          <p>We'll automatically retry your payment on <strong>${next_retry_date}</strong>. If the payment continues to fail after <strong>${max_retries}</strong> attempts, your Briteside Plus subscription will be suspended on <strong>${suspension_date}</strong>.</p>
          <p><strong>Don't Lose Access To:</strong></p>
          <ul>
            <li>1-on-1 video booking tools</li>
            <li>Paid messages</li>
            <li>Unlimited live streams</li>
            <li>Advanced audience analytics</li>
            <li>95% creator earnings rate</li>
          </ul>
          <div style="text-align:center;margin:24px 0;">
            ${ctaButton('Update Payment Method')}
            ${ctaButton('Contact Support')}
          </div>
          <p><strong>The Briteside Team</strong></p>
        </div>
        ${footer(`Your Briteside Plus payment could not be processed.<br/><a href="#">Manage subscription</a> | <a href="#">Billing history</a> | <a href="#">Unsubscribe</a>`)}
      </div>`,
  },
};
