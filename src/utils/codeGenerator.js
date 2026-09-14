/**
 * Utility functions for generating professional codes for events, organizers, tickets, etc.
 */

/**
 * Generate a random alphanumeric string
 */
function generateRandomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Generate event code: #EVT_RANDOM12345
 */
export function generateEventCode() {
  return `#EVT_${generateRandomString(8)}`;
}

/**
 * Generate organizer code: #ORGNSR_RANDOM12345
 */
export function generateOrganizerCode() {
  return `#ORGNSR_${generateRandomString(8)}`;
}

/**
 * Generate ticket tier code: #TKT_RANDOM12345
 */
export function generateTicketCode() {
  return `#TKT_${generateRandomString(8)}`;
}

/**
 * Generate organizer member code: #ORGNSR_MEMBR_RANDOM123
 */
export function generateMemberCode() {
  return `#ORGNSR_MEMBR_${generateRandomString(10)}`;
}

/**
 * Generate purchased ticket code: #PTKT_RANDOM12345
 */
export function generatePurchasedTicketCode() {
  return `#PTKT_${generateRandomString(8)}`;
}

/**
 * Generate QR code data for ticket verification
 */
export function generateQRCodeData(data) {
  return JSON.stringify({
    tId: data.ticketId,
    eId: data.eventId,
    oId: data.organizerId,
    tCode: data.ticketCode,
    eCode: data.eventCode,
    oCode: data.organizerCode,
    ts: Date.now(), // timestamp for verification
  });
}

/**
 * Parse QR code data for verification
 */
export function parseQRCodeData(qrData) {
  try {
    const parsed = JSON.parse(qrData);
    return {
      ticketId: parsed.tId,
      eventId: parsed.eId,
      organizerId: parsed.oId,
      ticketCode: parsed.tCode,
      eventCode: parsed.eCode,
      organizerCode: parsed.oCode,
      timestamp: parsed.ts,
    };
  } catch {
    return null;
  }
}
