# Drive and restart smoke tests

Build once, then run the Playwright Electron checks:

```sh
npm run build-all
npm run test:drive-smoke
```

The automatic run uses a local OAuth/Drive HTTP server, the production renderer, cloud service and adapter, and the real OS-encrypted connection store. It creates an isolated directory under `out/drive-smoke/`. It does not use Google or your normal `~/.mkeditor/` data. No separate Playwright browser download is needed: the runner uses the project's Electron binary. Add `-- --headed` to show its test window.

The run checks:

- Connecting through Settings and enabling editing.
- Creating, opening, editing and saving Markdown, followed by an independent provider read.
- Saving a separate copy and refusing duplicate names without overwriting.
- Creating a folder and moving the open document through its context menu.
- A stale save preserving the external revision and the local draft.
- A lost save response followed by reconciliation, without replaying the write.
- Closing Electron, relaunching with the same encrypted store, and refreshing an expired access token.
- Revoked access requiring sign-in again.
- Disconnecting, clearing account details and remaining disconnected after another restart.

OS credential encryption must be available. The shell removes Playwright's mock-keychain switches rather than accepting plaintext credential storage. A Linux runner needs a real supported desktop keyring; a headless CI container without one will fail this check.

## Run against Google

Build with MKEditor's Desktop OAuth registration, then run:

```sh
npm run test:drive-live
```

Complete Google sign-in and consent in your regular browser when prompted. Editing consent is requested separately. Playwright drives MKEditor; it does not automate Google login, passwords or MFA. The command includes the explicit `--authorize-disposable-test` opt-in. Running `node scripts/drive-smoke/run.cjs --live` without that flag refuses to start.

The run creates a new folder named `000 MKEditor smoke <run ID>` in My Drive. Every document write and move is restricted to files and folders created by this run. It also makes a separate real provider update to its disposable document to test a genuine save conflict. Existing Drive documents and your normal MKEditor connection store are not changed. Test folders are retained; the report identifies the folder so you can remove it in Drive afterward.

Restart testing closes and relaunches Electron with the same isolated disk store, expires only that store's cached access token and verifies that refresh works without another sign-in. The successful run disconnects its test connection at the end.

Lost provider responses and revoked grants are tested only against the local fixture. Google-side revocation and switching real Google accounts remain manual checks. This run does not test installed packages, remote tab/session recovery, or crash recovery. Its shell uses production cloud components but does not launch the normal desktop lifecycle or read the normal app's settings/session files.

## Results

Each run writes `report.json` and app screenshots under its own `out/drive-smoke/<run ID>/` directory. The report labels the run as `local-fixture` or `live-google`, records completed steps and identifies the failing phase if needed. A successful local run is not evidence that Google accepted the live requests.

Google tokens stay in the main process and the OS-encrypted test store. Reports do not include tokens or registration values. Browser consent pages are not captured, and Playwright tracing/video is disabled. Do not publish or upload the test profile or `connections.json`; keep reports and screenshots separate if sharing results.

The relevant entry points are [run.cjs](../../scripts/drive-smoke/run.cjs), [electron.cjs](../../scripts/drive-smoke/electron.cjs) and [fixture.cjs](../../scripts/drive-smoke/fixture.cjs). Normal builds keep the default `CloudStore` location; only the isolated shell supplies an explicit store path.
