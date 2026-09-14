import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import env from '../config/config.js';

const sesClient = new SESClient({
  region: process.env.AWS_SES_REGION, // e.g. 'us-east-1'
});

// SES requires the sender address to be verified in your AWS account
const FROM_ADDRESS = process.env.AWS_SES_FROM_MAIL; // e.g. 'noreply@briteside.app'
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://briteside.app';
/**
 * Send an email using AWS SES
 * @param {string} to - Recipient email address
 * @param {string} subject - Email subject
 * @param {string} html - Email HTML content
 * @param {string} text - Email text content (optional)
 * @returns {Promise} - SES SendEmailCommand response
 */
export const sendMail = async (to, subject, html, text = '') => {
  const params = {
    Source: FROM_ADDRESS,
    Destination: {
      ToAddresses: Array.isArray(to) ? to : [to],
    },
    Message: {
      Subject: {
        Data: subject,
        Charset: 'UTF-8',
      },
      Body: {
        Html: {
          Data: html,
          Charset: 'UTF-8',
        },
        ...(text && {
          Text: {
            Data: text,
            Charset: 'UTF-8',
          },
        }),
      },
    },
  };

  try {
    const command = new SendEmailCommand(params);
    const info = await sesClient.send(command);
    return info;
  } catch (error) {
    console.error('Error sending email via SES:', error);
    throw error;
  }
};

/**
 * Send a transaction confirmation email after Stripe payment
 * @param {string} to - Recipient email address
 * @param {object} transactionDetails - Details of the transaction
 * @param {string} transactionDetails.amount - Transaction amount
 * @param {string} transactionDetails.currency - Transaction currency
 * @param {string} transactionDetails.eventName - Event name (optional)
 * @param {string} transactionDetails.transactionId - Transaction ID
 * @returns {Promise} - SES SendEmailCommand response
 */
export const sendTransactionEmail = async (to, transactionDetails) => {
  const { amount, currency, eventName = 'Event', transactionId } = transactionDetails;

  const subject = `Payment Confirmation - ${eventName}`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #333;">Payment Confirmation</h2>
      <p>Dear Customer,</p>
      <p>Your payment has been successfully processed.</p>
      <div style="background-color: #f5f5f5; padding: 20px; margin: 20px 0;">
        <h3>Transaction Details:</h3>
        <p><strong>Amount:</strong> ${amount} ${currency.toUpperCase()}</p>
        <p><strong>Event:</strong> ${eventName}</p>
        <p><strong>Transaction ID:</strong> ${transactionId}</p>
      </div>
      <p>Thank you for your purchase!</p>
      <p>Best regards,<br>Briteside Team</p>
    </div>
  `;

  const text = `
    Payment Confirmation

    Dear Customer,

    Your payment has been successfully processed.

    Transaction Details:
    Amount: ${amount} ${currency.toUpperCase()}
    Event: ${eventName}
    Transaction ID: ${transactionId}

    Thank you for your purchase!

    Best regards,
    Briteside Team
  `;

  return sendMail(to, subject, html, text);
};

/**
 * Send a general email with default template including website link
 * @param {string} to - Recipient email address
 * @param {string} subject - Email subject
 * @param {string} message - Custom message content (optional, defaults to welcome message)
 * @param {string} websiteUrl - Website URL (optional, defaults to env.apiHost)
 * @returns {Promise} - SES SendEmailCommand response
 */
export const sendGeneralEmail = async ({ to, subject, message = '', websiteUrl = FRONTEND_URL }) => {
  const defaultMessage =
    message ||
    `
    Welcome to Briteside! We're excited to have you on board.
    Discover amazing events and connect with like-minded people.
  `;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #333;">Hello from Briteside</h2>
      <p>${defaultMessage}</p>
      <p style="text-align: center; margin: 30px 0;">
        <a href="${websiteUrl}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Visit Our Website</a>
      </p>
      <p>Best regards,<br>Briteside Team</p>
    </div>
  `;

  const text = `
    Hello from Briteside

    ${defaultMessage}

    Visit our website: ${websiteUrl}

    Best regards,
    Briteside Team
  `;

  return sendMail(to, subject, html, text);
};

/**
 * Send OTP email for password reset
 * @param {string} to - Recipient email address
 * @param {string} otp - 5-digit OTP code
 * @returns {Promise} - SES SendEmailCommand response
 */
