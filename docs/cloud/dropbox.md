# Dropbox in MKEditor

Dropbox is a desktop storage provider alongside Google Drive. Connect in **Settings → Connections → Connect with Dropbox**, then select the connection in the top toolbar. Connections start read-only. **Enable editing** requests the additional access needed to save and create Markdown documents.

## Documents and recovery

- Browse folders, open Markdown, save changes, create a file or save a copy of the active tab into Dropbox. The tab and document menu display the Dropbox icon. Confirmed saves show **Saved to Dropbox**.
- Files use their stable Dropbox IDs. Updates send the expected `rev` with `strict_conflict: true` and `autorename: false`. A stale revision preserves the external version and local draft. Save never recreates a deleted file.
- Creation uses a folder-ID-relative path, no-overwrite mode and an app-owned operation property. This property lets MKEditor identify the result after a lost response. Unknown outcomes are checked without replaying uploads.
- Tab order, active document, drafts and view state use the same OS-encrypted recovery store as Drive. Restoring checks the matching account before another save and never uploads a draft automatically.
- Local copies and remote Save As use the normal local editor/save flow. Saving a copy to Dropbox does not mark the source tab saved.
- Create folders from the Explorer context menu or its actions menu. Document moves are disabled because Dropbox cannot atomically enforce the checked source identity, location and revision.

Supported content is UTF-8 Markdown up to 4 MiB. Personal accounts and the member's home area of a Dropbox team account use the user API; mounted shared folders follow the account's permissions. Team administration, separate team-space browsing, Dropbox Paper conversion, moving folders, rename, delete and synchronization remain outside this adapter's current scope.

Folder creation uses [`create_folder_v2`](https://docs.dropboxapi.com/dropbox-api/api-reference/user-endpoints/files/create-folder-v-2) with automatic renaming disabled, then adds an app-owned marker to the acknowledged folder ID. A lost creation reply before the marker was written remains unconfirmed; MKEditor does not adopt an unmarked same-name folder or automatically repeat creation. Confirmed markers allow read-only reconciliation after restart.

Dropbox's [`move_v2`](https://docs.dropboxapi.com/dropbox-api/api-reference/user-endpoints/files/move-v-2) has no source revision or location precondition. A path-based move could move a replacement file; an ID-based move could follow an unchecked relocation. MKEditor therefore declines move preparation and execution without sending a mutation. Older pending move records remain available for read-only reconciliation after restart; they are never replayed.

## Maintainer app registration

Create one **Scoped access → Full Dropbox** app in the [Dropbox App Console](https://www.dropbox.com/developers/apps). Enable public clients/PKCE and register this exact redirect URI:

```text
http://127.0.0.1:53683/oauth/callback
```

Dropbox requires an exact registered redirect, including the scheme, host, port and path. Keep that port available while signing in. The listener binds only to `127.0.0.1`, validates state, accepts one callback and expires. PKCE uses the public app key; MKEditor does not accept or bundle the Dropbox app secret.

Enable these app scopes:

| Scope                  | Use                                              |
| ---------------------- | ------------------------------------------------ |
| `account_info.read`    | Verify the connected account.                    |
| `files.metadata.read`  | Browse folders and read file metadata.           |
| `files.content.read`   | Download chosen Markdown documents.              |
| `files.content.write`  | Save and create documents after Enable editing.  |
| `files.metadata.write` | Maintain the app-owned creation marker template. |

The initial authorization requests the three read scopes. Editing requests all five. Use Full Dropbox for browsing existing documents and app-owned file properties. Users authorize MKEditor's app; they do not create apps themselves. Complete Dropbox's production review before general distribution.

## Build registration

The tracked `src/app/config/dropbox.json` is an empty template. Set `MKEDITOR_DROPBOX_APP_KEY` when building, or put a public registration in the ignored `src/app/config/dropbox.local.json`:

```json
{ "clientId": "YOUR_PUBLIC_APP_KEY", "clientValue": "" }
```

The environment value takes precedence. `build-app` writes the registration only into `dist/app/config/dropbox.json`. Add a repository Actions secret named `MKEDITOR_DROPBOX_APP_KEY` for release builds; the workflow requires it. Contributor builds without registration disable the default sign-in button and retain the custom-app option. Account credentials remain encrypted in the main process.

## Validation

After `npm run build-all`, run `npm run test:dropbox-smoke`. It uses the production renderer, adapter, connection store and recovery components with a local HTTP fixture and an isolated profile. It covers connection/upgrade, create/save/readback, the save toast, folder creation, disabled move controls with draft preservation, conflict preservation, lost acknowledgements, encrypted draft restart, forced termination/offline recovery and token refresh/disconnect. Adapter and service tests also cover folder ownership markers, interrupted folder requests, declined moves, concurrent source replacements and recovery of older pending moves.

`npm run test:dropbox-live` requires interactive Dropbox consent. It creates a uniquely named `000 MKEditor …` folder and changes only documents it creates there. The folder is retained for inspection. Live mode does not inject connection failures or capture browser consent pages. Reports and screenshots are written under `out/drive-smoke/dropbox-*/`; do not publish the credential/profile files.

The shared contract suite is `tests/CloudProvider.conformance.test.ts`; provider-specific protocol cases are in `tests/Dropbox.test.ts` and build configuration cases in `tests/DropboxBuild.test.ts`.

On 24 November 2026, the live Windows run passed browser authorization and the editing upgrade, creation/save with independent readback, genuine revision-conflict preservation, encrypted dirty-tab restart, token refresh and disconnect. The final local fixture run additionally passed lost-acknowledgement and forced-crash/offline recovery cases. The live run identified and corrected the different metadata shapes returned by upload/download and file-property endpoints. Installer and macOS/Linux runtime checks remain separate.

Protocol references: [OAuth/PKCE](https://docs.dropboxapi.com/dropbox-api/docs/oauth), [uploads and revision conditions](https://docs.dropboxapi.com/dropbox-api/api-reference/user-endpoints/files/upload), [ID-relative paths](https://docs.dropboxapi.com/dropbox-api/docs/technical-reference/request-response-formats), and [app-owned file properties](https://github.com/dropbox/dropbox-api-spec/blob/main/file_properties.stone).
