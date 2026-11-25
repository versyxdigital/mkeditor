# Cloud storage in the web editor

Google Drive and Dropbox use the same Connections settings, cloud Explorer, remote tabs and conflict controls as desktop. Connect read-only, then choose **Enable editing** to grant write access. Provider limitations still apply: shared Google drives are read-only, and Dropbox moves remain disabled because the API cannot enforce source identity at mutation time.

The storage dropdown beside the toolbar menu is always visible, starting with **Local files**. It offers branded Google Drive and Dropbox sign-in actions and **Manage connections** before any account is added. After connecting, select the account there to browse its files; the dropdown displays its provider icon and connection name.

## Register the website

Browser registration is separate from the desktop app registration. Users authorize MKEditor's registered app; they do not create their own OAuth clients.

For Google, create an OAuth **Web application** client in Google Cloud, enable the Drive API, and register the website's exact **Authorized JavaScript origin**, including a development port if used. For example, `https://example.com` is the origin even when MKEditor lives at `/mkeditor/web/`. Google's Identity Services token client handles its own popup; it does not use MKEditor's desktop loopback callback. Configure the same read-only and editing scopes described in [Google Drive setup](google-drive.md). Google app verification remains required for general access to restricted scopes.

For Dropbox, use a scoped **Full Dropbox** app and the scopes in [Dropbox setup](dropbox.md). The browser flow uses PKCE with the public app key. Register the exact browser callback URL, including the installation path:

```text
https://example.com/mkeditor/web/cloud-callback.html
```

The callback must be served as the shipped static page, without redirecting it to the editor or a generic SPA route. No Dropbox app secret is used. Keep the desktop callback registered separately if the same app serves both clients.

Set the public registration values before building the renderer:

```powershell
$env:MKEDITOR_WEB_GOOGLE_CLIENT_ID = 'YOUR_WEB_CLIENT_ID.apps.googleusercontent.com'
$env:MKEDITOR_WEB_DROPBOX_APP_KEY = 'YOUR_PUBLIC_APP_KEY'
npm run build-web
```

Deploy the contents of `out/web/`, including `cloud-callback.html` and its script, into the website's `/mkeditor/web/` directory. The dedicated web build keeps Electron output and desktop registration files out of the website and does not alter `dist/app/`. The host must redirect `/mkeditor/web` to `/mkeditor/web/`, so relative assets and callbacks resolve beneath the editor directory.

MKEditor's production website is maintained in `versyxdigital/versyxdigital.github.io`. In the sibling `rowles-portfolio` checkout, the editor lives under `public/mkeditor/web/`; the portfolio build copies it unchanged into the site output. The product homepage, screenshots and legal pages remain outside this generated editor directory. The existing `npm run build-editor` target still writes the renderer to `dist/` for the established copy flow; include the callback files and exclude `dist/app/` when copying it. Both build targets use the same public web registration variables.

The two environment variables are public identifiers baked into the bundle. Never provide a client secret or access token. The build does not read the desktop registration files for web sign-in. An absent registration disables that provider's Connect button in contributor builds. Set `MKEDITOR_REQUIRE_WEB_CLOUD=true` to reject incomplete registration, as release builds do.

## CI and release artifacts

Pull-request CI builds the same web target with public fixture identifiers and runs the browser checks under `/mkeditor/web/`. It needs no real account credentials. Browser reports and screenshots are uploaded as the `web-cloud-verification` artifact.

The release workflow builds `mkeditor-web-<version>.zip` alongside the desktop installers and attaches it to the existing draft release. It does not publish the website. Configure these repository Actions **variables**, under **Settings → Secrets and variables → Actions → Variables**:

- `MKEDITOR_WEB_GOOGLE_CLIENT_ID`: the Google **Web application** client ID.
- `MKEDITOR_WEB_DROPBOX_APP_KEY`: the public Dropbox app key.

Existing repository secrets with those web names also work. If the web Dropbox variable is absent, the workflow can reuse `MKEDITOR_DROPBOX_APP_KEY` from the desktop release because both clients use the same public Dropbox app registration. The Google desktop client ID cannot substitute for the web client ID. Missing required web registration stops the release build instead of producing a website with disabled connections.

