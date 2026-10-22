import type { Configuration, RedirectRequest, SilentRequest } from '@azure/msal-browser';
import { LogLevel } from '@azure/msal-browser';

/**
 * Microsoft Entra ID (Azure AD) sign-in configuration.
 *
 * Every value comes from the environment so the same build can target a
 * different tenant or host - see `.env.example`. A public SPA holds no
 * secret: the client id and tenant id are not credentials, the flow is
 * authorization code with PKCE (the MSAL default for browsers).
 */

const tenantId = import.meta.env.VITE_AZURE_ENTRA_TENANT_ID?.trim();
const clientId = import.meta.env.VITE_AZURE_ENTRA_CLIENT_ID?.trim();

const authority =
  import.meta.env.VITE_AZURE_ENTRA_AUTHORITY?.trim() ||
  (tenantId ? `https://login.microsoftonline.com/${tenantId}` : '');

const redirectUri =
  import.meta.env.VITE_AZURE_ENTRA_REDIRECT_URI?.trim() ||
  (typeof window !== 'undefined' ? window.location.origin : '');

/**
 * Scope of the backend API, exposed by its own app registration, e.g.
 * `api://<api-client-id>/access_as_user`. Optional: leave it unset until the
 * backend validates bearer tokens, and the UI signs in without requesting an
 * API token.
 */
const apiScope = import.meta.env.VITE_AZURE_ENTRA_API_SCOPE?.trim();

/** False when the tenant/client values are missing, so the app can say so
 * plainly instead of failing deep inside MSAL. */
export const isAuthConfigured = Boolean(clientId && authority);

export const missingAuthSettings = [
  !clientId && 'VITE_AZURE_ENTRA_CLIENT_ID',
  !authority && 'VITE_AZURE_ENTRA_AUTHORITY (or VITE_AZURE_ENTRA_TENANT_ID)',
].filter(Boolean) as string[];

export const msalConfig: Configuration = {
  auth: {
    clientId: clientId ?? '',
    authority,
    redirectUri,
    // Land back on the app root after signing out.
    postLogoutRedirectUri: redirectUri,
  },
  cache: {
    /* Per-tab storage: tokens do not outlive the tab, and a new tab
       re-authenticates silently against the existing Entra session. Switch to
       'localStorage' if you want sign-in shared across tabs and restarts. */
    cacheLocation: 'sessionStorage',
  },
  system: {
    loggerOptions: {
      logLevel: import.meta.env.DEV ? LogLevel.Warning : LogLevel.Error,
      loggerCallback: (level, message, containsPii) => {
        if (containsPii) return;
        if (level === LogLevel.Error) console.error('[msal]', message);
        else if (level === LogLevel.Warning && import.meta.env.DEV) console.warn('[msal]', message);
      },
    },
  },
};

/** Interactive sign-in request. */
export const loginRequest: RedirectRequest = {
  scopes: apiScope ? [apiScope] : ['openid', 'profile', 'email'],
};

/** Silent request used to attach a bearer token to API calls, when an API
 * scope is configured. */
export const apiTokenRequest: Pick<SilentRequest, 'scopes'> | null = apiScope
  ? { scopes: [apiScope] }
  : null;
