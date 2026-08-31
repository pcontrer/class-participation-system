# Architecture v0.7

## Entities

COURSE -> ROSTERS -> STUDENTS
COURSE -> SESSIONS -> PARTICIPATION_EVENTS
SESSION stores `rosterIdSnapshot`, `rosterNameSnapshot`, ordering/layout snapshot.

A course may have multiple rosters. `course.activeRosterId` determines the roster used for new sessions, analytics and grading. Historical sessions keep their original roster snapshot.

## Roster import pipeline

File (.xlsx/.xls/.csv)
-> parse first worksheet / CSV
-> detect headers
-> suggest mapping
-> professor confirms mapping
-> validate 1..100 rows
-> create ROSTER
-> create STUDENTS linked to roster
-> assign roster to course
-> create default layout

Internal student fields:
- externalId
- firstName
- lastName
- email
- photoUrl

Only firstName and lastName are mandatory mappings.

## Local-first sync

Every write goes first to IndexedDB and then to a durable sync queue. Cloud synchronization is secondary and never blocks the live classroom interaction.
