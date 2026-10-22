import { useCallback, useMemo } from 'react';
import { useMsal } from '@azure/msal-react';
import { branding } from '@/config/branding';
import { isAuthConfigured } from './msalConfig';

export interface AuthUser {
  name: string;
  /** First name only, for greetings. */
  givenName: string;
  /** UPN / email, when the token carries one. */
  email: string;
  /** Up to two letters for an avatar. */
  initials: string;
}

/** The signed-in user, plus a sign-out that clears the session. */
export function useAuthUser(): AuthUser & { signOut: () => void } {
  const { instance, accounts } = useMsal();
  const account = instance.getActiveAccount() ?? accounts[0] ?? null;

  const user = useMemo<AuthUser>(() => {
    const claims = (account?.idTokenClaims ?? {}) as Record<string, unknown>;
    const name = account?.name || (claims.name as string) || branding.user.name;
    const email = account?.username || (claims.preferred_username as string) || '';
    const givenName = (claims.given_name as string) || name.split(' ')[0] || name;
    return { name, givenName, email, initials: toInitials(name) };
  }, [account]);

  const signOut = useCallback(() => {
    if (!isAuthConfigured) return;
    // Ends the Entra session too, so the next visit is prompted to sign in
    // rather than being waved straight back through.
    void instance.logoutRedirect({ account: account ?? undefined });
  }, [instance, account]);

  return { ...user, signOut };
}

function toInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
