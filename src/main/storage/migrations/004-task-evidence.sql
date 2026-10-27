CREATE TABLE task_evidence (
  task_id TEXT NOT NULL REFERENCES tasks(task_id),
  step_id TEXT NOT NULL,
  invocation_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  reference TEXT NOT NULL UNIQUE,
  observed_at TEXT NOT NULL,
  verified INTEGER NOT NULL CHECK(verified = 1),
  PRIMARY KEY(task_id, step_id, invocation_id, kind)
);
