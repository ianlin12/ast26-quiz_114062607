# CLAUDE.md — Quiz Submission Repository

## Overview

This is a **public** repository where students submit multiple-choice quiz questions
for the Advanced Storage Systems course. Students open PRs to add YAML quiz files.
CI validates structure, Claude reviews quality and checks for duplicates, and on merge
the questions are pushed to the main course website API.

This repo is the **permanent source of truth** for all quiz questions. The main site's
database is a read cache synced from this repo.

---

## Repository Structure

you can find ANTHROPIC_API_KEY at .env

```
quiz-pool/
├── CLAUDE.md                          ← this file
├── CONTRIBUTING.md                    ← student-facing guide
├── templates/
│   └── quiz-template.yaml            ← blank template to copy
├── docs/
│   ├── flash-ssd/
│   │   ├── nand-cell-types/
│   │   │   └── quiz/
│   │   │       ├── .gitkeep
│   │   │       ├── q-alice-chen-1.yaml
│   │   │       └── q-bob-smith-1.yaml
│   │   ├── block-page-plane-hierarchy/
│   │   │   └── quiz/
│   │   │       └── .gitkeep
│   │   ├── ssd-architecture/
│   │   │   └── quiz/
│   │   │       └── .gitkeep
│   │   └── ... (one folder per concept)
│   ├── io-interfaces/
│   │   └── ...
│   ├── indexing/
│   │   └── ...
│   ├── filesystems/
│   │   └── ...
│   ├── reliability/
│   │   └── ...
│   └── data-systems/
│       └── ...
├── scripts/
│   ├── validate-quiz.js               ← structural validation (CI Job 1)
│   ├── push-to-site.js                ← push merged quizzes to API (CI Job 3)
│   └── reconcile.js                   ← full sync check (manual/cron)
├── package.json
└── .github/
    └── workflows/
        ├── quiz-review.yml            ← CI Jobs 1 & 2 (on PR)
        └── quiz-push.yml              ← CI Job 3 (on merge to main)
```

The folder structure under `docs/` mirrors the main course site exactly. Each concept
has a `quiz/` subdirectory. All YAML files in `quiz/` are quiz questions that stay
in the repo permanently after merge.

---

## Quiz YAML Schema

### File Location

```
docs/<pillar>/<concept-slug>/quiz/q-<github-handle>-<n>.yaml
```

Examples:
```
docs/flash-ssd/nand-cell-types/quiz/q-alice-chen-1.yaml
docs/flash-ssd/nand-cell-types/quiz/q-alice-chen-2.yaml
docs/indexing/btree-btreeplus/quiz/q-bob-smith-1.yaml
```

### Filename Convention

```
q-<github-handle>-<n>.yaml
```

- `<github-handle>` is the student's GitHub username (lowercase, hyphens ok)
- `<n>` is a sequential number starting from 1 (per student per concept)
- The handle in the filename MUST match the PR author's GitHub username
- The handle in the filename MUST match the `author` field inside the YAML

### Schema

```yaml
author: alice-chen
date: 2026-03-15
question: |
  An SSD with page-level FTL has 1TB of flash and 4KB pages.
  How many entries does the full mapping table require?
options:
  - text: "256M entries, ~1GB SRAM"
    correct: true
    explanation: |
      1TB / 4KB = 256M pages. Each entry needs ~4 bytes
      for physical address, so 256M × 4B = **1GB**.
  - text: "256K entries, ~1MB SRAM"
    explanation: |
      This would be correct for 1GB of flash, not 1TB.
      Off by **1000x**.
  - text: "256M entries, ~1MB SRAM"
    explanation: |
      Right number of entries but drastically
      underestimates the per-entry size.
  - text: "1M entries, ~4MB SRAM"
    explanation: |
      This assumes block-level mapping
      (256 pages per block), not page-level.
```

### Rules

- **Exactly 4 options**, exactly 1 marked `correct: true`
- Required fields: `author`, `date`, `question`, `options`
- `date` must be a valid date in `YYYY-MM-DD` format
- `question` must be non-empty (minimum 20 characters)
- Each option must have `text` and `explanation`
- Exactly one option must have `correct: true`
- All text fields support **full Markdown**: bold, inline code, math (KaTeX), etc.
- `explanation` is shown for ALL options after the student clicks "Check Answer"
  on the course website
- Each student creates a NEW file; no one edits another student's file

---

## Scaffolding Script

Create a script to generate the initial folder structure from the main site's
knowledge graph.

