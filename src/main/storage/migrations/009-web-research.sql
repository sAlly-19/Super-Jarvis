CREATE TABLE web_research_meta (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  generation INTEGER NOT NULL DEFAULT 0 CHECK(generation>=0)
);
INSERT INTO web_research_meta(singleton,generation) VALUES(1,0);
CREATE TABLE web_research_history (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('running','complete','partial','blocked','unavailable','cancelled')),
  sealed_payload BLOB NOT NULL
);
