import 'dotenv/config';
import bcrypt from 'bcrypt';
import { db } from '../src/db/index.js';
import { users } from '../src/db/schema/index.js';
import { createUser, createUserInformation } from '../src/services/user.service.js';

const DEFAULT_PASSWORD = 'Test@123';
const SALT_ROUNDS = 10;

const initialUsers = [
  {
    username: 'spiderman',
    email: 'peter.parker@gmail.com',
    name: 'Peter Parker',
    firstName: 'Peter',
    lastName: 'Parker',
    dob: '2001-08-10',
    bio: 'Your friendly neighborhood Spider-Man!',
    phoneNumber: '+15550001',
    isEmailVerified: true,
    timezone: 'America/New_York',
    locale: 'en-US',
    userInfo: {
      address: '20 Ingram St, Forest Hills, Queens, NY',
      city: 'New York',
      state: 'NY',
      country: 'USA',
      postalCode: '11375',
      latitude: '40.71350000',
      longitude: '-73.84480000',
    },
  },
  {
    username: 'ironman',
    email: 'tony.stark@gmail.com',
    name: 'Tony Stark',
    firstName: 'Tony',
    lastName: 'Stark',
    dob: '1970-05-29',
    bio: 'Genius, billionaire, playboy, philanthropist.',
    phoneNumber: '+15550002',
    isEmailVerified: true,
    timezone: 'America/Los_Angeles',
    locale: 'en-US',
    userInfo: {
      address: '10880 Malibu Point',
      city: 'Malibu',
      state: 'CA',
      country: 'USA',
      postalCode: '90265',
      latitude: '34.02590000',
      longitude: '-118.77980000',
    },
  },
  {
    username: 'captainamerica',
    email: 'steve.rogers@gmail.com',
    name: 'Steve Rogers',
    firstName: 'Steve',
    lastName: 'Rogers',
    dob: '1918-07-04',
    bio: 'I can do this all day.',
    phoneNumber: '+15550003',
    isEmailVerified: true,
    timezone: 'America/New_York',
    locale: 'en-US',
    userInfo: {
      address: '569 Leaman Place, Brooklyn',
      city: 'New York',
      state: 'NY',
      country: 'USA',
      postalCode: '11201',
      latitude: '40.69250000',
      longitude: '-73.99030000',
    },
  },
  {
    username: 'blackwidow',
    email: 'natasha.romanoff@gmail.com',
    name: 'Natasha Romanoff',
    firstName: 'Natasha',
    lastName: 'Romanoff',
    dob: '1984-11-22',
    bio: 'I\u2019m done running from my past.',
    phoneNumber: '+15550004',
    isEmailVerified: true,
    timezone: 'Europe/Moscow',
    locale: 'ru-RU',
    userInfo: {
      address: 'S.H.I.E.L.D. HQ, 1000 Triskelion Way',
      city: 'Washington',
      state: 'DC',
      country: 'USA',
      postalCode: '20500',
      latitude: '38.89770000',
      longitude: '-77.03650000',
    },
  },
  {
    username: 'thor',
    email: 'thor.odinson@gmail.com',
    name: 'Thor Odinson',
    firstName: 'Thor',
    lastName: 'Odinson',
    dob: '0964-04-15',
    bio: 'God of Thunder.',
    phoneNumber: '+15550005',
    isEmailVerified: true,
    timezone: 'UTC',
    locale: 'en-GB',
    userInfo: {
      address: 'Royal Palace of Asgard',
      city: 'Asgard',
      state: 'Asgard',
      country: 'Nine Realms',
      postalCode: '00000',
      latitude: '0.00000000',
      longitude: '0.00000000',
    },
  },
  {
    username: 'hulk',
    email: 'bruce.banner@gmail.com',
    name: 'Bruce Banner',
    firstName: 'Bruce',
    lastName: 'Banner',
    dob: '1969-12-18',
    bio: "That's my secret, Cap: I'm always angry.",
    phoneNumber: '+15550006',
    isEmailVerified: true,
    timezone: 'America/Chicago',
    locale: 'en-US',
    userInfo: {
      address: 'Culver University, 123 Science Dr',
      city: 'Willowdale',
      state: 'VA',
      country: 'USA',
      postalCode: '22180',
      latitude: '38.90120000',
      longitude: '-77.26540000',
    },
  },
  {
    username: 'blackpanther',
    email: 'tchalla@gmail.com',
    name: "T'Challa",
    firstName: "T'Challa",
    lastName: 'Udaku',
    dob: '1980-11-20',
    bio: 'Wakanda Forever!',
    phoneNumber: '+15550007',
    isEmailVerified: true,
    timezone: 'Africa/Cairo',
    locale: 'en-US',
    userInfo: {
      address: 'Golden City Palace',
      city: 'Birnin Zana',
      state: 'Central Region',
      country: 'Wakanda',
      postalCode: '99999',
      latitude: '-0.18670000',
      longitude: '37.81360000',
    },
  },
  {
    username: 'scarletwitch',
    email: 'wanda.maximoff@gmail.com',
    name: 'Wanda Maximoff',
    firstName: 'Wanda',
    lastName: 'Maximoff',
    dob: '1989-02-10',
    bio: 'You guys know I can move things with my mind, right?',
    phoneNumber: '+15550008',
    isEmailVerified: true,
    timezone: 'Europe/Berlin',
    locale: 'en-US',
    userInfo: {
      address: '2800 Sherwood Terrace',
      city: 'Westview',
      state: 'NJ',
      country: 'USA',
      postalCode: '08037',
      latitude: '39.61050000',
      longitude: '-74.80620000',
    },
  },
  {
    username: 'drstrange',
    email: 'stephen.strange@gmail.com',
    name: 'Stephen Strange',
    firstName: 'Stephen',
    lastName: 'Strange',
    dob: '1930-11-18',
    bio: 'Master of the Mystic Arts.',
    phoneNumber: '+15550009',
    isEmailVerified: true,
    timezone: 'America/New_York',
    locale: 'en-US',
    userInfo: {
      address: '177A Bleecker St',
      city: 'New York',
      state: 'NY',
      country: 'USA',
      postalCode: '10012',
      latitude: '40.72890000',
      longitude: '-74.00020000',
    },
  },
  {
    username: 'starlord',
    email: 'peter.quill@gmail.com',
    name: 'Peter Quill',
    firstName: 'Peter',
    lastName: 'Quill',
    dob: '1980-05-01',
    bio: 'Leader of the Guardians of the Galaxy.',
    phoneNumber: '+15550010',
    isEmailVerified: true,
    timezone: 'UTC',
    locale: 'en-US',
    userInfo: {
      address: 'The Milano Spaceship',
      city: 'Knowhere',
      state: 'Outer Space',
      country: 'Andromeda Galaxy',
      postalCode: '00000',
      latitude: '0.00000000',
      longitude: '0.00000000',
    },
  },
];

export async function seedUsers() {
  console.log('Seeding users...');

  const existing = await db.select().from(users).limit(2);
  if (existing.length > 1) {
    console.log('More than 1 user exists, skipping user seeding');
    return;
  }

  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, SALT_ROUNDS);

  for (const u of initialUsers) {
    try {
      const payload = {
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
        timezone: u.timezone,
        locale: u.locale,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const user = await createUser(payload);

      // create userInformation record if provided
      const info = u.userInfo || {};
      await createUserInformation(user.id, {
        address: info.address || '',
        city: info.city || null,
        state: info.state || null,
        country: info.country || null,
        postalCode: info.postalCode || null,
        latitude: info.latitude ? parseFloat(info.latitude) : null,
        longitude: info.longitude ? parseFloat(info.longitude) : null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      console.log(`Created user: ${user.email}`);
    } catch (err) {
      console.warn(`Failed to create user ${u.email}:`, err.message || err);
    }
  }

  console.log('User seeding completed.');
}

async function main() {
  seedUsers()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Error seeding users:', err);
      process.exit(1);
    });
}

main();