### `scripts/scaffold-from-graph.js`

This script:

1. Takes `knowledge-graph.yaml` as input (downloaded or copied from the main site repo)
2. For each pillar → for each concept (brick + lecture):
   - Creates `docs/<pillar>/<concept-slug>/quiz/`
   - Places a `.gitkeep` in each empty quiz directory
3. Is idempotent — running it again does not delete existing quiz files

```bash
node scripts/scaffold-from-graph.js path/to/knowledge-graph.yaml
```

The script should also generate a `CONCEPTS.md` file at the repo root listing all
valid concept folders, so students know where they can submit. Format:

```markdown
# Available Concepts

## ⚡ Flash & SSD Internals
- `flash-ssd/nand-cell-types` — NAND Flash Cell Types
- `flash-ssd/block-page-plane-hierarchy` — Block / Page / Plane Hierarchy
- `flash-ssd/ssd-architecture` — SSD Architecture
...

## 🔌 I/O Interfaces & Kernel
...
```

---

## CONTRIBUTING.md

Create a student-facing guide. Tone: friendly, clear, concise.

### Content

```markdown
# Contributing Quiz Questions

## Quick Start

1. Fork this repository
2. Copy `templates/quiz-template.yaml`
3. Place your copy in the right topic folder:
   `docs/<pillar>/<concept>/quiz/q-<your-github-username>-1.yaml`
4. Write your question following the template
5. Open a Pull Request

See `CONCEPTS.md` for the full list of available topics.

## Writing Good Questions

**DO:**
- Test reasoning and application, not vocabulary recall
- Make distractors plausible (each should represent a real misconception)
- Make the correct answer unambiguously correct
- Use Markdown formatting: **bold**, `inline code`, $math$
- Write clear explanations for ALL four options

**DON'T:**
- Write "which of the following is true" style questions
- Make one option obviously wrong or joke-like
- Copy questions from textbooks or other sources
- Submit questions on topics you haven't studied yet

## Example

See `templates/quiz-template.yaml` for a complete example.

## What Happens After You Submit

1. Automated checks validate your YAML structure
2. An AI reviewer checks question quality and uniqueness
3. A maintainer reviews and merges your PR
4. Your question appears on the course website with your name as author

## File Naming

Your file must be named: `q-<your-github-username>-<number>.yaml`

- Use your actual GitHub username (the one on the PR)
- Number sequentially: `-1`, `-2`, `-3` for multiple questions in the same topic
- Example: `q-alice-chen-1.yaml`, `q-alice-chen-2.yaml`

## Troubleshooting

**CI says "author mismatch":**
The `author:` field in your YAML must match your GitHub username exactly.

**CI says "invalid folder":**
Check `CONCEPTS.md` for valid topic paths. Make sure your file is inside a `quiz/` folder.

**AI reviewer says "duplicate":**
Your question overlaps with an existing one. Read the reviewer's suggestion for
alternative angles to explore.
```

---

## Quiz Template

### `templates/quiz-template.yaml`

```yaml
author: your-github-username
date: 2026-01-01
question: |
  Write your question here. You can use **Markdown** formatting,
  `inline code`, and math like $O(n \log n)$.

  Multi-line questions are fine. Include enough context for the
  question to stand on its own.
options:
  - text: "First option (the correct one in this example)"
    correct: true
    explanation: |
      Explain WHY this is correct. Show the reasoning or calculation.
  - text: "Second option (a plausible wrong answer)"
    explanation: |
      Explain the misconception this represents.
      Why might a student pick this?
  - text: "Third option"
    explanation: |
      Explain what's wrong and what it would be correct for.
  - text: "Fourth option"
    explanation: |
      Explain the error in reasoning.
```

---

## CI Pipeline

### Workflow 1: `quiz-review.yml` (on Pull Request)

Triggers when a PR adds or modifies files matching `docs/**/quiz/q-*.yaml`.

#### Job 1: Structural Validation

Runs always. Fast. No AI. Must pass for merge.

```yaml
name: Quiz Review
on:
  pull_request:
    paths: ['docs/**/quiz/q-*.yaml']

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: npm ci

      - name: Get changed quiz files
        id: changed
        uses: tj-actions/changed-files@v44
        with:
          files: 'docs/**/quiz/q-*.yaml'

      - name: Validate quiz files
        run: node scripts/validate-quiz.js ${{ steps.changed.outputs.all_changed_files }}
        env:
          PR_AUTHOR: ${{ github.event.pull_request.user.login }}
```

