# Google Drive implementation report

23 November 2026. Scope: the [Drive ticket](cloud-provider-integration.md). Google Drive browsing, optional My Drive saves, conflict recovery and new-file creation are implemented. Dropbox and other adapters remain separate roadmap work. A Windows walkthrough now records live consent, browsing, saving and creation. The remaining live failure/recovery matrix and Google production verification are pending.

## Live evidence

The owner reported successfully creating a Google app and using the original connection guide. Individual account-switch, revocation and OS-keychain cases were not itemized and are not claimed live-verified.

The owner then authorized the disposable-file write spike and continuation. The first v3 probe was inconclusive because no strong validator was returned. Further probes distinguished Drive's broad resource counter from the actual blob content revision. On **23 November 2026 at 13:14:36 UTC**, the exact v2 multipart `PUT`/`If-Match` protocol passed three current-validator writes (HTTP 200) and three stale-validator rejections (HTTP 412). Newer bytes, checksum, blob `headRevisionId` and visible metadata survived each rejected write. Only the generated, ownership-marked disposable file was created/changed/trashed. Its temporary OAuth credentials were not persisted or substituted for the saved connection. See [Decision B](drive-decisions.md#b--existing-file-save-precondition) and the non-secret report `out/drive-write-verification-v2-multipart.json`.

The protocol pass covers ordinary Markdown blobs in **My Drive**. Shared-drive writes and Google-native formats remain disabled. It is not a substitute for testing the final editing UI end to end with live Google.

### Recorded live UI walkthrough

On 23 November 2026, the owner requested recording assistance and completed Google consent using their remembered regular Chrome profile. The built production renderer and production `CloudService`/`GoogleDrive` code ran in an isolated demo shell with in-memory connection persistence, without loading or changing existing saved MKEditor connections. OS-backed token encryption was exercised in that session; persistence across restart was not.

The successful take records read-only connection, separate editing consent, browsing an app-created disposable folder, opening/editing/saving its sample document, and creating/saving a second Markdown file. Independent Drive reads confirmed both final contents. The final captioned H.264 MP4 is `out/google-review/MKEditor-Google-Verification-2026-11-23.mp4` (88.4 seconds, 1280×900, about 1 MB). A final still segment shows the real Google account permission details because consent summarized already-granted access. It explains the additional `drive.file` grant from the earlier developer probe; normal UI requests remain `drive.readonly` and `drive`. No grant was revoked or changed during that inspection, and no video was uploaded or submitted.

An initial take failed because Chrome's window capture returned black frames and a consent-window transition ended capture. The corrected Windows helper uses `PrintWindow` and the browser document's accessible bounds, excludes the address bar, skips credential-entry screens and tolerates closed-window transitions. The final MP4 was decoded end to end without errors; consent, application actions, ending and permission-detail frames were visually inspected. The recorder is opt-in (`scripts/record-google-review.cjs`, `record-google-window.ps1`) and Windows-specific. It captures genuine UI and real provider requests, without fixture substitutions. Chrome profile selection reads only the last-used profile identifier, not cookies or passwords.

Both takes' disposable folders were retained in Drive; generated-ID manifests are under `out/google-review/`. This verifies the positive Windows flow, not live conflict, lost-response, revocation, account-switch, close/quit, other-OS or installer behavior. Those retain their separate fixture evidence and pending manual checks.

## Implemented behavior

