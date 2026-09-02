# Changelog

All notable changes to Class Participation System are documented here.

## [0.8.0] - 2026-09-02

### Added

- Session-scoped last-write-wins synchronization.
- Per-session `updatedAt` timestamps used as the synchronization conflict boundary.
- `owner_id` on courses, rosters and sessions, with `personal` as the current fixed owner.
- Account-scoped credential configuration through `ACCOUNT_CREDENTIALS`.
- `session_sync_state` database table for conflict resolution.
- Synchronization Diagnostics panel with uploaded sessions, downloaded sessions and resolved conflicts.
- Append-only `auditHistory` for edits made after a session has been closed.
- Attendance-exception justification field.
- Complete XLSX export with dedicated sheets for interventions, attendance exceptions and edit history.
- Approximate elapsed time within the session for each participation intervention.
- GDPR clarification covering personal data from the first real student record.
- Public-repository hygiene guidance.

### Changed

- Cloud synchronization no longer relies on whole-application last-write-wins behavior for session data.
- Session-related records now synchronize as part of their parent session conflict scope.
- Evidence-assisted grading is disabled by default. Final grading remains manual.
- PWA cache manifest updated for v0.8 modules.

### Deprecated

- `APP_ACCESS_KEY` as the permanent credential model. It remains temporarily supported only as a migration fallback for existing v0.7 deployments.

### Removed

- The previous Excel report module from the runtime load path. It is superseded by the complete v0.8 export module.

### Security / privacy

- Repository documentation now explicitly prohibits committing production credentials, real student exports or backups.
- Real student names, IDs, emails, photographs, attendance, participation records and observations are treated as personal data under GDPR from first collection.

## [0.7.0]

Baseline before v0.8. Included local IndexedDB storage, Netlify synchronization, course and roster management, session editing, classroom layouts, participation quality markers, student observations, course-level Excel reporting and optional evidence-assisted grading logic.
