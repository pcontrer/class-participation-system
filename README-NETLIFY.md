# Class Participation System v0.7 — Netlify multi-device edition

## What changed

The app is now local-first **and** cloud-synchronised:

- IndexedDB remains the immediate/offline store on each device.
- Netlify Database (Postgres) stores the shared state.
- Netlify Function `/api/sync` accepts queued mutations and returns the shared state.
- A per-site `APP_ACCESS_KEY` protects the sync API.
- First sync bootstraps the cloud from an existing local v0.6 installation when the server is empty.
- A new device starts empty and downloads the shared state after the access key is entered.

## Deploy to Netlify

Connect this repository to the existing Netlify project `class-participation-system` or create a new site from the repository. Netlify will install `@netlify/database`, provision the Postgres database automatically, apply the migration under `netlify/database/migrations`, bundle the function, and publish the static PWA.

Set `APP_ACCESS_KEY` as a production environment variable before using cloud sync.

## First device

1. Open the deployed URL.
2. Press **Cloud locked**.
3. Enter the access key.
4. Press **Sync now**.
5. If this browser already contains local data, the first sync uploads the local dataset when the cloud database is empty.

## Additional devices

1. Open the same Netlify URL.
2. Press **Cloud locked**.
3. Enter the same access key.
4. Press **Sync now**.
5. Courses, rosters, layouts, sessions, participation events, attendance, notes, grading and Zoom transcript data are downloaded locally.

## Offline behaviour

A participation tap is always written locally first. Network failure does not block the classroom UI. Mutations stay in `syncQueue` and are retried after reconnection.

## Conflict policy

Current v0.7 policy is **last server write wins per record**. It is suitable for one professor working across several personal devices. It is not yet intended for multiple people editing the same session simultaneously.

## Security note

Do not put `APP_ACCESS_KEY` in source code. For an institutional deployment, replace this shared-key model with named-user authentication and role-based permissions before onboarding multiple faculty members.
