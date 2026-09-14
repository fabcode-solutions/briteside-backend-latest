/**
 * One-time script to create/update Briteside email templates in AWS SES.
 * Run once: node src/scripts/createSesTemplates.js
 * Requires AWS_SES_REGION and AWS credentials in environment.
 */
import 'dotenv/config';
import { SESClient, CreateTemplateCommand, DeleteTemplateCommand } from '@aws-sdk/client-ses';

const sesClient = new SESClient({ region: process.env.AWS_SES_REGION || 'us-east-2' });

const year = new Date().getFullYear();

const footer = `
  <div style="padding:20px;border-top:2px solid #f0f0f0;font-size:12px;color:#999;text-align:center;margin-top:32px;">
    <p style="margin:0 0 4px;">&copy; ${year} Briteside. All rights reserved.</p>
    <p style="margin:0;">You received this email because you are a member of Briteside.</p>
  </div>`;

const header = `
  <div style="background:#6c47ff;padding:24px;text-align:center;border-radius:8px 8px 0 0;">
    <strong style="font-size:22px;color:#fff;letter-spacing:1px;">BRITESIDE</strong>
  </div>`;

const ctaButton = (label, urlVar) =>
  `<a href="${urlVar}" style="background:#6c47ff;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:bold;font-size:15px;">${label}</a>`;

const infoRow = (icon, label, value) =>
  `<tr>
    <td style="padding:8px 0;color:#666;width:24px;font-size:18px;">${icon}</td>
    <td style="padding:8px 12px;color:#444;"><strong>${label}:</strong> ${value}</td>
  </tr>`;

const alertBanner = (color, icon, message) =>
  `<div style="background:${color};border-radius:6px;padding:14px 18px;margin:20px 0;">
    <span style="font-size:20px;">${icon}</span>
    <span style="color:#333;font-size:14px;line-height:1.5;margin-left:8px;">${message}</span>
  </div>`;

