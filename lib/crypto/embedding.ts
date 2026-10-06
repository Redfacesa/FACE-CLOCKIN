import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";

const IV_BYTES = 12;
const TAG_BYTES = 16;
export const EMBEDDING_DIMENSIONS = 512;

export function hashDeviceSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function deviceSecretsMatch(secret: string, secretHash: string): boolean {
  const actual = Buffer.from(hashDeviceSecret(secret), "hex");
  const expected = Buffer.from(secretHash, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function newDeviceSecret(): string {
  return randomBytes(24).toString("base64url");
}

export function hashPassword(value: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(value, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(value: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const actual = scryptSync(value, salt, 32);
  const expected = Buffer.from(hash, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function loadBiometricKey(raw: string): Buffer {
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("BIOMETRIC_KEY must be 32 bytes, base64-encoded.");
  }
  return key;
}

export function newBiometricKey(): string {
  return randomBytes(32).toString("base64");
}

export function embeddingFromNumbers(values: number[]): Float32Array {
  if (values.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Face embedding must be ${EMBEDDING_DIMENSIONS} dimensions.`);
  }
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error("Face embedding contains a non-finite value.");
  }
  return Float32Array.from(values);
}

/** AES-256-GCM blob: 12-byte IV, 16-byte tag, then ciphertext. */
export function encryptEmbedding(values: number[], key: Buffer): Buffer {
  const embedding = embeddingFromNumbers(values);
  const plain = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]);
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  const scale = Math.sqrt(leftNorm) * Math.sqrt(rightNorm);
  return scale === 0 ? 0 : dot / scale;
}

export function decryptEmbedding(blob: Buffer, key: Buffer): number[] {
  if (blob.length < IV_BYTES + TAG_BYTES + 4) throw new Error("Encrypted template is truncated.");
  const iv = blob.subarray(0, IV_BYTES);
  const tag = blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = blob.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const floats = new Float32Array(plain.buffer, plain.byteOffset, plain.byteLength / 4);
  return Array.from(floats);
}
