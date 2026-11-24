import * as React from 'react';
import type { CloudConnection } from '../../../../app/interfaces/Cloud';
import { useCloud } from '../../hooks/useCloud';
import { useTranslation } from '../../hooks/useTranslation';
import { confirmExternal } from '../../contexts/PromptsContext';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { GoogleDriveLogo, GoogleLogo } from './GoogleBrand';

export const CloudConnections: React.FC = () => {
  const { manager, state } = useCloud();
  const { t } = useTranslation();
  const [name, setName] = React.useState('');
  const [clientId, setClientId] = React.useState('');
  const [clientValue, setClientValue] = React.useState('');
  const [advanced, setAdvanced] = React.useState(false);
  return (
    <div className="space-y-5">
      <div className="space-y-2 text-sm text-muted-foreground">
        <p>{t('cloud:intro')}</p>
        <p>{t('cloud:editing_intro')}</p>
        <p>{t('cloud:preview_limit')}</p>
      </div>
      {!state.secureStorage && (
        <p role="status" className="text-sm text-destructive">
          {t('cloud:secure_unavailable')}
        </p>
      )}
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {t(`cloud:error_${state.error}`)}
        </p>
      )}
      <section
        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-subtle bg-card p-4"
        aria-label="Google Drive"
      >
        <h3 className="flex items-center gap-2 font-medium">
          <GoogleDriveLogo className="h-5 w-5" />
          Google Drive
        </h3>
        <Button
          type="button"
          variant="outline"
          className="border-[#747775] bg-white text-[#1f1f1f] hover:bg-[#f5f6f8] hover:text-[#1f1f1f]"
          disabled={
            !manager ||
            !state.secureStorage ||
            !state.googleDriveAvailable ||
            state.busy.includes('settings')
          }
          onClick={() =>
            void manager?.run({
              action: 'add',
              name: 'Google Drive',
              authorize: true,
            })
          }
        >
          <GoogleLogo />
          {t(state.connections.length ? 'cloud:add_account' : 'cloud:connect')}
        </Button>
        {!state.googleDriveAvailable && (
          <p className="w-full text-sm text-muted-foreground" role="status">
            {t('cloud:default_unavailable')}
          </p>
        )}
      </section>
      {state.connections.map((connection) => (
        <ConnectionCard key={connection.id} connection={connection} />
      ))}
      <Button
        type="button"
        variant="ghost"
        aria-expanded={advanced}
        aria-controls="cloud-advanced"
        onClick={() => setAdvanced((value) => !value)}
      >
        {t('cloud:advanced')}
      </Button>
      {advanced && (
        <form
          id="cloud-advanced"
          className="space-y-3 rounded-lg border border-subtle p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void manager
              ?.run({ action: 'add', name, clientId, clientValue })
              .then((ok) => {
                if (ok) {
                  setName('');
                  setClientId('');
                  setClientValue('');
                }
              });
          }}
        >
          <h3 className="font-medium">{t('cloud:custom_app')}</h3>
          <div className="space-y-1">
            <Label htmlFor="cloud-name">{t('cloud:name')}</Label>
            <Input
              id="cloud-name"
              required
              maxLength={100}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cloud-client-id">{t('cloud:client_id')}</Label>
            <Input
              id="cloud-client-id"
              required
              spellCheck={false}
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cloud-client-value">
              {t('cloud:client_value')}
            </Label>
            <Input
              id="cloud-client-value"
              spellCheck={false}
              value={clientValue}
              onChange={(event) => setClientValue(event.target.value)}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {t('cloud:registration_help')}
          </p>
          <Button
            type="submit"
            disabled={
              !manager ||
              state.busy.includes('settings') ||
              !name.trim() ||
              !clientId.trim()
            }
          >
            {t('cloud:add')}
          </Button>
        </form>
      )}
    </div>
  );
};

const ConnectionCard: React.FC<{ connection: CloudConnection }> = ({
  connection,
}) => {
  const { manager, state } = useCloud();
  const { t } = useTranslation();
  const [name, setName] = React.useState(connection.name);
  React.useEffect(() => setName(connection.name), [connection.name]);
  const busy =
    state.busy.includes(connection.id) || connection.status === 'connecting';
  const connect = connection.status === 'connected';
  return (
    <section
      className="space-y-3 rounded-lg border border-subtle bg-card p-4"
      aria-label={connection.name}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex flex-1 items-center gap-2 font-medium">
          <GoogleDriveLogo className="h-5 w-5" />
          Google Drive
        </h3>
        <span role="status" className="text-xs text-muted-foreground">
          {t(`cloud:status_${connection.status}`)}
        </span>
      </div>
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <Label htmlFor={`cloud-name-${connection.id}`}>
            {t('cloud:name')}
          </Label>
          <Input
            id={`cloud-name-${connection.id}`}
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <Button
          variant="outline"
          disabled={busy || !name.trim() || name === connection.name}
          onClick={() =>
            void manager?.run({
              action: 'rename',
              connectionId: connection.id,
              name,
            })
          }
        >
          {t('cloud:rename')}
        </Button>
      </div>
      {connection.accountName && (
        <p className="break-all text-sm text-muted-foreground">
          {connection.accountName}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {connect && !connection.writeAccess && (
          <Button
            variant="outline"
            disabled={busy || !state.secureStorage}
            onClick={() => {
              void confirmExternal({
                title: t('cloud:enable_editing'),
                description: t('cloud:editing_permission'),
                confirmLabel: t('cloud:enable_editing'),
                cancelLabel: t('cloud:cancel'),
              }).then((ok) => {
                if (ok)
                  void manager?.run({
                    action: 'connect',
                    connectionId: connection.id,
                    writeAccess: true,
                  });
              });
            }}
          >
            {t('cloud:enable_editing')}
          </Button>
        )}
        <Button
          disabled={busy || !state.secureStorage}
          variant="outline"
          className="border-[#747775] bg-white text-[#1f1f1f] hover:bg-[#f5f6f8] hover:text-[#1f1f1f]"
          onClick={() =>
            void manager?.run({
              action: 'connect',
              connectionId: connection.id,
            })
          }
        >
          <GoogleLogo />
          {t(connect ? 'cloud:reconnect' : 'cloud:connect')}
        </Button>
        <Button
          variant="outline"
          disabled={busy || !connect}
          onClick={() =>
            void manager?.run({ action: 'test', connectionId: connection.id })
          }
        >
          {t('cloud:test')}
        </Button>
        <Button
          variant="outline"
          disabled={
            !connect &&
            connection.status !== 'connecting' &&
            connection.status !== 'reauthorize'
          }
          onClick={() =>
            void manager?.run({
              action: 'disconnect',
              connectionId: connection.id,
            })
          }
        >
          {t(
            connection.status === 'connecting'
              ? 'cloud:cancel'
              : 'cloud:disconnect',
          )}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            void confirmExternal({
              title: t('cloud:remove'),
              description: t('cloud:remove_confirm'),
              confirmLabel: t('cloud:remove'),
              cancelLabel: t('cloud:cancel'),
              destructive: true,
            }).then((ok) => {
              if (ok)
                void manager?.run({
                  action: 'remove',
                  connectionId: connection.id,
                });
            });
          }}
        >
          {t('cloud:remove')}
        </Button>
      </div>
    </section>
  );
};
