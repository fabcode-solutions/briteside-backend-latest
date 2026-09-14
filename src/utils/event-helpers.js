import { eq, and, desc, asc, gte, lte, sql, exists, lt, like } from 'drizzle-orm';
import { db } from '../db/index.js';
import { events, eventTickets, venues } from '../db/schema/index.js';
import dayjs from 'dayjs';

/**
 * Distance and Location Helper Functions
 */

// Helper to parse distance string to kilometers
export const parseDistanceToKm = distanceStr => {
  if (!distanceStr) return null;

  const match = distanceStr.match(/^(\d+(?:\.\d+)?)\s*(mi|mile|miles|km|kilometer|kilometers)$/i);
  if (!match) return null;

  const value = parseFloat(match[1]);
  const unit = match[2].toLowerCase();

  // Convert to kilometers
  if (unit.startsWith('mi')) {
    return value * 1.60934; // miles to km
  }
  return value; // already in km
};

// Helper to calculate distance between two coordinates using Haversine formula
export const calculateDistance = (lat1, lng1, lat2, lng2) => {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in km
};

// Helper to build Haversine distance condition for SQL queries
export const buildDistanceCondition = (lat, lng, distanceKm) => {
  if (!lat || !lng || !distanceKm) return null;

  // Haversine formula in SQL
  // Returns distance in kilometers
  const haversineDistance = sql`(
    6371 * acos(
      cos(radians(${lat})) *
      cos(radians(${venues.latitude})) *
      cos(radians(${venues.longitude}) - radians(${lng})) +
      sin(radians(${lat})) *
      sin(radians(${venues.latitude}))
    )
  )`;

  return sql`${haversineDistance} <= ${distanceKm}`;
};

// Helper to filter events by text-based location
export const filterEventsByLocation = (events, location) => {
  if (!location) return events;

  const locationLower = location.toLowerCase();
  return events.filter(event => {
    const venue = event.venue;
    if (!venue) return false;

    return (
      (venue.city && venue.city.toLowerCase().includes(locationLower)) ||
      (venue.state && venue.state.toLowerCase().includes(locationLower)) ||
      (venue.address && venue.address.toLowerCase().includes(locationLower)) ||
      (venue.country && venue.country.toLowerCase().includes(locationLower))
    );
  });
};

/**
 * Date and Time Helper Functions
 */

// Helper to calculate event start and end dates from sessions
export const calculateEventDateRange = sessions => {
  if (!sessions || sessions.length === 0) {
    return { startDate: null, endDate: null };
  }

  // Find earliest session start time
  const startDate = sessions.reduce((earliest, session) => {
    const sessionStart = new Date(session.startTime);
    return !earliest || sessionStart < earliest ? sessionStart : earliest;
  }, null);

  // Find latest session end time
  const endDate = sessions.reduce((latest, session) => {
    const sessionEnd = new Date(session.endTime);
    return !latest || sessionEnd > latest ? sessionEnd : latest;
  }, null);

  return { startDate, endDate };
};

// Helper function to build date conditions
export const buildDateConditions = (timeFilter, dateRange) => {
  const conditions = [];
  const now = dayjs();

  const startOfToday = now.startOf('day');
  const endOfToday = startOfToday.add(1, 'day');

  const startOfWeek = startOfToday.startOf('week'); // Sunday
  const endOfWeek = startOfToday.endOf('week');

  /* ------------------ TIME FILTER (API #1) ------------------ */
  if (timeFilter) {
    switch (timeFilter) {
      case 'today':
        conditions.push(
          and(lt(events.startDate, endOfToday.toDate()), gte(events.endDate, startOfToday.toDate()))
        );
        break;

      case 'weekend': {
        const friday = startOfWeek.add(5, 'day').startOf('day');
        const monday = friday.add(3, 'day');

        conditions.push(
          and(lt(events.startDate, monday.toDate()), gte(events.endDate, friday.toDate()))
        );
        break;
      }
    }

    return conditions;
  }

  /* ------------------ DATE RANGE (API #2) ------------------ */
  if (dateRange) {
    // ✅ Single date (YYYY-MM-DD)
    if (dayjs(dateRange, 'YYYY-MM-DD', true).isValid()) {
      const selectedDay = dayjs(dateRange).startOf('day');
      const nextDay = selectedDay.add(1, 'day');

      conditions.push(
        and(lt(events.startDate, nextDay.toDate()), gte(events.endDate, selectedDay.toDate()))
      );

      return conditions;
    }

    switch (dateRange) {
      case 'tomorrow': {
        const tomorrowStart = endOfToday;
        const tomorrowEnd = tomorrowStart.add(1, 'day');

        conditions.push(
          and(
            lt(events.startDate, tomorrowEnd.toDate()),
            gte(events.endDate, tomorrowStart.toDate())
          )
        );
        break;
      }
      case 'today':
        conditions.push(
          and(lt(events.startDate, endOfToday.toDate()), gte(events.endDate, startOfToday.toDate()))
        );
        break;
      case 'this_week':
        conditions.push(
          and(lt(events.startDate, endOfWeek.toDate()), gte(events.endDate, startOfWeek.toDate()))
        );
        break;

      case 'this_weekend': {
        const friday = startOfWeek.add(5, 'day').startOf('day');
        const monday = friday.add(3, 'day');

        conditions.push(
          and(lt(events.startDate, monday.toDate()), gte(events.endDate, friday.toDate()))
        );
        break;
      }
    }
  }

  return conditions;
};

