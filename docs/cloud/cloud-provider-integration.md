# MKEditor — Remote Markdown Workspaces: Google Drive

**Ticket:** Google Drive, delivered in three stages (0 → 1a → 1b → 1c).
**Also read:** [Shared standards](cloud-provider-standards.md) (security, save safety, errors, reporting). [Roadmap](cloud-provider-roadmap.md) (other providers, not part of this ticket).

## Goal

Let users connect a Google Drive account, browse and open Markdown files, and, where the write gate can be met, save them back from MKEditor's existing editor. Remote editing should feel like local editing. The UI must make the remote origin, save status and conflicts clear.

**Non-goals:** a general-purpose storage client, a Git IDE, a sync engine, or any other provider.

## Scope rules

These resolve the usual tension between "build the slice" and "build the architecture".

- **Build what Drive needs.** Shape the provider interface from Drive's actual operations: authorise, list, get metadata, read, create, conditional update. Do not build a capability framework for providers that do not exist yet. Generalise when the second adapter is ticketed.
- **One capability model only:** each item is either editable or read-only, with a reason shown to the user. Gate controls on that.
- **Keep provider details out of editor and explorer components.** A central remote service bridges connections, browsing and the editor lifecycle.
- **Reuse the existing UI, editor commands and tests.** Local open and save must behave exactly as before.
- **Depth of edge-case handling:** the [standards](cloud-provider-standards.md) list what is required. Anything not listed gets a sensible default, a code comment, and a line in the report, not a new subsystem.

## Stage 0 — Orientation and two decisions

