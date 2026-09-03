# Zoom Participation Analyzer Skill

## Purpose

Analyze a Zoom classroom transcript together with the official student roster, identify students who made substantive classroom contributions, count their interventions, assess the quality of their participation on a 1–5 scale, generate an auditable Excel participation report, and generate a second Excel/CSV file that can be imported directly into the Class Participation System.

This skill is intentionally conservative. A false attribution is worse than an unassigned intervention.

## Inputs

Required:

1. Zoom transcript, preferably `.vtt`. `.txt` is acceptable if timestamps and sequence are preserved.
2. Official roster in `.xlsx`, `.xls`, or `.csv`.

Optional:

3. Session date.
4. Session title.
5. Course name/code.
6. User-confirmed alias mappings when Zoom mis-transcribes a student's name, e.g. `Giovanni -> Giovana Mariano Widal`.

## Core principles

- The roster is the source of truth for student identity.
- Never create a student who is not present in the roster.
- Never use gender, nationality, accent, topic knowledge, or other unsupported characteristics to infer identity.
- Zoom speaker labels are evidence but not ground truth. In many classroom recordings all speech may be attributed to the host/professor.
- Reconstruct participation sequentially from conversational context.
- Prefer leaving an intervention unassigned over guessing.
- User-confirmed identity corrections override transcript spelling ambiguity.
- Do not reward speaking frequency automatically. Frequency and quality are separate dimensions.

## Step 1. Parse the roster

Extract, when present:

- Student ID
- First name
- Surname / last name
- Email
- Username

Normalize names for comparison by:

- trimming whitespace;
- case-folding;
- removing diacritics only for matching;
- preserving the roster's original spelling for output.

Build exact identity keys in this order:

1. Student ID
2. Email / username
3. Exact normalized first name + surname

Do not perform automatic fuzzy assignment.

## Step 2. Parse the transcript

Read the entire transcript in chronological order.

For each transcript segment capture:

- timestamp start;
- timestamp end;
- Zoom speaker label;
- text;
- surrounding conversational context.

Do not treat subtitle fragmentation as separate speaking turns when consecutive fragments form one continuous contribution.

## Step 3. Detect candidate student interventions

Look for patterns such as:

- professor calls a student by name, then the student answers;
- professor asks a named student a question;
- professor acknowledges a student's answer by name;
- professor corrects a previously misremembered name;
- student enters the discussion and is subsequently identified by the professor;
- a user-confirmed alias links a transcript name to a roster student.

A candidate contribution must contain meaningful classroom content.

Exclude:

- greetings;
- attendance confirmations;
- microphone / Zoom issues;
- `yes`, `no`, `okay`, `thank you` unless the short answer itself demonstrates material conceptual knowledge;
- pure logistics;
- names of brands, authors, executives, case characters or other people mentioned in the lesson;
- a student who is called by name but for whom no substantive response is recorded.

## Step 4. Define one substantive intervention

Count one intervention as one continuous contribution addressing a question, argument, example, interpretation or discussion point.

Several adjacent subtitle fragments from the same speaking turn count as one intervention.

A new intervention begins when:

- another person takes the floor and the student speaks again later;
- the professor asks a new question and the student answers again;
- the student makes a new contribution at another point in the class.

## Step 5. Identity reconciliation against the roster

For each candidate intervention:

1. Attempt an exact match to a roster student.
2. Apply any user-confirmed alias mapping.
3. If exactly one roster student is identified, assign the intervention.
4. If more than one roster student could fit, mark as ambiguous.
5. If the transcript name does not map safely to the roster, leave it unassigned.

Confidence levels:

- **High**: explicit transcript evidence plus unique roster match.
- **Confirmed**: identity explicitly confirmed by the user.
- **Medium**: strong conversational inference but not explicit enough for automatic app import.
- **Low**: plausible only; never import automatically.

Only **High** and **Confirmed** rows are eligible for the default app-import file.

## Step 6. Quality scoring 1–5

Score the overall quality of each student's participation during the session, not simply their best comment.

### 1 — Very Low

- largely incorrect, irrelevant or superficial;
- little intellectual value;
- repeats what has already been said without adding understanding.

### 2 — Limited

- relevant but basic;
- partial understanding;
- little reasoning or elaboration.

### 3 — Good

- relevant and correct;
- demonstrates understanding;
- includes some reasoning, application, example or interpretation;
- helps advance the discussion.

### 4 — Very Good

- strong understanding;
- clear reasoning;
- connects concepts effectively;
- introduces a useful example, implication or perspective;
- meaningfully enriches the discussion.