#### `scripts/validate-quiz.js`

Takes a list of file paths as CLI arguments. For each file:

**Checks (all must pass):**

1. **Valid YAML** — file parses without error
2. **Required fields present** — `author`, `date`, `question`, `options`
3. **Exactly 4 options** — `options` array has length 4
4. **Exactly 1 correct** — exactly one option has `correct: true`
5. **Each option has `text` and `explanation`** — both non-empty strings
6. **`question` is substantive** — minimum 20 characters
7. **Each `explanation` is substantive** — minimum 10 characters
8. **`date` is valid** — parses as YYYY-MM-DD
9. **Author matches PR author** — the `author` field in YAML equals the
   `PR_AUTHOR` environment variable (case-insensitive)
10. **Filename matches author** — the filename `q-<handle>-<n>.yaml` contains
    the same handle as the `author` field
11. **Filename is unique** — no other file with the same name exists in the
    target `quiz/` directory (check against existing files on main branch)
12. **Target folder exists** — the `quiz/` parent directory exists in the repo
    (meaning it's a valid concept)

**Output:** For each file, print pass/fail per check. If any check fails, exit with
code 1 (blocks merge).

**PR Comment:** Post a summary as a PR comment using `peter-evans/create-or-update-comment`:

```markdown
## 🧱 Quiz Validation Results

### `docs/flash-ssd/nand-cell-types/quiz/q-alice-chen-1.yaml`

| Check | Result |
|-------|--------|
| Valid YAML | ✅ |
| Required fields | ✅ |
| 4 options, 1 correct | ✅ |
| Options have text + explanation | ✅ |
| Question substantive | ✅ |
| Date valid | ✅ |
| Author matches PR author | ✅ |
| Filename matches author | ✅ |
| Filename unique | ✅ |
| Target folder exists | ✅ |

**Result: ✅ All structural checks passed**
```

#### Job 2: Claude Quality Review

Runs only if Job 1 passes. Posts review as PR comment. Does NOT block merge
(advisory only — instructor makes final call).

```yaml
  claude-review:
    needs: validate
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # need full history to get all existing files

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: npm ci

      - name: Get changed quiz files
        id: changed
        uses: tj-actions/changed-files@v44
        with:
          files: 'docs/**/quiz/q-*.yaml'

      - name: Claude review
        run: node scripts/claude-review.js ${{ steps.changed.outputs.all_changed_files }}
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}

```

#### `scripts/claude-review.js`

For each new/changed quiz file:

1. Read the file content
2. Find the `quiz/` directory it belongs to
3. Read ALL existing `q-*.yaml` files in that same directory (these are the
   previously merged questions for the same concept)
4. Call Claude API (`claude-sonnet-4-5-20250929`) with:

```
System: You are a quiz question reviewer for a graduate-level storage systems
course. You assess question quality and check for duplicates.

User:
## New Question
File: q-alice-chen-1.yaml
Topic: flash-ssd / nand-cell-types

<new question YAML content>

## Existing Questions in This Topic (${count} total)
<all existing YAML contents, each prefixed with filename>

## Review Tasks

### 1. Quality Assessment
- Is the question testing reasoning, application, or analysis — NOT just
  vocabulary recall or definition matching?
- Is the correct answer unambiguously correct?
- Are all 4 distractors plausible? Does each represent a real misconception
  a student might have?
- Are the explanations clear and educational?
- Is the question well-written (clear, grammatically correct, sufficient context)?

### 2. Duplicate Detection
- Is this question semantically different from ALL existing questions?
- It must test a different aspect, scenario, or reasoning chain — not just
  rephrase an existing question with different numbers or wording.
- If it overlaps with an existing question, identify which one and explain
  the overlap.

Respond in this exact JSON format:
{
  "quality_verdict": "approve" | "request-changes",
  "quality_feedback": "One paragraph explaining your assessment.",
  "is_duplicate": true | false,
  "duplicate_of": "filename.yaml" | null,
  "duplicate_explanation": "..." | null,
  "suggestions": ["2-3 alternative angles the student could explore if this is a duplicate or needs improvement"]
}
```

5. Parse Claude's JSON response
6. Post as PR comment:

```markdown
## 🤖 AI Quality Review

### `q-alice-chen-1.yaml`

**Quality:** ✅ Approved
> The question tests application of page-level FTL math, not just definitions.
> Distractors represent common off-by-factor errors and confusion between
> mapping granularities. Well-crafted.

**Duplicate check:** ✅ Unique
> No overlap with existing questions in this topic.

---

_Review by Claude (claude-sonnet-4-5-20250929). This is advisory — a maintainer makes the final merge decision._
```

Or if issues found:

```markdown
## 🤖 AI Quality Review

### `q-alice-chen-1.yaml`

**Quality:** ⚠️ Request Changes
> The question asks "what does FTL stand for?" which is vocabulary recall,
> not application. Consider asking students to calculate or reason about
> FTL behavior instead.

**Duplicate check:** ❌ Duplicate Detected
> This question overlaps significantly with `q-bob-smith-1.yaml`, which
> also asks about page-level FTL table size for a 1TB drive.

**Suggested alternative angles:**
1. Ask about the tradeoff between page-level and block-level FTL in terms of write amplification
2. Present a scenario where DFTL's demand-based approach saves SRAM and ask students to calculate the reduction
3. Ask about FTL behavior during garbage collection

---
_Review by Claude (claude-sonnet-4-5-20250929). This is advisory._
```

**Error handling for Claude review:**
- If the API call fails, post a comment saying "AI review unavailable — please
  review manually" and do NOT block the PR.
- Timeout: 60 seconds per question.
- If the topic has >50 existing questions, send only the 20 most recent to Claude
  (to stay within context limits) and note this in the review comment.

---

### Workflow 2: `quiz-push.yml` (on merge to main)

Triggers when quiz files land on the main branch. Pushes them to the course website API.

```yaml
name: Push Quizzes to Site
on:
  push:
    branches: [main]
    paths: ['docs/**/quiz/q-*.yaml']

jobs:
  push:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 2  # need previous commit to compute diff

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: npm ci

      - name: Push to site
        run: node scripts/push-to-site.js
        env:
          SITE_API_URL: ${{ secrets.SITE_API_URL }}
          QUIZ_PUSH_TOKEN: ${{ secrets.QUIZ_PUSH_TOKEN }}
```

#### `scripts/push-to-site.js`

1. Compute the diff between `HEAD` and `HEAD~1`:
   ```bash
   git diff --name-status HEAD~1 HEAD -- 'docs/**/quiz/q-*.yaml'
   ```
   This gives lines like:
   ```
   A   docs/flash-ssd/nand-cell-types/quiz/q-alice-chen-1.yaml   (added)
   M   docs/flash-ssd/nand-cell-types/quiz/q-bob-smith-1.yaml    (modified)
   D   docs/indexing/btree-btreeplus/quiz/q-carol-wu-1.yaml       (deleted)
   ```

2. For each file, determine the action:
   - `A` (added) or `M` (modified) → **upsert**
   - `D` (deleted) → **delete**

3. For upserts, parse the YAML and extract:
   - `pillar` and `concept` from the file path
   - All fields from the YAML content
   - `filename` from the file name

4. Call the main site API:

   **Upsert:**
   ```
   POST ${SITE_API_URL}/api/quiz
   Authorization: Bearer ${QUIZ_PUSH_TOKEN}
   Content-Type: application/json

   {
     "pillar": "flash-ssd",
     "concept": "nand-cell-types",
     "filename": "q-alice-chen-1.yaml",
     "author": "alice-chen",
     "date": "2026-03-15",
     "question": "...",
     "options": [...]
   }
   ```

   **Delete:**
   ```
   DELETE ${SITE_API_URL}/api/quiz
   Authorization: Bearer ${QUIZ_PUSH_TOKEN}
   Content-Type: application/json

   {
     "pillar": "flash-ssd",
     "concept": "nand-cell-types",
     "filename": "q-alice-chen-1.yaml"
   }
   ```

5. **Retry logic:** For each API call:
   - On success (2xx): log and continue
   - On 4xx: log error, do NOT retry (bad data, needs manual fix)
   - On 5xx or network error: retry up to 3 times with exponential backoff
     (2s, 4s, 8s)
   - On final failure: collect in a failure list

6. **On any failures after retries:** Open a GitHub Issue:

   ```markdown
   ## ⚠️ Quiz Sync Failed

   The following quiz files were merged but failed to push to the course website.

   | File | Error |
   |------|-------|
   | `docs/flash-ssd/.../q-alice-chen-1.yaml` | 500 Internal Server Error |

   **Action needed:** Run manual reconciliation or re-trigger this workflow.

   Commit: ${GITHUB_SHA}
   ```

   Use `peter-evans/create-issue-from-file` or the GitHub API directly.

7. **Summary output:** Print a table:
   ```
   ✅ q-alice-chen-1.yaml → upserted
   ✅ q-bob-smith-1.yaml  → upserted
   ❌ q-carol-wu-1.yaml   → FAILED (500, retried 3x)
   ```

---

### Reconciliation Script

#### `scripts/reconcile.js`

A manual script (not CI) that checks the quiz repo against the site database
and fixes any drift.

```bash
# Check for drift without fixing
node scripts/reconcile.js --check

# Fix drift (push missing, delete orphaned)
node scripts/reconcile.js --fix
```

**Behavior:**

1. Glob all `q-*.yaml` files in the repo
2. Parse each into a quiz record (pillar, concept, filename, content hash)
3. Call `GET ${SITE_API_URL}/api/quiz/sync/status` — returns all quiz records
   in the DB with their content hashes
4. Compare:
   - **In repo but not in DB** → push (upsert)
   - **In DB but not in repo** → delete from DB (was removed from repo)
   - **In both but different hash** → update in DB (content was edited)
   - **In both and same hash** → skip (in sync)
5. Print summary:
   ```
   Repo: 142 quiz files
   DB:   140 quiz records
   Missing from DB: 3
   Orphaned in DB:  1
   Content mismatch: 0
   ```
6. With `--fix`: execute the upserts and deletes
7. With `--check`: report only, no mutations

**Environment variables:** Same `SITE_API_URL` and `QUIZ_PUSH_TOKEN` as the push workflow.

---

## Main Site API Contract

The main course website must implement these endpoints. Document this here so both
repos agree on the contract.

### `POST /api/quiz` — Upsert a quiz question

```
Authorization: Bearer <QUIZ_PUSH_TOKEN>
Content-Type: application/json

{
  "pillar": "flash-ssd",
  "concept": "nand-cell-types",
  "filename": "q-alice-chen-1.yaml",
  "author": "alice-chen",
  "date": "2026-03-15",
  "question": "An SSD with page-level FTL has 1TB...",
  "options": [
    {
      "text": "256M entries, ~1GB SRAM",
      "correct": true,
      "explanation": "1TB / 4KB = 256M pages..."
    },
    {
      "text": "256K entries, ~1MB SRAM",
      "explanation": "This would be correct for 1GB..."
    },
    {
      "text": "256M entries, ~1MB SRAM",
      "explanation": "Right number of entries but..."
    },
    {
      "text": "1M entries, ~4MB SRAM",
      "explanation": "This assumes block-level..."
    }
  ]
}
```

**Response:** `200 OK` with `{ "id": "uuid", "action": "created" | "updated" }`

**Upsert key:** `(concept, filename)` — if a record with the same concept + filename
exists, update it. Otherwise create.

### `DELETE /api/quiz` — Soft-delete a quiz question

```
Authorization: Bearer <QUIZ_PUSH_TOKEN>
Content-Type: application/json

{
  "pillar": "flash-ssd",
  "concept": "nand-cell-types",
  "filename": "q-alice-chen-1.yaml"
}
```

**Response:** `200 OK` with `{ "id": "uuid", "action": "deleted" }`

Soft-delete: sets `deleted_at` timestamp. The question no longer appears on the site
but remains in the DB for audit.

### `GET /api/quiz/:pillar/:concept` — List quizzes for a concept

```
GET /api/quiz/flash-ssd/nand-cell-types
```

**Response:** `200 OK` with array of quiz objects (excluding soft-deleted).

No auth required — this is the public read endpoint used by the site frontend.

### `GET /api/quiz/sync/status` — Reconciliation status

```
Authorization: Bearer <QUIZ_PUSH_TOKEN>
```

**Response:** `200 OK` with:
```json
{
  "total": 140,
  "quizzes": [
    {
      "concept": "nand-cell-types",
      "filename": "q-alice-chen-1.yaml",
      "content_hash": "a3f2b1c4..."
    }
  ]
}
```

The `content_hash` is SHA-256 of the quiz's canonical JSON (sorted keys), used by
the reconciliation script to detect content changes.

---

## Repository Secrets

Configure these in GitHub repo settings → Secrets and variables → Actions:

| Secret | Purpose |
|--------|---------|
| `ANTHROPIC_API_KEY` | Claude API for quality review (Job 2) |
| `SITE_API_URL` | Main course website base URL, e.g. `https://storage.example.com` |
| `QUIZ_PUSH_TOKEN` | Bearer token for authenticating push/delete API calls |

---

## Dependencies

```json
{
  "name": "storage-systems-quiz-pool",
  "private": false,
  "scripts": {
    "validate": "node scripts/validate-quiz.js",
    "scaffold": "node scripts/scaffold-from-graph.js"
  },
  "dependencies": {
    "js-yaml": "^4.1.0"
  },
  "devDependencies": {
    "@anthropic-ai/sdk": "^0.30.0"
  }
}
```

Keep dependencies minimal. This repo has no framework — just YAML files, validation
scripts, and CI workflows.

---

## Execution Checklist

```
[ ] Phase 1: Repository setup
    [ ] Initialize repo with package.json
    [ ] Create folder structure (run scaffold from knowledge-graph.yaml)
    [ ] .gitkeep in every empty quiz/ directory
    [ ] CONCEPTS.md generated listing all valid concept folders
    [ ] CONTRIBUTING.md with student guide
    [ ] templates/quiz-template.yaml

[ ] Phase 2: Validation script
    [ ] scripts/validate-quiz.js created
    [ ] Parses YAML correctly
    [ ] Checks all 12 structural rules
    [ ] Author-match check works (compares to PR_AUTHOR env var)
    [ ] Filename-match check works
    [ ] Filename uniqueness check works
    [ ] Exits with code 1 on any failure
    [ ] Outputs clear per-check pass/fail table
    [ ] Test: create a valid YAML and verify all checks pass
    [ ] Test: create an invalid YAML (3 options) and verify it fails
    [ ] Test: create a YAML with wrong author and verify it fails

[ ] Phase 3: Claude review script
    [ ] scripts/claude-review.js created
    [ ] Reads new file + all existing files in same quiz/ directory
    [ ] Calls Claude API with structured prompt
    [ ] Parses JSON response correctly
    [ ] Handles >50 existing questions (truncates to 20 most recent)
    [ ] Handles API failure gracefully (posts "unavailable" comment)
    [ ] Formats review as clear PR comment markdown
    [ ] Test: submit a good question and verify approval
    [ ] Test: submit a duplicate and verify detection

[ ] Phase 4: CI workflows
    [ ] .github/workflows/quiz-review.yml created
    [ ] Triggers on PR with quiz file changes
    [ ] Job 1 (validate) runs and posts PR comment
    [ ] Job 2 (Claude review) runs only if Job 1 passes
    [ ] Job 2 posts review as PR comment
    [ ] Structural failure blocks merge (required check)
    [ ] Claude review is advisory (not required for merge)

[ ] Phase 5: Push workflow
    [ ] .github/workflows/quiz-push.yml created
    [ ] Triggers on push to main with quiz file changes
    [ ] scripts/push-to-site.js created
    [ ] Correctly detects added/modified/deleted files via git diff
    [ ] Upserts new and modified quizzes
    [ ] Deletes removed quizzes
    [ ] Retry with backoff on 5xx errors
    [ ] Opens GitHub Issue on final failure
    [ ] Test: merge a PR and verify quiz appears on site

[ ] Phase 6: Reconciliation
    [ ] scripts/reconcile.js created
    [ ] --check mode reports drift without fixing
    [ ] --fix mode pushes missing, deletes orphaned, updates changed
    [ ] Test: manually delete a quiz from DB, run --fix, verify it's restored

[ ] Phase 7: Sample quiz questions
    [ ] Create 3-5 sample quiz YAML files across different concepts
    [ ] Verify they pass validation
    [ ] Verify they push to site correctly after merge
    [ ] Verify they display on the course website with author names shown
```

---

## Notes

- **YAML files stay in the repo forever after merge.** They are never deleted by
  automation. Only an instructor manually deleting a file (via PR) triggers a
  soft-delete on the site.
- **Author verification is critical.** Without it, students can impersonate each
  other. The CI must check `YAML author == filename handle == PR author`.
- **Claude review uses `claude-sonnet-4-5-20250929`** for cost efficiency. Do not use
  Opus for CI — it's too slow and expensive for per-PR review.
- **The push workflow must handle multi-file PRs.** A single merge might add 5 quiz
  files across 3 different concepts. Each is pushed individually.
- **The reconciliation script is a safety net.** Run it weekly or after any suspected
  sync issue. It's not in CI — it's a manual tool.
- **Keep this repo minimal.** No framework, no build step, no bundler. Just YAML
  files, Node.js scripts, and CI workflows. Students should be able to contribute
  with nothing more than a text editor and `git`.
