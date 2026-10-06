const textEncoder = new TextEncoder();

export type SessionActor = {
  id: string;
  role: "admin" | "manager" | "employee";
  fullName: string;
  email: string;
  employeeId: string | null;
  locationIds: string[];
  exp: number;
};

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET ?? "dev-only-session-secret-change-me-32b";
  if (process.env.NODE_ENV === "production" && secret.startsWith("dev-only")) {
    throw new Error("Set SESSION_SECRET before running in production.");
  }
  return secret;
}

function encode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decode(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function sign(value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(sessionSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(value));
  return encode(new Uint8Array(signature));
}

export async function signSession(actor: Omit<SessionActor, "exp">): Promise<string> {
  const payload = encode(textEncoder.encode(JSON.stringify({ ...actor, exp: Date.now() + 12 * 60 * 60 * 1000 })));
  return `${payload}.${await sign(payload)}`;
}

export async function readSession(token: string | undefined | null): Promise<SessionActor | null> {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = await sign(payload);
  if (expected.length !== signature.length) return null;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  }
  if (mismatch !== 0) return null;
  try {
    const actor = JSON.parse(new TextDecoder().decode(decode(payload))) as SessionActor;
    if (!actor.exp || actor.exp < Date.now()) return null;
    return actor;
  } catch {
    return null;
  }
}
