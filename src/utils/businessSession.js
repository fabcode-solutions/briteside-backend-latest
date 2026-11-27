/**
 * Session types for business services:
 *   individual    — one customer per slot (default)
 *   group         — the business schedules sessions; customers book seats
 *                   (priceCents is per seat)
 *   private_group — one party books a normal slot for a group
 *                   (priceCents is per person, never below minimumTotalCents)
 * Pure functions, unit-tested.
 */
export const SESSION_TYPES = ['individual', 'group', 'private_group'];
export const MAX_PARTY_SIZE = 500;
export const MAX_SEATS_PER_BOOKING = 20;

export const isGroup = service => service?.sessionType === 'group';
export const isPrivateGroup = service => service?.sessionType === 'private_group';

/** Service price for a party (before add-ons). */
export function sessionBaseCents(service, partySize = 1) {
  if (isGroup(service)) return service.priceCents * partySize;
  if (isPrivateGroup(service)) return Math.max(service.minimumTotalCents ?? 0, service.priceCents * partySize);
  return service.priceCents;
}

/**
 * The service as deposit maths should see it for this booking: the price is
 * the booked total; a fixed deposit counts per seat for group sessions and
 * once for everything else.
 */
export const depositBasis = (service, totalCents, partySize = 1) => ({
  ...service,
  priceCents: totalCents,
  depositCents:
    service.depositCents != null && isGroup(service) ? service.depositCents * partySize : service.depositCents,
});

/** Why `partySize` can't be booked for this service (null = fine). */
export function partySizeProblem(service, partySize = 1) {
  if (!Number.isInteger(partySize) || partySize < 1) return 'Choose how many people are coming';
  if (isGroup(service)) {
    if (partySize > MAX_SEATS_PER_BOOKING) return `You can book up to ${MAX_SEATS_PER_BOOKING} seats at a time`;
    return null;
  }
  if (isPrivateGroup(service)) {
    // No minimum guest count (any old min_guests value is ignored): minimumTotalCents sets the floor.
    const max = service.maxGuests ?? MAX_PARTY_SIZE;
    if (partySize > max) return `This event is for up to ${max} guests`;
    return null;
  }
  return partySize === 1 ? null : 'This service is booked for one person';
}

/** Why a service's session settings are incomplete (null = fine). Checks the merged row. */
export function sessionSettingsProblem(s) {
  if (!SESSION_TYPES.includes(s.sessionType ?? 'individual')) return 'Choose a session type';
  if (isGroup(s)) {
    if (!Number.isInteger(s.capacity) || s.capacity < 1 || s.capacity > MAX_PARTY_SIZE) {
      return `Set how many seats each session has (1–${MAX_PARTY_SIZE})`;
    }
  }
  if (isPrivateGroup(s)) {
    if (!Number.isInteger(s.maxGuests) || s.maxGuests < 1) {
      return 'Set the largest group you take';
    }
    if (s.maxGuests > MAX_PARTY_SIZE) return `Groups can be up to ${MAX_PARTY_SIZE} people`;
    if (s.minimumTotalCents != null && s.minimumTotalCents < 0) return 'The minimum to book can’t be negative';
  }
  return null;
}

/** Seats left in a session (never negative). */
export const seatsLeft = (capacity, taken) => Math.max(0, capacity - taken);
