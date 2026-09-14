import { catchAsync } from '../utils/catch-async.js';
import ApiError from '../utils/api-error.js';
import httpStatus from 'http-status';
import { db } from '../db/index.js';
import { events } from '../db/schema/events.js';
import { groups } from '../db/schema/groups.js';
import { eq } from 'drizzle-orm';
import { sendBulkTemplatedEmail } from '../services/bulkMail.service.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3330.com';

function parseLine(line) {
  const cols = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      cols.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cols.push(current.trim());
  return cols;
}

// Handles any CSV format: with/without header, single column, multi-column.
// Scans every cell and extracts valid email addresses.
// If a "name" column header is present, uses that for personalization.
function parseCsvBuffer(buffer) {
  const text = buffer.toString('utf-8');
  const lines = text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'CSV file is empty');
  }

  // Detect optional header row — a row where no cell is a valid email
  const firstRowCells = parseLine(lines[0]);
  const firstRowHasEmail = firstRowCells.some(c => EMAIL_REGEX.test(c.trim()));
  const hasHeader = !firstRowHasEmail;

  let nameIdx = -1;
  let dataStartIdx = 0;

  if (hasHeader) {
    const headers = firstRowCells.map(h => h.toLowerCase().replace(/[^a-z0-9_]/g, ''));
    nameIdx = headers.indexOf('name');
    dataStartIdx = 1;
  }

  const seen = new Set();
  const recipients = [];

  for (let i = dataStartIdx; i < lines.length; i++) {
    const cols = parseLine(lines[i]);
    let foundEmail = null;
    let foundName = nameIdx !== -1 && cols[nameIdx] ? cols[nameIdx].trim() : 'there';

    for (const cell of cols) {
      const val = cell.toLowerCase().trim();
      if (EMAIL_REGEX.test(val)) {
        foundEmail = val;
        break;
      }
    }

    if (foundEmail && !seen.has(foundEmail)) {
      seen.add(foundEmail);
      recipients.push({ email: foundEmail, name: foundName });
    }
  }

  if (recipients.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'No valid email addresses found in CSV');
  }

  return recipients;
}

export const bulkInviteFromCsv = catchAsync(async (req, res) => {
  const { type, entityId } = req.body;

  if (!req.file) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'CSV file is required');
  }

  const mime = req.file.mimetype;
  const fileName = (req.file.originalname || '').toLowerCase();
  if (mime !== 'text/csv' && !fileName.endsWith('.csv')) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Uploaded file must be a CSV');
  }

  if (!type || !['event', 'group'].includes(type)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'type must be "event" or "group"');
  }

  if (!entityId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'entityId is required');
  }

  const rawRecipients = parseCsvBuffer(req.file.buffer);

  let templateName, defaultData, buildData;

  if (type === 'event') {
    const event = await db.query.events.findFirst({
      where: eq(events.id, entityId),
      with: { venue: true, organizer: true },
    });

    if (!event) throw new ApiError(httpStatus.NOT_FOUND, 'Event not found');

    const eventDate = new Date(event.startDate).toLocaleString();
    const eventLocation = event.venue
      ? [event.venue.name, event.venue.city, event.venue.state].filter(Boolean).join(', ')
      : 'See event details';
    const inviteUrl = `${FRONTEND_URL}/events/${event.slug}`;
    const organizerName = event.organizer?.businessName || 'The Organizer';

    templateName = 'Briteside-event-invite';
    defaultData = {
      user_name: 'there',
      event_name: event.title,
      event_date: eventDate,
      event_location: eventLocation,
      organizer_name: organizerName,
      invite_url: inviteUrl,
    };
    buildData = r => ({
      user_name: r.name,
      event_name: event.title,
      event_date: eventDate,
      event_location: eventLocation,
      organizer_name: organizerName,
      invite_url: inviteUrl,
    });
  } else {
    const group = await db.query.groups.findFirst({
      where: eq(groups.id, entityId),
      with: { createdBy: true },
    });

    if (!group) throw new ApiError(httpStatus.NOT_FOUND, 'Group not found');

    const inviteUrl = `${FRONTEND_URL}/groups/${entityId}`;
    const creator = group.createdBy;
    const organizerName = creator
      ? [creator.firstName, creator.lastName].filter(Boolean).join(' ')
      : 'The Organizer';

    templateName = 'Briteside-group-invite';
    defaultData = {
      user_name: 'there',
      group_name: group.name,
      organizer_name: organizerName,
      invite_url: inviteUrl,
    };
    buildData = r => ({
      user_name: r.name,
      group_name: group.name,
      organizer_name: organizerName,
      invite_url: inviteUrl,
    });
  }

  const recipients = rawRecipients.map(r => ({ email: r.email, data: buildData(r) }));
  const result = await sendBulkTemplatedEmail(templateName, defaultData, recipients);

  res.status(httpStatus.OK).json({
    success: true,
    total: recipients.length,
    sent: result.sent,
    failed: result.failed.length,
    failedRecipients: result.failed.map(f => ({ email: f.email, error: f.error })),
  });
});
