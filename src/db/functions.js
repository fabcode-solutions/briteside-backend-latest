import { sql } from 'drizzle-orm';

// Function to update updated_at timestamp
export const updateUpdatedAtFunction = sql`
  CREATE OR REPLACE FUNCTION update_updated_at_column()
  RETURNS TRIGGER AS $$
  BEGIN
      NEW.updated_at = CURRENT_TIMESTAMP;
      RETURN NEW;
  END;
  $$ language 'plpgsql';
`;

// Function for audit logging
export const auditLogFunction = sql`
  CREATE OR REPLACE FUNCTION log_audit_event()
  RETURNS TRIGGER AS $$
  DECLARE
      changes JSONB;
  BEGIN
      IF TG_OP = 'INSERT' THEN
          INSERT INTO audit_logs (action, resource_type, resource_id, user_id, new_values)
          VALUES ('create', TG_TABLE_NAME, NEW.id, 
                  CASE WHEN TG_TABLE_NAME = 'users' THEN NEW.id
                       WHEN TG_TABLE_NAME = 'events' THEN NEW.organizer_id
                       WHEN TG_TABLE_NAME = 'groups' THEN NEW.created_by
                       ELSE NULL END, 
                  row_to_json(NEW));
      ELSIF TG_OP = 'UPDATE' THEN
          changes := '{}'::JSONB;
          
          INSERT INTO audit_logs (action, resource_type, resource_id, user_id, previous_values, new_values, changes)
          VALUES ('update', TG_TABLE_NAME, NEW.id, 
                  CASE WHEN TG_TABLE_NAME = 'users' THEN NEW.id
                       WHEN TG_TABLE_NAME = 'events' THEN NEW.organizer_id
                       WHEN TG_TABLE_NAME = 'groups' THEN NEW.created_by
                       ELSE NULL END,
                  row_to_json(OLD), row_to_json(NEW), changes);
      ELSIF TG_OP = 'DELETE' THEN
          INSERT INTO audit_logs (action, resource_type, resource_id, previous_values)
          VALUES ('delete', TG_TABLE_NAME, OLD.id, row_to_json(OLD));
      END IF;
      
      RETURN NULL;
  END;
  $$ LANGUAGE plpgsql;
`;

// Triggers for updated_at columns
export const createUpdatedAtTriggers = [
  sql`CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();`,
  sql`CREATE TRIGGER update_organizers_updated_at BEFORE UPDATE ON organizers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();`,
  sql`CREATE TRIGGER update_events_updated_at BEFORE UPDATE ON events FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();`,
  sql`CREATE TRIGGER update_event_tickets_updated_at BEFORE UPDATE ON event_tickets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();`,
  sql`CREATE TRIGGER update_event_merchandise_updated_at BEFORE UPDATE ON event_merchandise FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();`,
  sql`CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();`,
  sql`CREATE TRIGGER update_event_reviews_updated_at BEFORE UPDATE ON event_reviews FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();`,
  sql`CREATE TRIGGER update_groups_updated_at BEFORE UPDATE ON groups FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();`,
  sql`CREATE TRIGGER update_payment_methods_updated_at BEFORE UPDATE ON payment_methods FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();`,
  sql`CREATE TRIGGER update_venues_updated_at BEFORE UPDATE ON venues FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();`,
  sql`CREATE TRIGGER update_system_settings_updated_at BEFORE UPDATE ON system_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();`,
  sql`CREATE TRIGGER update_group_posts_updated_at BEFORE UPDATE ON group_posts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();`,
  sql`CREATE TRIGGER update_post_comments_updated_at BEFORE UPDATE ON post_comments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();`,
  sql`CREATE TRIGGER update_admin_tasks_updated_at BEFORE UPDATE ON admin_tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();`,
  sql`CREATE TRIGGER update_user_notification_settings_updated_at BEFORE UPDATE ON user_notification_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();`,
];

// Audit triggers for key tables
export const createAuditTriggers = [
  sql`CREATE TRIGGER audit_events AFTER INSERT OR UPDATE OR DELETE ON events FOR EACH ROW EXECUTE FUNCTION log_audit_event();`,
  sql`CREATE TRIGGER audit_orders AFTER INSERT OR UPDATE OR DELETE ON orders FOR EACH ROW EXECUTE FUNCTION log_audit_event();`,
  sql`CREATE TRIGGER audit_users AFTER INSERT OR UPDATE OR DELETE ON users FOR EACH ROW EXECUTE FUNCTION log_audit_event();`,
  sql`CREATE TRIGGER audit_organizers AFTER INSERT OR UPDATE OR DELETE ON organizers FOR EACH ROW EXECUTE FUNCTION log_audit_event();`,
  sql`CREATE TRIGGER audit_groups AFTER INSERT OR UPDATE OR DELETE ON groups FOR EACH ROW EXECUTE FUNCTION log_audit_event();`,
];

// Database extensions
export const createExtensions = [
  sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`,
  sql`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`,
  sql`CREATE EXTENSION IF NOT EXISTS "postgis";`,
];

// Default data insertions
export const insertDefaultRoles = sql`
  INSERT INTO roles (name, description, permissions) VALUES
  ('super_admin', 'Platform administrator with full access', '["*"]'),
  ('organizer', 'Can create and manage events', '["event:create", "event:update", "event:delete", "ticket:manage", "order:view"]'),
  ('attendee', 'Can browse and attend events', '["event:view", "ticket:purchase", "order:create"]'),
  ('group_admin', 'Can create and manage groups', '["group:create", "group:update", "group:delete", "group:manage_members"]')
  ON CONFLICT (name) DO NOTHING;
`;

export const insertDefaultCategories = sql`
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
`;
