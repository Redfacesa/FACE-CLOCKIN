import assert from "node:assert/strict";
import test from "node:test";
import { hashSecret, verifySecret } from "./crypto.js";
import { suggestedAction } from "./clock.js";

test("a later tap offers clock-out only after a clock-in", () => {
  assert.equal(suggestedAction(null), "CLOCK_IN");
  assert.equal(suggestedAction("CLOCK_OUT"), "CLOCK_IN");
  assert.equal(suggestedAction("CLOCK_IN"), "CLOCK_OUT");
});

test("pin hashes verify the same secret and reject another", async () => {
  const stored = await hashSecret("2401", "james-salt");
  assert.equal(await verifySecret("2401", stored), true);
  assert.equal(await verifySecret("9999", stored), false);
  assert.equal(stored.includes("2401"), false);
});
