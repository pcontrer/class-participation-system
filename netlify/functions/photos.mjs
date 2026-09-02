import { getStore, getDeployStore } from "@netlify/blobs";

function authorized(req) {
  const expected = process.env.APP_ACCESS_KEY;
  const supplied = req.headers.get("x-app-key") || "";
  return Boolean(expected) && supplied === expected;
}

function store() {
  if (process.env.CONTEXT === "production") {
    return getStore("student-photo-vault", { consistency: "strong" });
  }
  return getDeployStore("student-photo-vault");
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store, private, max-age=0",
      "x-content-type-options": "nosniff"
    }
  });
}

export default async (req) => {
  if (!authorized(req)) return json({ error: "Unauthorized" }, 401);

  const url = new URL(req.url);
  const key = url.searchParams.get("k") || "";
  if (!/^[a-f0-9]{64}$/.test(key)) return json({ error: "Invalid key" }, 400);

  const vault = store();

  if (req.method === "GET") {
    const value = await vault.get(key, { type: "text" });
    if (value == null) return json({ error: "Not found" }, 404);
    return new Response(value, {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store, private, max-age=0",
        "x-content-type-options": "nosniff"
      }
    });
  }

  if (req.method === "PUT") {
    const text = await req.text();
    if (!text || text.length > 2_000_000) return json({ error: "Payload too large or empty" }, 413);
    let parsed;
    try { parsed = JSON.parse(text); } catch { return json({ error: "Invalid JSON" }, 400); }
    if (!parsed || parsed.v !== 1 || typeof parsed.salt !== "string" || typeof parsed.iv !== "string" || typeof parsed.data !== "string") {
      return json({ error: "Invalid encrypted envelope" }, 400);
    }
    await vault.set(key, text);
    return json({ ok: true });
  }

  if (req.method === "DELETE") {
    await vault.delete(key);
    return json({ ok: true });
  }

  return json({ error: "Method not allowed" }, 405);
};

export const config = { path: "/api/photos" };
