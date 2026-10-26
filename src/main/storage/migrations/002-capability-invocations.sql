CREATE TABLE capability_invocations (
  invocation_id TEXT PRIMARY KEY NOT NULL,
  capability_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  session_id INTEGER NOT NULL CHECK(session_id >= 0),
  module_revision INTEGER NOT NULL CHECK(module_revision >= 0),
  reserved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
