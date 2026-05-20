---
description: Run all three custom-title-bar reviewers in parallel against a phase's diff
argument-hint: <phase-number>
---

Run a comprehensive standalone review of **Phase $1** of the custom-title-bar feature.

Use this for mid-phase checkpoints, after manual changes, or to re-check after fixes.

## Procedure

1. **Determine diff scope:**
   - If a `feature/title-bar-phase-$1-*` branch exists and is checked out, diff it against `main`: `git diff main...HEAD`.
   - Otherwise diff the working tree + staged changes against `main`.
   - Capture the changed file list once and reuse it across all three reviewers.

2. **Dispatch all three reviewers in parallel** — single message, three `Agent` tool calls:
   - `title-bar-phase-reviewer` — pass phase number $1, the changed file list, and the diff command to reproduce.
   - `title-bar-architecture-auditor` — pass the changed file list and diff command.
   - `title-bar-test-auditor` — pass the changed file list and diff command.

3. **Synthesise** results into:
   - ✅ **Passes** (one line per check that passed; consolidate across agents)
   - ⚠️ **Concerns** (file:line citations, proposed fix in one sentence)
   - ❌ **Blockers** (must address before phase can be marked complete)

4. **Recommend next action:**
   - "All clear — safe to mark phase complete" (if no blockers / concerns), OR
   - "Address blockers, then re-run `/title-bar-review $1`" (if blockers), OR
   - "Concerns only — your call whether to address now or defer."

## Hard rules

- **Read-only.** Do not modify code or docs as part of this command.
- Do not update the phase status emoji — that only happens after a `/title-bar-phase` flow ends in a commit.
- Do not run `npm test` or lint yourself; the `title-bar-test-auditor` agent owns that.
