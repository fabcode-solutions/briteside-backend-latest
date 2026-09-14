/**
 * Authentication Email Templates
 * Covers: welcome, email-verification, password-reset
 */

export const authTemplates = {
  welcome: {
    id: 'welcome',
    subject: () => 'Welcome to Briteside! 🎉',
    html: ({ user_name }) => `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <div style="text-align:center;padding:20px 0;border-bottom:1px solid #eee;">
          <strong>BRITESIDE</strong><br/>
          <a href="https://www.briteside.app" style="color:#666;font-size:12px;">www.briteside.app</a>
        </div>
        <div style="padding:30px 20px;">
          <p>Hi ${user_name},</p>
          <h2 style="color:#333;">Welcome to Briteside! 🎉</h2>
          <p>We're thrilled to have you join our community of event enthusiasts, creators, and like-minded individuals.</p>
          <p><strong>Here's what you can do on Briteside:</strong></p>
          <ul>
            <li><strong>Discover Events</strong> – Find amazing events happening near you</li>
            <li><strong>Join Groups</strong> – Connect with people who share your interests</li>
            <li><strong>Book 1:1 Sessions</strong> – Get personalized time with your favorite creators</li>
            <li><strong>Create & Share</strong> – Post updates and engage with the community</li>
          </ul>
          <div style="text-align:center;margin:30px 0;">
            <a href="https://www.briteside.app/events" style="background:#6c47ff;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;margin:0 8px;">Browse Events</a>
            <a href="https://www.briteside.app/groups" style="background:#6c47ff;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;margin:0 8px;">Find Groups</a>
            <a href="https://www.briteside.app/profile" style="background:#6c47ff;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;margin:0 8px;">Complete Profile</a>
          </div>
          <p>If you have any questions, our support team is always here to help.</p>
          <p>Welcome aboard!<br/><strong>The Briteside Team</strong></p>
        </div>
        <div style="padding:15px 20px;border-top:1px solid #eee;font-size:12px;color:#999;text-align:center;">
          You received this email because you signed up for Briteside.<br/>
          <a href="#">Manage email preferences</a> | <a href="#">Unsubscribe</a>
        </div>
      </div>`,
  },

  emailVerification: {
    id: 'email-verification',
    subject: () => 'Verify your email address',
    html: ({ user_name, verification_link, ip_address, location, timestamp }) => `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <div style="text-align:center;padding:20px 0;border-bottom:1px solid #eee;">
          <strong>BRITESIDE</strong><br/>
          <a href="https://www.briteside.app" style="color:#666;font-size:12px;">www.briteside.app</a>
        </div>
        <div style="padding:30px 20px;">
          <p>Hi ${user_name},</p>
          <p>Thanks for signing up for Briteside! Please verify your email address by clicking the button below:</p>
          <div style="text-align:center;margin:30px 0;">
            <a href="${verification_link}" style="background:#6c47ff;color:#fff;padding:14px 32px;border-radius:6px;text-decoration:none;font-size:16px;">Verify Email Address</a>
          </div>
          <p>This link will expire in <strong>24 hours</strong>.</p>
          <p>If you didn't create an account with Briteside, you can safely ignore this email.</p>
          <div style="background:#f8f8f8;border-radius:6px;padding:16px;margin:20px 0;font-size:13px;">
            <strong>For security, this request was received from:</strong><br/>
            IP Address: ${ip_address}<br/>
            Location: ${location}<br/>
            Time: ${timestamp}
          </div>
          <p>Thanks,<br/><strong>The Briteside Team</strong></p>
        </div>
        <div style="padding:15px 20px;border-top:1px solid #eee;font-size:12px;color:#999;text-align:center;">
          This is an automated message. Please do not reply directly to this email.
        </div>
      </div>`,
  },

  passwordReset: {
    id: 'password-reset',
    subject: () => 'Reset your password',
    html: ({ user_name, reset_link, ip_address, location, timestamp }) => `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <div style="text-align:center;padding:20px 0;border-bottom:1px solid #eee;">
          <strong>BRITESIDE</strong>
        </div>
        <div style="padding:30px 20px;">
          <p>Hi ${user_name},</p>
          <p>We received a request to reset your password for your Briteside account. Click the button below to create a new password:</p>
          <div style="text-align:center;margin:30px 0;">
            <a href="${reset_link}" style="background:#6c47ff;color:#fff;padding:14px 32px;border-radius:6px;text-decoration:none;font-size:16px;">Reset Password</a>
          </div>
          <p>This link will expire in <strong>1 hour</strong> for security reasons.</p>
          <p>If you didn't request a password reset, please ignore this email or contact our support team if you have concerns about your account security.</p>
          <div style="background:#f8f8f8;border-radius:6px;padding:16px;margin:20px 0;font-size:13px;">
            <strong>For security, this request was received from:</strong><br/>
            IP Address: ${ip_address}<br/>
            Location: ${location}<br/>
            Time: ${timestamp}
          </div>
          <p>Stay safe,<br/><strong>The Briteside Security Team</strong></p>
        </div>
        <div style="padding:15px 20px;border-top:1px solid #eee;font-size:12px;color:#999;text-align:center;">
          This is an automated security message. Please do not reply directly to this email.
        </div>
      </div>`,
  },
};
