CREATE TABLE email_accounts (
  id TEXT PRIMARY KEY, provider TEXT NOT NULL CHECK(provider IN ('gmail','outlook')),
  subject_id TEXT NOT NULL, tenant_id TEXT, address TEXT NOT NULL, display_name TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
  status TEXT NOT NULL CHECK(status IN ('connected','reauth_required','disconnected')),
  vault_ref TEXT NOT NULL
);
CREATE UNIQUE INDEX email_identity ON email_accounts(provider,COALESCE(tenant_id,''),subject_id);
CREATE TABLE email_preferences (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1), default_account_id TEXT REFERENCES email_accounts(id),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0)
);
INSERT INTO email_preferences(singleton,default_account_id) VALUES(1,NULL);
CREATE TABLE email_operations (
  id TEXT PRIMARY KEY, invocation_id TEXT NOT NULL UNIQUE, account_id TEXT NOT NULL REFERENCES email_accounts(id),
  kind TEXT NOT NULL, args_fingerprint TEXT NOT NULL, sealed_correlation TEXT,
  state TEXT NOT NULL CHECK(state IN ('prepared','dispatching','accepted','observed','rejected','unknown')),
  provider_ref TEXT, error_code TEXT, revision INTEGER NOT NULL DEFAULT 0,
  leg_receipts_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
