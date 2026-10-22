import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { broadcastResponseToMainFrame } from '@azure/msal-browser/redirect-bridge';
import { App } from '@/app/App';
import { initializeMsal } from '@/auth/msalInstance';
import '@/styles/global.css';
import '@/styles/app.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element not found');
}

/** True in the sign-in popup or the hidden silent-renewal iframe that
 * Microsoft has just sent back to this page with an auth response. */
function isAuthResponseInChildWindow(): boolean {
  const inChildWindow = window.parent !== window || Boolean(window.opener && window.opener !== window);
  const params = `${window.location.hash}&${window.location.search}`;
  return inChildWindow && /[#?&](code|error)=/.test(params) && /[#?&]state=/.test(params);
}

if (isAuthResponseInChildWindow()) {
  /* MSAL v5 receives popup and silent-iframe responses only through this
     bridge. Without it the popup never completes and silent renewal always
     times out - which is what used to force a full-page login redirect in
     the middle of a conversation. The app itself is never booted here. */
  broadcastResponseToMainFrame().catch((error) => {
    console.error('Could not hand the sign-in response back to the app', error);
  });
} else {
  const root = createRoot(container);

  /* MSAL has to be initialized - and a redirect coming back from Entra fully
     processed - before the first render, or that render would see "no account"
     and kick off a second sign-in. */
  initializeMsal()
    .catch((error) => {
      console.error('Microsoft sign-in could not be initialized', error);
    })
    .finally(() => {
      root.render(
        <StrictMode>
          <App />
        </StrictMode>,
      );
    });
}
