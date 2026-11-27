import assert from "node:assert/strict";
import test from "node:test";
import { hashSecret, verifySecret } from "./crypto.js";
import { matchFace, suggestedAction } from "./clock.js";

test("a later tap offers clock-out only after a clock-in", () => {
  assert.equal(suggestedAction(null), "CLOCK_IN");
  assert.equal(suggestedAction("CLOCK_OUT"), "CLOCK_IN");
  assert.equal(suggestedAction("CLOCK_IN"), "CLOCK_OUT");
});

test("a face matches its own template and rejects a different one", () => {
  const james = Array.from({ length: 128 }, (_, index) => (index % 2 === 0 ? 0.1 : -0.1));
  const other = james.map((value) => value * -1);
  assert.equal(matchFace(james, [{ employeeId: "james", descriptor: james }]), "james");
  assert.equal(matchFace(other, [{ employeeId: "james", descriptor: james }]), null);
  assert.equal(matchFace(james, [
    { employeeId: "james", descriptor: james },
    { employeeId: "james", descriptor: james.map((value, index) => value + (index === 0 ? 0.002 : 0)) },
  ]), "james");
  assert.equal(matchFace(james, [
    { employeeId: "james", descriptor: james },
    { employeeId: "sarah", descriptor: james.map((value, index) => value + (index === 0 ? 0.002 : 0)) },
  ]), null);
  const closeImpostor = james.map((value, index) => value + (index === 0 ? 0.46 : 0));
  assert.equal(matchFace(closeImpostor, [{ employeeId: "james", descriptor: james }]), null);
});

test("pin hashes verify the same secret and reject another", async () => {
  const stored = await hashSecret("2401", "james-salt");
  assert.equal(await verifySecret("2401", stored), true);
  assert.equal(await verifySecret("9999", stored), false);
  assert.equal(stored.includes("2401"), false);
});
