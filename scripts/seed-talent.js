import 'dotenv/config';
/**
 * scripts/seed-talent.js
 *
 * Seeds 10 realistic American talent users with full profiles,
 * availability windows, and correct data shapes matching the backend schema.
 *
 * Usage:
 *   node scripts/seed-talent.js
 *
 * Or add to package.json:
 *   "seed:talent": "node scripts/seed-talent.js"
 *
 * ── Rate note ────────────────────────────────────────────────────────────────
 * rates are stored as DOLLAR amounts (not cents).
 * getAvailableSlots() does: Math.round((rates[duration] || 0) * 100)
 * So rates: { "15": 100 } → priceCents = 10000 = $100.00 ✓
 * ────────────────────────────────────────────────────────────────────────────
 */

import bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import { fileURLToPath } from 'url';
import { db } from '../src/db/index.js';
import { users } from '../src/db/schema/index.js';
import { talentProfiles } from '../src/db/schema/talentProfiles.js';
import { talentAvailability } from '../src/db/schema/talentAvailability.js';
import { createUser, createUserInformation } from '../src/services/user.service.js';

const __filename = fileURLToPath(import.meta.url);

const PASSWORD = 'User@Qa2026';
const SALT_ROUNDS = 10;

// ─── Talent definitions ───────────────────────────────────────────────────────

