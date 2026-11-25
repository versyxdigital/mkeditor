# Test audit: Windows execution and false passes

Audit date: 25 November 2026.

The audit scanned all 110 existing Jest test files for disabled declarations,
early returns, swallowed errors and unawaited promise assertions. It also traced
the affected persistence, workspace, startup and diff-preview tests against their
production implementations, ran the full suite on Windows, and shuffled test
order to expose shared state. The suite now contains 111 files, including tests
for the new enforcement rules.

## Findings and fixes

| Finding                                                                                                                            | Change                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The original session replacement test returned immediately on Windows, hiding its outdated schema expectation.                     | The same replacement and schema checks now run on every OS. A failed-rename test also checks that the previous session survives.                                                        |
| Five filesystem tests could return when symlink creation was denied. Four actually executed no assertions on this Windows machine. | Directory links use real Windows junctions. Two file-link cases inject filesystem metadata into the real containment logic. Fixture setup errors now fail the test.                     |
| A main-window test returned without checking anything on macOS.                                                                    | The host-platform test checks the appropriate chrome and menu behavior; parameterized tests also exercise all three platform branches.                                                  |
| Main-process tests relied on the first test starting the app and shared a window that other tests could close.                     | Startup is fixture setup, and each test gets a fresh window. Tests also run individually by name.                                                                                       |
| Session filesystem failure mocks survived module resets and broke later tests when order changed.                                  | Each test resets the filesystem mock registration before installing its own fixture.                                                                                                    |
| Diff-preview option and disposal tests exercised a copied factory inside a fake manager.                                           | They now invoke the production `EditorManager.createDiffPreview`, with Monaco substituted at its external boundary.                                                                     |
| Several containment checks only compared filename suffixes.                                                                        | They now compare the full canonical path. Invalid-input coverage includes non-string values, and the traversal fixture stays inside its own temporary directory.                        |
| Paste-image cleanup ignored thrown errors.                                                                                         | Cleanup failures now fail the test.                                                                                                                                                     |
| A cloud-store test claimed atomic-write coverage without checking the write sequence.                                              | Separate tests verify staged replacement and preservation of the previous file after write or rename failure. Credential assertions explicitly check the mocked `safeStorage` boundary. |

## Ongoing enforcement

- `npm test` runs [audit-tests.cjs](../scripts/audit-tests.cjs) first. It rejects
  skipped, focused, placeholder and expected-failure declarations, including
  chained parameterized declarations and named Jest import aliases. It also
  rejects standalone unawaited `resolves`/`rejects` assertions.
- [requireAssertions.cjs](../tests/requireAssertions.cjs) makes Jest fail a test
  that executes no assertions. Its regression test launches a separate Jest
  process and verifies that empty and early-return cases fail while an asserted
  case passes. It checks structured JSON results with terminal colours enabled
  and disabled; colour codes must not affect the outcome.
- CI runs Node 24 on both Windows and Ubuntu, with shuffled test order. Jest
  reports the seed so failures can be reproduced with
  `npm test -- --runInBand --randomize --seed=<reported-seed> --showSeed`.
- Assertions must check production behavior. Mocks should replace dependencies,
  not duplicate the implementation being tested. Assertions and static checks
  still require review for whether they prove the behavior named by the test.

## Verification

Following the Node 24 update, the complete suite passes on Windows with Node
24.15.0 in shuffled order (seed `20261126`): **111 suites, 1,542 tests, zero
skipped**. The full run forces terminal colour output; the policy regression
cases explicitly test both coloured and plain output. Formatting, production-source
lint, renderer build and Electron main/preload build also pass.

Five temporary source mutations confirmed that relevant assertions fail:

| Deliberate fault                          | Assertion failures |
| ----------------------------------------- | -----------------: |
| Write the previous session schema         |                  2 |
| Accept workspace parent traversal         |                  4 |
| Re-enable the diff-preview line numbers   |                  1 |
| Send an incorrect Drive save precondition |                  1 |
| Send an incorrect Dropbox save revision   |                  2 |

Every mutated source file was restored byte for byte. No production changes were
needed for these test fixes.

Platform-branch tests simulate platform values; native filesystem tests use the
host OS. Electron, Monaco UI and credential backends remain separate integration
boundaries: Jest mocks do not verify the native implementations. See the
[Drive smoke and restart checks](cloud/drive-smoke-tests.md) and
[Dropbox smoke checks](cloud/dropbox.md). The updated GitHub Actions jobs must run
after these changes are pushed; no new remote CI result is claimed here.