const templates = [
  // ── Event Invite ─────────────────────────────────────────────────────────────
  {
    TemplateName: 'Briteside-event-invite',
    SubjectPart: '{{organizer_name}} invited you to {{event_name}}!',
    HtmlPart: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e8e8e8;border-radius:8px;overflow:hidden;">
        ${header}
        <div style="padding:32px 24px;">
          <h2 style="color:#333;margin:0 0 8px;">You're Invited! 🎉</h2>
          <p style="color:#555;margin:0 0 24px;">Hi {{user_name}},</p>
          <p style="color:#555;"><strong>{{organizer_name}}</strong> has personally invited you to attend <strong>{{event_name}}</strong>. We'd love to see you there!</p>
          <div style="background:#f8f6ff;border:1px solid #e0d7ff;border-radius:8px;padding:20px;margin:24px 0;">
            <h3 style="margin:0 0 14px;color:#6c47ff;font-size:15px;text-transform:uppercase;letter-spacing:0.5px;">Event Details</h3>
            <table style="width:100%;border-collapse:collapse;">
              ${infoRow('📅', 'Date', '{{event_date}}')}
              ${infoRow('📍', 'Location', '{{event_location}}')}
              ${infoRow('🎟️', 'Hosted by', '{{organizer_name}}')}
            </table>
          </div>
          <p style="text-align:center;margin:28px 0;">
            ${ctaButton('View Event &amp; RSVP &rarr;', '{{invite_url}}')}
          </p>
          <p style="color:#888;font-size:13px;text-align:center;">This is a personal invite from {{organizer_name}}. Secure your spot before tickets run out.</p>
        </div>
        ${footer}
      </div>
    `,
    TextPart: `{{organizer_name}} invited you to {{event_name}}!\n\nHi {{user_name}},\n\n{{organizer_name}} has personally invited you to {{event_name}}.\n\nDate: {{event_date}}\nLocation: {{event_location}}\nHosted by: {{organizer_name}}\n\nView event & RSVP: {{invite_url}}\n\nBest regards,\nBriteside Team`,
  },

  // ── Group Invite ─────────────────────────────────────────────────────────────
  {
    TemplateName: 'Briteside-group-invite',
    SubjectPart: '{{organizer_name}} invited you to join {{group_name}}',
    HtmlPart: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e8e8e8;border-radius:8px;overflow:hidden;">
        ${header}
        <div style="padding:32px 24px;">
          <h2 style="color:#333;margin:0 0 8px;">You've Been Invited to a Group! 👥</h2>
          <p style="color:#555;margin:0 0 24px;">Hi {{user_name}},</p>
          <p style="color:#555;"><strong>{{organizer_name}}</strong> has invited you to join the <strong>{{group_name}}</strong> community on Briteside.</p>
          <div style="background:#f8f6ff;border:1px solid #e0d7ff;border-radius:8px;padding:20px;margin:24px 0;">
            <h3 style="margin:0 0 14px;color:#6c47ff;font-size:15px;text-transform:uppercase;letter-spacing:0.5px;">Group Details</h3>
            <table style="width:100%;border-collapse:collapse;">
              ${infoRow('👥', 'Group', '{{group_name}}')}
              ${infoRow('✉️', 'Invited by', '{{organizer_name}}')}
            </table>
          </div>
          <p style="color:#555;">Join to stay connected, get event updates, and be part of the community.</p>
          <p style="text-align:center;margin:28px 0;">
            ${ctaButton('Accept Invitation &rarr;', '{{invite_url}}')}
          </p>
          <p style="color:#888;font-size:13px;text-align:center;">This invitation was sent by {{organizer_name}} via Briteside.</p>
        </div>
        ${footer}
      </div>
    `,
    TextPart: `{{organizer_name}} invited you to join {{group_name}} on Briteside!\n\nHi {{user_name}},\n\n{{organizer_name}} has invited you to join {{group_name}}.\n\nAccept invitation: {{invite_url}}\n\nBest regards,\nBriteside Team`,
  },

  // ── Event Rescheduled ────────────────────────────────────────────────────────
  {
    TemplateName: 'Briteside-event-rescheduled',
    SubjectPart: 'Important: {{event_name}} has been rescheduled',
    HtmlPart: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e8e8e8;border-radius:8px;overflow:hidden;">
        ${header}
        <div style="padding:32px 24px;">
          <h2 style="color:#333;margin:0 0 8px;">Event Rescheduled 📅</h2>
          <p style="color:#555;margin:0 0 24px;">Hi {{user_name}},</p>
          ${alertBanner('#fff8e1', '⚠️', '<strong>{{event_name}}</strong> has been rescheduled by the organizer. Please update your calendar with the new date and time below.')}
          <div style="background:#f8f6ff;border:1px solid #e0d7ff;border-radius:8px;padding:20px;margin:24px 0;">
            <h3 style="margin:0 0 14px;color:#6c47ff;font-size:15px;text-transform:uppercase;letter-spacing:0.5px;">New Schedule</h3>
            <table style="width:100%;border-collapse:collapse;">
              ${infoRow('📅', 'New Start', '{{new_start_date}}')}
              ${infoRow('🏁', 'New End', '{{new_end_date}}')}
              ${infoRow('🎟️', 'Organised by', '{{organizer_name}}')}
            </table>
          </div>
          <p style="color:#555;">✅ Your tickets are still valid — no action needed. If you can no longer attend, you may request a refund from the event page.</p>
          <p style="text-align:center;margin:28px 0;">
            ${ctaButton('View Updated Event &rarr;', '{{event_url}}')}
          </p>
        </div>
        ${footer}
      </div>
    `,
    TextPart: `Important: {{event_name}} has been rescheduled\n\nHi {{user_name}},\n\n{{event_name}} has been rescheduled by {{organizer_name}}.\n\nNew Start: {{new_start_date}}\nNew End: {{new_end_date}}\n\nYour tickets remain valid. View the updated event: {{event_url}}\n\nBest regards,\nBriteside Team`,
  },

  // ── Venue Changed ────────────────────────────────────────────────────────────
  {
    TemplateName: 'Briteside-event-venue-changed',
    SubjectPart: 'Venue Update: {{event_name}} has moved',
    HtmlPart: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e8e8e8;border-radius:8px;overflow:hidden;">
        ${header}
        <div style="padding:32px 24px;">
          <h2 style="color:#333;margin:0 0 8px;">Venue Change 📍</h2>
          <p style="color:#555;margin:0 0 24px;">Hi {{user_name}},</p>
          ${alertBanner('#e8f5e9', '📍', '<strong>{{event_name}}</strong> has moved to a new venue. Please update your travel plans.')}
          <div style="background:#f8f6ff;border:1px solid #e0d7ff;border-radius:8px;padding:20px;margin:24px 0;">
            <h3 style="margin:0 0 14px;color:#6c47ff;font-size:15px;text-transform:uppercase;letter-spacing:0.5px;">New Venue</h3>
            <table style="width:100%;border-collapse:collapse;">
              ${infoRow('📍', 'Location', '{{new_venue}}')}
              ${infoRow('🎟️', 'Organised by', '{{organizer_name}}')}
            </table>
          </div>
          <p style="color:#555;">✅ The date and time remain unchanged. Your tickets are still valid — no action needed.</p>
          <p style="text-align:center;margin:28px 0;">
            ${ctaButton('View Updated Event &rarr;', '{{event_url}}')}
          </p>
        </div>
        ${footer}
      </div>
    `,
    TextPart: `Venue Update: {{event_name}} has moved\n\nHi {{user_name}},\n\n{{event_name}} has moved to a new venue.\n\nNew Venue: {{new_venue}}\nOrganised by: {{organizer_name}}\n\nDate and time unchanged. Tickets still valid.\n\nView updated event: {{event_url}}\n\nBest regards,\nBriteside Team`,
  },

  // ── Date & Venue Changed ─────────────────────────────────────────────────────
  {
    TemplateName: 'Briteside-event-date-venue-changed',
    SubjectPart: 'Important Update: New Date & Venue for {{event_name}}',
    HtmlPart: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e8e8e8;border-radius:8px;overflow:hidden;">
        ${header}
        <div style="padding:32px 24px;">
          <h2 style="color:#333;margin:0 0 8px;">Event Updated 🔔</h2>
          <p style="color:#555;margin:0 0 24px;">Hi {{user_name}},</p>
          ${alertBanner('#fff3e0', '🔔', '<strong>{{event_name}}</strong> has been updated with a new date and venue. Please review the changes below and update your plans.')}
          <div style="background:#f8f6ff;border:1px solid #e0d7ff;border-radius:8px;padding:20px;margin:24px 0;">
            <h3 style="margin:0 0 14px;color:#6c47ff;font-size:15px;text-transform:uppercase;letter-spacing:0.5px;">Updated Details</h3>
            <table style="width:100%;border-collapse:collapse;">
              ${infoRow('📅', 'New Start', '{{new_start_date}}')}
              ${infoRow('🏁', 'New End', '{{new_end_date}}')}
              ${infoRow('📍', 'New Venue', '{{new_venue}}')}
              ${infoRow('🎟️', 'Organised by', '{{organizer_name}}')}
            </table>
          </div>
          <p style="color:#555;">✅ Your tickets are still valid — no action needed. If you can no longer attend due to these changes, you may request a refund from the event page.</p>
          <p style="text-align:center;margin:28px 0;">
            ${ctaButton('View Updated Event &rarr;', '{{event_url}}')}
          </p>
        </div>
        ${footer}
      </div>
    `,
    TextPart: `Important Update: New Date & Venue for {{event_name}}\n\nHi {{user_name}},\n\n{{event_name}} has been updated by {{organizer_name}}.\n\nNew Start: {{new_start_date}}\nNew End: {{new_end_date}}\nNew Venue: {{new_venue}}\n\nTickets still valid. View updated event: {{event_url}}\n\nBest regards,\nBriteside Team`,
  },
];

async function upsertTemplate(template) {
  try {
    await sesClient.send(new DeleteTemplateCommand({ TemplateName: template.TemplateName }));
    console.log(`  Deleted existing: ${template.TemplateName}`);
  } catch (_) {
    // Template didn't exist — fine
  }

  await sesClient.send(new CreateTemplateCommand({ Template: template }));
  console.log(`  Created: ${template.TemplateName}`);
}

async function main() {
  console.log('Creating SES email templates...\n');
  for (const template of templates) {
    await upsertTemplate(template);
  }
  console.log('\nDone.');
}

main().catch(err => {
  console.error('Template creation failed:', err.message);
  process.exit(1);
});