export const sendOtpEmail = async (to, otp) => {
  const subject = 'Password Reset OTP - Briteside';

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f9f9f9; padding: 20px; border-radius: 10px;">
      <h2 style="color: #333; text-align: center;">Password Reset Request</h2>
      <p style="color: #666; font-size: 16px;">Hello,</p>
      <p style="color: #666; font-size: 16px;">You requested a password reset for your Briteside account. Please use the following One-Time Password (OTP) to reset your password:</p>

      <div style="background-color: #ffffff; padding: 15px; text-align: center; border-radius: 5px; margin: 30px 0; border: 1px solid #ddd;">
        <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #007bff;">${otp}</span>
      </div>

      <p style="color: #666; font-size: 14px;">This OTP is valid for <strong>15 minutes</strong>.</p>
      <p style="color: #999; font-size: 14px; margin-top: 30px;">If you didn't request this, please ignore this email. Your password will remain unchanged.</p>

      <div style="border-top: 1px solid #eee; margin-top: 20px; padding-top: 20px; text-align: center;">
        <p style="color: #aaa; font-size: 12px;">&copy; ${new Date().getFullYear()} Briteside. All rights reserved.</p>
      </div>
    </div>
  `;

  const text = `
    Password Reset Request

    Hello,

    You requested a password reset for your Briteside account.

    Your OTP is: ${otp}

    This OTP is valid for 15 minutes.

    If you didn't request this, please ignore this email.
  `;

  return sendMail(to, subject, html, text);
};

/**
 * Send reset password email with link
 * @param {string} to - Recipient email address
 * @param {string} token - Reset token
 * @returns {Promise} - SES SendEmailCommand response
 */
export const sendResetPasswordEmail = async (to, token) => {
  const subject = 'Reset Your Password - Briteside';
  const resetLink = `${
    process.env.FRONTEND_URL || 'http://localhost:3000'
  }/reset-password?email=${to}&token=${token}`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f9f9f9; padding: 20px; border-radius: 10px;">
      <h2 style="color: #333; text-align: center;">Reset Your Password</h2>
      <p style="color: #666; font-size: 16px;">Hello,</p>
      <p style="color: #666; font-size: 16px;">You recently requested to reset your password for your Briteside account. Click the button below to reset it:</p>

      <div style="text-align: center; margin: 30px 0;">
        <a href="${resetLink}" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px;">Reset Password</a>
      </div>

      <p style="color: #666; font-size: 14px;">If the button above doesn't work, copy and paste the following link into your browser:</p>
      <p style="color: #007bff; font-size: 14px; word-break: break-all;"><a href="${resetLink}">${resetLink}</a></p>

      <p style="color: #666; font-size: 14px;">This link is valid for <strong>${
        env.jwt.resetPasswordExpirationMinutes
      } minutes</strong>.</p>
      <p style="color: #999; font-size: 14px; margin-top: 30px;">If you didn't request a password reset, please ignore this email.</p>

      <div style="border-top: 1px solid #eee; margin-top: 20px; padding-top: 20px; text-align: center;">
        <p style="color: #aaa; font-size: 12px;">&copy; ${new Date().getFullYear()} Briteside. All rights reserved.</p>
      </div>
    </div>
  `;

  const text = `
    Reset Your Briteside Account Password

Hello,

We received a request to reset the password for your Briteside account.

To proceed, please click the link below to create a new password:
${resetLink}

This link is valid for a limited time. For your security, please do not share it with anyone.

If you did not request a password reset, you can safely ignore this email—no changes will be made to your account.

If you need further assistance, please contact Briteside Support.

Best regards,
The Briteside Team
  `;

  return sendMail(to, subject, html, text);
};

/**
 * Send username reservation approved email
 * @param {object} params
 * @param {string} params.to - Recipient email
 * @param {string} params.fullName - Applicant's full name
 * @param {string} params.username - Reserved username
 * @returns {Promise}
 */
