# Workspace agent tools

The desktop assistant registers 31 tools through `AssistantTools`: the original 11 plus 20 workspace tools. Provider SDKs receive that catalog through the existing chat/tool-result IPC loop. Web editing remains available, but the AI assistant and these native tools remain desktop-only. No dependencies were added.

## Completed tiers

| Tier | Tools                                                                                                           | Behaviour                                                                                                                                                                                                                                                                                                                  |
| ---- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `move_path`, `rename_path`, `copy_path`, `delete_path`, `path_info`                                             | Files and folders share one implementation. Moves create missing parents; renames take a bare name. Overwrite defaults off. Deletion uses the OS trash/recycle bin and non-empty folders require `recursive: true`. Metadata includes existence, type, bytes, modified time and immediate folder item count.               |
| 2    | `search_files`, `find_and_replace`, `update_links`, `check_links`, `get_outline`                                | Search includes unopened files and live buffers. Replacements and standalone link updates default to dry runs. Moves/renames default to `updateLinks: true`, repairing inbound links and rebasing links inside moved documents.                                                                                            |
| 3    | `get_open_tabs`, `save_file`, `close_tab`, `append_to_file`, `edit_lines`, `word_count`, `create_from_template` | Tab state includes active/unsaved flags. Close refuses unsaved content unless `discard: true`. Line ranges are 1-based and inclusive; `endLine = startLine - 1` inserts before a line. Templates: `readme`, `blog-post`, `meeting-notes`. Counts use whitespace-delimited words, Unicode code points and 200 words/minute. |
| 4    | `export_html`, `get_settings`, `set_setting`                                                                    | Reuses current editor/export settings, the existing HTML generator and native Save dialog. Export reports the final output path or cancellation. Setting changes validate known keys and values.                                                                                                                           |

`read_file` also accepts optional inclusive `startLine`/`endLine`; omitting both retains its full-file result. Existing file creation and editing tools retain their APIs.

`toggle_preview` is intentionally omitted: the application exposes split resizing/reset but no existing preview-visibility action. Tier 4 was conditional on existing actions.

## Confirmation and data integrity

- Path mutations, new editor writes, setting changes and export require confirmation even when the conversation enables auto-accept. A non-dry-run replacement/link update always confirms. Dry runs and read tools execute without confirmation.
- The existing inline tool card shows a concrete operation summary, file/match counts and unsaved-change warnings. Asynchronous preparation completes before Accept is available. Cancellation while preparing cannot leave a live confirmation behind.
- Moves and renames preserve open models, undo history and unsaved state, including descendants of moved folders. Copy refuses unsaved source tabs; save them first. Delete and destination overwrite refuse affected unsaved tabs. Deletion events close clean affected tabs and remove pinned references.
- Text plans read the live buffer first and warn when accepting will save existing unsaved edits. A buffer changed after preview causes `stale_plan`. Native writes compare the previewed disk content again, stage replacements beside each target, and attempt rollback if a later write fails. New files never silently overwrite concurrent creations.
- Disk writes finish before updating Monaco buffers. Buffer updates use undoable model edits; new edits made during disk I/O are retained. Clean appends use native append rather than replacing the existing file.
- Path plans are single-use, expire after ten minutes and check source/destination metadata again at execution. Native mutations are serialized. Destination backups are restored on failed commits; overwritten originals go to trash after success. Cross-device moves stage a copy and trash the source only after the destination commits.
- A move and its link updates are separate commits. If link updates fail, the result explicitly reports that the move completed, names the old/new paths and directs the agent to retry `update_links`. Multi-file rollback failures report paths that could not be restored. A failed trash operation never silently falls back to permanent deletion.

## Scope, parsing and limits

`workspacePaths.ts` supplies literal workspace resolution, segment-aware containment, portable name validation and machine-readable errors. The renderer checks even open-buffer paths; native `WorkspaceFiles` additionally uses `AppStorage.assertInWorkspace` for canonical/symlink containment. Outside paths, reserved Windows names, root mutations, identical paths and nested source/destination operations are rejected. Recursive mutations refuse symbolic-link entries instead of following them. Existing source bytes can be moved/copied, but text tools reject binary/non-UTF-8 content.

The HTML export's input is workspace-scoped. Its output, like an untitled tab's Save As destination, is chosen by the user through the existing native dialog rather than supplied by the agent.

`workspaceMarkdown.ts` is shared by link repair and checking. Markdown-it supplies block boundaries and headings; destination ranges preserve the surrounding source, titles, reference definitions, images, URL fragments and external URLs. Code blocks and inline code are excluded. Conventional Unicode heading slugs include duplicate suffixes (`heading-1`). The tools inspect local Markdown links; they do not fetch URLs or interpret embedded HTML links.

Text files are limited to 4 MiB. Search defaults to 100 matches, caps at 500 and returns snippets of at most 240 characters. Broken-link reports and open-tab lists cap at 500. Bulk edits fail before writing if more than 500 changed files or 12 MiB of preview text would be involved; native batch payloads cap at 32 MiB. Dry-run previews cap each side at 600 characters and flag truncation. Regex evaluation runs in a native worker with a one-second timeout and bounded output/memory, keeping both UI and main event loops responsive.

Failures return `{ ok: false, error, message }` through the existing tool-result channel. Codes include `not_found`, `destination_exists`, `outside_workspace`, `permission_denied`, `invalid_name`, `unsaved_changes`, `not_empty`, `stale_plan`, `partial_failure`, `regex_timeout` and `cancelled`.

## Implementation map

- `AssistantTools.ts` validates and dispatches the combined catalog; `WorkspaceToolCatalog.ts`, `WorkspaceEditorTools.ts` and `WorkspaceFeatureTools.ts` define the added tools.
- `WorkspaceToolFiles.ts` owns buffer-aware planning, previews, searches, link maintenance and native calls. React only renders confirmations.
- `WorkspaceFiles.ts` owns scoped native I/O, mutation serialization, filesystem preparation/commit, trash, rollback and explorer/tab notifications. `workspaceRegex.ts` isolates regex execution.
- `AppBridge` exposes the narrow `workspaceOperation` preload method through its sender-scoped invoke helper. Shared request/response shapes live in `interfaces/WorkspaceTools.ts`.
- `WorkspaceFiles.test.ts` exercises real temporary files and mocked trash, while `WorkspaceToolCatalog.test.ts` drives the catalog through the native service. Manager/card tests cover confirmation policy and UI summaries; existing FileManager tests cover model/dirty-state migration.
