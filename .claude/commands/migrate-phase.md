---
description: Execute a phase of the React migration end-to-end (plan → implement → review → report)
argument-hint: <phase-number>
---

You are executing **Phase $1** of the React migration described in `docs/REACT_MIGRATION.md`.

## Procedure

1. **Anchor.** Read three things in order, then summarise back what you read so context is fresh:
   - `docs/REACT_MIGRATION.md` — specifically the **Decisions** section and the section "## Phase $1 — …".
   - `CLAUDE.md` — for the governing rule "Managers own data and IPC. React owns UI and presentation."
   - `docs/ARCHITECTURE.md` — only the sections relevant to files this phase will touch.

2. **Prereq check.** Look at the Phase Index table. Every phase 1..($1 − 1) must be marked 🟢. If any prior phase is 🔵 or 🟡, stop and report — do not start.

3. **Branch.** Confirm you are on a branch named `feature/react-phase-$1-<slug>`. If not, ask the user to switch or create one. Do not switch branches yourself.

4. **Plan.** Use `TodoWrite` to create one task per numbered task in the phase, plus a final "Run end-of-phase reviewers" task and a "Report and request commit approval" task.

5. **Implement.** Execute tasks in the listed order.
   - **Parallel sub-agents are allowed** only when sub-tasks have strictly non-overlapping file ownership (e.g. building four independent modal components in Phase 7). Dispatch via the `react-phase-executor` agent, briefing each one with its exact file list and the rule "do not touch any other files." Sequential or shared-file work stays in this session.
   - **Shared infrastructure** (tsconfig, webpack.config.js, package.json, jest.config.js, index.ts, ManagersContext) is always your responsibility — never delegate it to a sub-agent.
   - If implementation reveals a planning gap or wrong assumption, **stop, surface the question to the user, update `docs/REACT_MIGRATION.md` first, then resume**.

6. **End-of-phase review.** Once implementation tasks are complete, dispatch all three reviewers **in parallel** (single message, three `Agent` tool calls):
   - `react-phase-reviewer` — brief it with: phase number $1, the diff scope (current branch vs `main`), and the exit criteria from the doc.
   - `react-architecture-auditor` — brief it with: diff scope and the architectural rules.
   - `react-test-auditor` — brief it with: diff scope.

7. **Synthesise.** Combine the three reports into:
   - ✅ Passes (one line per check that passed)
   - ⚠️ Concerns (with file:line citations and proposed fixes)
   - ❌ Blockers (must address before merge)

8. **Address.** Fix blockers and concerns the user agrees to. Re-run the relevant reviewer(s) to confirm.

9. **Local verification.** Run `npm test` and `npm run lint`. Report results. If desktop/web smoke is feasible, prompt the user to perform it.

10. **Report and request approval.** Output a structured summary:
    - Files created/modified (compact list).
    - Reviewer verdicts (one line each).
    - Exit-criteria checklist with ✅/❌.
    - Proposed commit message in Conventional Commits format with the `react` scope (e.g. `feat(react): phase 3 — preview pane and resizable workspace`).
    - **Ask the user explicitly** whether to commit. Do not commit without approval.

11. **On approval.** Commit on the current `feature/react-phase-$1-*` branch. After the commit lands, edit the Phase Index row in `docs/REACT_MIGRATION.md` to 🟢 with today's date.

## Hard rules

- Never skip a phase or merge phase boundaries.
- Never reintroduce a dependency listed as removed (Bootstrap renderer-side, `@popperjs/core`, `split.js`, `sweetalert2` once Phase 9/8 has dropped them).
- Never call `git commit` without explicit user approval.
- Never modify the phase status emoji except after a user-approved commit.
- If the plan and the code disagree, the plan is updated first and the user is told.