- **Shared app registration:** normal users choose Connect with Google; Advanced retains custom Desktop registration. Only public Desktop client values are bundled. Existing token/client bindings are preserved. No account credentials were bundled or logged. Disconnect clears account labels, listings and credentials while retaining buffers.
- **Read-only by default:** Enable editing separately explains Google's full Drive permission and starts fresh consent. The actual granted scope is checked. A failed/cancelled upgrade preserves the previous credential and mode. Full Drive access still requires Google review; see the [consent submission guide](google-verification.md).
- **Safe existing-file saves:** file/account identity, edit permission and a strong validator are required. The main process serializes writes and uses the exact verified v2 multipart protocol. Renderer snapshots include model identity, contents and alternative-version ID. Acknowledging a snapshot does not mark later edits saved. Missing files are not recreated.
- **Conflict and uncertain-result recovery:** stale conditions preserve the buffer and offer comparison, local copy and confirmed reload. Reload rejects intervening edits. Lost responses retain their operation/snapshot and are reconciled through reads, without replaying writes. Pending/unconfirmed saves remain in close, workspace-switch and quit protection.
- **Creation and copies:** a generated ID plus an operation marker supports lost-response reconciliation. A same-name preflight match is refused without renaming. Google does not provide a unique-name reservation against other applications. Saving a copy never marks the source saved. Unknown non-empty copy results also retain a local recovery buffer.
- **Boundaries:** remote identities never enter filesystem writes or persisted sessions. Account changes cannot retarget tabs. Credentials stay in main with OS-backed encryption; safe reads have bounded retries, writes have no automatic retries. Remote previews disable raw HTML and local/relative asset resolution. Assistant remote selection writes remain blocked.
- **UI and localization:** Connections, Explorer actions and remote save notices use existing themed controls and the cloud namespace in all 13 locales. Prompt callbacks were moved to neutral `prompts.ts`, with compatible React-context re-exports, so the new manager code does not import UI modules.

Main ownership: `GoogleDrive.ts`, `CloudService.ts`, `CloudStore.ts`, `GoogleDriveRegistration.ts`. Renderer ownership: `CloudManager.ts`, injected FileManager remote operations, `useCloud.ts` and the cloud components. Existing sender-scoped AppBridge/preload channels carry validated commands, sanitized results and revisioned public snapshots. No new SDK dependency or lockfile change.

## Capability evidence

| Capability                                             | Implemented | Fixture-tested                                                           | Live evidence                                                                                |
| ------------------------------------------------------ | ----------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| OAuth/browser callback, browsing, Markdown opening     | Yes         | Real adapter against local HTTP                                          | Original connection success reported by owner; live disposable verifier also completed OAuth |
| Encrypted persistence and account/disconnect races     | Yes         | OS storage mocked; real HTTP lifecycle tests                             | Full OS-keychain/revocation matrix pending                                                   |
| Conditional My Drive updates                           | Yes         | Success, stale validator, unknown response, no replay, queued disconnect | Exact v2 multipart protocol passed three current/stale rounds                                |
| Snapshot dirty tracking and conflict/reload/check UI   | Yes         | FileManager/manager/component tests                                      | Windows save/create walkthrough passed; live failure/recovery cases pending                  |
| Generated-ID create, copy, collision refusal/reconcile | Yes         | Real adapter HTTP fixture                                                | New-file UI and saved contents verified live; copy/collision/reconcile live cases pending    |
| Shared-drive writes                                    | Disabled    | Rejection covered                                                        | Not verified                                                                                 |
| Localization, keyboard, themes, web gate               | Yes         | Component keyboard tests, locale checks; earlier offscreen checks        | Windows exercised; macOS/Linux not exercised                                                 |

## Validation

The baseline had 94 suites / 1,229 passing tests and existing renderer size warnings. Focused suites cover provider requests, OAuth scope upgrades, operation serialization, deleted/shared/account-bound writes, lost-response reconciliation, edit-during-save dirty tracking, reload confirmation/intervening edits and keyboard activation. They use deterministic local HTTP fixtures through the real adapter, with no live credentials.

| Command                                                                      | Result                                                        |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `npm test -- --runInBand`                                                    | 100 suites / 1,294 tests passed                               |
| Focused FileManager and cloud component suites after the final UI correction | 2 suites / 43 tests passed                                    |
| `npm run lint`                                                               | Passed                                                        |
| `npx tsc --noEmit`                                                           | Passed                                                        |
| `npm run build-app`                                                          | Passed                                                        |
| `npm run build-editor`                                                       | Passed; existing three categories of size/performance warning |
| `npm run prettier-check`                                                     | Passed                                                        |
| `git diff --check`                                                           | Passed                                                        |
| `node scripts/audit-i18n-coverage.mjs`                                       | All 325 statically referenced keys present in all 13 locales  |

An initial new component test used an uncached fake snapshot and failed; the fake was corrected and the full rerun passed. One concurrent validation process exited without a test report; the subsequent standalone full-suite run above completed successfully. No failing check was bypassed.

Earlier offscreen Windows checks covered Connections and remote browsing in light/dark themes, readonly typing, disconnect cleanup, local-copy dirty state and the web gate. The revised default sign-in button passed Enter activation in a component test. Hidden-window native keyboard dispatch did not activate it, so offscreen clicks were used and are not claimed as manual keyboard verification.

