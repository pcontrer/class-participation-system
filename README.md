# Class Participation System

Current version: **v0.8**

A lightweight browser-based system for recording class participation, attendance exceptions, student observations and session history. The current deployment is designed for personal use, while the v0.8 data model deliberately leaves room for future multiuser evolution.

## What v0.8 changes

### Session-scoped synchronization

Cloud synchronization no longer treats the whole application state as a single last-write-wins object. Each class session has:

- a unique session ID;
- its own `updatedAt` timestamp;
- a session-scoped synchronization boundary for participation events, attendance and transcript data.

When two devices change different sessions, both sets of changes survive. If both devices change the same session before synchronizing, the version with the newest session timestamp wins for that session only.

A local **Diagnostics** panel records synchronization events, including sessions uploaded, sessions downloaded and conflicts resolved.

### Append-only edit history

Changes made after a session has been closed generate audit entries. Each entry records:

- field or child record changed;
- previous value;
- new value;
- edit timestamp;
- owner identifier.

The audit history is append-only from normal application workflows and is exported with the course data.

### Manual grading by default

Evidence-assisted grading is disabled by default in v0.8 through the feature flag:

```js
CPS_FEATURES.evidenceAssistedGrading = false
```

The participation record is evidence for the professor. The final academic judgment remains manual.

### Complete Excel export

The v0.8 workbook contains separate sheets for:

- Sessions
- Interventions
- Attendance Exceptions
- Edit History
- Professor Notes

Each intervention includes the session date, student, quality (`strong`, `standard`, `limited`), exact recorded timestamp and approximate elapsed time within the session. Attendance exceptions include their justification when one was entered.

## Data model and future multiuser preparation

Courses, rosters and sessions contain an `owner_id`. In the current personal deployment this is fixed to `personal`.

The Netlify synchronization endpoint supports account-scoped credentials through the `ACCOUNT_CREDENTIALS` environment variable. Example structure, using placeholders only:

```json
[
  {
    "owner_id": "personal",
    "access_key": "REPLACE_WITH_A_LONG_RANDOM_SECRET"
  }
]
```

Do not commit real credentials to GitHub. The legacy `APP_ACCESS_KEY` is supported temporarily by the server only as a v0.7 migration fallback and should not be treated as the permanent credential model.

## Netlify database migration

v0.8 adds migration `002-v08-session-sync`, which:

- scopes synchronized records by `owner_id`;
- stores the session scope and client modification timestamp;
- changes the synchronization primary key to `(owner_id, entity_type, entity_id)`;
- adds `session_sync_state` for per-session conflict resolution.

Deploy the database migration together with the updated Netlify function.

## Privacy and GDPR

This application can process personal data from the moment a real student is entered or imported. This includes, among other fields:

- first name and surname;
- student ID;
- email address;
- photograph or photo URL;
- attendance information;
- participation records;
- professor observations.

Under GDPR, those fields are personal data from the first real record. This is true even when the software is being used personally and before any institutional or commercial deployment.

Before using the system with real students, the operator is responsible for ensuring an appropriate lawful basis, security controls, retention policy and institutional compliance where applicable.

## Public repository hygiene

Before publishing or cloning the repository publicly:

- never commit `.env` files, Netlify secrets or access keys;
- never include exports or backups containing real student data;
- use synthetic examples only;
- review Git history as well as the current working tree if a secret was ever committed;
- rotate any credential that may have appeared in logs, screenshots, commits or support conversations.

## Scope of v0.8

Included:

- session-level last-write-wins conflict resolution;
- synchronization diagnostics;
- append-only session edit history;
- complete XLSX export;
- manual grading default;
- `owner_id` and account-scoped credential model;
- documentation for public GitHub use.

Not included:

- real multiuser authentication;
- automatic grading enabled by default;
- Blackboard, SIS or other institutional integrations.

## Main files

- `app-part1.js` to `app-part5.js`: v0.7 application base
- `v08-core.js`: v0.8 data ownership, audit and synchronization layer
- `v08-ui.js`: diagnostics, attendance justification and grading feature flag UI
- `v08-export.js`: complete v0.8 Excel export
- `netlify/functions/sync.mjs`: account-scoped cloud synchronization
- `netlify/database/migrations/002-v08-session-sync/migration.sql`: v0.8 database migration
- `CHANGELOG.md`: version history
