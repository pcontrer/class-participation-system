# Cloud architecture

Device (iPad / Mac / phone)
  -> IndexedDB: immediate local writes
  -> syncQueue: durable offline mutation queue
  -> HTTPS /api/sync with X-App-Key
  -> Netlify Function
  -> Netlify Database / Postgres
  -> sync_records(entity_type, entity_id, payload, deleted, updated_at)

Synced entity types:
- courses
- rosters
- students
- layouts
- sessions
- events
- attendance
- notes
- grades
- transcriptSegments

The server uses generic JSONB records to preserve compatibility with the rapidly evolving MVP schema. A later production refactor can migrate these into fully normalized relational tables without changing the live classroom interaction model.
