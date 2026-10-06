import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { zonedDateTime } from "../attendance/time";
import { DEMO, openStore } from "./dev-store";

const TZ = "Africa/Johannesburg";
const now = zonedDateTime("2026-10-06", "09:55", TZ);

test("floor, overtime approval, and device ingest follow the attendance rules", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "face-clock-"));
  try {
    const store = openStore(dir, now);
    const admin = store.login("admin@facelock.local", "dev-admin-pass");
    assert.ok(admin);
    assert.equal(store.login("admin@facelock.local", "wrong"), null);

    const floor = store.floor(admin, DEMO.locationId, now);
    const john = floor.working.find((person) => person.employeeCode === "EMP-001");
    assert.equal(john?.lateMinutes, 24);
    assert.ok(floor.late.some((person) => person.employeeCode === "EMP-001"));
    assert.ok(floor.shouldBeWorking.some((person) => person.employeeCode === "EMP-002"));
    assert.ok(floor.late.some((person) => person.employeeCode === "EMP-002"));
    assert.ok(floor.working.some((person) => person.employeeCode === "EMP-003" && person.lateMinutes === 0));
    assert.ok(floor.onLeave.some((person) => person.employeeCode === "EMP-004"));

    const pending = store.listOvertime(admin, DEMO.locationId).find((row) => row.employeeCode === "EMP-001");
    assert.equal(pending?.workDate, "2026-10-05");
    assert.equal(pending?.potentialMinutes, 40);
    assert.equal(pending?.status, "pending");

    const before = store.getEmployee(admin, DEMO.johnId).events.map((event) => event.occurredAt);
    store.decideOvertime(admin, pending!.id, { status: "approved", approvedMinutes: 30 });
    const after = store.getEmployee(admin, DEMO.johnId).events.map((event) => event.occurredAt);
    assert.deepEqual(after, before);
    const approved = store.listOvertime(admin, DEMO.locationId).find((row) => row.id === pending!.id);
    assert.equal(approved?.status, "approved");
    assert.equal(approved?.approvedMinutes, 30);

    const secret = readFileSync(path.join(dir, "station.env"), "utf8").match(/STATION_DEVICE_SECRET=(.*)/)?.[1];
    assert.ok(secret);
    const device = store.authenticateDevice(secret);
    assert.ok(device);
    const rejected = store.ingestEvents(device, [
      {
        clientEventId: "no-liveness",
        employeeId: DEMO.johnId,
        eventType: "CLOCK_IN",
        occurredAt: now.toISOString(),
        verificationMethod: "FACIAL",
        verificationStatus: "SUCCESS",
        confidenceScore: 0.91,
        livenessPassed: false,
      },
    ], now);
    assert.equal(rejected[0]?.accepted, false);

    const clockOutAt = zonedDateTime("2026-10-06", "17:30", TZ);
    const first = store.pinEvent(
      device,
      { pin: "2468", eventType: "CLOCK_OUT", occurredAt: clockOutAt.toISOString(), clientEventId: "john-out" },
      clockOutAt,
    );
    const second = store.pinEvent(
      device,
      { pin: "2468", eventType: "CLOCK_OUT", occurredAt: clockOutAt.toISOString(), clientEventId: "john-out" },
      clockOutAt,
    );
    assert.equal(first.employeeCode, "EMP-001");
    assert.equal(second.duplicate, true);
    const today = store.listAttendance(admin, DEMO.locationId, "2026-10-06", "2026-10-06").find((row) => row.employeeCode === "EMP-001");
    assert.equal(today?.lateMinutes, 24);
    assert.equal(today?.potentialOvertimeMinutes, 30);
    assert.equal(today?.workedMinutes, 486);
    assert.equal(store.listOvertime(admin, DEMO.locationId).find((row) => row.workDate === "2026-10-06")?.status, "pending");

    const johnUser = store.login("john@facelock.local", "dev-employee-pass");
    assert.ok(johnUser);
    assert.throws(() => store.getEmployee(johnUser, DEMO.ayeshaId), /cannot view/i);

    store.deactivateEmployee(admin, DEMO.ayeshaId);
    assert.equal(store.getEmployee(admin, DEMO.ayeshaId).status, "terminated");
    assert.equal(store.getEmployee(admin, DEMO.ayeshaId).template, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
