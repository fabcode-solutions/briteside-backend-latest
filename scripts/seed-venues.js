import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { db } from '../src/db/index.js';
import { eventVenueProfiles, events, venues, users } from '../src/db/schema/index.js';
import { eq, inArray, isNotNull } from 'drizzle-orm';

/**
 * Create or get a seeder user which will be used as createdBy for venues
 */
async function getSeederUser() {
  const seederEmail = 'seeder@dev.local';

  let user = await db.query.users.findFirst({
    where: eq(users.email, seederEmail),
  });

  if (!user) {
    const passwordHash = await bcrypt.hash('Password123!', 10);
    const [createdUser] = await db
      .insert(users)
      .values({
        firebaseUid: 'seed_firebase_uid',
        username: 'seed_user',
        email: seederEmail,
        passwordHash,
        firstName: 'Seed',
        lastName: 'User',
        phoneNumber: '0000000000',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    user = createdUser;
  }

  return user;
}

async function seedVenues() {
  console.log('Seeding venues...');

  const user = await getSeederUser();

  const now = new Date();

  const sampleVenues = [
    {
      name: 'Ravin Events Hall',
      googlePlaceId: 'place_ravin_events_hall',
      address: '123 Main St, Las Vegas, NV 89101',
      latitude: 36.169941,
      longitude: -115.139832,
      city: 'Las Vegas',
      state: 'NV',
      country: 'USA',
      countryCode: 'US',
      postalCode: '89101',
      websiteUrl: 'https://ravinevents.example',
      isVerified: true,
      profile: {
        description: 'Large events and conference hall with multiple stages',
        capacity: 5000,
        amenities: ['wifi', 'parking', 'stage', 'bar'],
        additionalInformation: { hours: '9am - 11pm' },
        cancellationPolicy: 'Refundable up to 72 hours before event',
        accessibility: ['wheelchair access', 'assistive-listening'],
        contactEmail: 'info@ravinevents.example',
        contactPhone: '+17025551212',
        parkingInfo: 'Onsite parking for 300 vehicles',
        publicTransportInfo: 'Near Metro Line 2',
        emoji: '🏛️',
      },
    },
    {
      name: 'Downtown Conference Center',
      googlePlaceId: 'place_downtown_conf_center',
      address: '45 Conference Ave, San Francisco, CA 94103',
      latitude: 37.774929,
      longitude: -122.419418,
      city: 'San Francisco',
      state: 'CA',
      country: 'USA',
      countryCode: 'US',
      postalCode: '94103',
      websiteUrl: 'https://downtowncc.example',
      isVerified: false,
      profile: {
        description: 'Modern venue for conferences, workshops and expos',
        capacity: 2000,
        amenities: ['wifi', 'projector', 'breakout-rooms'],
        additionalInformation: { nearbyRestaurants: true },
        cancellationPolicy: 'Non-refundable',
        accessibility: ['elevators'],
        contactEmail: 'events@downtowncc.example',
        contactPhone: '+14155559876',
        parkingInfo: 'Valet and limited public parking nearby',
        publicTransportInfo: 'Accessible via BART and buses',
        emoji: '🏢',
      },
    },
    {
      name: 'City Park Amphitheater',
      googlePlaceId: 'place_city_park_amphitheater',
      address: '88 Park Drive, Philadelphia, PA 19103',
      latitude: 39.952583,
      longitude: -75.165222,
      city: 'Philadelphia',
      state: 'PA',
      country: 'USA',
      countryCode: 'US',
      postalCode: '19103',
      websiteUrl: 'https://cityparkamps.example',
      isVerified: false,
      profile: {
        description: 'Outdoor amphitheater in the heart of the city park',
        capacity: 15000,
        amenities: ['seating', 'outdoor-stage', 'restrooms'],
        additionalInformation: { recommendedSeating: 'General Admission' },
        cancellationPolicy: 'Event may be rescheduled due to weather',
        accessibility: ['ramp-access'],
        contactEmail: 'info@cityparkamps.example',
        contactPhone: '+12155551212',
        parkingInfo: 'Street parking and park lots',
        publicTransportInfo: 'Bus and light rail access',
        emoji: '🎭',
      },
    },
    {
      name: 'Cafe Central',
      googlePlaceId: 'place_cafe_central',
      address: '200 Coffee Lane, Austin, TX 73301',
      latitude: 30.267153,
      longitude: -97.743057,
      city: 'Austin',
      state: 'TX',
      country: 'USA',
      countryCode: 'US',
      postalCode: '73301',
      websiteUrl: 'https://cafecentral.example',
      isVerified: false,
      profile: {
        description: 'Small indoor venue suitable for intimate shows and gatherings',
        capacity: 120,
        amenities: ['coffee', 'wifi'],
        additionalInformation: { petFriendly: false },
        cancellationPolicy: 'Free cancellation up to 24 hours before event',
        accessibility: ['entrance-ramp'],
        contactEmail: 'hello@cafecentral.example',
        contactPhone: '+15125552345',
        parkingInfo: 'Limited street parking',
        publicTransportInfo: 'Within walking distance of downtown transit',
        emoji: '☕',
      },
    },
  ];

  const profileByPlaceId = new Map(sampleVenues.map(venue => [venue.googlePlaceId, venue.profile]));

  try {
    // Insert canonical venues first
    for (const venue of sampleVenues) {
      const { profile, ...venueBase } = venue;
      await db
        .insert(venues)
        .values({
          ...venueBase,
          createdBy: user.id,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing();
    }

    const eventsWithVenue = await db.query.events.findMany({
      where: isNotNull(events.venueId),
      columns: { id: true, venueId: true },
    });

    if (eventsWithVenue.length === 0) {
      console.log('Venues seeded successfully (no events found, skipped event_venue_profiles)');
      return;
    }

    const venueIds = [...new Set(eventsWithVenue.map(event => event.venueId).filter(Boolean))];
    const venueRows = await db.query.venues.findMany({
      where: inArray(venues.id, venueIds),
      columns: { id: true, googlePlaceId: true },
    });
    const venueById = new Map(venueRows.map(venue => [venue.id, venue]));

    let seededProfilesCount = 0;

    for (const event of eventsWithVenue) {
      const venue = venueById.get(event.venueId);
      const template = profileByPlaceId.get(venue?.googlePlaceId) || {
        description: null,
        capacity: null,
        amenities: [],
        additionalInformation: {},
        cancellationPolicy: null,
        accessibility: [],
        contactEmail: null,
        contactPhone: null,
        parkingInfo: null,
        publicTransportInfo: null,
        emoji: null,
      };

      await db
        .insert(eventVenueProfiles)
        .values({
          eventId: event.id,
          venueId: event.venueId,
          ...template,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing();

      seededProfilesCount += 1;
    }

    console.log(
      `Venues seeded successfully. Attempted event_venue_profiles seed for ${seededProfilesCount} events`
    );
  } catch (error) {
    console.error('Error seeding venues:', error);
    throw error;
  }
}

async function main() {
  try {
    await seedVenues();
    process.exit(0);
  } catch (error) {
    console.error('Error during seeding:', error);
    process.exit(1);
  }
}

export { seedVenues };

// Run directly
main();
