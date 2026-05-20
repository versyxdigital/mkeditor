---
description: Show AI Assistant phase status and next-up phase
---

Read `docs/AI_ASSISTANT.md` and locate the **Phase Index** table.

Report:

1. The full phase index as a compact table (number, name, status emoji).
2. The next phase to execute (lowest 🔵 row).
3. Any blockers noted in the doc since the last status check.
4. A one-line recommendation: "next step is `/assistant-phase <N>`" or, if a phase is 🟡 in-progress, "resume in-progress phase N".

Do not run reviewers. Do not modify code or docs. Keep output under 25 lines.
