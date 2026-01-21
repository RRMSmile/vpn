export const WG_PUBLIC_KEY_RE = /^[A-Za-z0-9+/]{43}=$/;

export function normalizePublicKey(v: string): string {
  return v.trim();
}
