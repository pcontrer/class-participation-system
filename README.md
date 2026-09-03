# Class Participation System v0.8.1

Local-first classroom participation tracker for 1–100 students, prepared for multi-device synchronization on Netlify.

## Core features

- Courses and rosters are separate entities.
- Create a course first, then import one or more rosters.
- Import `.xlsx`, `.xls`, or `.csv` rosters with interactive field mapping.
- First name and surname are required; student ID, email and photo URL are optional.
- Flexible panel sorting: first name/surname, ascending/descending, or manual.
- Drag & drop manual layouts, with multiple saved layouts per course.
- Session snapshots preserve roster and layout history.
- One-tap participation logging, Strong/Limited overrides, Undo and attendance exceptions.
- Edit completed sessions manually without changing later sessions.
- Smart Next Call, participation coverage, Fair Share Index and evidence-assisted grading.
- Zoom VTT import and timestamp reconciliation groundwork.
- Import post-class participation assessments from Excel/CSV without manual tapping.
- Strict roster matching for participation imports: Student ID, then email, then exact normalized first name + surname. No fuzzy matching is applied automatically.
- Participation import supports intervention count, numeric quality score 1–5, confidence and comments.
- Re-importing a participation file replaces only participation previously imported from files for that session; manual participation events are preserved.
- Imported quality 4–5 maps to Strong, 3 to Standard, and 1–2 to Limited for compatibility while retaining the original numeric score.
- Course Analytics shows average imported quality on a 1–5 scale.
- IndexedDB local persistence and offline-first operation.
- Netlify sync backend for sharing state across devices.

## Participation import format

Required columns:

- `Interventions`
- `Quality Score`
- one matching method: `Student ID`, `Email`, or both `First Name` and `Last Name`

Optional columns:

- `Confidence`
- `Comment`
- `Session Date`
- `Session Title`
- `Session Start`
- `Session End`

Recommended workflow:

1. Open the course.
2. If the completed class session already exists, open it and click **Import participation**.
3. Select the Excel/CSV file.
4. Review the strict roster matching preview.
5. Confirm only the matched rows.
6. If importing from the course screen, include a unique session date/title. If no matching session exists and a date is supplied, the app can create a completed session from the import.

Unmatched or ambiguous rows are skipped rather than guessed.

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
