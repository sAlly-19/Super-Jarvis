CREATE TABLE reminders (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  schedule_revision INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  schedule TEXT NOT NULL,
  next_due_utc TEXT,
  state TEXT NOT NULL CHECK(state IN ('active','completed','deleted')),
  source TEXT NOT NULL CHECK(source IN ('jasper','ical')),
  uid TEXT NOT NULL,
  source_hash TEXT,
  local_edited INTEGER NOT NULL CHECK(local_edited IN (0,1)),
  ical_source TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(source,uid)
);
CREATE INDEX reminders_due ON reminders(state,next_due_utc,id);
CREATE TABLE reminder_occurrences (
  key TEXT PRIMARY KEY,
  reminder_id TEXT NOT NULL REFERENCES reminders(id),
  schedule_revision INTEGER NOT NULL,
  nominal_local_time TEXT NOT NULL,
  due_utc TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','notified','completed','missed','cancelled')),
  snoozed_until_utc TEXT,
  UNIQUE(reminder_id,schedule_revision,nominal_local_time)
);
CREATE INDEX reminder_occurrences_due ON reminder_occurrences(state,due_utc);
CREATE TABLE reminder_receipts (
  invocation_id TEXT PRIMARY KEY,
  capability_id TEXT NOT NULL,
  args_hash TEXT NOT NULL,
  affected TEXT NOT NULL,
  committed_at TEXT NOT NULL
);
CREATE TABLE reminder_preferences (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  time_zone TEXT NOT NULL,
  all_day_time TEXT NOT NULL,
  notifications_enabled INTEGER NOT NULL CHECK(notifications_enabled IN (0,1)),
  revision INTEGER NOT NULL
);
CREATE TABLE reminder_deliveries (
  occurrence_key TEXT PRIMARY KEY REFERENCES reminder_occurrences(key),
  epoch TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('claimed','shown','missed','uncertain','blocked')),
  claimed_at TEXT NOT NULL,
  shown_at TEXT
);
CREATE TABLE reminder_overdue_batches (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  acknowledged_at TEXT
);
CREATE TABLE reminder_overdue_members (
  batch_id TEXT NOT NULL REFERENCES reminder_overdue_batches(id),
  occurrence_key TEXT NOT NULL UNIQUE REFERENCES reminder_occurrences(key),
  PRIMARY KEY(batch_id,occurrence_key)
);