Serve over HTTPS; loopback HTTP is allowed for development. Allow popups for sign-in. If the host supplies CSP or cross-origin opener headers, check them against the OAuth providers' browser requirements: Google loads `https://accounts.google.com/gsi/client`, and the app calls Google/Dropbox APIs directly using browser CORS. Callback communication requires an opener relationship. Do not put an authenticated API proxy or a confidential OAuth secret in a static website.

## Credentials and recovery

Access tokens live only in memory. Google uses its supported browser token flow; Dropbox uses an online authorization-code flow with S256 PKCE. Reloading or expiring a token requires an explicit sign-in. Disconnect cancels pending sign-in and clears the connection's credentials without closing documents. Reconnecting a different account cannot retarget an existing tab or pending operation.

Returning browser sessions label remembered accounts **Reconnect needed** in the storage menu and Connections settings. A restored document offers a **Reconnect** button, and selecting a disconnected cloud workspace offers the same action in Explorer. These actions reuse the existing connection and its editing permissions. Reconnecting checks the document against its cloud version before saving; it never automatically uploads restored edits. Normal reconnection uses the provider icon rather than an error indicator, while save conflicts and unknown outcomes keep their existing warnings.

Drafts and pending operations are stored in this browser under the website's origin. This is browser document storage, not the desktop's OS-encrypted credential store. Clearing site data removes those drafts. Tokens, authorization codes, PKCE verifiers and client secrets are never written to these records.

One tab at a time owns cloud access for a website, using the browser's Web Locks API. Close the first tab and reload the second to use cloud storage there. Browsers without Web Locks keep local editing available but disable cloud access. Browser previews sanitize all document HTML before insertion, including local and untitled documents, to protect the page's credentials and drafts.

Writes use the existing conditional provider protocol and record their intent before sending a mutation. Storage failure stops the write. Conflicts preserve both the remote contents and the local draft. An unknown outcome stays pending for inspection; reloading never retries an upload automatically. Restored drafts stay available while disconnected and require the matching account and a remote check before saving again.

## Verification

Run `npm run test:web-cloud-smoke` for browser tests using intercepted OAuth and API responses with disposable local browser profiles. The runner builds an isolated production bundle under `out` with public fixture registration values, preserving `dist`. To verify an existing web artifact without rebuilding it, run `npm run test:web-cloud-smoke -- --skip-build --build-dir out/web --base-path /mkeditor/web/`. It exercises the actual web UI without real accounts. Live Google and Dropbox authorization, consent, CORS response headers and deployed callback URLs must also be verified against the registered production origin before release. Desktop tests remain separate.

The 25 November 2026 Chromium fixture run passed 20 scenarios across both providers: authorization and editing upgrades, conditional Unicode saves, edits during pending saves, lost-response reconciliation without replay, stale-write protection, account and second-tab isolation, token non-persistence, immediate reload recovery, and background/pagehide checkpoints. It also checked executable HTML removal in local web previews. Reports and screenshots are written under `out/web-cloud-smoke/`. This establishes fixture coverage, not live OAuth or CORS verification.

The final configured web artifact subsequently passed all 41 browser scenarios at `/mkeditor/web/`, adding file and folder context menus, creation and copies, no-overwrite checks, comparison, reload cancellation, supported Drive moves, browser storage failures and clearing sessions before unload. The portfolio's generated site output also passed editor startup, configured connection controls, callback MIME/query-scrubbing and folder-route checks with no browser errors or failed asset requests. The website's local source received the same 500-file artifact, with its previous generated editor folder backed up outside the website. Product-page source was preserved.

On 25 November 2026, both providers also passed all 10 checks in the live browser harness at `http://127.0.0.1:8765`: read-only authorization, editing authorization, creation of a new test folder and Markdown file, initial readback, conditional saving, saved-content readback, rejection of a stale validator, preservation of the newer remote content, and completion. The harness used real provider authorization and API requests through the production cloud service, with separate test recovery storage and no provider interception. The report is retained locally at `out/web-cloud-live/report.json`; test folders remain in the accounts for inspection. This verifies browser API access from loopback. Consent, callback routing and hosting headers at the deployed website remain deployment checks.

Provider references: [Google token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model), [Google browser setup](https://developers.google.com/identity/oauth2/web/guides/get-google-api-clientid), and [Dropbox OAuth guide](https://docs.dropboxapi.com/dropbox-api/docs/oauth).