/**
 * Price Filtering Helper Functions
 */

// Helper function to build price conditions
export const buildPriceConditions = priceFilter => {
  switch (priceFilter) {
    case 'free':
      return eq(events.isFree, true);
    case 'paid':
      return eq(events.isFree, false);
    default:
      if (priceFilter && priceFilter.includes('-')) {
        const [min, max] = priceFilter.split('-').map(Number);
        if (min && max && min <= max) {
          return exists(
            db
              .select()
              .from(eventTickets)
              .where(
                and(
                  eq(eventTickets.eventId, events.id),
                  gte(eventTickets.price, min.toString()),
                  lte(eventTickets.price, max.toString())
                )
              )
          );
        }
      }
      return null;
  }
};

/**
 * Data Formatting Helper Functions
 */

// Helper to get the lowest ticket price for an event
export const getLowestTicketPrice = async (eventId, isFree) => {
  if (isFree) {
    return '0.00';
  }

  const lowestPriceTicket = await db.query.eventTickets.findFirst({
    where: eq(eventTickets.eventId, eventId),
    orderBy: asc(eventTickets.price),
  });

  return lowestPriceTicket?.price || '0.00';
};

// Helper to format distance based on requested unit
export const formatDistance = (distanceKm, distanceQuery) => {
  if (!distanceKm) return null;

  // Convert to the unit used in the request
  if (distanceQuery && distanceQuery.toLowerCase().includes('mi')) {
    return `${(distanceKm / 1.60934).toFixed(2)} mi`;
  } else {
    return `${distanceKm.toFixed(2)} km`;
  }
};

// Helper to build pagination response object
export const buildPaginationResponse = (page, limit, total) => {
  return {
    page,
    limit,
    total,
    hasNext: page < Math.ceil(total / limit),
    hasPrev: page > 1,
  };
};

/**
 * Event Enhancement Helper Functions
 */

// Helper to add lowest ticket price and distance to event data
export const enhanceEventData = async (event, lat, lng, distanceQuery) => {
  const eventData = { ...event };

  // Add lowest ticket price
  eventData.lowestTicketPrice = await getLowestTicketPrice(event.id, event.isFree);

  // Add tickets
  eventData.tickets = await db.query.eventTickets.findMany({
    where: eq(eventTickets.eventId, event.id),
  });

  // Calculate and format distance if coordinates are provided
  if (lat && lng && event.venue?.latitude && event.venue?.longitude) {
    const distanceKm = calculateDistance(lat, lng, event.venue.latitude, event.venue.longitude);

    eventData.distance = formatDistance(distanceKm, distanceQuery);
  }

  return eventData;
};

// Helper to enhance multiple events with price and distance data
export const enhanceEventsData = async (events, lat, lng, distanceQuery) => {
  return Promise.all(events.map(event => enhanceEventData(event, lat, lng, distanceQuery)));
};

/**
 * Location Filtering Utility (placeholder for future implementation)
 */
export const applyLocationFilter = (conditions, location) => {
  // Placeholder function - currently just returns conditions unchanged
  // Can be expanded for additional location filtering logic
  return conditions;
};

/**
 * Generates a unique slug by appending an incrementing suffix if duplicates exist.
 * e.g. "tech-meetup-abc12" → "tech-meetup-abc12-1" → "tech-meetup-abc12-2"
 *
 * @param {string} baseSlug - The initial slug (title-slugified + eventCode)
 * @returns {Promise<string>} A slug guaranteed to be unique in the events table
 */
export async function generateUniqueSlug(baseSlug) {
  // Check if the base slug is already taken
  const existing = await db.query.events.findFirst({
    where: eq(events.slug, baseSlug),
  });

  if (!existing) {
    return baseSlug; // No conflict, use as-is
  }

  // Find all slugs that start with the base slug followed by a dash and a number
  // e.g. "tech-meetup-abc12-1", "tech-meetup-abc12-2", ...
  const candidates = await db
    .select({ slug: events.slug })
    .from(events)
    .where(like(events.slug, `${baseSlug}-%`));

  // Extract the numeric suffixes from matching slugs
  let maxSuffix = 0;
  for (const { slug } of candidates) {
    const tail = slug.slice(baseSlug.length + 1); // strip "baseSlug-"
    const num = Number(tail);
    if (Number.isInteger(num) && num >= maxSuffix) {
      maxSuffix = num;
    }
  }

  return `${baseSlug}-${maxSuffix + 1}`;
}
