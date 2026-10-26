-- Each former data/*.json file is one "doc", split into parts so no SQL statement passes D1's 100 KB limit.
CREATE TABLE IF NOT EXISTS docs (
  name TEXT PRIMARY KEY,
  parts INTEGER NOT NULL,
  size INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'cloud'
);

CREATE TABLE IF NOT EXISTS doc_parts (
  name TEXT NOT NULL,
  idx INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (name, idx)
);

CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL
);
