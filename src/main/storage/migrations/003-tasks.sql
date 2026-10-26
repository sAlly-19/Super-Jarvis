CREATE TABLE tasks (
  task_id TEXT PRIMARY KEY,
  origin TEXT NOT NULL CHECK(origin IN ('chat','live','automation')),
  session_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  step_states TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE task_events (
  task_id TEXT NOT NULL REFERENCES tasks(task_id),
  sequence INTEGER NOT NULL,
  type TEXT NOT NULL,
  step_id TEXT,
  occurred_at TEXT NOT NULL,
  PRIMARY KEY(task_id, sequence)
);
CREATE INDEX tasks_session_status ON tasks(session_id,status);
