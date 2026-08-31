import { getDatabase } from "@netlify/database";

function authorized(req) {
  const expected = process.env.APP_ACCESS_KEY;
  const supplied = req.headers.get("x-app-key") || "";
  return Boolean(expected) && supplied === expected;
}

export default async (req) => {
  if (!authorized(req)) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
  const db = getDatabase();
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
        await client.query(
          `INSERT INTO sync_records(entity_type, entity_id, payload, deleted, updated_at)
           VALUES($1,$2,$3::jsonb,$4,NOW())
           ON CONFLICT(entity_type, entity_id)
           DO UPDATE SET payload=EXCLUDED.payload, deleted=EXCLUDED.deleted, updated_at=NOW()`,
          [m.store, m.id, payload === null ? null : JSON.stringify(payload), deleted]
        );
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } else if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { "content-type": "application/json" } });
  }
  const rows = await db.sql`SELECT entity_type, entity_id, payload, deleted, updated_at FROM sync_records ORDER BY updated_at ASC`;
  return new Response(JSON.stringify({ records: rows }), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
};

export const config = { path: "/api/sync" };
