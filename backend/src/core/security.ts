/**
 * Lightweight secret handling for the local application database.
 *
 * Uses AES-256-GCM keyed by a SHA-256 digest of `settings.secretKey` so that
 * datasource passwords are never stored in plaintext at rest. This is meant
 * for local/dev use; production deployments should back this with a real
 * secret manager (Vault, AWS Secrets Manager, Azure Key Vault, etc.) behind
 * the same `encryptSecret` / `decryptSecret` interface.
 *
 * Note: this is a fresh (non-Fernet) scheme, not binary-compatible with the
 * original Python backend's `cryptography.fernet`-encrypted secrets - any
 * previously-stored encrypted password must be re-entered once after
 * migrating to this backend.
 */
import crypto from "node:crypto";
import { getSettings } from "./config";

const ALGORITHM = "aes-256-gcm";

function deriveKey(secretKey: string): Buffer {
  return crypto.createHash("sha256").update(secretKey, "utf8").digest();
}

export function encryptSecret(plaintext: string): string {
  if (!plaintext) return "";
  const settings = getSettings();
  const key = deriveKey(settings.secretKey);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64url");
}

export function decryptSecret(ciphertext: string): string {
  if (!ciphertext) return "";
  const settings = getSettings();
  const key = deriveKey(settings.secretKey);
  const raw = Buffer.from(ciphertext, "base64url");
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
