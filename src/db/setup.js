import { sql } from 'drizzle-orm';
import { db } from './index.js';

// Database extensions
export async function createExtensions() {
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS "postgis";`);
  // Powers similarity() — used by InterestService.searchInterests for
  // fuzzy interest-category matching.
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS "pg_trgm";`);
}

// Updated at trigger function
export async function createUpdatedAtFunction() {
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
    END;
    $$ language 'plpgsql';
  `);
}

// Audit logging function
export async function createAuditFunction() {
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION log_audit_event()
    RETURNS TRIGGER AS $$
    DECLARE
        changes JSONB;
    BEGIN
        IF TG_OP = 'INSERT' THEN
            INSERT INTO audit_logs (action, resource_type, resource_id, user_id, new_values)
            VALUES ('create', TG_TABLE_NAME, NEW.id, NEW.created_by, row_to_json(NEW));
        ELSIF TG_OP = 'UPDATE' THEN
            changes := '{}'::JSONB;
            
            INSERT INTO audit_logs (action, resource_type, resource_id, user_id, previous_values, new_values, changes)
            VALUES ('update', TG_TABLE_NAME, NEW.id, NEW.updated_by, row_to_json(OLD), row_to_json(NEW), changes);
        ELSIF TG_OP = 'DELETE' THEN
            INSERT INTO audit_logs (action, resource_type, resource_id, previous_values)
            VALUES ('delete', TG_TABLE_NAME, OLD.id, row_to_json(OLD));
        END IF;
        
        RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;
  `);
}

// Create all updated_at triggers
export async function createUpdatedAtTriggers() {
  const tables = [
    'users',
    'organizers',
    'events',
    'event_tickets',
    'event_merchandise',
    'orders',
    'event_reviews',
    'groups',
    'payment_methods',
    'venues',
    'system_settings',
    'group_posts',
    'post_comments',
    'admin_tasks',
    'user_notification_settings',
  ];

  for (const table of tables) {
    await db.execute(
      sql.raw(`
      CREATE TRIGGER update_${table}_updated_at 
      BEFORE UPDATE ON ${table} 
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `)
    );
  }
}

// Create audit triggers
export async function createAuditTriggers() {
  const tables = ['events', 'orders', 'users', 'organizers', 'groups'];

  for (const table of tables) {
    await db.execute(
      sql.raw(`
      CREATE TRIGGER audit_${table} 
      AFTER INSERT OR UPDATE OR DELETE ON ${table} 
      FOR EACH ROW EXECUTE FUNCTION log_audit_event();
    `)
    );
  }
}

// Insert default data
export async function insertDefaultData() {
  // Default roles
  await db.execute(sql`
    INSERT INTO roles (name, description, permissions) VALUES
    ('super_admin', 'Platform administrator with full access', '["*"]'),
    ('organizer', 'Can create and manage events', '["event:create", "event:update", "event:delete", "ticket:manage", "order:view"]'),
    ('attendee', 'Can browse and attend events', '["event:view", "ticket:purchase", "order:create"]'),
    ('group_admin', 'Can create and manage groups', '["group:create", "group:update", "group:delete", "group:manage_members"]')
    ON CONFLICT (name) DO NOTHING;
  `);

  // Default categories
  await db.execute(sql`
    INSERT INTO categories (name, description) VALUES
    ('Music', 'Concerts, festivals, and live performances'),
    ('Technology', 'Tech conferences, workshops, and hackathons'),
    ('Food & Drink', 'Food festivals, cooking classes, and tastings'),
    ('Health & Wellness', 'Yoga classes, meditation workshops, and fitness events'),
    ('Business', 'Networking events, conferences, and seminars'),
    ('Arts & Culture', 'Art exhibitions, theater performances, and cultural events'),
    ('Sports & Fitness', 'Sports competitions, fitness classes, and marathons'),
    ('Education', 'Workshops, classes, and educational seminars')
    ON CONFLICT (name) DO NOTHING;
  `);
}

// Complete database setup
export async function setupDatabase() {
  console.log('Setting up database...');

  await createExtensions();
  console.log('✓ Extensions created');

  await createUpdatedAtFunction();
  console.log('✓ Updated at function created');

  await createAuditFunction();
  console.log('✓ Audit function created');

  await createUpdatedAtTriggers();
  console.log('✓ Updated at triggers created');

  await createAuditTriggers();
  console.log('✓ Audit triggers created');

  await insertDefaultData();
  console.log('✓ Default data inserted');

  console.log('Database setup complete!');
}
