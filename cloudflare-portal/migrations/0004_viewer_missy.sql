-- Missy Ann Pham: read-only viewer (sees the staff view; every write is refused by src/api.js).
INSERT INTO users (email, role, name, added_by, added_at)
VALUES ('pmissyann@gmail.com', 'viewer', 'Missy Ann Pham', 'seed', '2026-10-08T00:00:00.000Z')
ON CONFLICT(email) DO UPDATE SET role = 'viewer', name = excluded.name;

INSERT INTO audit (at, email, role, action, detail, status, ip)
VALUES ('2026-10-08T00:00:00.000Z', 'seed', 'owner', 'role change', 'pmissyann@gmail.com -> viewer (migration 0004)', 200, '');
