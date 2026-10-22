import { NextFunction, Request, Response } from "express";
import { createRemoteJWKSet, JWTPayload, jwtVerify } from "jose";
import { getSettings } from "./config";
import { getLogger } from "./logging";

const logger = getLogger("core.auth");

/**
 * Identifies the signed-in user from the Microsoft Entra ID token the
 * frontend sends as `Authorization: Bearer <id token>`. The token's
 * signature is checked against the tenant's published signing keys, and its
 * issuer, audience (this app's client id) and expiry are enforced - so a
 * caller can't claim to be someone else. The user is the token's `oid`
 * (object id), which is stable for a person within the tenant.
 */

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksTenant = "";

function getJwks(tenantId: string) {
  if (!jwks || jwksTenant !== tenantId) {
    jwks = createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`));
    jwksTenant = tenantId;
  }
  return jwks;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

/** Verifies an Entra ID token and returns the user's object id. */
export async function verifyIdToken(
  token: string,
  options: { tenantId: string; clientId: string; keys?: Parameters<typeof jwtVerify>[1] }
): Promise<string> {
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, options.keys ?? getJwks(options.tenantId), {
      issuer: `https://login.microsoftonline.com/${options.tenantId}/v2.0`,
      audience: options.clientId,
    }));
  } catch (err) {
    throw new AuthError(`Invalid sign-in token: ${(err as Error).message}`);
  }
  const oid = typeof payload.oid === "string" ? payload.oid : "";
  if (!oid) throw new AuthError("Sign-in token has no user id (oid).");
  return oid;
}

/** Rejects the request with 401 unless it carries a valid sign-in token;
 * the user id is then available via `currentUserId(res)`. */
export async function requireUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { entraTenantId, entraClientId } = getSettings();
  if (!entraTenantId || !entraClientId) {
    res.status(401).json({
      detail: "Sign-in is not configured on the server: set AZURE_ENTRA_TENANT_ID and AZURE_ENTRA_CLIENT_ID.",
    });
    return;
  }
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (!token) {
    res.status(401).json({ detail: "Sign in required." });
    return;
  }
  try {
    res.locals.userId = await verifyIdToken(token, { tenantId: entraTenantId, clientId: entraClientId });
    next();
  } catch (err) {
    logger.warning("auth_rejected", { path: req.originalUrl, error: String((err as Error).message) });
    res.status(401).json({ detail: "Your sign-in has expired or is invalid. Please sign in again." });
  }
}

/** The signed-in user's id - only valid on routes behind `requireUser`. */
export function currentUserId(res: Response): string {
  const userId = res.locals.userId;
  if (typeof userId !== "string" || !userId) throw new AuthError("No signed-in user on this request.");
  return userId;
}
