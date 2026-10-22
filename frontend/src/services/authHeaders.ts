import { apiTokenRequest, loginRequest } from '@/auth/msalConfig';
import { getActiveAccount, msalInstance } from '@/auth/msalInstance';
import { markReauthRequired } from '@/auth/sessionState';

/** Renew the ID token this long before it expires, so a request never
 * reaches the backend with a token that lapses on the way. */
const ID_TOKEN_RENEW_MARGIN_SECONDS = 5 * 60;

let inFlight: Promise<Record<string, string>> | null = null;

/**
 * Authorization header for a backend call, or `{}` when nobody is signed in.
 *
 * With an API scope configured (`VITE_AZURE_ENTRA_API_SCOPE`) this is an
 * access token for that API. Otherwise it is the signed-in user's Microsoft
 * ID token, which the backend verifies. MSAL renews either silently.
 *
 * Never navigates away: if renewal needs the user (expired session, MFA,
 * consent), the session is flagged and `AuthGate` offers a sign-in popup over
 * the current page, so nothing on screen is lost.
 *
 * Concurrent callers share one renewal instead of each forcing their own.
 * Shared by the axios client and the raw-`fetch` SSE stream so both send the
 * same credentials.
 */
export function getApiAuthHeaders(): Promise<Record<string, string>> {
  if (!inFlight) {
    inFlight = acquireHeaders().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

async function acquireHeaders(): Promise<Record<string, string>> {
  const account = getActiveAccount();
  if (!account) return {};
  const request = apiTokenRequest ?? { scopes: loginRequest.scopes };

  try {
    let result = await msalInstance.acquireTokenSilent({ ...request, account });
    if (!apiTokenRequest) {
      const exp = Number(result.idTokenClaims && (result.idTokenClaims as { exp?: number }).exp);
      if (!exp || exp - Date.now() / 1000 < ID_TOKEN_RENEW_MARGIN_SECONDS) {
        result = await msalInstance.acquireTokenSilent({ ...request, account, forceRefresh: true });
      }
    }
    const token = apiTokenRequest ? result.accessToken : result.idToken;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch (error) {
    // Interaction required, or silent renewal failed outright - either way
    // only the user can fix it now.
    console.warn('Silent sign-in renewal failed; asking the user to sign in again.', error);
    markReauthRequired();
    return {};
  }
}
