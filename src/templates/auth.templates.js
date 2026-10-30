/**
 * Authentication Email Templates
 * Covers: welcome, email-verification, password-reset
 */

import { header, footer, ctaButton } from './emailLayout.js';

export const authTemplates = {
  welcome: {
    id: 'welcome',
    subject: () => 'Welcome to Briteside! 🎉',
    html: ({ user_name }) => `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        ${header}
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
            ${ctaButton('Browse Events', 'https://www.briteside.app/events')}
            ${ctaButton('Find Groups', 'https://www.briteside.app/groups')}
            ${ctaButton('Complete Profile', 'https://www.briteside.app/profile')}
          </div>
          <p>If you have any questions, our support team is always here to help.</p>
          <p>Welcome aboard!<br/><strong>The Briteside Team</strong></p>
        </div>
        ${footer(`You received this email because you signed up for Briteside.<br/><a href="#">Manage email preferences</a> | <a href="#">Unsubscribe</a>`)}
      </div>`,
  },

  emailVerification: {
    id: 'email-verification',
    subject: () => 'Verify your email address',
    html: ({ user_name, verification_link, ip_address, location, timestamp }) => `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        ${header}
        <div style="padding:30px 20px;">
          <p>Hi ${user_name},</p>
          <p>Thanks for signing up for Briteside! Please verify your email address by clicking the button below:</p>
          <div style="text-align:center;margin:30px 0;">
            ${ctaButton('Verify Email Address', verification_link)}
          </div>
          <p>This link will expire in <strong>24 hours</strong>.</p>
          <p>If you didn't create an account with Briteside, you can safely ignore this email.</p>
          <div style="background:#f8f9fa;border-left:4px solid #00D16E;border-radius:0 8px 8px 0;padding:16px 20px;margin:20px 0;font-size:13px;">
            <strong>For security, this request was received from:</strong><br/>
            IP Address: ${ip_address}<br/>
            Location: ${location}<br/>
            Time: ${timestamp}
          </div>
          <p>Thanks,<br/><strong>The Briteside Team</strong></p>
        </div>
        ${footer('This is an automated message. Please do not reply directly to this email.')}
      </div>`,
  },

  passwordReset: {
    id: 'password-reset',
    subject: () => 'Reset your password',
    html: ({ user_name, reset_link, ip_address, location, timestamp }) => `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        ${header}
        <div style="padding:30px 20px;">
          <p>Hi ${user_name},</p>
          <p>We received a request to reset your password for your Briteside account. Click the button below to create a new password:</p>
          <div style="text-align:center;margin:30px 0;">
            ${ctaButton('Reset Password', reset_link)}
          </div>
          <p>This link will expire in <strong>1 hour</strong> for security reasons.</p>
          <p>If you didn't request a password reset, please ignore this email or contact our support team if you have concerns about your account security.</p>
          <div style="background:#f8f9fa;border-left:4px solid #00D16E;border-radius:0 8px 8px 0;padding:16px 20px;margin:20px 0;font-size:13px;">
            <strong>For security, this request was received from:</strong><br/>
            IP Address: ${ip_address}<br/>
            Location: ${location}<br/>
            Time: ${timestamp}
          </div>
          <p>Stay safe,<br/><strong>The Briteside Security Team</strong></p>
        </div>
        ${footer('This is an automated security message. Please do not reply directly to this email.')}
      </div>`,
  },
};
