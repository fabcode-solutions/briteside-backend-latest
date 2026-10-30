import httpStatus from 'http-status';
import { sendMail } from '../services/mail.service.js';
import { contactService } from '../services/index.js';
import ApiError from '../utils/api-error.js';
import { header, footer, ctaButton, calloutBox } from '../templates/emailLayout.js';

// Simple HTML escape to avoid injection in the email body
const escapeHtml = str =>
  String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

/**
 * Public endpoint to receive contact form messages, persist them and forward to admin
 * POST /api/contact
 */
export const sendContactMessage = async (req, res, next) => {
  try {
    const { firstName = '', lastName = '', email, subject, message } = req.body;

    if (!email || !subject || !message) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'email, subject and message are required');
    }

    // Persist contact message first so we keep track even if email fails
    const saved = await contactService.createMessage({
      firstName,
      lastName,
      email,
      subject,
      message,
    });

    const senderName = `${firstName || ''} ${lastName || ''}`.trim() || 'Anonymous';

    const adminEmail = 'admin@briteside.app';
    const mailSubject = `☀️ [Briteside] New Inquiry: ${escapeHtml(subject)} — ${escapeHtml(senderName)}`;
    const html = `
  <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
    ${header}
    <div style="padding: 32px 40px;">
      <h2 style="color: #333; margin-top: 0;">New Inquiry Received</h2>
      <p style="color: #666; font-size: 14px; margin-bottom: 25px;">You have a new message from the <strong>Briteside</strong> contact form.</p>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 25px;">
        <tr>
          <td style="padding: 8px 0; color: #888; font-size: 13px; width: 80px;">FROM</td>
          <td style="padding: 8px 0; font-weight: 600; color: #333;">${escapeHtml(senderName)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #888; font-size: 13px;">EMAIL</td>
          <td style="padding: 8px 0;"><a href="mailto:${escapeHtml(email)}" style="color: #00D16E; text-decoration: none;">${escapeHtml(email)}</a></td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #888; font-size: 13px;">SUBJECT</td>
          <td style="padding: 8px 0; font-weight: 600; color: #333;">${escapeHtml(subject)}</td>
        </tr>
      </table>

      ${calloutBox(`<p style="margin: 0 0 10px 0; font-size: 12px; color: #aaa; text-transform: uppercase; font-weight: bold;">Message:</p><div style="white-space: pre-wrap; color: #444; line-height: 1.6; font-size: 15px;">${escapeHtml(message)}</div>`)}

      <div style="margin-top: 30px; text-align: center;">
        ${ctaButton('Go to Briteside', 'https://www.briteside.app/')}
      </div>
    </div>
    ${footer('This is an automated notification from the Briteside Contact System.')}
  </div>
`;

    const text = `New contact message\n\nFrom: ${senderName} <${email}>\nSubject: ${subject}\n\n${message}`;

    try {
      await sendMail(adminEmail, mailSubject, html, text);
      // mark as sent
      await contactService.updateMessageStatus(saved.id, { status: 'sent', errorMessage: null });
    } catch (sendErr) {
      // update DB record so admin can see the failure
      await contactService.updateMessageStatus(saved.id, {
        status: 'failed',
        errorMessage: String(sendErr.message || sendErr),
      });
      // still return friendly message to user
      return res.status(httpStatus.OK).json({
        success: true,
        message:
          'Thank you — your message has been received. Our team will respond within 24–48 hours. (Delivery to admin failed, we will retry or review the message.)',
      });
    }

    return res.status(httpStatus.OK).json({
      success: true,
      message:
        'Thanks for reaching out. A member of our team is already reviewing your message. We will respond  within 24-48 hours.',
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Admin: get paginated contact messages
 * GET /api/admin/contact-messages
 */
export const getContactMessages = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;
    const result = await contactService.getMessages({
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      status,
      search,
      sortBy,
      sortOrder,
    });

    res
      .status(httpStatus.OK)
      .json({ success: true, data: result.data, pagination: result.pagination });
  } catch (err) {
    next(err);
  }
};

/**
 * Admin: get single message by id
 * GET /api/admin/contact-messages/:id
 */
export const getContactMessageById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const msg = await contactService.getMessageById(id);
    if (!msg) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Contact message not found');
    }
    res.status(httpStatus.OK).json({ success: true, data: msg });
  } catch (err) {
    next(err);
  }
};

/**
 * Admin: update message status (mark read/archived/etc)
 * PATCH /api/admin/contact-messages/:id/status
 */
export const updateContactMessageStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!status) throw new ApiError(httpStatus.BAD_REQUEST, 'status is required');

    const updated = await contactService.updateMessageStatus(id, { status });
    res
      .status(httpStatus.OK)
      .json({ success: true, message: 'Message status updated', data: updated });
  } catch (err) {
    next(err);
  }
};

export const contactController = {
  sendContactMessage,
  getContactMessages,
  getContactMessageById,
  updateContactMessageStatus,
};
