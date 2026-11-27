const COOKIE = "rf_session";

const MANAGER = new Set(["overview", "employees", "stations", "credentials", "face", "attendance", "shifts", "leave", "reports"]);

export function can(role, action) {
  if (role === "owner") return true;
  if (role === "admin") return action !== "billing";
  return MANAGER.has(action);
}

export async function signSession(secret, session) {
  const body = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(session)));
  const signature = await hmac(secret, body);
  return `${body}.${signature}`;
}

export async function readSession(request, secret) {
  if (!secret) return null;
  const header = request.headers.get("cookie") ?? "";
  const pair = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`));
  if (!pair) return null;
  const token = decodeURIComponent(pair.slice(COOKIE.length + 1));
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = await hmac(secret, body);
  if (expected.length !== signature.length) return null;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  }
  if (difference !== 0) return null;
  try {
    const session = JSON.parse(new TextDecoder().decode(base64UrlToBytes(body)));
    if (!session?.uid || !session.companyId || !session.exp || session.exp < Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

export function sessionCookie(token) {
  return `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=43200`;
}

export function clearCookie() {
  return `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlToBytes(value) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
