# Remote Providers — Roadmap

**Status:** Dropbox is implemented, fixture-tested and live-verified on Windows; other adapters remain planned. See [Dropbox setup and scope](dropbox.md). Nothing listed here is part of the original [Google Drive ticket](cloud-provider-integration.md). Everything is subject to the [shared standards](cloud-provider-standards.md), including the safety requirements for enabling saves.

## Web cloud support — deferred

Deferred to a later release with no target version. Bug fixes, small quality-of-life improvements and optimization take priority. The future work will bring the existing Google Drive and Dropbox integrations to the web editor.

- Reuse the cloud Explorer, remote tabs, conflict handling and provider contracts.
- Add browser authorization and registered web origins/callbacks, replacing the desktop loopback flow.
- Separate browser transport and storage from Electron IPC and OS credential storage. Define token expiry, reauthorization and browser draft recovery.
- Verify browser API access and conditional saves, with tests for concurrent edits, account changes and recovery, before enabling writes.

## Principles for all adapters

- First implement a working **connect → browse → open** flow. Enable writes only when the save safety requirements are met.
- When an operation cannot be performed safely, offer useful features in **read-only mode**. State the exact limitation and either hide the control or disable it with an explanation.
- Document supported editions and operating systems, authentication flows, access scopes, and actual capabilities.
- Use OAuth with PKCE for desktop apps when the provider supports it, or a supported alternative with limited-scope tokens. Any flow that requires a confidential client secret needs a separate security design.
- **When the second adapter ticket is opened**, extract a common adapter interface from the Drive implementation and build a shared conformance test suite covering supported capabilities and common error states. Keep provider-specific test fixtures for authentication, pagination, revision behavior, and content preservation.

## Providers

| Suggested order | Adapter                                       | Primary acceptance criterion                                                                | Notes                                                                                                                                                   |
| --------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2               | **Dropbox — implemented**                     | Revision-conditional updates and creation without overwriting                               | Shared provider contract extracted. Core editing, conflict recovery and restart/refresh passed a live Windows run; fault cases use HTTP fixtures.       |
| 3               | **Microsoft OneDrive**                        | Verify that the chosen upload endpoint checks the expected ETag                             | Microsoft identity and Microsoft Graph. Personal accounts and supported work or school accounts. Pagination and rate limits. Stable drive and item IDs. |
| 4               | **GitHub**                                    | Verify create and update preconditions, protected branches, and stale revisions             | GitHub.com only. Repository and branch selection.                                                                                                       |
| 4               | **GitLab**                                    | Verify the chosen revision precondition                                                     | GitLab.com only. Support for self-managed installations will be decided separately.                                                                     |
| 4               | **Bitbucket**                                 | Verify that the server enforces concurrency control                                         | Bitbucket Cloud only. Never offer an unconditional commit as a save option.                                                                             |
| 5               | **Confluence**                                | A subset of pages that can be edited without content loss, with version-conditional updates | Confluence Cloud. Open all other pages in read-only mode. Never silently discard macros, embeds, attachments, or structured formatting.                 |
| 5               | **Jira**                                      | Preserve content when opening and saving again, and enforce a precondition at write time    | Jira Cloud. Issue descriptions only. Use ADF where needed. Read-only if either condition is not met. No deletion, transitions, or administration.       |
| 6               | **SFTP over SSH**                             | Verified conditional replacement or create-only support                                     | See below.                                                                                                                                              |
| Later           | **Remote file management** (for any provider) | Explicit destructive actions. Tests with stale or missing targets                           | Create folders, rename, move, and delete where permitted. Preserve the identity of open tabs when files are moved from within the app.                  |

Keep **Confluence** and **Jira** separate in the capability matrix and acceptance checklist.

## Git providers (GitHub, GitLab, Bitbucket)

- Show the target branch. Require a commit message. Ask for the author's identity only when required.
- Document whether saving is blocked by a branch change that does not affect the edited file, or only when that file changes.
- Verify that saving against a stale revision neither overwrites newer content nor creates an unintended commit.
- Do not include merge workflows, pull requests, or terminal operations.

## SFTP over SSH

- Allow users to configure the server, port, username, starting directory, timeout, and keepalive where supported.
- Support password authentication, passphrase-protected keys, and SSH agent authentication on documented platforms.
- Display the server host key fingerprint and require the user to explicitly trust it on first connection. Block changed host keys until they are reverified and trust is updated.
- Run tests on an isolated server.
- Upload the content to a temporary file in the destination directory and close it before publishing it. Preserve permissions where possible and remove the temporary file on failure.
- Allow file creation only when publishing cannot overwrite an existing file. Keep existing files in **read-only mode** unless the server provides a verified conditional replacement mechanism. An atomic rename alone is not enough to prevent conflicts.
- Enable directory and file management only if the server supports the corresponding operations.

## Drive notes that still apply

- **Native Google files** (Docs and Sheets) are never edited as Markdown. Conversion is a separate import and export workflow.