The final built-desktop local-HTTP check passed save acknowledgement, preservation of an external edit after a stale save, conflict comparison, Unicode-named creation and a committed write with a lost response followed by **Check save**. Monaco input was supplied through Chromium's input command; menu save events used the production bridge listener. App-chrome conflict notices were visually reviewed in light/dark themes, and the uncertain-save notice in dark mode. These checks found and fixed a timing bug where conflict actions depended on an imperative pending-write map after its notification had already fired; the notice now derives availability from its reactive save phase. The editor theme itself was left unchanged while capturing app-chrome themes. Temporary harness/profile files were removed. No live account was used for these UI checks.

### Cloud UI refinement — 24 November 2026

Storage selection lives in the top application toolbar, immediately after the sidebar toggle and before the file path. Explorer contains the folder toolbar and single-line 30px file rows. Account details live in the storage menu; creation and refresh use labelled icon buttons, and copy/connection actions live in the overflow menu. File metadata is available on hover instead of repeated rows. Official Google and Drive assets are bundled locally. Normal remote status and actions live beside the filename; only connection/save problems add a fixed 32px recovery bar inside the workspace.

The built renderer was exercised in hidden Electron against the production cloud service and adapter with local HTTP fixtures, without live credentials. Measurements passed at 180/240/360px sidebar widths in both themes, with no horizontal overflow or wrapped file rows. Saving did not move the editor. An 80-file listing scrolled while the source selector and toolbar retained their size and position. A genuine fixture stale-save rejection showed the recovery bar inside the workspace, with German text. Default, narrow, menu and conflict screenshots were visually reviewed. Component tests cover keyboard navigation/actions and recovery availability for saved, unconfirmed and disconnected documents.

The toolbar placement was also checked at 1280px and 720px window widths in both themes: the toolbar remained 32px high, the selector 28px, with no overflow. Switching storage with Explorer collapsed retained the active document. Component tests assert the selector's position, absence from Explorer, workspace switching and the web gate.

The refinement passed 100 suites / 1,304 tests, lint, renderer type checking, both builds, formatting and `git diff --check`. The renderer build retains its three size/performance warnings. The locale audit found all 331 statically referenced keys in all 13 locales. Temporary UI harness/profile files were removed; screenshots and geometry measurements remain under `out/` for review.

The existing Google verification recording predates this layout refinement; it has not been recorded again. Provider scopes and write protocols did not change.

## Drive organization follow-up (24 November 2026)

Writable My Drive connections now support folder creation and Markdown document moves through Explorer context menus. A folder-only destination picker stays within the same connection. Main validates both locations, serializes moves with document saves and updates only parent metadata. Open models, unsaved text, undo history and saved baselines remain intact. Generated IDs, operation markers and outcome checks prevent automatic replay after lost responses. Shared-drive writes remain disabled.

Validation passed 105 suites / 1,360 tests, formatting, lint and both builds. Local HTTP fixtures cover folder creation, conditional moves, account/grant checks, duplicate names, serialization and lost responses. An isolated hidden Electron check exercised the production renderer with synthetic Drive data in both themes, including new-folder progress, the destination picker, tab identity, dirty edits and the next save's validator. These new actions have not been exercised against a live Drive account.

## Remaining limits

- Publish a correct privacy policy, verify the website/branding and submit Google's restricted-scope review using the [submission guide](google-verification.md). No Console publishing or submission was performed by the agent.
- Complete the remaining [editing UI live smoke checklist](google-drive.md#opt-in-live-smoke-check), especially failure/recovery and lifecycle cases. The recorded positive Windows flow and narrower protocol spike do not establish the entire production-support matrix.
- Unsaved remote buffers and uncertain operations are in-memory only. No restart/crash recovery, offline sync or remote session restore is promised. Keep local copies for durable recovery.
- UTF-8 `.md`, 4 MiB; no native Google format conversion, relative attachment fetching, separate Shared with me root, remote rename/delete, folder moves, sync or account-wide search.
- Windows development builds were exercised. Targets are Windows NSIS, macOS PKG and Linux DEB; no installer build/install, macOS/Linux runtime, publishing, commit or push was performed. Locale wording has no native-speaker review. Changes remain subject to developer review.
