import { catchAsync } from '../utils/catch-async.js';
import ApiError from '../utils/api-error.js';
import { getUserInformation } from '../utils/helper.js';
import { sendMail } from '../services/mail.service.js';
import { FRONTEND_URL, header, footer, ctaButton } from '../templates/emailLayout.js';

export const sendInvite = catchAsync(async (req, res) => {
  const { emails } = req.body;

  if (!Array.isArray(emails) || emails.length === 0) {
    throw new ApiError(400, 'At least one email address is required');
  }
  if (emails.length > 20) {
    throw new ApiError(400, 'You can invite up to 20 people at a time');
  }

  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const cleaned = [...new Set(emails.map(e => String(e).trim().toLowerCase()))].filter(Boolean);
  const invalid = cleaned.filter(e => !EMAIL_REGEX.test(e));
  if (invalid.length > 0) {
    throw new ApiError(400, `Invalid email address: ${invalid[0]}`);
  }

  const inviter = await getUserInformation(req.user.id);
  const inviterName =
    inviter?.name || `${inviter?.firstName || ''} ${inviter?.lastName || ''}`.trim() || 'A friend';

  // Always the platform's own URL — never whatever the client sent. Trusting
  // a client-supplied link here would turn this endpoint into an open relay
  // for sending arbitrary (e.g. phishing) links from our mail sender.
  const inviteLink = FRONTEND_URL;

  const subject = `${inviterName} invited you to Briteside`;
  const html = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
      ${header}
      <div style="padding: 32px 40px;">
        <h2 style="color: #333;">You've been invited to Briteside!</h2>
        <p><strong>${inviterName}</strong> thinks you'd like Briteside and wants you to join.</p>
        <div style="text-align: center; margin: 30px 0;">
          ${ctaButton('Join Briteside', inviteLink)}
        </div>
        <p style="font-size: 12px; color: #666;">If you weren't expecting this invite, you can safely ignore this email.</p>
      </div>
      ${footer()}
    </div>
  `;
  const text = `${inviterName} invited you to Briteside!\nJoin here: ${inviteLink}`;

  const results = await Promise.allSettled(cleaned.map(email => sendMail(email, subject, html, text)));
  const sentCount = results.filter(r => r.status === 'fulfilled').length;

  if (sentCount === 0) {
    throw new ApiError(502, 'Failed to send invites. Please try again later.');
  }

  res.json({
    success: true,
    message: `Invite sent to ${sentCount} recipient(s)`,
    data: { sentCount, totalRequested: cleaned.length },
  });
});
