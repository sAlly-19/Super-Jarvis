CREATE TABLE module_events (
  id INTEGER PRIMARY KEY,
  module_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision >= 0),
  outcome TEXT NOT NULL,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
