import type { SessionPayload } from '../../interfaces/Session';
import { remoteDocumentPath } from '../../interfaces/Cloud';
import type { RecoveryData } from './CloudRecoveryBase';

/** Reconstruct unacknowledged writes as drafts; never replay a provider mutation. */
export function mergeCloudSession(
  local: SessionPayload | null,
  recovery: Omit<RecoveryData, 'session'> & { session?: SessionPayload },
): SessionPayload | null {
  const session = recovery.session ?? local;
  const tabs = (session?.tabs ?? []).map((tab) => ({
    ...tab,
    ...(tab.remote ? { remote: { ...tab.remote } } : {}),
  }));
  for (const operation of recovery.operations) {
    if (recovery.suppressedOperations.includes(operation.operationId)) continue;
    if (
      (operation.kind !== 'create' && operation.kind !== 'save') ||
      operation.content === undefined
    )
      continue;
    const document = operation.document ?? {
      ...(operation.provider ? { provider: operation.provider } : {}),
      ...(operation.kind === 'create' ? { pendingCreate: true } : {}),
      connectionId: operation.connectionId,
      accountId: operation.accountId,
      connectionName: operation.connectionId,
      content: operation.content,
      item: {
        id: operation.itemId,
        name: operation.name ?? `${operation.itemId}.md`,
        kind: 'markdown' as const,
        parents: operation.folderId ? [operation.folderId] : [],
        validator: operation.validator,
        editable: true,
      },
    };
    const path = remoteDocumentPath(document);
    const existing = tabs.find((tab) => tab.path === path);
    if (existing?.remote) {
      if (
        operation.epoch &&
        operation.epoch === existing.remote.epoch &&
        operation.sequence !== undefined &&
        (existing.remote.sequence ?? -1) <= operation.sequence
      ) {
        existing.remote = {
          ...existing.remote,
          dirty: true,
          document: {
            ...existing.remote.document,
            content: operation.content,
          },
        };
      }
      existing.remote = {
        ...existing.remote,
        document: {
          ...existing.remote.document,
          ...(operation.notApplied
            ? { operationId: operation.operationId }
            : {}),
        },
        pendingSave: operation.notApplied
          ? undefined
          : {
              operationId: operation.operationId,
              content: operation.content,
              validator: operation.validator ?? '',
            },
      };
    } else
      tabs.push({
        path,
        name: document.item.name,
        viewState: null,
        remote: {
          dirty: true,
          document: {
            ...document,
            content: operation.content,
            ...(operation.notApplied
              ? { operationId: operation.operationId }
              : {}),
          },
          baseline:
            operation.kind === 'create' || operation.notApplied
              ? ''
              : document.content,
          pendingSave: operation.notApplied
            ? undefined
            : {
                operationId: operation.operationId,
                content: operation.content,
                validator: operation.validator ?? '',
              },
        },
      });
  }
  const restored: SessionPayload | null =
    session || tabs.length
      ? {
          version: 3,
          tabs,
          activeFile: session?.activeFile ?? tabs[0]?.path ?? null,
          workspaceRoot: session?.workspaceRoot ?? null,
          assistant: session?.assistant,
        }
      : null;
  return restored;
}
