-- Who may sign in, and as what (owner > manager > staff). src/access.js checks this on every request.
CREATE TABLE IF NOT EXISTS users (
  email TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'staff')),
  name TEXT NOT NULL DEFAULT '',
  added_by TEXT NOT NULL DEFAULT '',
  added_at TEXT NOT NULL,
  last_login_at TEXT
);

-- Sign-ins (allowed and refused), sign-outs and every write request: who, when, what, and the result.
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  status INTEGER,
  ip TEXT NOT NULL DEFAULT ''
);

INSERT OR IGNORE INTO users (email, role, name, added_by, added_at)
VALUES ('iv3nsun@gmail.com', 'owner', 'Owner', 'seed', '2026-10-08T00:00:00.000Z');