const talentUsers = [
  // ── 1. Marcus Williams — Business / Executive Coach (New York) ────────────
  {
    user: {
      username: 'marcuswilliams',
      email: 'marcus.williams@briteside.dev',
      name: 'Marcus Williams',
      firstName: 'Marcus',
      lastName: 'Williams',
      dob: '1982-03-14',
      bio: 'Former Fortune 500 executive turned coach. I help entrepreneurs and leaders unlock their potential, build high-performing teams, and scale with confidence. 20+ years in corporate strategy across tech and finance.',
      phoneNumber: '+15551001',
      isEmailVerified: true,
      timezone: 'America/New_York',
      locale: 'en-US',
      image:
        'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=400&fit=crop&crop=face',
    },
    userInfo: {
      address: '245 Park Avenue, Suite 1700',
      city: 'New York',
      state: 'NY',
      country: 'USA',
      postalCode: '10167',
      latitude: 40.7549,
      longitude: -73.9784,
    },
    talentProfile: {
      category: 'Business',
      title: 'Executive Coach & Business Strategist',
      bio: 'With two decades at the intersection of strategy and leadership, I have guided over 300 professionals from mid-level managers to C-suite executives. My coaching philosophy combines data-driven goal-setting with deep emotional intelligence work. Past clients include founders of 3 unicorn startups and senior leaders at Goldman Sachs, Google, and PepsiCo.\n\nSpecialties: Leadership development, board-level communication, M&A readiness, team culture, and scaling operations from $1M to $100M ARR.',
      location: 'New York, NY',
      introVideoUrl: 'https://www.w3schools.com/html/mov_bbb.mp4',
      rates: { 15: 150, 30: 280, 45: 390, 60: 480 },
      languages: ['English', 'Spanish'],
      isVerified: true,
      isActive: true,
      rating: '4.97',
      reviewCount: 214,
      totalSessions: 331,
      priorityMessageFee: 500,
    },
    availability: {
      dayOfWeek: [1, 2, 3, 4, 5],
      startTime: '08:00',
      endTime: '18:00',
      timezone: 'America/New_York',
      durations: [15, 30, 45, 60],
      priceOverrides: { '08:00-10:00': 1.15 },
      blockedDates: [],
      isActive: true,
    },
  },

  // ── 2. Ashley Chen — Technology / AI & Software (San Francisco) ───────────
  {
    user: {
      username: 'ashleychen',
      email: 'ashley.chen@briteside.dev',
      name: 'Ashley Chen',
      firstName: 'Ashley',
      lastName: 'Chen',
      dob: '1991-07-22',
      bio: 'Staff engineer at a top-5 tech company by day, mentor and builder by night. Passionate about AI, distributed systems, and helping the next generation of engineers land their dream roles.',
      phoneNumber: '+15551002',
      isEmailVerified: true,
      timezone: 'America/Los_Angeles',
      locale: 'en-US',
      image:
        'https://images.unsplash.com/photo-1573496799652-408c2ac9fe98?w=400&h=400&fit=crop&crop=face',
    },
    userInfo: {
      address: '500 Pine Street',
      city: 'San Francisco',
      state: 'CA',
      country: 'USA',
      postalCode: '94104',
      latitude: 37.7879,
      longitude: -122.4074,
    },
    talentProfile: {
      category: 'Technology',
      title: 'Staff Software Engineer & AI Product Advisor',
      bio: 'I have shipped production ML systems used by 50M+ users and led platform teams of 20+ engineers. Whether you need to crack FAANG interviews, architect a scalable backend, debug a gnarly distributed system issue, or figure out how to actually ship an AI product — I have been there.\n\nI specialize in: System design, large language model integrations, Python/Go backends, Kubernetes, and navigating senior-to-staff career transitions. My mock interview candidates have a 78% offer rate at FAANG companies.',
      location: 'San Francisco, CA',
      introVideoUrl: 'https://www.w3schools.com/html/mov_bbb.mp4',
      rates: { 15: 125, 30: 220, 45: 300, 60: 380 },
      languages: ['English', 'Mandarin'],
      isVerified: true,
      isActive: true,
      rating: '4.95',
      reviewCount: 187,
      totalSessions: 265,
      priorityMessageFee: 500,
    },
    availability: {
      dayOfWeek: [1, 3, 5, 6],
      startTime: '17:00',
      endTime: '22:00',
      timezone: 'America/Los_Angeles',
      durations: [30, 45, 60],
      priceOverrides: {},
      blockedDates: [],
      isActive: true,
    },
  },

  // ── 3. DeShawn Carter — Fitness / Performance Training (Chicago) ──────────
  {
    user: {
      username: 'deshawncarter',
      email: 'deshawn.carter@briteside.dev',
      name: 'DeShawn Carter',
      firstName: 'DeShawn',
      lastName: 'Carter',
      dob: '1988-11-05',
      bio: 'NSCA-certified strength & conditioning specialist. Former D1 football athlete. I train NFL prospects, serious amateurs, and everyday people who want to move, feel, and perform better.',
      phoneNumber: '+15551003',
      isEmailVerified: true,
      timezone: 'America/Chicago',
      locale: 'en-US',
      image:
        'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=400&h=400&fit=crop&crop=face',
    },
    userInfo: {
      address: '2400 N Lakeview Ave',
      city: 'Chicago',
      state: 'IL',
      country: 'USA',
      postalCode: '60614',
      latitude: 41.9231,
      longitude: -87.6382,
    },
    talentProfile: {
      category: 'Fitness',
      title: 'Elite Strength & Performance Coach',
      bio: 'Ten years coaching athletes from high school to the pros. I have worked with 12 NFL draft picks, multiple collegiate All-Americans, and hundreds of weekend warriors who just want to stop getting hurt and start feeling great.\n\nMy sessions cover: Movement assessment, powerlifting programming, speed and agility development, sports nutrition basics, injury prevention, and mental performance.',
      location: 'Chicago, IL',
      introVideoUrl: 'https://www.w3schools.com/html/mov_bbb.mp4',
      rates: { 15: 80, 30: 140, 45: 190, 60: 240 },
      languages: ['English'],
      isVerified: true,
      isActive: true,
      rating: '4.92',
      reviewCount: 309,
      totalSessions: 450,
      priorityMessageFee: 500,
    },
    availability: {
      dayOfWeek: [1, 2, 3, 4, 5, 6],
      startTime: '06:00',
      endTime: '14:00',
      timezone: 'America/Chicago',
      durations: [15, 30, 60],
      priceOverrides: { '06:00-08:00': 1.1 },
      blockedDates: [],
      isActive: true,
    },
  },

  // ── 4. Sophia Martinez — Music / Vocal & Songwriting (Los Angeles) ─────────
  {
    user: {
      username: 'sophiamartinez',
      email: 'sophia.martinez@briteside.dev',
      name: 'Sophia Martinez',
      firstName: 'Sophia',
      lastName: 'Martinez',
      dob: '1994-02-19',
      bio: 'Grammy-nominated singer-songwriter and vocal coach. I have written songs placed in major network TV shows and worked with artists on three continents. Teaching music is my true calling.',
      phoneNumber: '+15551004',
      isEmailVerified: true,
      timezone: 'America/Los_Angeles',
      locale: 'en-US',
      image:
        'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=400&h=400&fit=crop&crop=face',
    },
    userInfo: {
      address: '8721 Sunset Blvd',
      city: 'Los Angeles',
      state: 'CA',
      country: 'USA',
      postalCode: '90069',
      latitude: 34.0905,
      longitude: -118.3853,
    },
    talentProfile: {
      category: 'Music',
      title: 'Grammy-Nominated Vocalist & Songwriting Coach',
      bio: 'I started playing piano at age 5 and never stopped. Today I coach emerging artists, help established musicians break through creative blocks, and teach songwriting from chord progressions to professional pitching.\n\nWhat I offer: Vocal technique (belt, mix, head voice), breath control, stage presence, songwriting structure, co-writing sessions, music theory for non-theory people, and navigating the modern streaming-first music industry.',
      location: 'Los Angeles, CA',
      introVideoUrl: 'https://www.w3schools.com/html/mov_bbb.mp4',
      rates: { 15: 100, 30: 175, 45: 235, 60: 290 },
      languages: ['English', 'Spanish'],
      isVerified: true,
      isActive: true,
      rating: '4.98',
      reviewCount: 156,
      totalSessions: 228,
      priorityMessageFee: 500,
    },
    availability: {
      dayOfWeek: [2, 4, 6, 0],
      startTime: '10:00',
      endTime: '20:00',
      timezone: 'America/Los_Angeles',
      durations: [30, 45, 60],
      priceOverrides: {},
      blockedDates: [],
      isActive: true,
    },
  },

  // ── 5. Tyler Brooks — Comedy / Content Creation (New York) ───────────────
  {
    user: {
      username: 'tylerbrooks',
      email: 'tyler.brooks@briteside.dev',
      name: 'Tyler Brooks',
      firstName: 'Tyler',
      lastName: 'Brooks',
      dob: '1990-09-30',
      bio: 'Comedian, writer, and content creator with 2.4M YouTube subscribers. I have toured 40 states, written for two late-night shows, and now help creators and brands find their comedic voice.',
      phoneNumber: '+15551005',
      isEmailVerified: true,
      timezone: 'America/New_York',
      locale: 'en-US',
      image:
        'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&h=400&fit=crop&crop=face',
    },
    userInfo: {
      address: '350 West 42nd Street',
      city: 'New York',
      state: 'NY',
      country: 'USA',
      postalCode: '10036',
      latitude: 40.758,
      longitude: -74.0005,
    },
    talentProfile: {
      category: 'Comedy',
      title: 'Comedian, Late-Night Writer & Content Strategist',
      bio: 'I have been making people laugh professionally since I was 22 — from open mics in basements to sold-out theaters to writing jokes that aired on national TV. Now I love helping others find their voice.\n\nI can help with: Stand-up material development, comedic writing for brand content, roast speeches, public speaking with humor, YouTube channel strategy, and building an authentic content personality.',
      location: 'New York, NY',
      introVideoUrl: 'https://www.w3schools.com/html/mov_bbb.mp4',
      rates: { 15: 90, 30: 160, 45: 210, 60: 260 },
      languages: ['English'],
      isVerified: true,
      isActive: true,
      rating: '4.91',
      reviewCount: 98,
      totalSessions: 142,
      priorityMessageFee: 500,
    },
    availability: {
      dayOfWeek: [1, 2, 4, 5],
      startTime: '12:00',
      endTime: '21:00',
      timezone: 'America/New_York',
      durations: [15, 30, 60],
      priceOverrides: {},
      blockedDates: [],
      isActive: true,
    },
  },

  // ── 6. Jordan Lee — Influencer / Personal Brand (Chicago) ────────────────
  {
    user: {
      username: 'jordanlee',
      email: 'jordan.lee@briteside.dev',
      name: 'Jordan Lee',
      firstName: 'Jordan',
      lastName: 'Lee',
      dob: '1996-04-08',
      bio: 'Social media strategist and personal brand consultant with 1.1M Instagram followers. I have helped 80+ creators go from zero to monetized and worked with brands like Nike, Glossier, and Adobe on influencer campaigns.',
      phoneNumber: '+15551006',
      isEmailVerified: true,
      timezone: 'America/Chicago',
      locale: 'en-US',
      image:
        'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=400&h=400&fit=crop&crop=face',
    },
    userInfo: {
      address: '111 S Michigan Ave',
      city: 'Chicago',
      state: 'IL',
      country: 'USA',
      postalCode: '60603',
      latitude: 41.8799,
      longitude: -87.6237,
    },
    talentProfile: {
      category: 'Influencer',
      title: 'Personal Brand Coach & Social Media Strategist',
      bio: 'I built my audience from scratch — no shortcuts, no fake followers, no algorithm hacks that stop working next month. Just genuine content strategy, consistent storytelling, and understanding what actually converts.\n\nI work with: Aspiring creators figuring out their niche, established influencers ready to monetize, professionals wanting a LinkedIn or Instagram presence, and small businesses wanting to build an authentic social voice.',
      location: 'Chicago, IL',
      introVideoUrl: 'https://www.w3schools.com/html/mov_bbb.mp4',
      rates: { 15: 110, 30: 195, 45: 265, 60: 320 },
      languages: ['English'],
      isVerified: true,
      isActive: true,
      rating: '4.93',
      reviewCount: 172,
      totalSessions: 241,
      priorityMessageFee: 500,
    },
    availability: {
      dayOfWeek: [1, 2, 3, 4, 5],
      startTime: '09:00',
      endTime: '19:00',
      timezone: 'America/Chicago',
      durations: [15, 30, 60],
      priceOverrides: {},
      blockedDates: [],
      isActive: true,
    },
  },

  // ── 7. Rachel Thompson — Education / Admissions & Career (Cambridge) ───────
  {
    user: {
      username: 'rachelthompson',
      email: 'rachel.thompson@briteside.dev',
      name: 'Rachel Thompson',
      firstName: 'Rachel',
      lastName: 'Thompson',
      dob: '1985-12-03',
      bio: 'Harvard-educated academic advisor and career coach. Former admissions officer at a top-10 university. I have helped 500+ students get into Ivy League schools and land roles at McKinsey, Google, and Goldman Sachs.',
      phoneNumber: '+15551007',
      isEmailVerified: true,
      timezone: 'America/New_York',
      locale: 'en-US',
      image:
        'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=400&h=400&fit=crop&crop=face',
    },
    userInfo: {
      address: '90 Mt Auburn St',
      city: 'Cambridge',
      state: 'MA',
      country: 'USA',
      postalCode: '02138',
      latitude: 42.3736,
      longitude: -71.1206,
    },
    talentProfile: {
      category: 'Education',
      title: 'Ivy League Admissions Advisor & Career Coach',
      bio: 'I spent six years on the inside of top-university admissions before moving to coaching, and that insider perspective has been transformative for my clients.\n\nI help with: College application essays and strategy (undergrad and MBA), interview prep for competitive programs, career pivots into consulting and finance, resume and LinkedIn optimization, and navigating the early career decisions that shape the next decade. My MBA applicants have an acceptance rate of 67% at M7 programs.',
      location: 'Cambridge, MA',
      introVideoUrl: 'https://www.w3schools.com/html/mov_bbb.mp4',
      rates: { 15: 175, 30: 325, 45: 450, 60: 560 },
      languages: ['English', 'French'],
      isVerified: true,
      isActive: true,
      rating: '4.99',
      reviewCount: 263,
      totalSessions: 398,
      priorityMessageFee: 500,
    },
    availability: {
      dayOfWeek: [1, 2, 3, 4, 5],
      startTime: '07:00',
      endTime: '17:00',
      timezone: 'America/New_York',
      durations: [30, 60],
      priceOverrides: { '07:00-09:00': 1.1 },
      blockedDates: [],
      isActive: true,
    },
  },

  // ── 8. James Harrington — Athletes / Basketball Training (Phoenix) ─────────
  {
    user: {
      username: 'jamesharrington',
      email: 'james.harrington@briteside.dev',
      name: 'James Harrington',
      firstName: 'James',
      lastName: 'Harrington',
      dob: '1986-06-17',
      bio: 'Former professional basketball player (10 seasons, 3 overseas championships). Now a full-time skills trainer and mental performance coach for serious basketball players aged 14 to pro.',
      phoneNumber: '+15551008',
      isEmailVerified: true,
      timezone: 'America/Phoenix',
      locale: 'en-US',
      image:
        'https://images.unsplash.com/photo-1639415358065-fde8ac579ee2?w=400&h=400&fit=crop&crop=face',
    },
    userInfo: {
      address: '2910 E Camelback Rd',
      city: 'Phoenix',
      state: 'AZ',
      country: 'USA',
      postalCode: '85016',
      latitude: 33.5092,
      longitude: -111.9874,
    },
    talentProfile: {
      category: 'Athletes',
      title: 'Pro Basketball Veteran & Skills Trainer',
      bio: "Ten professional seasons gave me a perspective you can't find in YouTube videos or training academies. I know what separates players who make it from those who don't.\n\nI work with: High school players preparing for college recruitment, college players going through the draft process, pro players fine-tuning specific skills, and coaches developing systems. Areas: Ball handling, shooting mechanics, pick-and-roll reads, IQ development, film study, and the mental side.",
      location: 'Phoenix, AZ',
      introVideoUrl: 'https://www.w3schools.com/html/mov_bbb.mp4',
      rates: { 15: 100, 30: 180, 45: 250, 60: 310 },
      languages: ['English'],
      isVerified: true,
      isActive: true,
      rating: '4.94',
      reviewCount: 141,
      totalSessions: 204,
      priorityMessageFee: 500,
    },
    availability: {
      dayOfWeek: [1, 2, 3, 4, 5, 6],
      startTime: '07:00',
      endTime: '15:00',
      timezone: 'America/Phoenix',
      durations: [30, 45, 60],
      priceOverrides: {},
      blockedDates: [],
      isActive: true,
    },
  },

  // ── 9. Natalie Rodriguez — Art / Brand Identity Design (Denver) ───────────
  {
    user: {
      username: 'natalierodriguez',
      email: 'natalie.rodriguez@briteside.dev',
      name: 'Natalie Rodriguez',
      firstName: 'Natalie',
      lastName: 'Rodriguez',
      dob: '1993-08-25',
      bio: 'Senior brand designer with 10 years shaping visual identities for startups, agencies, and global brands. Past clients include Airbnb, Spotify, and a dozen venture-backed startups you use every day.',
      phoneNumber: '+15551009',
      isEmailVerified: true,
      timezone: 'America/Denver',
      locale: 'en-US',
      image:
        'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400&h=400&fit=crop&crop=face',
    },
    userInfo: {
      address: '1600 Glenarm Place',
      city: 'Denver',
      state: 'CO',
      country: 'USA',
      postalCode: '80202',
      latitude: 39.7472,
      longitude: -104.9903,
    },
    talentProfile: {
      category: 'Art',
      title: 'Brand Identity Designer & Creative Director',
      bio: 'I believe a great brand is a story told visually — and I have been telling those stories for a decade. My work sits at the intersection of strategy and aesthetics.\n\nI can help with: Logo and visual identity critique and redesign, Figma/design tool mentorship, portfolio reviews for junior designers, brand strategy workshops, design system structure, presentation design, and career guidance for designers trying to move from execution to creative leadership.',
      location: 'Denver, CO',
      introVideoUrl: 'https://www.w3schools.com/html/mov_bbb.mp4',
      rates: { 15: 120, 30: 210, 45: 285, 60: 350 },
      languages: ['English', 'Spanish'],
      isVerified: true,
      isActive: true,
      rating: '4.96',
      reviewCount: 88,
      totalSessions: 127,
      priorityMessageFee: 500,
    },
    availability: {
      dayOfWeek: [2, 3, 4, 5],
      startTime: '10:00',
      endTime: '18:00',
      timezone: 'America/Denver',
      durations: [30, 45, 60],
      priceOverrides: {},
      blockedDates: [],
      isActive: true,
    },
  },

  // ── 10. Evelyn Park — Fashion / Styling & Personal Image (Miami) ──────────
  {
    user: {
      username: 'evelynpark',
      email: 'evelyn.park@briteside.dev',
      name: 'Evelyn Park',
      firstName: 'Evelyn',
      lastName: 'Park',
      dob: '1989-01-14',
      bio: 'Celebrity stylist and personal image consultant based in Miami. I have dressed talent for the Met Gala, VMAs, and major brand campaigns. Now I bring that same expertise to everyday people who want to dress with intention.',
      phoneNumber: '+15551010',
      isEmailVerified: true,
      timezone: 'America/New_York',
      locale: 'en-US',
      image:
        'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=400&h=400&fit=crop&crop=face',
    },
    userInfo: {
      address: '1111 Brickell Avenue',
      city: 'Miami',
      state: 'FL',
      country: 'USA',
      postalCode: '33131',
      latitude: 25.7617,
      longitude: -80.1918,
    },
    talentProfile: {
      category: 'Fashion',
      title: 'Celebrity Stylist & Personal Image Consultant',
      bio: 'Style is not about expensive clothes — it is about knowing who you are and projecting that with confidence. I have worked with everyone from A-list celebrities to executives who just got promoted and realized their wardrobe did not match their new title.\n\nMy sessions cover: Wardrobe audits, dressing for your body type and lifestyle, building a work wardrobe that actually works, event and red carpet styling, color analysis, personal shopping guidance, and understanding how to spend strategically on fashion.',
      location: 'Miami, FL',
      introVideoUrl: 'https://www.w3schools.com/html/mov_bbb.mp4',
      rates: { 15: 95, 30: 170, 45: 230, 60: 285 },
      languages: ['English', 'Korean'],
      isVerified: true,
      isActive: true,
      rating: '4.90',
      reviewCount: 119,
      totalSessions: 178,
      priorityMessageFee: 500,
    },
    availability: {
      dayOfWeek: [1, 3, 5, 6, 0],
      startTime: '11:00',
      endTime: '20:00',
      timezone: 'America/New_York',
      durations: [15, 30, 60],
      priceOverrides: {},
      blockedDates: [],
      isActive: true,
    },
  },
];

