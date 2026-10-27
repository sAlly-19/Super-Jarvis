CREATE TABLE reminder_import_receipts (
  invocation_id TEXT PRIMARY KEY,
  args_hash TEXT NOT NULL,
  report TEXT NOT NULL,
  committed_at TEXT NOT NULL
);
