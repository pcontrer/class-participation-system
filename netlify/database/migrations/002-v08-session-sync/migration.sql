ALTER TABLE sync_records ADD COLUMN IF NOT EXISTS owner_id TEXT NOT NULL DEFAULT 'personal';
ALTER TABLE sync_records ADD COLUMN IF NOT EXISTS scope_session_id TEXT;
ALTER TABLE sync_records ADD COLUMN IF NOT EXISTS client_updated_at TIMESTAMPTZ;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'sync_records'::regclass
      AND conname = 'sync_records_pkey'
  ) THEN
    ALTER TABLE sync_records DROP CONSTRAINT sync_records_pkey;
  END IF;
END $$;

ALTER TABLE sync_records
  ADD CONSTRAINT sync_records_pkey PRIMARY KEY (owner_id, entity_type, entity_id);

CREATE INDEX IF NOT EXISTS sync_records_owner_updated_at_idx
  ON sync_records(owner_id, updated_at);
CREATE INDEX IF NOT EXISTS sync_records_owner_session_idx
  ON sync_records(owner_id, scope_session_id);

CREATE TABLE IF NOT EXISTS session_sync_state (
  owner_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  session_updated_at TIMESTAMPTZ NOT NULL,
  server_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (owner_id, session_id)
);
