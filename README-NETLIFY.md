# Netlify deployment notes for v0.8

## 1. Database migration

Deploy the repository with the migration in:

`netlify/database/migrations/002-v08-session-sync/migration.sql`

It adds owner-scoped records and the `session_sync_state` table used for session-level conflict resolution.

## 2. Account credential

Configure a Netlify environment variable named `ACCOUNT_CREDENTIALS`.

Use JSON with one entry per account. For the current personal deployment:

```json
[
  {
    "owner_id": "personal",
    "access_key": "REPLACE_WITH_A_LONG_RANDOM_SECRET"
  }
]
```

The value shown above is a placeholder. Generate a new strong random secret and never commit the real value to GitHub.

The browser still asks for the cloud access key. That key is stored locally in the browser and sent to `/api/sync` in the `X-App-Key` header.

`APP_ACCESS_KEY` remains supported temporarily by the server as a v0.7 compatibility fallback. New deployments should use `ACCOUNT_CREDENTIALS`.

## 3. Deploy

Push or merge the v0.8 branch and trigger a normal Netlify deploy. The updated function is:

`netlify/functions/sync.mjs`

The endpoint remains:

`/api/sync`

## 4. Verify

After deployment:

1. Open the application and enter the new access key.
2. Run **Sync now**.
3. Open **Diagnostics**.
4. Confirm that uploaded/downloaded session IDs are recorded.
5. Make different edits on two devices to different sessions and confirm both survive.
6. Make conflicting edits to the same closed session and confirm the newest session timestamp wins only for that session.
7. Export the course Excel file and verify the `Interventions`, `Attendance Exceptions` and `Edit History` sheets.

## Security

Do not place credentials in source files, `netlify.toml`, screenshots, example datasets or committed `.env` files. Rotate a credential immediately if it has ever been exposed.
