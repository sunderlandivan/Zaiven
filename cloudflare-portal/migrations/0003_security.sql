-- Adds the read-only "viewer" role. SQLite can't change a CHECK constraint in place, so the table is rebuilt.
CREATE TABLE users_new (
  email TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'staff', 'viewer')),
  name TEXT NOT NULL DEFAULT '',
  added_by TEXT NOT NULL DEFAULT '',
  added_at TEXT NOT NULL,
  last_login_at TEXT
);
INSERT INTO users_new (email, role, name, added_by, added_at, last_login_at)
  SELECT email, role, name, added_by, added_at, last_login_at FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

-- Server-side sessions: the cookie holds a random id, only its SHA-256 is stored, so deleting a row signs that browser out at once.
CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  csrf TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  ip TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  ua TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS sessions_email ON sessions (email);

-- Browsers each account has signed in from (hash of a long-lived random device cookie), for new-device alerts.
CREATE TABLE IF NOT EXISTS devices (
  email TEXT NOT NULL,
  device_hash TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  PRIMARY KEY (email, device_hash)
);

-- Lockout checks count recent refused sign-ins per IP.
CREATE INDEX IF NOT EXISTS audit_ip_action ON audit (ip, action, at);
