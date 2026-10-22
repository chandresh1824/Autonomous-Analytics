import {
  EventType,
  PublicClientApplication,
  type AuthenticationResult,
  type EventMessage,
} from '@azure/msal-browser';
import { isAuthConfigured, msalConfig } from './msalConfig';

/**
 * The single MSAL instance for the app.
 *
 * MSAL v3+ must be initialized before use, and the redirect coming back from
 * Entra has to be processed before React renders - otherwise the first render
 * sees "no account" and starts a second sign-in, looping.
 */
export const msalInstance = new PublicClientApplication(msalConfig);

let initialized = false;

export async function initializeMsal(): Promise<void> {
  if (!isAuthConfigured || initialized) return;
  initialized = true;

  await msalInstance.initialize();

  /* Completes an interactive sign-in that redirected back to the app.
     `navigateToLoginRequestUrl` returns the user to the route they originally
     asked for; in MSAL v5 it is an option here rather than in the config. */
  const redirectResult = await msalInstance.handleRedirectPromise({
    navigateToLoginRequestUrl: true,
  });
  if (redirectResult?.account) {
    msalInstance.setActiveAccount(redirectResult.account);
  } else if (!msalInstance.getActiveAccount()) {
    const [existing] = msalInstance.getAllAccounts();
    if (existing) msalInstance.setActiveAccount(existing);
  }

  // Keep the active account current for logins that happen later.
  msalInstance.addEventCallback((event: EventMessage) => {
    if (
      (event.eventType === EventType.LOGIN_SUCCESS ||
        event.eventType === EventType.ACQUIRE_TOKEN_SUCCESS) &&
      event.payload
    ) {
      const { account } = event.payload as AuthenticationResult;
      if (account) msalInstance.setActiveAccount(account);
    }
  });
}

/** The signed-in account, or null when signed out. */
export function getActiveAccount() {
  if (!isAuthConfigured) return null;
  return msalInstance.getActiveAccount() ?? msalInstance.getAllAccounts()[0] ?? null;
}
