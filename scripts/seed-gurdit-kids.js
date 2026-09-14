import 'dotenv/config';
import { db } from '../src/db/index.js';
import {
  users,
  organizers,
  groups,
  groupMembers,
  groupCategories,
  categories,
  events,
  eventTickets,
} from '../src/db/schema/index.js';
import { eq } from 'drizzle-orm';
import slugify from 'slugify';
import { generateUniqueSlug } from '../src/utils/event-helpers.js';

function generateCode(prefix = 'X') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function main() {
  const email = 'gurdit@thefabcode.org';

  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (!user) throw new Error(`User not found: ${email}`);
  console.log('User:', user.id, user.email);

  // --- Kids category (for events) ---
  let kidsCategory = await db.query.categories.findFirst({
    where: eq(categories.name, 'Kids & Family'),
  });
  if (!kidsCategory) {
    [kidsCategory] = await db
      .insert(categories)
      .values({
        name: 'Kids & Family',
        description: 'Events designed for children and families',
        emoji: '🧒',
        createdAt: new Date(),
      })
      .returning();
    console.log('Created category:', kidsCategory.id, kidsCategory.name);
  } else {
    console.log('Category already exists:', kidsCategory.id, kidsCategory.name);
  }

  // --- Kids & Family group category ---
  let kidsGroupCategory = await db.query.groupCategories.findFirst({
    where: eq(groupCategories.name, 'Kids & Family'),
  });
  if (!kidsGroupCategory) {
    [kidsGroupCategory] = await db
      .insert(groupCategories)
      .values({
        name: 'Kids & Family',
        description: 'Community groups for kids and family events',
        emoji: '🧒',
        createdAt: new Date(),
      })
      .returning();
    console.log('Created group category:', kidsGroupCategory.id, kidsGroupCategory.name);
  } else {
    console.log('Group category already exists:', kidsGroupCategory.id, kidsGroupCategory.name);
  }

  // --- Group ---
  let group = await db.query.groups.findFirst({
    where: eq(groups.name, 'Little Explorers Kids Club'),
  });
  if (!group) {
    const baseSlug = slugify('Little Explorers Kids Club', { lower: true, strict: true });
    [group] = await db
      .insert(groups)
      .values({
        name: 'Little Explorers Kids Club',
        description:
          'A community for parents and kids to find fun local events, playdates, and workshops.',
        isPublic: true,
        requiresApproval: false,
        address: '123 Main St, San Francisco, CA',
        city: 'San Francisco',
        state: 'CA',
        country: 'US',
        countryCode: 'US',
        postalCode: '94103',
        slug: baseSlug,
        categoryId: kidsGroupCategory.id,
        isPaid: false,
        createdBy: user.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    console.log('Created group:', group.id, group.name);

    await db
      .insert(groupMembers)
      .values({
        groupId: group.id,
        userId: user.id,
        role: 'admin',
        status: 'joined',
        joinedAt: new Date(),
      })
      .onConflictDoNothing();
  } else {
    console.log('Group already exists:', group.id, group.name);
  }

  // --- Events ---
  const now = new Date();

  const eventSpecs = [
    {
      title: 'Kids Story Time in the Park',
      description:
        "A free, cozy storytelling session for kids ages 3-8 with a local children's author. Bring a blanket and enjoy an afternoon of imagination!",
      isFree: true,
      startInDays: 14,
      durationHours: 2,
      capacity: 60,
      tickets: [{ name: 'Free Admission', price: 0 }],
    },
    {
      title: 'Kids Birthday Bash Workshop',
      description:
        'A full afternoon birthday party experience for kids ages 5-12 — crafts, games, face painting, and a party host. Includes goodie bag.',
      isFree: false,
      startInDays: 28,
      durationHours: 3,
      capacity: 40,
      tickets: [
        { name: 'Child Ticket', price: 25 },
        { name: 'Adult/Guardian Ticket', price: 10 },
      ],
    },
  ];

  for (const spec of eventSpecs) {
    const exists = await db.query.events.findFirst({ where: eq(events.title, spec.title) });
    if (exists) {
      console.log(`Event already exists, skipping: ${spec.title}`);
      continue;
    }

    const startDate = new Date(now.getTime() + spec.startInDays * 24 * 60 * 60 * 1000);
    const endDate = new Date(startDate.getTime() + spec.durationHours * 60 * 60 * 1000);

    const baseSlug = slugify(spec.title, { lower: true, strict: true });
    const slug = await generateUniqueSlug(baseSlug);

    await db.transaction(async tx => {
      const [createdEvent] = await tx
        .insert(events)
        .values({
          eventCode: generateCode('EVT'),
          title: spec.title,
          slug,
          description: spec.description,
          organizerId: 'f98430c7-d2ff-40b4-b38e-dcc7673f2bc3',
          categoryIds: [kidsCategory.id],
          venueId: null,
          isFree: spec.isFree,
          startDate,
          endDate,
          capacity: spec.capacity,
          coverImages: [`https://picsum.photos/seed/${generateCode('IMG')}/1200/600`],
          eventType: 'public',
          eventStatus: 'published',
          eventMode: 'in_person',
          groupId: group.id,
          hostedBy: 'organizer',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      const salesStart = new Date();
      let salesEnd = new Date(startDate.getTime() - 24 * 60 * 60 * 1000);
      if (salesEnd <= salesStart) salesEnd = new Date(startDate.getTime() - 60 * 60 * 1000);

      for (const t of spec.tickets) {
        await tx.insert(eventTickets).values({
          ticketCode: generateCode('TCK'),
          eventId: createdEvent.id,
          name: t.name,
          description: `${t.name} for ${spec.title}`,
          price: Number(t.price).toFixed(2),
          quantityAvailable: Math.floor(spec.capacity / spec.tickets.length),
          quantitySold: 0,
          salesStart,
          salesEnd,
          minTicketsPerOrder: 1,
          maxTicketsPerOrder: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      console.log(`Created event: ${spec.title} (${createdEvent.id}) — isFree=${spec.isFree}`);
    });
  }

  console.log('Done.');
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
