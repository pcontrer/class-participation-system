# Class Participation System v0.7

Local-first classroom participation tracker for 1–100 students, prepared for multi-device synchronization on Netlify.

## Core features

- Courses and rosters are separate entities.
- Create a course first, then import one or more rosters.
- Import `.xlsx`, `.xls`, or `.csv` with interactive field mapping.
- First name and surname are required; student ID, email and photo URL are optional.
- Flexible panel sorting: first name/surname, ascending/descending, or manual.
- Drag & drop manual layouts, with multiple saved layouts per course.
- Session snapshots preserve roster and layout history.
- One-tap participation logging, Strong/Limited overrides, Undo and attendance exceptions.
- Edit completed sessions manually without changing later sessions.
- Smart Next Call, participation coverage, Fair Share Index and evidence-assisted grading.
- Zoom VTT import and timestamp reconciliation groundwork.
- IndexedDB local persistence and offline-first operation.
- Netlify sync backend for sharing state across devices.

## Netlify deployment

The repository includes:

- `netlify.toml`
- `netlify/functions/sync.mjs`
- `netlify/database/migrations/001-sync-records/migration.sql`
- `package.json` with `@netlify/database`

Set the secret environment variable `APP_ACCESS_KEY` in Netlify before using cloud sync.

See `README-NETLIFY.md` and `ARCHITECTURE-CLOUD.md` for details.

## Local development

For a simple frontend-only check:

```bash
python3 -m http.server 8080
```

For Netlify functions/database emulation, use Netlify CLI:

```bash
npm install
npx netlify dev
```

## Privacy

This is a prototype intended for controlled testing. Before institutional use with real student data, review authentication, authorization, retention, audit logging, GDPR/legal basis, and institutional DPO requirements.
