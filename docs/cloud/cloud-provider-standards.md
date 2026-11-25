# Remote Providers — Shared Standards

These requirements apply to every provider adapter. The [Google Drive ticket](cloud-provider-integration.md) is the first to apply them. Each future adapter must meet them before it can write.

## Security and credentials

- **Authorisation:** use the provider's supported OAuth authorisation-code flow with PKCE in the **system browser**, with a provider-supported desktop redirect. Validate `state` and callback parameters. Reject expired, replayed and mismatched callbacks. A loopback listener must bind to `127.0.0.1` only, accept one callback, and time out.
- **No confidential secrets in the app.** Some providers issue a client secret for public or desktop clients (Google does for Desktop clients) and document it as non-confidential. Treat that value as public configuration. It must never be a trust boundary, and it must never be logged. Do not bundle any secret that actually grants privilege.
- **Configurable registration:** the client ID (and any non-confidential client value) is configurable. Document the redirect URI and scope requirements. Request the minimum practical scopes.
- **Privileged boundary:** keep credentials and authenticated requests in the application's existing privileged process. The renderer never sees tokens.
- **Storage:** use OS-backed credential storage. Check which backend is actually in use and treat plaintext-equivalent backends as unavailable. If secure storage is unavailable, either use session-only credentials with an explicit notice or disable sign-in. **Never fall back to plaintext.** Persist only non-sensitive configuration and credential references.
- **Lifecycle:** support token refresh and reauthorisation after revocation. Disconnect clears credentials and blocks authorised operations while keeping configuration. Remove clears both. Neither closes or discards an open buffer. Pending authentication or refresh work must not restore credentials that have been cleared.
- **Account identity:** record the verified account behind a connection. Reauthorising as a different account must not retarget existing tabs or pending saves.
- **Redaction:** keep secrets out of logs, errors, telemetry and test fixtures.

## Document identity

- Key a remote document by **connection, verified account and provider item ID**. Never key it by name or path.
- Track three things separately: the **revision matching the opened contents**, the **dirty buffer**, and the **last confirmed save**.
- Refresh display paths from item metadata when needed. A moved or deleted item must **never** cause Save to write to a different file at the old path.

## Save safety gate

This is the release gate for every adapter.

1. **Require a write-time condition.** Updates to existing documents must use a provider-enforced revision precondition, or an equivalent atomic check on the actual write. These do **not** qualify:
   - A read followed by an unconditional write.
   - A check-then-write sequence.
   - An atomic rename on its own.

   If the guarantee cannot be demonstrated for an item or endpoint, open it **read-only**. Do not expose controls that bypass this gate.

2. **Creation must not overwrite.** Use a no-overwrite operation, or an operation that cannot collide (such as a new unique ID). Never silently choose a different name.
3. **Save a snapshot, not a mutable buffer.** Each request records the document identity, the expected revision and the exact contents submitted. On confirmation, advance the saved snapshot and revision. Edits made during the request stay dirty. Serialise writes per document. Never clear dirty state on failure, or merely because a request was sent.
4. **An ambiguous result is unconfirmed.** If a write may have reached the server before a timeout or disconnect, keep the buffer and say the outcome is unknown. This includes a create whose response was lost. Reconcile by checking the authoritative remote identity, revision and contents. If it still cannot be confirmed, stay unconfirmed and offer recovery. **Never blindly replay a write or force an overwrite.**
5. **Protect the buffer.** A stale revision, revoked access, remote deletion or network failure must not discard edits.
   - Comparing versions is non-destructive.
   - Reloading a dirty tab needs explicit confirmation.
   - The existing unsaved-change protection applies to tab close and app quit, including when a save is pending, failed or unconfirmed.
   - Never report a save as successful unless it is confirmed.

## Error mapping

Map provider errors to actionable states, each with a clear user-facing message:

| State                         | Meaning                                           |
| ----------------------------- | ------------------------------------------------- |
| Authentication required       | Token missing, expired beyond refresh, or revoked |
| Permission denied             | Valid account, insufficient access                |
| Missing item                  | Deleted, trashed or no longer visible             |
| Timeout or connection failure | Network-level problem                             |
| Throttled                     | Rate limited. Honour retry hints                  |
| Quota exceeded                | Storage or API quota                              |
| Conflict                      | Stale revision                                    |
| Invalid configuration         | Bad client ID, redirect or scope                  |
| Unsupported operation         | Item or provider cannot do this                   |

**Retries:** retry only safe reads, or writes with verified replay protection. Bound the number of retries and respect provider retry hints.

## Verification vocabulary

Report each capability as one of:

- **Implemented:** the code exists.
- **Fixture-tested:** passes deterministic tests against the real adapter and a local fixture.
- **Live-verified:** passed an opt-in smoke test against a real disposable account.

Do not call an authentication flow or write capability production-supported until it is live-verified. If external registration or credentials are unavailable, report that check as **blocked**.

## Capability matrix (documentation)

Keep one row per provider in the user documentation. Distinguish **shipped**, **read-only**, **not yet verified** and **planned**. Record the supported editions, operating systems, auth flow, scopes and any known limitations. Keep Confluence and Jira on separate rows.
