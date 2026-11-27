const SCHEME = "pbkdf2";

export async function hashSecret(secret, salt, iterations = 10000) {
  const encoded = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoded.encode(secret), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: encoded.encode(salt), iterations, hash: "SHA-256" },
    key,
    256,
  );
  const bytes = new Uint8Array(bits);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `${SCHEME}$${iterations}$${salt}$${btoa(binary)}`;
}

export async function verifySecret(secret, stored) {
  if (!stored || !secret) return false;
  const [scheme, rounds, salt] = stored.split("$");
  if (scheme !== SCHEME || !rounds || !salt) return false;
  const actual = await hashSecret(secret, salt, Number(rounds));
  if (actual.length !== stored.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) {
    difference |= actual.charCodeAt(index) ^ stored.charCodeAt(index);
  }
  return difference === 0;
}

export function randomToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
