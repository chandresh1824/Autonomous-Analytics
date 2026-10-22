import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { AuthError, verifyIdToken } from "../src/core/auth";

const TENANT = "11111111-1111-1111-1111-111111111111";
const CLIENT = "22222222-2222-2222-2222-222222222222";
const ISSUER = `https://login.microsoftonline.com/${TENANT}/v2.0`;

let privateKey: CryptoKey;
let keys: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey as CryptoKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: "test-key", alg: "RS256" };
  keys = createLocalJWKSet({ keys: [jwk] });
});

function token(claims: Record<string, unknown>, opts: { issuer?: string; audience?: string; expiresIn?: string } = {}) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(opts.issuer ?? ISSUER)
    .setAudience(opts.audience ?? CLIENT)
    .setIssuedAt()
    .setExpirationTime(opts.expiresIn ?? "1h")
    .sign(privateKey);
}

const verify = (jwt: string) => verifyIdToken(jwt, { tenantId: TENANT, clientId: CLIENT, keys });

describe("verifyIdToken", () => {
  it("returns the user's object id for a valid token", async () => {
    expect(await verify(await token({ oid: "user-a" }))).toBe("user-a");
  });

  it("rejects a token for another app", async () => {
    await expect(verify(await token({ oid: "user-a" }, { audience: "other-app" }))).rejects.toThrow(AuthError);
  });

  it("rejects a token from another tenant", async () => {
    const otherIssuer = "https://login.microsoftonline.com/33333333-3333-3333-3333-333333333333/v2.0";
    await expect(verify(await token({ oid: "user-a" }, { issuer: otherIssuer }))).rejects.toThrow(AuthError);
  });

  it("rejects an expired token", async () => {
    await expect(verify(await token({ oid: "user-a" }, { expiresIn: "-1m" }))).rejects.toThrow(AuthError);
  });

  it("rejects a token without a user id", async () => {
    await expect(verify(await token({}))).rejects.toThrow(AuthError);
  });

  it("rejects a token signed with a different key", async () => {
    const other = await generateKeyPair("RS256");
    const forged = await new SignJWT({ oid: "user-a" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(ISSUER)
      .setAudience(CLIENT)
      .setExpirationTime("1h")
      .sign(other.privateKey);
    await expect(verify(forged)).rejects.toThrow(AuthError);
  });
});
