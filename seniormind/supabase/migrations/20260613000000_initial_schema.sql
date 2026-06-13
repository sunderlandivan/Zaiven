-- SeniorMind initial schema + pilot seed data

CREATE TABLE IF NOT EXISTS facilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  contact_email text,
  subscription_status text NOT NULL DEFAULT 'trial' CHECK (subscription_status IN ('trial', 'active', 'inactive')),
  trial_start_date timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS residents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  name text NOT NULL,
  room_number text NOT NULL,
  date_of_birth date,
  cognitive_flag boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
  start_time timestamptz NOT NULL DEFAULT now(),
  end_time timestamptz,
  session_type text NOT NULL DEFAULT 'chat' CHECK (session_type IN ('chat', 'game', 'media')),
  message_count int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS mood_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
  session_id uuid REFERENCES sessions(id) ON DELETE SET NULL,
  timestamp timestamptz NOT NULL DEFAULT now(),
  mood_score int NOT NULL CHECK (mood_score BETWEEN 1 AND 10),
  source text NOT NULL DEFAULT 'ai_detected' CHECK (source IN ('ai_detected', 'self_reported')),
  notes text
);

CREATE TABLE IF NOT EXISTS staff_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  alert_type text NOT NULL CHECK (alert_type IN ('mood_decline', 'nurse_call', 'no_activity')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid
);

CREATE TABLE IF NOT EXISTS staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  role text NOT NULL DEFAULT 'nurse' CHECK (role IN ('nurse', 'admin'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_resident_start ON sessions(resident_id, start_time DESC);
CREATE INDEX IF NOT EXISTS idx_mood_logs_resident_timestamp ON mood_logs(resident_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_staff_alerts_facility_unresolved ON staff_alerts(facility_id) WHERE resolved_at IS NULL;

INSERT INTO facilities (id, name, contact_email, subscription_status, trial_start_date)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'Missy''s Place (Pilot)',
  'admin@missysplace.demo',
  'trial',
  now()
) ON CONFLICT (id) DO NOTHING;

INSERT INTO residents (id, facility_id, name, room_number, date_of_birth, cognitive_flag) VALUES
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'Margaret Chen', '101A', '1942-03-15', false),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'Robert Williams', '102B', '1938-07-22', true),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 'Dorothy Hayes', '103A', '1945-11-08', false),
  ('10000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001', 'James O''Brien', '104C', '1940-01-30', true)
ON CONFLICT (id) DO NOTHING;