// ─── Seed logic ───────────────────────────────────────────────────────────────

async function seedTalentUsers() {
  console.log('\n🎭  Starting talent user seed...\n');

  const passwordHash = await bcrypt.hash(PASSWORD, SALT_ROUNDS);

  for (const entry of talentUsers) {
    const { user: u, userInfo, talentProfile: tp, availability: av } = entry;

    console.log(`→ Processing ${u.name} (${u.username})...`);

    // ── 1. Skip if user already exists ────────────────────────────────────
    const existing = await db.query.users.findFirst({
      where: eq(users.email, u.email),
    });

    let userId;

    if (existing) {
      console.log(`  ⚠️  User already exists (${u.email}), skipping user creation.`);
      userId = existing.id;
    } else {
      // ── 2. Create user ───────────────────────────────────────────────────
      const createdUser = await createUser({
        username: u.username,
        email: u.email,
        passwordHash,
        name: u.name,
        firstName: u.firstName,
        lastName: u.lastName,
        dob: u.dob,
        bio: u.bio,
        phoneNumber: u.phoneNumber,
        isEmailVerified: u.isEmailVerified,
        image: u.image,
        timezone: u.timezone,
        locale: u.locale,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      userId = createdUser.id;
      console.log(`  ✅ User created: ${userId}`);

      // ── 3. Create userInformation ────────────────────────────────────────
      await createUserInformation(userId, {
        address: userInfo.address,
        city: userInfo.city,
        state: userInfo.state,
        country: userInfo.country,
        postalCode: userInfo.postalCode,
        latitude: userInfo.latitude,
        longitude: userInfo.longitude,
      });
      console.log(`  ✅ User information created.`);
    }

    // ── 4. Skip if talentProfile already exists ────────────────────────────
    const existingProfile = await db.query.talentProfiles.findFirst({
      where: eq(talentProfiles.userId, userId),
    });

    if (existingProfile) {
      console.log(`  ⚠️  Talent profile already exists, skipping.\n`);
      const existingProfile = await db.query.talentProfiles.findFirst({
        where: eq(talentProfiles.userId, userId),
      });
      continue;
    }

    // ── 5. Create talentProfile ────────────────────────────────────────────
    const [profile] = await db
      .insert(talentProfiles)
      .values({
        userId,
        category: tp.category,
        title: tp.title,
        bio: tp.bio,
        location: tp.location,
        introVideoUrl: tp.introVideoUrl,
        rates: tp.rates,
        languages: tp.languages,
        isVerified: tp.isVerified,
        isActive: tp.isActive,
        rating: tp.rating,
        reviewCount: tp.reviewCount,
        totalSessions: tp.totalSessions,
        priorityMessageFee: tp.priorityMessageFee,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    console.log(`  ✅ Talent profile created: ${profile.id}`);

    // ── 6. Create talentAvailability window ────────────────────────────────
    await db.insert(talentAvailability).values({
      talentProfileId: profile.id,
      dayOfWeek: av.dayOfWeek,
      startTime: av.startTime,
      endTime: av.endTime,
      timezone: av.timezone,
      durations: av.durations,
      priceOverrides: av.priceOverrides,
      blockedDates: av.blockedDates,
      isActive: av.isActive,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    console.log(`  ✅ Availability window created.`);
    console.log(
      `     Days: [${av.dayOfWeek.join(', ')}]  ${av.startTime}–${av.endTime}  ${av.timezone}`
    );
    console.log(`     Durations offered: [${av.durations.join(', ')}] min`);
    console.log(`     Rates (dollars): ${JSON.stringify(tp.rates)}\n`);
  }

  console.log('🎉  Talent seed complete!\n');
  console.log('─────────────────────────────────────────────────────────────');
  console.log('  Login password for all 10 talent users:');
  console.log(`  ${PASSWORD}`);
  console.log('─────────────────────────────────────────────────────────────');
  console.log('  Rate storage: dollars  →  getAvailableSlots × 100 = cents');
  console.log('  e.g. rates["30"] = 180  →  priceCents = 18000 = $180.00\n');
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main() {
  try {
    await seedTalentUsers();
    process.exit(0);
  } catch (error) {
    console.error('\n❌  Error seeding talent users:', error);
    process.exit(1);
  }
}

if (process.argv[1] === __filename) {
  main();
}

export { seedTalentUsers };