Work in the [MKEditor application repository](https://github.com/versyxdigital/mkeditor), not the `MKEditorDocs` checkout that contains this brief. If the application checkout is unavailable, report the blocker. Documentation or mock adapters do not count as implementation.

1. **Inspect** the document lifecycle, explorer and workspace state, settings, privileged process boundaries, test setup and CI packaging targets.
2. **Record the desktop OS scope** from the current release targets, and note which platforms you actually exercised.
3. **Run the baseline checks** (tests, lint/static checks, build). Separate pre-existing failures from regressions.
4. **Write a one-page decision record** in the repo covering the two Drive-specific questions below. Stage 1a may start before the second is answered. Stage 1b may not.

### Decision A — OAuth scope

Drive's scopes decide what the app can see. This is from my knowledge of Google's policies. **Confirm against current Google documentation before deciding.**

| Scope            | Sensitivity   | Browse existing files                                        | Write existing files |
| ---------------- | ------------- | ------------------------------------------------------------ | -------------------- |
| `drive.file`     | Non-sensitive | No. Only files the app created or the user explicitly picked | Only those files     |
| `drive.readonly` | Restricted    | Yes                                                          | No                   |
| `drive`          | Restricted    | Yes                                                          | Yes                  |

- "Browse your Drive folders" means a **restricted** scope. Restricted scopes require Google app verification, and possibly a third-party security assessment, before distribution beyond test users.
- While an external app is in **Testing** status, consent is limited to listed test users and refresh tokens can expire after about 7 days. Plan live verification around this.
- **Default proposal:** request `drive.readonly` in Stage 1a. Request a write scope in Stage 1b only if Decision B passes. Incremental authorisation will show the user a new consent prompt. The owner confirms or overrides this.
- Make the OAuth client ID configurable. Document the redirect and scope requirements.

### Decision B — Is there a write-time revision precondition?

This is the key risk. Dropbox enforces a revision on the write itself. **I am not confident that Drive's file content upload does.** Do not assume it. Run a short spike against a disposable account, using the exact endpoint the app would use for content updates:

1. Update a file with a current validator (for example `If-Match` with the file's ETag, or any other documented mechanism). It must succeed.
2. Update the same file with a stale validator after changing it elsewhere. It must be **rejected**, and the file must be unchanged.
3. Repeat enough times to rule out luck. Record the endpoint, headers, API version, date and results in the decision record.

A read-then-compare-then-write sequence **does not qualify**. See the [save-safety gate](cloud-provider-standards.md#save-safety-gate).

| Outcome                                 | Consequence                                                                                                                                                                                                                                                                                   |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pass**                                | Stage 1b enables saving existing files, for the item types the spike covered.                                                                                                                                                                                                                 |
| **Fail or inconclusive**                | Existing Drive files open **read-only**. Stage 1b becomes: show a clear "Drive cannot safely save changes to existing files" reason, local export, and (owner's choice) an explicit **Save a copy to Drive** command that only ever creates a new file. Stage 1c's create path still applies. |
| **Blocked (no account or credentials)** | Finish Stage 1a and the fixture-based work. Report Stage 1b as blocked. Do not guess.                                                                                                                                                                                                         |

## Drive specifics that affect the design

- **Identity is the file ID.** Names and paths are display data and may change. Resolve shortcuts to their target ID. Parents can be multiple or absent, so refresh display paths from metadata.
- **Names are not unique in Drive.** Two siblings can share a name. Show enough to tell them apart (for example modified time). Creation never overwrites. It makes a new ID, so "collision" means "a same-named item already exists". Check first and refuse. A race can still produce a duplicate name, which is acceptable because no data is lost.
- **Idempotent create:** pre-generate the file ID (`files.generateIds`) and create with it. A replayed create then fails instead of making a duplicate. Reconcile a lost create response by looking up that ID.
- **Which files are editable Markdown:** use the existing Markdown file rules (extension-based). Google-native types (`application/vnd.google-apps.*`: Docs, Sheets, and so on) and other non-Markdown files are never offered for editing. Conversion is a separate future workflow.
- **Coverage:** My Drive and shared drives the user can access (use the all-drives parameters). "Shared with me" is out unless it is trivial. Document whatever is covered. Ignore trashed items. Opening one that was trashed after listing is a "missing item" state.
- **Listing:** `files.list` with `pageToken` paging and an explicit `fields` mask. Request only the metadata needed.
- **Errors and retries:** Drive signals throttling and quota through 403 and 429 responses with reason codes. Map them per the [standards](cloud-provider-standards.md#error-mapping). Retry only safe reads, with bounded exponential backoff.
- **Desktop redirect:** use Google's supported loopback redirect (`127.0.0.1` on an ephemeral port) with PKCE. Google issues a client secret for Desktop clients but documents it as non-confidential. See the [standards](cloud-provider-standards.md#security-and-credentials) for how to treat it.

## Stage 1a — Connect, browse, open (read-only)

**User workflow**

1. In **Settings → Connections**, add a Google Drive connection, name it, and authorise it in the system browser. Test access and see **Connected** or **Needs reauthorisation**. Edit the display name, reconnect, disconnect and remove.
2. In the existing explorer, switch between local and remote workspaces. Browse My Drive and shared drive folders. Load further pages and refresh. Show loading, empty, error and disconnected states.
3. Open a Markdown file in the existing editor. It is read-only. Show its connection and remote location. Opening the same item again through the same connection focuses the existing tab.
4. Disconnect clears credentials and blocks authorised operations but keeps the configuration. Remove clears both. Neither closes an open tab.

**Done when** these behaviours are tested (see [Testing](#testing)):

- The authorisation flow works against the fixture, including PKCE, state validation, and rejection of expired, replayed or mismatched callbacks.
- Token refresh works. Revoked access moves the connection to "needs reauthorisation".
- A multi-page listing loads and refreshes. Empty, error and disconnected states render.
- Non-Markdown and Google-native files are not offered as editable.
- The same item opened twice gives one tab.
- Disconnect and remove clear credentials, including when a refresh is in flight.
- Secrets do not appear in logs or errors.
- Local open and save are unchanged.

## Stage 1b — Safe save (depends on Decision B)

**If Decision B passed:**

1. Normal **Save** writes to the same file ID with the expected revision, using the verified write-time condition.
2. Show **saving, saved, conflict, failed** and **unconfirmed** states.
3. On conflict, the user can **compare** the local buffer with the latest remote contents, **keep editing**, or **explicitly reload** (with confirmation if dirty). Comparing or refreshing never replaces a dirty buffer.
4. Offer **local export** as the recovery path.
5. Saves follow the [snapshot, serialisation and unconfirmed-result rules](cloud-provider-standards.md#save-safety-gate).
6. Existing unsaved-change protection covers tab close and app quit, including pending, failed and unconfirmed saves.
7. Re-authorising as a **different account** never retargets existing tabs or pending saves.

**Done when:**

- A stale save is rejected, and the newer remote content survives.
- A save after the file was moved is resolved by file ID, and a deleted file is not recreated.
- A failure before the write keeps the buffer dirty.
- A lost response after a committed write ends as unconfirmed, then reconciles by checking remote revision and contents. There is no blind replay.
- Edits made during an in-flight save remain dirty afterwards.
- A save and a disconnect that overlap leave credentials cleared and the buffer intact.
- Close and quit are blocked or confirmed with an unconfirmed save pending.

**If Decision B failed:** implement the read-only reason, local export, and the optional **Save a copy to Drive** per the decision record. Test that no code path writes to an existing file.

## Stage 1c — Create, polish, documentation

- **Create a new Markdown file** in a chosen folder with a create-only request (pre-generated ID). A same-named existing item is refused and left unchanged. A name is never silently altered.
- A create whose response is lost ends as unconfirmed and reconciles by file ID.
- **Keyboard and themes:** every connection, browser and conflict control is reachable with Tab, operable with Enter or Space, has a visible focus state and an accessible label, and is legible in both light and dark themes. Check by hand or by test, and report which.
- **Preview limitation:** relative links and images in remote documents are **not** fetched. Preserve them in the Markdown source and do not guess local paths. Document the limitation.
- **Offline limit:** unsaved changes live only in the open editor. No recovery after restart is promised.
- **Documentation:** connection setup, app registration and scopes (per Decision A), credential storage, conflict and failed-save recovery, preview and offline limits, troubleshooting. Add the Drive row to the capability matrix.

## Testing

- Use the existing test framework. Run the **real adapter** against a deterministic local fixture server that imitates Google's OAuth and Drive endpoints. Endpoint base URLs may be overridden **in tests only**, never as a selectable production option.
- Default CI runs with no live services or credentials.
- Test depth should be proportionate. Lost-response and edit-during-save cases are required. Do not exhaustively test every combination of failures.
- Add **opt-in live smoke instructions or tests** that use a disposable Google account and folder.

## Verification and reporting

Report three things separately for each capability: **implemented**, **fixture-tested**, **live-verified**. Do not mark authentication or any write capability production-supported until it has passed a live smoke test. If registration or credentials are unavailable, finish deterministic validation and report the blocked checks. Do not invent credentials or bypass authorisation.

**Deliverables**

- Application code, dependencies and automated tests for the stages completed.
- User documentation as listed in Stage 1c, plus the capability matrix (Drive row, with roadmap providers shown as "planned").
- The decision record (Decisions A and B).
- A concise implementation report: architecture and UI changes, key files and dependencies, the exact test, build and package commands run and their results, the OS targets identified versus exercised, live verification status, and known limits or blockers. Do not call a stage complete on the strength of placeholders, a passing build alone, or unrun checks.
