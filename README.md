# Node Express Drizzle

Node Express drizzle-orm boilerplate in ECMAScript Modules(mjs)

## Getting Started

To get a local copy up and running, please follow these simple steps.

### Prerequisites

Here is what you need.

- Node.js (Version: >= 20.x)
- PostgreSQL (Version: >= 16.x)
- npm

## Development

### Setup

1. Setup Node If your Node version does not meet the project's requirements as instructed by the docs, either [manually](https://nodejs.org/dist/latest-v20.x/) or using a tool like [nvm](https://github.com/nvm-sh/nvm) or [volta](https://volta.sh/) (recommended)

2. Clone the repo

   ```bash
   git clone git@github.com:yadav-saurabh/node-express-drizzle.git
   ```

3. Go to the project folder

   ```bash
   cd node-express-drizzle
   ```

4. Install packages with yarn

   ```bash
   npm i
   ```

5. Set up your `.env` file
   - Duplicate `.env.example` to `.env`
   - Use `openssl rand -base64 32` to generate a key and add it under `JWT_SECRET` in the `.env` file.
   - Configure environment variables in the `.env` file. Replace `<db_name>`, `<db_user>`, `<db_password>`, `<db-host>` and `<db-port>` with their applicable values

     ```text
       # Database Credentials
       POSTGRESQL_HOST=<db-host>
       POSTGRESQL_PORT=<db-port>
       POSTGRESQL_DB_NAME=<db_name>
       POSTGRESQL_DB_USER=<db_user>
       POSTGRESQL_DB_PASSWORD=<db_password>
     ```

