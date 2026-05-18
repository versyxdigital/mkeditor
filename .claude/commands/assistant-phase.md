---
description: Execute a phase of the AI Assistant feature end-to-end (plan → implement → review → report)
argument-hint: <phase-number>
---

You are executing **Phase $1** of the AI Assistant feature described in `docs/AI_ASSISTANT.md`.

## Procedure

1. **Anchor.** Read three things in order, then summarise back what you read so context is fresh:
   - `docs/AI_ASSISTANT.md` — specifically the **Decisions** section, the **Persistence Schema**, and the section "## Phase $1 — …".
   - `CLAUDE.md` — for the governing rule "Managers own data and IPC. React owns UI and presentation."
   - `docs/ARCHITECTURE.md` — only the sections relevant to files this phase will touch.

2. **Prereq check.** Look at the Phase Index table. Every phase 1..($1 − 1) must be marked 🟢. If any prior phase is 🔵 or 🟡, stop and report — do not start.

3. **Branch.** Confirm you are on a branch named `feature/assistant-phase-$1-<slug>`. If not, ask the user to switch or create one. Do not switch branches yourself.

4. **Plan.** Use `TodoWrite` to create one task per numbered task in the phase, plus a final "Run end-of-phase reviewers" task and a "Report and request commit approval" task.

5. **Implement.** Execute tasks in the listed order.
   - **Parallel sub-agents are allowed** only when sub-tasks have strictly non-overlapping file ownership. Dispatch via the `assistant-phase-executor` agent, briefing each one with its exact file list and the rule "do not touch any other files." Sequential or shared-file work stays in this session.
   - **Shared infrastructure** is always your responsibility — never delegate it to a sub-agent. Specifically: `src/app/preload.ts`, `src/app/AppBridge.ts`, `src/app/main.ts`, `src/browser/core/BridgeManager.ts`, `src/browser/core/BridgeListeners.ts`, `src/browser/react/App.tsx`, `src/browser/react/contexts/UIStateContext.tsx`, `src/browser/react/contexts/ManagersContext.tsx`, `src/app/lib/AppSession.ts`, `src/browser/core/FileManager.ts` session methods, `webpack.config.js`, `package.json`.
   - **Dependency installs** (P1: `ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `ollama-ai-provider`, `zod`) are also your responsibility — confirm the Decisions table or task list authorises any new dep before installing.
   - If implementation reveals a planning gap or wrong assumption, **stop, surface the question to the user, update `docs/AI_ASSISTANT.md` first, then resume**.

6. **End-of-phase review.** Once implementation tasks are complete, dispatch all three reviewers **in parallel** (single message, three `Agent` tool calls):
   - `assistant-phase-reviewer` — brief it with: phase number $1, the diff scope (current branch vs `main`), and the exit criteria from the doc.
   - `assistant-architecture-auditor` — brief it with: diff scope and the architectural rules.
   - `assistant-test-auditor` — brief it with: diff scope.

7. **Synthesise.** Combine the three reports into:
   - ✅ Passes (one line per check that passed)
   - ⚠️ Concerns (with file:line citations and proposed fixes)
   - ❌ Blockers (must address before merge)

8. **Address.** Fix blockers and concerns the user agrees to. Re-run the relevant reviewer(s) to confirm.

9. **Local verification.** Run `npm test`, `npm run lint`, and the relevant build (`npm run build-app` for P1, `npm run build-editor` for P2–P8, plus `npm run build-app` again for any phase that touches `src/app/`). Report results. Prompt the user to perform a manual smoke (desktop for P1–P6, both for P7 onward).

10. **Report and request approval.** Output a structured summary:
    - Files created/modified (compact list).
    - Reviewer verdicts (one line each).
    - Exit-criteria checklist with ✅/❌.
    - Proposed commit message in Conventional Commits format with the `assistant` scope (e.g. `feat(assistant): phase 1 — main-process infrastructure (AppAssistant + keystore + IPC)`).
    - **Ask the user explicitly** whether to commit. Do not commit without approval.

11. **On approval.** Commit on the current `feature/assistant-phase-$1-*` branch. After the commit lands, edit the Phase Index row in `docs/AI_ASSISTANT.md` to 🟢 with today's date.

## Hard rules

- Never skip a phase or merge phase boundaries.
- Never introduce a new dependency unless the phase tasks or Decisions table authorise it.
- Never call `git commit` without explicit user approval.
- Never modify the phase status emoji except after a user-approved commit.
- Never leak an API key value through a log, a renderer-bound IPC payload, or a test fixture.
- If the plan and the code disagree, the plan is updated first and the user is told.
