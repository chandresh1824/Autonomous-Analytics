import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { SemanticModelPanel } from '@/components/settings/semantic-model/SemanticModelPanel';
import { LogsPanel } from '@/components/settings/LogsPanel';
import { Icon } from '@/components/common/Icon';
import { PageHeader } from '@/components/layout/PageHeader';
import { GenerateSemanticModelPage } from './GenerateSemanticModelPage';

export function SettingsPage() {
  const { pathname } = useLocation();
  // Page titles sit in the top bar so each page body starts straight with its
  // content.
  const isGenerate = pathname.startsWith('/settings/semantic-model/generate');
  const title = isGenerate
    ? 'Add Semantic Model'
    : pathname.startsWith('/settings/semantic-model')
      ? 'Semantic Model'
      : undefined;

  return (
    <div className="settings-page">
      <PageHeader
        title={title}
        actions={
          <>
            {isGenerate && (
              <Link to="/settings/semantic-model" className="btn btn-secondary btn-md">
                <Icon name="arrow-left" size={16} />
                <span>Back to Semantic Model</span>
              </Link>
            )}
          </>
        }
      />

      <div className="settings-layout settings-layout-full">
        <div className="settings-content">
          <Routes>
            {/* The semantic model is the settings home; connections are managed
                from a dialog on it, so the old page link opens that dialog. */}
            <Route index element={<Navigate to="semantic-model" replace />} />
            <Route
              path="connections"
              element={<Navigate to="/settings/semantic-model" replace state={{ openConnections: true }} />}
            />
            <Route path="semantic-model" element={<SemanticModelPanel />} />
            <Route path="semantic-model/generate" element={<GenerateSemanticModelPage />} />
            {/* KPIs now live in a tab of the semantic model page. */}
            <Route
              path="kpis"
              element={<Navigate to="/settings/semantic-model" replace state={{ tab: 'kpis' }} />}
            />
            <Route path="logs" element={<LogsPanel />} />
            <Route path="*" element={<Navigate to="semantic-model" replace />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}
