CREATE TABLE semantic_index_builds (
  id TEXT PRIMARY KEY,
  generation INTEGER NOT NULL CHECK(generation>=0),
  source_revision INTEGER NOT NULL CHECK(source_revision>=generation),
  model_fingerprint TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN('building','ready','obsolete'))
);
CREATE INDEX semantic_index_current ON semantic_index_builds(generation,source_revision,model_fingerprint,state);
CREATE TABLE semantic_index_chunks (
  build_id TEXT NOT NULL REFERENCES semantic_index_builds(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  sealed_chunk BLOB NOT NULL,
  PRIMARY KEY(build_id,id)
);
