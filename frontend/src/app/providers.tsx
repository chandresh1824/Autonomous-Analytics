import { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { MsalProvider } from '@azure/msal-react';
import { ToastProvider } from '@/components/common/Toast';
import { AuthGate } from '@/auth/AuthGate';
import { ChatSessionProvider } from '@/features/chat/ChatSessionContext';
import { msalInstance } from '@/auth/msalInstance';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

/**
 * Provider stack. `AuthGate` sits outside the router and the data layer, so
 * no route renders and no API call is made until the visitor has signed in
 * with Microsoft Entra ID.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <MsalProvider instance={msalInstance}>
      <AuthGate>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <ToastProvider>
              {/* Above the routes so chat tabs survive page navigation. */}
              <ChatSessionProvider>{children}</ChatSessionProvider>
            </ToastProvider>
          </BrowserRouter>
        </QueryClientProvider>
      </AuthGate>
    </MsalProvider>
  );
}
