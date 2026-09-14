import { db } from '../db/index.js';
import { venues } from '../db/schema/index.js';
import { and, eq, ilike, like } from 'drizzle-orm';
import ApiError from '../utils/api-error.js';
import { getUserInformation } from '../utils/helper.js';

export class VenueService {
  static async createVenue(userId, venueData) {
    const [venue] = await db
      .insert(venues)
      .values({
        ...venueData,
        createdBy: userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return venue;
  }

  static async getVenues() {
    const allVenues = await db.query.venues.findMany({
      orderBy: (venues, { asc }) => [asc(venues.name)],
    });

    return allVenues;
  }

  static async getVenueById(venueId) {
    const venue = await db.query.venues.findFirst({
      where: eq(venues.id, venueId),
    });

    return venue;
  }

  static async searchVenues(query) {
    if (!query) {
      return this.getVenues();
    }

    const searchResults = await db.query.venues.findMany({
      where: ilike(venues.name, `%${query}%`),
      orderBy: (venues, { asc }) => [asc(venues.name)],
    });

    return searchResults;
  }

  static async updateVenue(venueId, userId, venueData) {
    // Only allow owner (createdBy) to update the venue
    const existing = await db.query.venues.findFirst({
      where: eq(venues.id, venueId),
    });

    if (!existing) {
      throw new ApiError(404, 'Venue not found');
    }

    if (existing.createdBy !== userId) {
      throw new ApiError(403, 'Unauthorized to update this venue');
    }

    const {
      name,
      googlePlaceId,
      address,
      latitude,
      longitude,
      city,
      state,
      country,
      countryCode,
      postalCode,
      websiteUrl,
      isVerified,
    } = venueData;

    const updatePayload = {};
    if (name !== undefined) updatePayload.name = name;
    if (googlePlaceId !== undefined) updatePayload.googlePlaceId = googlePlaceId;
    if (address !== undefined) updatePayload.address = address;
    if (latitude !== undefined) updatePayload.latitude = latitude;
    if (longitude !== undefined) updatePayload.longitude = longitude;
    if (city !== undefined) updatePayload.city = city;
    if (state !== undefined) updatePayload.state = state;
    if (country !== undefined) updatePayload.country = country;
    if (countryCode !== undefined) updatePayload.countryCode = countryCode;
    if (postalCode !== undefined) updatePayload.postalCode = postalCode;
    if (websiteUrl !== undefined) updatePayload.websiteUrl = websiteUrl;
    if (isVerified !== undefined) updatePayload.isVerified = isVerified;

    updatePayload.updatedAt = new Date();

    const [updated] = await db
      .update(venues)
      .set(updatePayload)
      .where(eq(venues.id, venueId))
      .returning();

    return updated;
  }

  static async getVenuesLocations({ country, state, userId }) {
    const user = await getUserInformation(userId);
    const userLocation = user?.userInformation || {};
    const whereConditions = [];

    if (country) {
      whereConditions.push(eq(venues.country, country));
    } else if (userLocation.country) {
      whereConditions.push(eq(venues.country, userLocation.country));
    }

    if (state) {
      whereConditions.push(eq(venues.state, state));
    }
    // else if (userLocation.state) {
    //   whereConditions.push(eq(venues.state, userLocation.state));
    // }
    const whereClause = and(...whereConditions);
    const venuesLocation = await db.query.venues.findMany({
      columns: {
        country: true,
        state: true,
        countryCode: true,
        city: true,
        latitude: true,
        longitude: true,
        address: true,
      },
      where: whereClause,
    });
    return venuesLocation;
  }
}