### 5 — Outstanding

- exceptional analytical depth;
- original or unusually insightful reasoning;
- challenges assumptions constructively;
- builds strong conceptual connections;
- materially advances the classroom discussion.

Do not assign 5 simply because a student participated frequently.

## Step 7. Conservative quality control

Before finalizing:

1. Re-read the transcript from beginning to end.
2. Check every identified student against the roster.
3. Merge spelling variants only when identity is secure.
4. Verify that fragmented subtitles were not double-counted.
5. Verify that professor speech was not counted as student participation.
6. Verify that names mentioned in examples were not treated as students.
7. Recalculate every student's intervention count.
8. Review scoring consistency across students.
9. Separate unattributed substantive interventions from assigned participation.
10. Exclude Medium/Low-confidence attribution from the default import file unless the professor explicitly confirms it.

## Output A. Participation analysis workbook

Filename convention:

`Participation_Report_<course>_<YYYY-MM-DD>.xlsx`

Recommended sheets:

### 1. Summary

Columns:

- Student ID
- First Name
- Last Name
- Interventions
- Quality Score
- Confidence
- Main Contributions
- Assessment

### 2. Evidence

One row per identified substantive intervention:

- Student ID
- Student
- Approx. Timestamp
- Context / Question
- Contribution Summary
- Intervention Quality
- Attribution Confidence

### 3. Unmatched / Ambiguous

- Approx. Timestamp
- Transcript Name / Candidate
- Contribution Summary
- Reason Not Assigned
- Possible Roster Match, if any

### 4. Session Summary

- Students with assigned participation
- Assigned substantive interventions
- Unassigned substantive interventions
- Distribution of quality scores 1–5
- Strongest contributors
- Infrequent but high-quality contributors
- Frequent but relatively superficial contributors, if applicable

## Output B. App-import workbook

Filename convention:

`Participation_Import_<course>_<YYYY-MM-DD>.xlsx`

The first sheet must use these exact columns:

| Column | Required | Meaning |
|---|---|---|
| Student ID | Preferred | Exact roster identifier |
| First Name | Yes if no Student ID/email | Exact roster first name |
| Last Name | Yes if no Student ID/email | Exact roster surname |
| Interventions | Yes | Number of substantive interventions |
| Quality Score | Yes | Overall session quality, integer 1–5 |
| Confidence | Yes | High or Confirmed by default |
| Comment | Optional | Short evidence-based summary |
| Session Date | Yes when importing from course screen | `YYYY-MM-DD` |
| Session Title | Recommended | Session title |

App-import eligibility:

- include only students present in the official roster;
- include only High or Confirmed identity matches by default;
- use Student ID whenever available;
- do not include an unmatched or ambiguous name;
- do not include zero-intervention students;
- use whole-number quality scores from 1 to 5.

The Class Participation System maps quality scores as follows while preserving the numeric score:

- 4–5 → Strong
- 3 → Standard
- 1–2 → Limited

## App import behavior expected

The application should:

1. match Student ID exactly;
2. otherwise match email exactly;
3. otherwise match exact normalized first name + surname;
4. skip unmatched rows;
5. preview matches before writing data;
6. replace prior file-imported participation for that session when re-importing;
7. preserve manually recorded participation events;
8. retain the numeric quality score 1–5;
9. record source as `participation-import`;
10. retain confidence and comment as audit metadata.

## Error handling

If no unique roster match exists:

- do not guess;
- place the contribution in `Unmatched / Ambiguous`;
- explain what evidence is missing.

If the roster contains duplicate names:

- require Student ID or email, or explicit user confirmation.

If the transcript does not preserve timestamps:

- continue with sequential evidence but mark timestamps unavailable.

If Zoom labels all turns as the professor:

- ignore speaker labels for identity and reconstruct turns from conversational context.

If the transcript is incomplete:

- state that totals are minimum observed counts, not guaranteed class totals.

## Privacy

The roster and transcript may contain educational records and personal data.

- Do not publish student-level outputs in a public repository.
- Keep generated reports local to the user unless explicitly instructed otherwise.
- Do not store student names, IDs, emails or transcripts in source control.
- Import only the minimum data required for classroom participation tracking.

## Default execution policy

When both a Zoom transcript and roster are supplied, execute the full workflow without requiring the user to restate these instructions.

The default deliverables are:

1. concise participation summary in chat;
2. full Excel participation report;
3. app-import Excel workbook;
4. explicit list of excluded/unmatched interventions;
5. warning if any identity assignment requires professor confirmation.
