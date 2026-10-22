import type { ConnectionOut } from '@/types/api';
import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { IconButton } from '@/components/common/IconButton';
import { Spinner } from '@/components/common/Spinner';

interface ConnectionListProps {
  connections: ConnectionOut[];
  onEdit: (connection: ConnectionOut) => void;
  onDelete: (connection: ConnectionOut) => void;
  onSetDefault: (connection: ConnectionOut) => void;
  onTest: (connection: ConnectionOut) => void;
  testingId: string | null;
  deletingId: string | null;
}

export function ConnectionList({
  connections,
  onEdit,
  onDelete,
  onSetDefault,
  onTest,
  testingId,
  deletingId,
}: ConnectionListProps) {
  return (
    <div className="settings-table-wrap">
      <table className="settings-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Host / Database</th>
            <th>Status</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {connections.map((conn) => (
            <tr key={conn.id}>
              <td>
                <div className="settings-table-primary">{conn.name}</div>
              </td>
              <td>{conn.type}</td>
              <td className="settings-table-muted">
                {conn.host ? `${conn.host}${conn.port ? `:${conn.port}` : ''}` : ''}
                {conn.database ? ` · ${conn.database}` : ''}
              </td>
              <td>
                <div className="settings-table-badges">
                  {conn.is_default && <Badge tone="accent">Default</Badge>}
                  <Badge tone={conn.enabled ? 'success' : 'neutral'}>
                    {conn.enabled ? 'Enabled' : 'Disabled'}
                  </Badge>
                </div>
              </td>
              <td>
                <div className="settings-table-actions">
                  <Button variant="ghost" size="sm" loading={testingId === conn.id} onClick={() => onTest(conn)}>
                    Test
                  </Button>
                  {!conn.is_default && (
                    <Button variant="ghost" size="sm" onClick={() => onSetDefault(conn)}>
                      Set default
                    </Button>
                  )}
                  <IconButton
                    icon="edit"
                    label={`Edit ${conn.name}`}
                    variant="ghost"
                    size="xs"
                    round={false}
                    onClick={() => onEdit(conn)}
                  />
                  <IconButton
                    icon="trash"
                    label={`Delete ${conn.name}`}
                    variant="ghost"
                    size="xs"
                    round={false}
                    tone="danger"
                    loading={deletingId === conn.id}
                    onClick={() => onDelete(conn)}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ConnectionListLoading() {
  return (
    <div className="settings-loading">
      <Spinner size={20} />
    </div>
  );
}
