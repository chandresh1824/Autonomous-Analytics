import { FormEvent, useState } from 'react';
import type { ConnectionCreate, ConnectionOut, ConnectionUpdate } from '@/types/api';
import { MYSQL_CONNECTION_TYPE, MYSQL_DEFAULT_PORT } from '@/types/api';
import { Button } from '@/components/common/Button';
import { Toggle } from '@/components/common/Toggle';

interface ConnectionFormProps {
  initial?: ConnectionOut | null;
  onSubmit: (payload: ConnectionCreate | ConnectionUpdate) => void;
  onTest: (payload: ConnectionCreate) => void;
  testing?: boolean;
  submitting?: boolean;
  testResult?: { success: boolean; message: string } | null;
  onCancel: () => void;
}

export function ConnectionForm({
  initial,
  onSubmit,
  onTest,
  testing,
  submitting,
  testResult,
  onCancel,
}: ConnectionFormProps) {
  const isEdit = !!initial;
  const [name, setName] = useState(initial?.name ?? '');
  const [host, setHost] = useState(initial?.host ?? '');
  const [port, setPort] = useState(initial?.port?.toString() ?? '');
  const [database, setDatabase] = useState(initial?.database ?? '');
  const [username, setUsername] = useState(initial?.username ?? '');
  const [password, setPassword] = useState('');
  const [ssl, setSsl] = useState(initial?.ssl ?? false);
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);

  const buildPayload = (): ConnectionCreate | ConnectionUpdate => {
    const base = {
      name,
      host: host || null,
      port: port ? Number(port) : null,
      database: database || null,
      username: username || null,
      ssl,
      enabled,
    };
    if (isEdit) {
      const update: ConnectionUpdate = { ...base };
      if (password) update.password = password;
      return update;
    }
    return {
      ...base,
      type: MYSQL_CONNECTION_TYPE,
      ...(password ? { password } : {}),
    } as ConnectionCreate;
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(buildPayload());
  };

  const handleTest = () => {
    onTest({
      name: name || 'Test connection',
      type: MYSQL_CONNECTION_TYPE,
      host: host || null,
      port: port ? Number(port) : null,
      database: database || null,
      username: username || null,
      password: password || null,
      ssl,
      enabled,
    });
  };

  return (
    <form className="form-grid" onSubmit={handleSubmit}>
      <div className="form-field">
        <label htmlFor="conn-name">Name</label>
        <input id="conn-name" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>

      <div className="form-row-2">
        <div className="form-field">
          <label htmlFor="conn-host">Host</label>
          <input id="conn-host" value={host} onChange={(e) => setHost(e.target.value)} placeholder="localhost" />
        </div>
        <div className="form-field">
          <label htmlFor="conn-port">Port</label>
          <input
            id="conn-port"
            type="number"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            placeholder={String(MYSQL_DEFAULT_PORT)}
          />
        </div>
      </div>

      <div className="form-field">
        <label htmlFor="conn-database">Database</label>
        <input id="conn-database" value={database} onChange={(e) => setDatabase(e.target.value)} />
      </div>

      <div className="form-row-2">
        <div className="form-field">
          <label htmlFor="conn-username">Username</label>
          <input id="conn-username" value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
        <div className="form-field">
          <label htmlFor="conn-password">Password</label>
          <input
            id="conn-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={
              isEdit ? (initial?.has_password ? '•••••••• (saved) - leave blank to keep' : 'No password saved') : ''
            }
            autoComplete="new-password"
            spellCheck={false}
          />
        </div>
      </div>

      <div className="form-row-2 form-row-toggles">
        <Toggle checked={ssl} onChange={setSsl} label="Use SSL" />
        <Toggle checked={enabled} onChange={setEnabled} label="Enabled" />
      </div>

      {testResult && (
        <div className={`test-result ${testResult.success ? 'test-result-success' : 'test-result-error'}`}>
          {testResult.message}
        </div>
      )}

      <div className="form-actions">
        <Button type="button" variant="secondary" loading={testing} onClick={handleTest}>
          Test connection
        </Button>
        <div className="form-actions-right">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            {isEdit ? 'Save changes' : 'Create connection'}
          </Button>
        </div>
      </div>
    </form>
  );
}
