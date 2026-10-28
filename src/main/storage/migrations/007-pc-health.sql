CREATE TABLE pc_health_preferences (singleton INTEGER PRIMARY KEY CHECK(singleton=1), settings TEXT NOT NULL, revision INTEGER NOT NULL);
CREATE TABLE pc_health_alerts (kind TEXT PRIMARY KEY, last_at INTEGER NOT NULL);