6. Database Setup
   - Quick start database using `docker-compose`

     > - **Requires Docker and Docker Compose to be installed**
     > - Will start a local Postgres instance

     ```bash
     docker-compose up
     ```

   - Manual Database setup
     1. [Download](https://www.postgresql.org/download/) and install postgres in your local (if you don't have it already).

     2. connect to postgres prompt `sudo -u postgres psql`

     3. Create a new user `CREATE USER my_user WITH ENCRYPTED PASSWORD 'user_password';`

     4. Create your own local db by executing `create database my_database;`

     5. Create your own local db by executing `grant all privileges on database my_database to my_user;`

     6. Now extract all the info and add it to your `.env`. The port is configurable and does not have to be 5432.

   - If you don't want to create a local DB. Then you can also consider using services like railway.app or render.
     - [Setup postgres DB with railway.app](https://docs.railway.app/guides/postgresql)
     - [Setup postgres DB with render](https://render.com/docs/databases)

7. Setting up the migrations

   ```bash
   npm run drizzle:migration-run
   ```

8. Run the node server
   - In Development

     ```bash
     npm run dev
     ```

   - In Production

     ```bash
     npm start
     ```

## Deployment

### ubuntu instance like in AWS,oracle etc

1. Update the system

   ```bash
   sudo apt update        # Fetches the list of available updates
   sudo apt upgrade       # Installs some updates; does not remove packages
   sudo apt full-upgrade  # Installs updates; may also remove some packages, if needed
   sudo apt autoremove    # Removes any old packages that are no longer needed
   ```

2. install pm2 globally

   ```bash
   npm install pm2 -g
   ```

3. Follow Development setup to get up and running the server in the instance

4. Expose the instance to the network for the node_server_port (Ingress Rules for TCP protocol)

5. allow firewall to accept the network for the port

   ```bash
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport node_server_port -j ACCEPT
   sudo netfilter-persistent save
   ```

6. use the public ip of the instance to access the node server ex: 111.11.11.11:node_server_port

#### using a custom domain (nginx and certbot)

1. Expose instance to accepts network on port 80 and 443 (Ingress Rules for TCP protocol)

2. allow firewall for port 80 and 443

   ```bash
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
   sudo netfilter-persistent save
   ```

3. install nginx

   ```bash
   sudo apt update
   sudo apt install nginx
   ```

4. Now, you will create a configuration block for the Node server

   ```bash
   sudo nano /etc/nginx/sites-available/your_domain
   ```

   add this to the file /etc/nginx/sites-available/your_domain

   ```text
     server {
       server_name your_domain www.your_domain;
         location / {
           proxy_pass http://localhost:node_server_port;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
         }
     }
   ```

5. Create a symlink, which tells Nginx to look for available web applications in the sites-available folder:

   ```bash
   sudo ln -s /etc/nginx/sites-available/your_domain /etc/nginx/sites-enabled/
   ```

6. Disable the default symlink otherwise, nginx will redirect all requests to the default site. Use the following command to unlink it.

   ```bash
    sudo unlink /etc/nginx/sites-enabled/default
   ```

7. Restart the Nginx service using the following command.

   ```bash
    sudo systemctl restart nginx
   ```

8. Install certbot

   ```bash
   sudo snap install core; sudo snap refresh core
   sudo snap install --classic certbot
   sudo ln -s /snap/bin/certbot /usr/bin/certbot
   ```

9. Obtain an SSL Certificate

   ```bash
   sudo certbot --nginx -d example.com -d www.example.com
   ```

10. Verifying Certbot Auto-Renewal

    ```bash
    sudo systemctl status snap.certbot.renew.service
    ```

## TODO

- [ ] Test
- [ ] CI/CD

# GoKyro API — Project Guide

## Project Overview

**GoKyro** is the backend API for **BriteSide** (`briteside.app`) — a comprehensive event management and social platform. It handles event ticketing, community groups, live streaming, talent booking, social features, and payments.

- **Runtime:** Node.js 20+, ESM modules (`"type": "module"`)
- **Framework:** Express.js 5
- **Port:** 3330 (dev), configurable via `PORT` env var
- **Base URL:** `/api`
- **API Docs:** `/api-docs` (Swagger, auto-generated)

## Architecture Pattern

All features follow a strict 4-layer pattern:

```
src/routes/        → Express router, param validation, auth middleware
src/controllers/   → Request/response handling, calls service layer
src/services/      → Business logic, orchestration
src/db/            → Drizzle ORM queries, direct DB access
```

When adding a feature: route → controller → service → db. Never skip layers or call db directly from a controller.

## Tech Stack

| Layer              | Technology                                          |
| ------------------ | --------------------------------------------------- |
| Database           | PostgreSQL 16+                                      |
| ORM                | Drizzle ORM (query builder style, not ActiveRecord) |
| Job Queue          | pg-boss (async workers, background jobs)            |
| Real-time          | Socket.IO 4                                         |
| Auth               | Passport.js — JWT, Google, Facebook, Apple OAuth    |
| Validation         | Zod schemas (`src/validations/`)                    |
| File Storage       | AWS S3                                              |
| Email              | AWS SES + Nodemailer                                |
| Push Notifications | AWS SNS                                             |
| Payments           | Stripe                                              |
| Video Streaming    | Stream.io (`@stream-io/node-sdk`)                   |
| Logging            | Winston + Morgan                                    |
| Scheduled Jobs     | node-cron (`src/cron/`)                             |
| Secrets (prod)     | AWS Secrets Manager                                 |

## Route Map

All routes mounted under `/api`:

| Prefix               | Feature                                        |
| -------------------- | ---------------------------------------------- |
| `/auth`              | JWT login/signup, Google/Facebook/Apple OAuth  |
| `/users`             | Profiles, settings (requires `authMiddleware`) |
| `/events`            | Create, publish, manage events                 |
| `/eventSchedules`    | Recurring event schedules                      |
| `/groups`            | Community groups, memberships                  |
| `/groupQuestions`    | Group membership questions                     |
| `/tickets`           | Purchase, manage tickets                       |
| `/ticket-scanning`   | QR code verification                           |
| `/venues`            | Venue management                               |
| `/categories`        | Event categories                               |
| `/organizers`        | Organizer profiles                             |
| `/social`            | Posts, follows, stories, bios, interests       |
| `/socialChat`        | DM chat between users                          |
| `/stream`            | Stream.io video call integration               |
| `/livestream`        | Live broadcasting (SSE + Stream.io)            |
| `/talent`            | Talent profiles and booking sessions           |
| `/talent-issues`     | Dispute resolution for bookings                |
| `/payments`          | Stripe payment flows                           |
| `/orders`            | Order management                               |
| `/subscriptions`     | BriteSide Plus subscriptions                   |
| `/priority-messages` | Paid direct messages to talent                 |
| `/door-sales`        | On-the-door ticket sales                       |
| `/gift-codes`        | Gift code management                           |
| `/analytics`         | Event/organizer analytics                      |
| `/admin`             | User/content moderation                        |
| `/admin/analytics`   | Admin-level analytics                          |
| `/appeals`           | Suspension appeals                             |
| `/notifications`     | Push/in-app notifications                      |
| `/reviews`           | Event reviews and ratings                      |
| `/reports`           | Content reporting                              |
| `/search`            | Universal search (public)                      |
| `/imports`           | Influencer bulk import sessions                |
| `/user/expenditure`  | User spending analytics                        |
| `/demo-sessions`     | Demo session registration (public)             |
| `/upload`            | File uploads to S3                             |
| `/contact`           | Contact form (public)                          |
| `/reservations`      | Username reservations (public)                 |

**Stripe webhooks:** `/api/webhooks` — uses raw body parser, mounted before JSON parser.

## Database (Drizzle ORM)

- Schema defined in `src/db/` — tables as Drizzle schema objects
- Migrations in `drizzle/` directory
- Config: `drizzle.config.js`

Key commands:

```bash
npm run db:generate   # generate migration from schema changes
npm run db:migrate    # run pending migrations
npm run db:push       # push schema directly (dev only)
npm run db:studio     # open Drizzle Studio UI
```

## Cron Jobs (`src/cron/`)

Scheduled via `node-cron`, all registered in `src/cron/cronJobs.js`:

- `eventReminders.js` — event reminder emails
- `sessionReminders.js` — talent session reminders
- `sessionEmails.js` — session-related email flows
- `birthdayReminders.js` — birthday notifications
- `statusPostCleanup.js` — expire status posts
- `publishScheduledPosts.js` — auto-publish scheduled social posts
- `priorityMessageRefund.js` — refund unanswered priority messages
- `reserveRelease.js` — release expired username reservations
- `snsTopicCleanup.js` — clean up unused SNS topics
- `fileCleanup.js` — remove orphaned S3 files
- `cleanupStaleImports.js` — clear stale import sessions

## Auth Pattern

- `authMiddleware` from `src/middlewares/auth.middleware.js` — validates JWT, attaches `req.user`
- Applied per-route or per-router (not globally)
- OAuth strategies: `src/config/passport.js`
- Tokens: short-lived access (30min) + refresh (30 days)

## Socket.IO

Real-time namespaces in `src/socket/`:

- Event chat
- Social chat
- Livestream events

## Dev Commands

```bash
npm run dev           # start with nodemon (local DB)
npm run prod          # start with AWS Secrets Manager (staging/prod)
npm run format        # prettier
npm run seed          # seed all base data
npm run seed:admin    # seed admin user only
npm run seed:talent   # seed talent profiles
```

## Environment Variables

See `.env.example` for required vars. Key ones:

- `PORT`, `API_HOST`
- `POSTGRESQL_HOST/PORT/DB_NAME/USER/PASSWORD`
- `JWT_SECRET`, `JWT_ACCESS_EXPIRATION_MINUTES`, `JWT_REFRESH_EXPIRATION_DAYS`
- AWS credentials (S3, SES, SNS, Secrets Manager)
- Stripe keys, Stream.io keys
- `FRONTEND_URL` — added to CORS allowlist

Local DB: `compose.yaml` spins up PostgreSQL via Docker.

## Current Branch

`feat-talents` — active development of talent booking features.
