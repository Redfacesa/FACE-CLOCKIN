import assert from "node:assert/strict";
import test from "node:test";
import { decryptEmbedding, encryptEmbedding, loadBiometricKey, verifyPassword, hashPassword } from "./embedding";

test("embeddings round-trip through AES-GCM and a wrong key fails", () => {
  const key = loadBiometricKey(Buffer.alloc(32, 7).toString("base64"));
  const values = Array.from({ length: 512 }, (_, index) => (index - 256) / 256);
  const blob = encryptEmbedding(values, key);
  const decoded = decryptEmbedding(blob, key);
  assert.equal(decoded.length, 512);
  assert.ok(Math.abs(decoded[0] - values[0]) < 1e-6);
  assert.ok(Math.abs(decoded[511] - values[511]) < 1e-6);
  const other = loadBiometricKey(Buffer.alloc(32, 8).toString("base64"));
  assert.throws(() => decryptEmbedding(blob, other));
});

test("password hashes verify without storing the password", () => {
  const stored = hashPassword("dev-admin-pass");
  assert.equal(verifyPassword("dev-admin-pass", stored), true);
  assert.equal(verifyPassword("nope", stored), false);
});