export const sendUsernameReservationApprovedEmail = async ({ to, fullName, username }) => {
  const subject = 'Your Username Reservation Has Been Approved — Briteside';
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
      <h2 style="color:#38a169">Username Reserved!</h2>
      <p>Hi <strong>${fullName || 'there'}</strong>,</p>
      <p>Great news! Your username reservation for <strong>@${username}</strong> has been approved.</p>
      <p>You can now register on Briteside using this username. Please note that your reservation may have an expiry window — sign up soon to secure it.</p>
      <p>Best regards,<br>Briteside Team</p>
      <div style="border-top:1px solid #eee;margin-top:20px;padding-top:20px;text-align:center">
        <p style="color:#aaa;font-size:12px">&copy; ${new Date().getFullYear()} Briteside. All rights reserved.</p>
      </div>
    </div>`;
  const text = `Hi ${fullName || 'there'},\n\nYour username reservation for @${username} has been approved.\nSign up on Briteside to claim it.\n\nBest regards,\nBriteside Team`;
  return sendMail(to, subject, html, text);
};

/**
 * Send username reservation rejected email
 * @param {object} params
 * @param {string} params.to - Recipient email
 * @param {string} params.fullName - Applicant's full name
 * @param {string} params.username - Requested username
 * @param {string} params.rejectionReason - Reason for rejection
 * @returns {Promise}
 */
export const sendUsernameReservationRejectedEmail = async ({
  to,
  fullName,
  username,
  rejectionReason,
}) => {
  const subject = 'Your Username Reservation Was Not Approved — Briteside';
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
      <h2 style="color:#e53e3e">Reservation Not Approved</h2>
      <p>Hi <strong>${fullName || 'there'}</strong>,</p>
      <p>Unfortunately, your reservation request for <strong>@${username}</strong> was not approved.</p>
      ${rejectionReason ? `<p><strong>Reason:</strong> ${rejectionReason}</p>` : ''}
      <p>You are welcome to submit a new reservation request at any time.</p>
      <p>Best regards,<br>Briteside Team</p>
      <div style="border-top:1px solid #eee;margin-top:20px;padding-top:20px;text-align:center">
        <p style="color:#aaa;font-size:12px">&copy; ${new Date().getFullYear()} Briteside. All rights reserved.</p>
      </div>
    </div>`;
  const text = `Hi ${fullName || 'there'},\n\nYour reservation for @${username} was not approved.${rejectionReason ? `\nReason: ${rejectionReason}` : ''}\n\nYou may submit a new request.\n\nBest regards,\nBriteside Team`;
  return sendMail(to, subject, html, text);
};

/**
 * Send account suspension email
 * @param {object} params - Email parameters
 * @param {string} params.to - Recipient email address
 * @param {string} params.username - User's username
 * @param {string} params.reason - Reason for suspension
 * @param {string} params.suspendedUntil - Suspension end date (optional)
 * @returns {Promise} - SES SendEmailCommand response
 */
export const sendSuspensionEmail = async ({ to, username, reason, suspendedUntil }) => {
  const subject = 'Your Briteside Account Has Been Suspended';
  const until = suspendedUntil
    ? `until <strong>${new Date(suspendedUntil).toDateString()}</strong>`
    : 'indefinitely';
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
      <h2 style="color:#e53e3e">Account Suspended</h2>
      <p>Hi <strong>${username || 'there'}</strong>,</p>
      <p>Your Briteside account has been suspended ${until}.</p>
      <p><strong>Reason:</strong> ${reason}</p>
      <p>If you believe this is a mistake, you can submit an appeal from the app.</p>
      <p>Best regards,<br>Briteside Team</p>
    </div>`;
  const text = `Your account has been suspended ${until}.\nReason: ${reason}\nYou may appeal via the app.`;
  return sendMail(to, subject, html, text);
};

/**
 * Send account unsuspension email
 * @param {object} params - Email parameters
 * @param {string} params.to - Recipient email address
 * @param {string} params.username - User's username
 * @returns {Promise} - SES SendEmailCommand response
 */
export const sendUnsuspensionEmail = async ({ to, username }) => {
  const subject = 'Your Briteside Account Has Been Reinstated';
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
      <h2 style="color:#38a169">Account Reinstated</h2>
      <p>Hi <strong>${username || 'there'}</strong>,</p>
      <p>Your suspension has been lifted. You can now log in again.</p>
      <p>Best regards,<br>Briteside Team</p>
    </div>`;
  const text = `Your Briteside account has been reinstated. You can now log in.`;
  return sendMail(to, subject, html, text);
};

