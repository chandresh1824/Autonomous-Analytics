import { ReactNode, useEffect, useRef, useState } from 'react';
import { BrowserAuthError, InteractionStatus } from '@azure/msal-browser';
import { useMsal } from '@azure/msal-react';
import { Spinner } from '@/components/common/Spinner';
import { BrandLogo } from '@/components/layout/BrandLogo';
import { apiTokenRequest, isAuthConfigured, loginRequest, missingAuthSettings } from './msalConfig';
import { clearReauthRequired, useReauthRequired } from './sessionState';

/**
 * Nothing in the app renders until the visitor is signed in.
 *
 * Signed out on arrival: the browser goes straight to Microsoft (a full
 * redirect is harmless here - nothing is on screen yet) and MSAL restores the
 * requested route afterwards.
 *
 * Once the app is showing it is NEVER unmounted or redirected away for
 * sign-in again. If the session lapses mid-use (token renewal needs the user,
 * or the backend answers 401), a banner offers a sign-in popup over the page,
 * so a running conversation and anything typed stay put.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  if (!isAuthConfigured) return <AuthNotConfigured />;
  return <RequireSignIn>{children}</RequireSignIn>;
}

function RequireSignIn({ children }: { children: ReactNode }) {
  const { instance, inProgress, accounts } = useMsal();
  const hasAccount = accounts.length > 0;
  const [appShown, setAppShown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loginStarted = useRef(false);

  // First sign-in only: no account and the app has never been shown.
  useEffect(() => {
    if (appShown || hasAccount || inProgress !== InteractionStatus.None || loginStarted.current) return;
    loginStarted.current = true;
    instance.loginRedirect(loginRequest).catch((e: unknown) => {
      loginStarted.current = false;
      setError((e as { errorMessage?: string }).errorMessage || 'Microsoft could not complete the sign-in.');
    });
  }, [appShown, hasAccount, inProgress, instance]);

  useEffect(() => {
    if (hasAccount && inProgress === InteractionStatus.None) setAppShown(true);
  }, [hasAccount, inProgress]);

  if (appShown) {
    return (
      <>
        <SessionBanner signedOut={!hasAccount} />
        {children}
      </>
    );
  }

  if (error) {
    return (
      <AuthScreen
        title="Sign-in failed"
        message={error}
        action={
          <button
            type="button"
            className="btn btn-primary btn-md"
            onClick={() => {
              setError(null);
              loginStarted.current = false;
            }}
          >
            Try again
          </button>
        }
      />
    );
  }

  return <AuthScreen title="Signing you in…" message="Redirecting to Microsoft." busy />;
}

/** Shown over the running app when the sign-in needs renewing. Signs in again
 * in a popup (opened from the button click, so popup blockers allow it). */
function SessionBanner({ signedOut }: { signedOut: boolean }) {
  const { instance } = useMsal();
  const reauthRequired = useReauthRequired();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (!reauthRequired && !signedOut) return null;

  const signIn = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const account = instance.getActiveAccount() ?? instance.getAllAccounts()[0];
      const result = account
        ? await instance.acquireTokenPopup({ ...(apiTokenRequest ?? loginRequest), account })
        : await instance.loginPopup(loginRequest);
      if (result.account) instance.setActiveAccount(result.account);
      clearReauthRequired();
    } catch (e) {
      const code = e instanceof BrowserAuthError ? e.errorCode : '';
      setProblem(
        code === 'popup_window_error' || code === 'empty_window_error'
          ? 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.'
          : code === 'user_cancelled'
            ? 'Sign-in was cancelled.'
            : 'Sign-in did not complete. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="session-banner" role="alert">
      <span className="session-banner-text">
        <strong>Your sign-in has expired.</strong> Sign in again to keep going - this page and any
        running question stay as they are.
        {problem && <span className="session-banner-problem"> {problem}</span>}
      </span>
      <button type="button" className="btn btn-primary btn-sm" onClick={signIn} disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in again'}
      </button>
    </div>
  );
}

function AuthNotConfigured() {
  return (
    <AuthScreen
      title="Sign-in is not configured"
      message={`Set ${missingAuthSettings.join(' and ')} in the frontend environment, then reload. The app stays locked until sign-in is configured.`}
    />
  );
}

interface AuthScreenProps {
  title: string;
  message: string;
  busy?: boolean;
  action?: ReactNode;
}

function AuthScreen({ title, message, busy, action }: AuthScreenProps) {
  return (
    <div className="auth-screen">
      <div className="auth-screen-card">
        <BrandLogo height={40} to={null} />
        <div className="auth-screen-text">
          <h1 className="auth-screen-title">{title}</h1>
          <p className="auth-screen-message">{message}</p>
        </div>
        {busy && <Spinner size={22} />}
        {action}
      </div>
    </div>
  );
}
