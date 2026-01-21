import nacl from "tweetnacl";

/**
 * WireGuard keys are Curve25519:
 * - privateKey: 32 random bytes (base64)
 * - publicKey:  scalarMultBase(privateKey) (base64)
 *
 * This implementation avoids relying on `wg` binary inside container.
 */
export function generateWgKeypair(): { privateKey: string; publicKey: string } {
  const priv = nacl.randomBytes(32);
  const pub = nacl.scalarMult.base(priv);

  const privateKey = Buffer.from(priv).toString("base64");
  const publicKey = Buffer.from(pub).toString("base64");

  return { privateKey, publicKey };
}

/**
 * Normalize input: trim + remove surrounding whitespace/newlines.
 * Do NOT mutate base64 content.
 */
export function normalizePublicKey(v: string): string {
  return String(v ?? "").trim();
}

/**
 * WireGuard public key = base64(32 bytes) => 44 chars, ends with "="
 * Accept + and /.
 */
export const WG_PUBLIC_KEY_RE = /^[A-Za-z0-9+/]{43}=$/;
