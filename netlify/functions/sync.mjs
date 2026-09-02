import { getDatabase } from "@netlify/database";

function credentials() {
  try {
    const parsed = JSON.parse(process.env.ACCOUNT_CREDENTIALS || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function authenticate(req) {
  const supplied = req.headers.get("x-app-key") || "";
  const account = credentials().find(x => x && x.access_key === supplied && x.owner_id);
  if (account) return { owner_id: String(account.owner_id) };
  // Temporary v0.7 compatibility path. Configure ACCOUNT_CREDENTIALS and remove this fallback later.
  if (process.env.APP_ACCESS_KEY && supplied === process.env.APP_ACCESS_KEY) return { owner_id: "personal" };
  return null;
}

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store" }
});

function validDate(value) {
  const t = Date.parse(value || "");
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export default async (req) => {
  const account = authenticate(req);
  if (!account) return json({ error: "Unauthorized" }, 401);
  const ownerId = account.owner_id;
  const db = getDatabase();
  const conflicts = [];
  const appliedSessions = new Set();

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const mutations = Array.isArray(body.mutations) ? body.mutations.slice(0, 5000) : [];
    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      for (const m of mutations) {
        if (!m || typeof m.store !== "string" || typeof m.id !== "string") continue;
        const deleted = m.op === "delete";
        const payload = deleted ? null : (m.payload ?? null);
        const scopeSessionId = typeof m.scope_session_id === "string" && m.scope_session_id ? m.scope_session_id : null;
        const incomingSessionAt = validDate(m.session_updated_at);
        const incomingEntityAt = validDate(m.client_at) || new Date().toISOString();

        if (scopeSessionId && incomingSessionAt) {
          const current = await client.query(
            `SELECT session_updated_at FROM session_sync_state
             WHERE owner_id=$1 AND session_id=$2 FOR UPDATE`,
            [ownerId, scopeSessionId]
          );
          const currentAt = current.rows[0]?.session_updated_at ? new Date(current.rows[0].session_updated_at).toISOString() : null;
          if (currentAt && Date.parse(currentAt) > Date.parse(incomingSessionAt)) {
            conflicts.push({ session_id: scopeSessionId, winner: "cloud", cloud_updated_at: currentAt, rejected_updated_at: incomingSessionAt });
            continue;
          }
        }

        if (!scopeSessionId) {
          const current = await client.query(
            `SELECT client_updated_at FROM sync_records
             WHERE owner_id=$1 AND entity_type=$2 AND entity_id=$3 FOR UPDATE`,
            [ownerId, m.store, m.id]
          );
          const currentAt = current.rows[0]?.client_updated_at ? Date.parse(current.rows[0].client_updated_at) : 0;
          if (currentAt > Date.parse(incomingEntityAt)) continue;
        }

        await client.query(
          `INSERT INTO sync_records(owner_id, entity_type, entity_id, payload, deleted, scope_session_id, client_updated_at, updated_at)
           VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,NOW())
           ON CONFLICT(owner_id, entity_type, entity_id)
           DO UPDATE SET payload=EXCLUDED.payload,
                         deleted=EXCLUDED.deleted,
                         scope_session_id=EXCLUDED.scope_session_id,
                         client_updated_at=EXCLUDED.client_updated_at,
                         updated_at=NOW()`,
          [ownerId, m.store, m.id, payload === null ? null : JSON.stringify(payload), deleted, scopeSessionId, incomingEntityAt]
        );

        if (scopeSessionId && incomingSessionAt) {
          await client.query(
            `INSERT INTO session_sync_state(owner_id, session_id, session_updated_at, server_updated_at)
             VALUES($1,$2,$3,NOW())
             ON CONFLICT(owner_id, session_id)
             DO UPDATE SET session_updated_at=EXCLUDED.session_updated_at, server_updated_at=NOW()`,
            [ownerId, scopeSessionId, incomingSessionAt]
          );
          appliedSessions.add(scopeSessionId);
        }
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } else if (req.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  const rows = await db.sql`
    SELECT entity_type, entity_id, payload, deleted, scope_session_id, client_updated_at, updated_at
    FROM sync_records
    WHERE owner_id = ${ownerId}
    ORDER BY updated_at ASC
  `;
  return json({ records: rows, conflicts, applied_sessions: [...appliedSessions], owner_id: ownerId });
};

export const config = { path: "/api/sync" };