/**
 * Send appeal received notification email
 * @param {object} params - Email parameters
 * @param {string} params.to - Recipient email address
 * @param {string} params.username - User's username
 * @returns {Promise} - SES SendEmailCommand response
 */
export const sendAppealReceivedEmail = async ({ to, username }) => {
  const subject = 'Appeal Received — Briteside';
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
      <h2>Appeal Submitted</h2>
      <p>Hi <strong>${username || 'there'}</strong>,</p>
      <p>We have received your suspension appeal and will review it within 3–5 business days.</p>
      <p>Best regards,<br>Briteside Team</p>
    </div>`;
  const text = `We received your suspension appeal. We will review it within 3–5 business days.`;
  return sendMail(to, subject, html, text);
};

/**
 * Send appeal review decision email
 * @param {object} params - Email parameters
 * @param {string} params.to - Recipient email address
 * @param {string} params.username - User's username
 * @param {string} params.status - Appeal status ('approved' or 'rejected')
 * @param {string} params.adminResponse - Admin's response/notes
 * @param {string} params.newSuspendedUntil - New suspension end date (optional)
 * @returns {Promise} - SES SendEmailCommand response
 */
export const sendAppealReviewedEmail = async ({
  to,
  username,
  status,
  adminResponse,
  newSuspendedUntil,
}) => {
  const approved = status === 'approved';
  const subject = approved
    ? 'Your Appeal Has Been Approved — Briteside'
    : 'Your Appeal Has Been Rejected — Briteside';
  const statusText = approved
    ? newSuspendedUntil
      ? `Your suspension has been reduced and will end on <strong>${new Date(newSuspendedUntil).toDateString()}</strong>.`
      : 'Your suspension has been fully lifted. You can log in again.'
    : 'Your appeal was not approved. Your original suspension remains in effect.';
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
      <h2 style="color:${approved ? '#38a169' : '#e53e3e'}">${subject}</h2>
      <p>Hi <strong>${username || 'there'}</strong>,</p>
      <p>${statusText}</p>
      ${adminResponse ? `<p><strong>Admin note:</strong> ${adminResponse}</p>` : ''}
      <p>Best regards,<br>Briteside Team</p>
    </div>`;
  const text = `${subject}\n\n${statusText}${adminResponse ? `\n\nAdmin note: ${adminResponse}` : ''}`;
  return sendMail(to, subject, html, text);
};

const demoConfirmationTemplate = ({ firstName, inviteLink, scheduledAt }) => {
  const scheduledDateStr = scheduledAt
    ? new Date(scheduledAt).toLocaleString('en-US', {
        dateStyle: 'full',
        timeStyle: 'short',
        timeZone: 'UTC',
      }) + ' UTC'
    : null;

  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#fafafa">
      <h2 style="color:#333">Hi ${firstName}, your demo is confirmed!</h2>
      <p style="color:#555;font-size:15px">We're excited to show you what Briteside can do. Here are your details:</p>
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin:20px 0">
        ${scheduledDateStr ? `<p style="margin:0 0 8px"><strong>When:</strong> ${scheduledDateStr}</p>` : ''}
        <p style="margin:0"><strong>Join Link:</strong>
          <a href="${inviteLink}" style="color:#007bff">${inviteLink}</a>
        </p>
      </div>
      <div style="text-align:center;margin:30px 0">
        <a href="${inviteLink}" style="background:#007bff;color:#fff;padding:12px 28px;text-decoration:none;border-radius:6px;font-weight:bold;font-size:15px">Join Demo Call</a>
      </div>
      <p style="color:#888;font-size:13px">If the button doesn't work, paste this link in your browser:<br>
        <a href="${inviteLink}">${inviteLink}</a>
      </p>
      <div style="border-top:1px solid #eee;margin-top:24px;padding-top:16px;text-align:center">
        <p style="color:#aaa;font-size:12px">&copy; ${new Date().getFullYear()} Briteside. All rights reserved.</p>
      </div>
    </div>`;
};

export const sendDemoConfirmationEmail = ({ to, firstName, inviteLink, scheduledAt }) => {
  const subject = 'Your Briteside Demo is Confirmed!';
  const html = demoConfirmationTemplate({ firstName, inviteLink, scheduledAt });
  return sendMail(to, subject, html);
};

// ─── Talent Issue Emails ──────────────────────────────────────────────────────

/**
 * Sent to the reporter immediately after they raise an issue.
 */
export const sendIssueSubmittedEmail = ({ to, reporterName, entityType, amountCents, issueId }) => {
  const typeLabel = entityType === 'session' ? 'session booking' : 'priority message';
  const amount = `$${(amountCents / 100).toFixed(2)}`;
  const subject = 'Issue Received — Briteside';
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
      <h2>Issue Received</h2>
      <p>Hi <strong>${reporterName}</strong>,</p>
      <p>We have received your issue regarding your <strong>${typeLabel}</strong> (amount paid: <strong>${amount}</strong>).</p>
      <p>Our team will review it and get back to you within 3–5 business days.</p>
      <p style="color:#888;font-size:12px">Issue ID: ${issueId}</p>
      <p>Best regards,<br>Briteside Team</p>
    </div>`;
  const text = `Hi ${reporterName},\n\nWe received your issue for a ${typeLabel} (${amount} paid).\nWe will review it within 3–5 business days.\n\nIssue ID: ${issueId}\n\nBriteside Team`;
  return sendMail(to, subject, html, text);
};

