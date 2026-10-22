import { AppProviders } from './providers';
import { AppRoutes } from './routes';
import { AppShell } from '@/components/layout/AppShell';

export function App() {
  return (
    <AppProviders>
      <AppShell>
        <AppRoutes />
      </AppShell>
    </AppProviders>
  );
}
