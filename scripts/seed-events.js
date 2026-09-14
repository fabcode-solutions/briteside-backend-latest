import 'dotenv/config';
import { db } from '../src/db/index.js';
import {
  events,
  eventTickets,
  eventVenueProfiles,
  categories,
  venues,
  organizers,
} from '../src/db/schema/index.js';
import { eq } from 'drizzle-orm';
import { seedOrganizer } from './seed-organizer.js';
import slugify from 'slugify';
import { generateUniqueSlug } from '../src/utils/event-helpers.js';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);

function generateCode(prefix = 'X') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function addWeeks(date, weeks) {
  return new Date(date.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);
}

function splitCapacity(capacity, weights) {
  const keys = Object.keys(weights);
  const result = {};
  let total = 0;

  for (const key of keys) {
    const qty = Math.floor(capacity * weights[key]);
    result[key] = qty;
    total += qty;
  }

  // assign remainder to the largest bucket (General or last key)
  const remainder = capacity - total;
  if (remainder > 0) {
    const bucket = keys.includes('General') ? 'General' : keys[keys.length - 1];
    result[bucket] += remainder;
  }

  return result;
}

async function seedEvents({ organizerId = null } = {}) {
  console.log('Seeding events...');

  const found = await db.query.events.findMany({ limit: 1 });
  if (found.length > 0) {
    console.log('Events already exist, skipping event seed');
    return;
  }

  let organizer;
  if (typeof organizerId === 'string' && organizerId) {
    organizer = await db.query.organizers.findFirst({ where: eq(organizers.id, organizerId) });
    if (!organizer) throw new Error(`Organizer not found with id ${organizerId}`);
  } else {
    organizer = await seedOrganizer();
    if (!organizer) throw new Error('Organizer creation failed; cannot seed events');
  }

  // Event specs
  const now = new Date();
  const eventSpecs = [
    {
      title: 'Music Meetup',
      categoryName: 'Music',
      venueName: 'Cafe Central',
      isFree: true,
      startInWeeks: 1,
      durationHours: 2,
      tickets: null, // free, single ticket
    },
    {
      title: 'Park Concert',
      categoryName: 'Music',
      venueName: 'City Park Amphitheater',
      isFree: true,
      startInWeeks: 2,
      durationHours: 3,
      tickets: null,
    },
    {
      title: 'Tech Workshop',
      categoryName: 'Technology',
      venueName: 'Downtown Conference Center',
      isFree: false,
      startInWeeks: 4,
      durationHours: 4,
      tickets: [
        { key: 'EarlyBird', name: 'Early Bird', price: 25 },
        { key: 'General', name: 'General Admission', price: 40 },
        { key: 'VIP', name: 'VIP', price: 100 },
      ],
    },
    {
      title: 'Business Summit',
      categoryName: 'Business',
      venueName: 'Ravin Events Hall',
      isFree: false,
      startInWeeks: 5,
      durationDays: 2,
      tickets: [
        { key: 'General', name: 'General Admission', price: 199 },
        { key: 'VIP', name: 'VIP', price: 499 },
      ],
    },
    {
      title: 'Food Festival',
      categoryName: 'Food & Drink',
      venueName: 'City Park Amphitheater',
      isFree: false,
      startInWeeks: 6,
      durationHours: 8,
      tickets: [
        { key: 'General', name: 'GA', price: 15 },
        { key: 'VIP', name: 'VIP', price: 60 },
      ],
    },
  ];

  // default weight distribution for paid events
  const defaultWeights = {
    VIP: 0.1,
    EarlyBird: 0.1,
    Reserved: 0.2,
    General: 0.6,
  };

  const venueProfilesByVenueName = {
    'Ravin Events Hall': {
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
    'Downtown Conference Center': {
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
    'City Park Amphitheater': {
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
    'Cafe Central': {
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
  };

  for (const spec of eventSpecs) {
    // fetch category(s) & venue
    const venue = await db.query.venues.findFirst({ where: eq(venues.name, spec.venueName) });

    // support either `categoryName` (string) or `categoryNames` (array)
    const categoryNames = spec.categoryNames || (spec.categoryName ? [spec.categoryName] : []);
    if (!categoryNames || categoryNames.length === 0) {
      throw new Error(`No categories specified for event '${spec.title}'`);
    }

    const categoryIds = [];
    for (const name of categoryNames) {
      const cat = await db.query.categories.findFirst({ where: eq(categories.name, name) });
      if (!cat) throw new Error(`Category not found: ${name}`);
      categoryIds.push(cat.id);
    }

    if (!venue) throw new Error(`Venue not found: ${spec.venueName}`);

    console.log(
      `Preparing event: ${spec.title}, categories=${categoryNames.join(',')}, venue=${spec.venueName}`
    );

    // compute dates
    const startDate = addWeeks(now, spec.startInWeeks);
    let endDate;
    if (spec.durationDays) {
      endDate = new Date(startDate.getTime() + spec.durationDays * 24 * 60 * 60 * 1000);
    } else {
      endDate = new Date(startDate.getTime() + (spec.durationHours || 2) * 60 * 60 * 1000);
    }

    // determine capacity
    const venueProfileSeed = venueProfilesByVenueName[spec.venueName] || {};
    const capacity = spec.capacity || venueProfileSeed.capacity || 100;
    if (!capacity)
      throw new Error(`No capacity specified for event '${spec.title}' and venue '${venue.name}'`);

    // prepare tickets
    let ticketsToCreate = [];

    if (spec.isFree) {
      const salesStart = new Date();
      let salesEnd = new Date(startDate.getTime() - 24 * 60 * 60 * 1000);
      if (salesEnd <= salesStart) salesEnd = new Date(startDate.getTime() - 60 * 60 * 1000);

      ticketsToCreate.push({
        ticketCode: generateCode('TCK'),
        name: 'Free Admission',
        description: 'Free entry ticket',
        price: '0.00',
        quantityAvailable: capacity,
        quantitySold: 0,
        salesStart,
        salesEnd,
        minTicketsPerOrder: 1,
        maxTicketsPerOrder: null,
      });
    } else {
      // split capacity among tiers using default weights
      const weights = { ...defaultWeights };
      // If spec.tickets doesn't include some keys (e.g., no EarlyBird), ensure division among present tiers
      const keysInSpec = spec.tickets.map(t => t.key);
      // build weight map for present keys
      const weightMap = {};
      let totalWeights = 0;
      for (const tk of keysInSpec) {
        const w = weights[tk] ?? (tk === 'General' ? 0.6 : 0.1);
        weightMap[tk] = w;
        totalWeights += w;
      }
      // normalize weights so sum === 1
      for (const k of Object.keys(weightMap)) weightMap[k] = weightMap[k] / totalWeights;

      const split = splitCapacity(capacity, weightMap);

      const salesStart = new Date();
      let salesEnd = new Date(startDate.getTime() - 24 * 60 * 60 * 1000);
      if (salesEnd <= salesStart) salesEnd = new Date(startDate.getTime() - 60 * 60 * 1000);

      ticketsToCreate = spec.tickets.map(t => ({
        ticketCode: generateCode('TCK'),
        name: t.name,
        description: `${t.name} ticket`,
        price: Number(t.price).toFixed(2),
        quantityAvailable: split[t.key] ?? 0,
        quantitySold: 0,
        salesStart,
        salesEnd,
        minTicketsPerOrder: 1,
        maxTicketsPerOrder: null,
      }));
    }

    // Insert event + tickets in a transaction
    await db.transaction(async tx => {
      // skip if an event with same title + startDate exists
      const exists = await tx.query.events.findFirst({
        where: eq(events.title, spec.title),
      });

      if (exists) {
        console.log(`Event already exists, skipping: ${spec.title}`);
        return;
      }

      // generate unique slug and ensure cover images and categoryIds are set
      const baseSlug = slugify(spec.title, { lower: true, strict: true });
      const slug = await generateUniqueSlug(baseSlug);
      const coverImagesToUse = spec.coverImages || [
        `https://picsum.photos/seed/${generateCode('IMG')}/1200/600`,
      ];

      const [createdEvent] = await tx
        .insert(events)
        .values({
          eventCode: generateCode('EVT'),
          title: spec.title,
          slug,
          description: `${spec.title} - seeded event`,
          organizerId: organizer.id,
          categoryIds,
          venueId: venue.id,
          isFree: !!spec.isFree,
          startDate,
          endDate,
          capacity,
          coverImages: coverImagesToUse,
          eventType: 'public',
          eventStatus: 'published',
          eventMode: 'in_person',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      if (!createdEvent) throw new Error(`Failed to create event ${spec.title}`);

      await tx
        .insert(eventVenueProfiles)
        .values({
          eventId: createdEvent.id,
          venueId: venue.id,
          description: venueProfileSeed.description || null,
          capacity,
          amenities: venueProfileSeed.amenities || [],
          additionalInformation: venueProfileSeed.additionalInformation || {},
          cancellationPolicy: venueProfileSeed.cancellationPolicy || null,
          accessibility: venueProfileSeed.accessibility || [],
          contactEmail: venueProfileSeed.contactEmail || null,
          contactPhone: venueProfileSeed.contactPhone || null,
          parkingInfo: venueProfileSeed.parkingInfo || null,
          publicTransportInfo: venueProfileSeed.publicTransportInfo || null,
          emoji: venueProfileSeed.emoji || null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoNothing();

      // attach tickets
      for (const t of ticketsToCreate) {
        await tx.insert(eventTickets).values({
          ticketCode: t.ticketCode,
          eventId: createdEvent.id,
          name: t.name,
          description: t.description,
          price: t.price,
          quantityAvailable: t.quantityAvailable,
          quantitySold: 0,
          salesStart: t.salesStart,
          salesEnd: t.salesEnd,
          minTicketsPerOrder: t.minTicketsPerOrder,
          maxTicketsPerOrder: t.maxTicketsPerOrder,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      console.log(`Created event and tickets: ${spec.title}`);
    });
  }

  console.log('Event seeding completed');
}

async function main() {
  try {
    // CLI option: --organizer=<organizerId>
    const orgArg = process.argv.find(
      a => a.startsWith('--organizer=') || a.startsWith('--organizerId=')
    );
    const organizerId = orgArg ? orgArg.split('=')[1] : process.env.SEED_ORGANIZER_ID || null;

    await seedEvents({ organizerId });
    process.exit(0);
  } catch (error) {
    console.error('Error seeding events:', error);
    process.exit(1);
  }
}

export { seedEvents };

// Run directly when invoked as a script
if (process.argv[1] === __filename) {
  main();
}