/**
 * Sent to the reporter after admin resolves or dismisses the issue.
 */
export const sendIssueResolvedToReporterEmail = ({
  to,
  reporterName,
  action,
  entityType,
  amountCents,
  refundIssued,
  refundAmountCents,
  adminNote,
  issueId,
}) => {
  const typeLabel = entityType === 'session' ? 'session booking' : 'priority message';
  const isDismissed = action === 'dismissed';
  const subject = isDismissed
    ? 'Issue Update — Briteside'
    : 'Your Issue Has Been Resolved — Briteside';
  const refundLine =
    refundIssued && refundAmountCents
      ? `<p>A refund of <strong>$${(refundAmountCents / 100).toFixed(2)}</strong> has been issued and will appear within 5–10 business days.</p>`
      : '';
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
      <h2 style="color:${isDismissed ? '#718096' : '#38a169'}">${subject}</h2>
      <p>Hi <strong>${reporterName}</strong>,</p>
      <p>Your issue regarding your <strong>${typeLabel}</strong> has been <strong>${isDismissed ? 'dismissed' : 'resolved'}</strong>.</p>
      ${refundLine}
      ${adminNote ? `<p><strong>Admin note:</strong> ${adminNote}</p>` : ''}
      <p style="color:#888;font-size:12px">Issue ID: ${issueId}</p>
      <p>Best regards,<br>Briteside Team</p>
    </div>`;
  const text = `${subject}\n\nYour ${typeLabel} issue has been ${isDismissed ? 'dismissed' : 'resolved'}.${refundIssued && refundAmountCents ? `\nRefund: $${(refundAmountCents / 100).toFixed(2)}` : ''}${adminNote ? `\nAdmin note: ${adminNote}` : ''}\n\nIssue ID: ${issueId}`;
  return sendMail(to, subject, html, text);
};

/**
 * Sent to the talent when a warning is issued against them.
 */
export const sendIssueWarningToTalentEmail = ({ to, talentName, entityType, adminNote }) => {
  const typeLabel = entityType === 'session' ? 'a session booking' : 'a priority message';
  const subject = 'Account Warning — Briteside';
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
      <h2 style="color:#e53e3e">Account Warning</h2>
      <p>Hi <strong>${talentName}</strong>,</p>
      <p>A customer raised an issue related to <strong>${typeLabel}</strong> on your account. After review, a warning has been issued.</p>
      ${adminNote ? `<p><strong>Note:</strong> ${adminNote}</p>` : ''}
      <p>Please ensure you respond to paid messages and attend confirmed sessions on time. Repeated issues may result in account suspension.</p>
      <p>Best regards,<br>Briteside Team</p>
    </div>`;
  const text = `Account Warning\n\nHi ${talentName},\n\nA customer raised an issue for ${typeLabel} on your account. A warning has been issued.${adminNote ? `\n\nNote: ${adminNote}` : ''}\n\nPlease ensure timely responses. Repeated issues may result in suspension.\n\nBriteside Team`;
  return sendMail(to, subject, html, text);
};
