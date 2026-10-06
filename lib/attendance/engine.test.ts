import assert from "node:assert/strict";
import test from "node:test";
import { eventsForWorkDate } from "./bucket";
import { calculateAttendanceDay, presenceState } from "./engine";
import { resolveShift } from "./schedule";
import { localDate, minutesBetween, zonedDateTime } from "./time";
import type { DayInput, EngineEvent } from "./types";

const TZ = "Africa/Johannesburg";

function at(isoDate: string, time: string): Date {
  return zonedDateTime(isoDate, time, TZ);
}

function event(partial: Partial<EngineEvent> & Pick<EngineEvent, "eventType" | "occurredAt">): EngineEvent {
  return {
    id: partial.id ?? partial.eventType + partial.occurredAt.toISOString(),
    employeeId: partial.employeeId ?? "emp",
    verificationStatus: partial.verificationStatus ?? "SUCCESS",
    adjustment: partial.adjustment,
    eventType: partial.eventType,
    occurredAt: partial.occurredAt,
  };
}

function day(overrides: Partial<DayInput> & Pick<DayInput, "now" | "events">): DayInput {
  const workDate = overrides.workDate ?? "2026-10-06";
  return {
    employeeId: "emp",
    workDate,
    scheduledStart: overrides.scheduledStart === undefined ? at(workDate, "09:00") : overrides.scheduledStart,
    scheduledEnd: overrides.scheduledEnd === undefined ? at(workDate, "17:00") : overrides.scheduledEnd,
    isDayOff: overrides.isDayOff ?? false,
    onLeave: overrides.onLeave ?? false,
    events: overrides.events,
    now: overrides.now,
    graceMinutes: overrides.graceMinutes ?? 5,
    absenceCutoffMinutes: overrides.absenceCutoffMinutes ?? 60,
  };
}

test("Johannesburg wall time converts to UTC", () => {
  assert.equal(at("2026-10-06", "09:24").toISOString(), "2026-10-06T07:24:00.000Z");
  assert.equal(localDate(at("2026-10-06", "09:24"), TZ), "2026-10-06");
});

test("John's shift: 24 minutes late and 30 minutes potential overtime", () => {
  const result = calculateAttendanceDay(
    day({
      now: at("2026-10-06", "18:00"),
      events: [
        event({ eventType: "CLOCK_IN", occurredAt: at("2026-10-06", "09:23"), verificationStatus: "FAILED" }),
        event({ eventType: "CLOCK_IN", occurredAt: at("2026-10-06", "09:24") }),
        event({ eventType: "CLOCK_OUT", occurredAt: at("2026-10-06", "17:30") }),
      ],
    }),
  );
  assert.equal(result.lateMinutes, 24);
  assert.equal(result.scheduledMinutes, 480);
  assert.equal(result.workedMinutes, 486);
  assert.equal(result.potentialOvertimeMinutes, 30);
  assert.equal(result.earlyDepartureMinutes, 0);
  assert.equal(result.status, "late");
  assert.equal(result.actualStart?.toISOString(), at("2026-10-06", "09:24").toISOString());
});

test("arrival inside the grace period is on time", () => {
  const result = calculateAttendanceDay(
    day({
      now: at("2026-10-06", "12:00"),
      events: [event({ eventType: "CLOCK_IN", occurredAt: at("2026-10-06", "09:05") })],
    }),
  );
  assert.equal(result.lateMinutes, 0);
  assert.equal(result.status, "present");
});

test("six minutes past start is the full late amount", () => {
  const result = calculateAttendanceDay(
    day({
      now: at("2026-10-06", "12:00"),
      events: [event({ eventType: "CLOCK_IN", occurredAt: at("2026-10-06", "09:06") })],
    }),
  );
  assert.equal(result.lateMinutes, 6);
  assert.equal(result.status, "late");
  assert.equal(result.potentialOvertimeMinutes, 0);
});

test("someone who has not arrived moves from expected to late to absent", () => {
  const expected = calculateAttendanceDay(day({ now: at("2026-10-06", "09:04"), events: [] }));
  const late = calculateAttendanceDay(day({ now: at("2026-10-06", "09:30"), events: [] }));
  const absent = calculateAttendanceDay(day({ now: at("2026-10-06", "10:00"), events: [] }));
  assert.equal(expected.status, "expected");
  assert.equal(late.status, "late");
  assert.equal(late.lateMinutes, 30);
  assert.equal(absent.status, "absent");
  assert.equal(absent.lateMinutes, 0);
});

test("leave and days off are not absences", () => {
  assert.equal(calculateAttendanceDay(day({ now: at("2026-10-06", "12:00"), events: [], onLeave: true })).status, "leave");
  assert.equal(
    calculateAttendanceDay(day({ now: at("2026-10-06", "12:00"), events: [], isDayOff: true, scheduledStart: null, scheduledEnd: null })).status,
    "day_off",
  );
});

test("leaving before the scheduled end is early departure and not overtime", () => {
  const result = calculateAttendanceDay(
    day({
      now: at("2026-10-06", "18:00"),
      events: [
        event({ eventType: "CLOCK_IN", occurredAt: at("2026-10-06", "09:00") }),
        event({ eventType: "CLOCK_OUT", occurredAt: at("2026-10-06", "16:40") }),
      ],
    }),
  );
  assert.equal(result.earlyDepartureMinutes, 20);
  assert.equal(result.potentialOvertimeMinutes, 0);
  assert.equal(result.workedMinutes, 460);
  assert.equal(result.status, "early_departure");
});

test("an unpaid break reduces hours worked and does not create overtime", () => {
  const result = calculateAttendanceDay(
    day({
      now: at("2026-10-06", "18:00"),
      events: [
        event({ eventType: "CLOCK_IN", occurredAt: at("2026-10-06", "09:00") }),
        event({ eventType: "BREAK_START", occurredAt: at("2026-10-06", "12:00") }),
        event({ eventType: "BREAK_END", occurredAt: at("2026-10-06", "12:30") }),
        event({ eventType: "CLOCK_OUT", occurredAt: at("2026-10-06", "17:00") }),
      ],
    }),
  );
  assert.equal(result.breakMinutes, 30);
  assert.equal(result.workedMinutes, 450);
  assert.equal(result.potentialOvertimeMinutes, 0);
  assert.equal(result.status, "present");
});

test("staying past the end is potential overtime even after a break", () => {
  const result = calculateAttendanceDay(
    day({
      now: at("2026-10-06", "18:00"),
      events: [
        event({ eventType: "CLOCK_IN", occurredAt: at("2026-10-06", "09:00") }),
        event({ eventType: "BREAK_START", occurredAt: at("2026-10-06", "12:00") }),
        event({ eventType: "BREAK_END", occurredAt: at("2026-10-06", "12:30") }),
        event({ eventType: "CLOCK_OUT", occurredAt: at("2026-10-06", "17:30") }),
      ],
    }),
  );
  assert.equal(result.workedMinutes, 480);
  assert.equal(result.potentialOvertimeMinutes, 30);
});

test("a missing clock-out stays open and does not invent overtime", () => {
  const result = calculateAttendanceDay(
    day({
      now: at("2026-10-06", "18:00"),
      events: [event({ eventType: "CLOCK_IN", occurredAt: at("2026-10-06", "09:24") })],
    }),
  );
  assert.equal(result.status, "open");
  assert.equal(result.potentialOvertimeMinutes, 0);
  assert.equal(result.workedMinutes, 0);
  assert.match(result.exceptionNotes ?? "", /Missing clock-out/);
});

test("a manual adjustment replaces clock times and keeps the original events", () => {
  const result = calculateAttendanceDay(
    day({
      now: at("2026-10-06", "18:00"),
      events: [
        event({ eventType: "CLOCK_IN", occurredAt: at("2026-10-06", "09:24") }),
        event({
          eventType: "MANUAL_ADJUSTMENT",
          occurredAt: at("2026-10-06", "18:10"),
          adjustment: {
            clockIn: at("2026-10-06", "09:00").toISOString(),
            clockOut: at("2026-10-06", "17:00").toISOString(),
            reason: "Station was offline",
          },
        }),
      ],
    }),
  );
  assert.equal(result.lateMinutes, 0);
  assert.equal(result.potentialOvertimeMinutes, 0);
  assert.equal(result.workedMinutes, 480);
  assert.equal(result.status, "present");
});

test("an overnight shift counts time after the scheduled end", () => {
  const result = calculateAttendanceDay(
    day({
      workDate: "2026-10-06",
      scheduledStart: at("2026-10-06", "18:00"),
      scheduledEnd: at("2026-10-07", "02:00"),
      now: at("2026-10-07", "03:00"),
      events: [
        event({ eventType: "CLOCK_IN", occurredAt: at("2026-10-06", "18:00") }),
        event({ eventType: "CLOCK_OUT", occurredAt: at("2026-10-07", "02:30") }),
      ],
    }),
  );
  assert.equal(result.scheduledMinutes, 480);
  assert.equal(result.potentialOvertimeMinutes, 30);
  assert.equal(minutesBetween(result.actualStart!, result.actualEnd!), 510);
});

test("clock-out just after midnight stays on the shift date", () => {
  const events = [
    event({ eventType: "CLOCK_IN", occurredAt: at("2026-10-06", "18:00") }),
    event({ eventType: "CLOCK_OUT", occurredAt: at("2026-10-07", "02:30") }),
  ];
  const bucket = eventsForWorkDate(events, "2026-10-06", TZ);
  assert.equal(bucket.length, 2);
  assert.equal(eventsForWorkDate(events, "2026-10-07", TZ).length, 0);
});

test("presence follows clock and break events", () => {
  const events = [
    event({ eventType: "CLOCK_IN", occurredAt: at("2026-10-06", "09:00") }),
    event({ eventType: "BREAK_START", occurredAt: at("2026-10-06", "12:00") }),
  ];
  assert.equal(presenceState(events), "break");
  assert.equal(
    presenceState([...events, event({ eventType: "BREAK_END", occurredAt: at("2026-10-06", "12:30") })]),
    "in",
  );
});

test("weekly schedule resolves and an exception can replace it", () => {
  const weekly = [
    { dayOfWeek: 2, startTime: "09:00", endTime: "17:00", effectiveFrom: "2026-01-01", effectiveTo: null },
  ];
  const normal = resolveShift("2026-10-06", TZ, weekly, null);
  assert.equal(normal.scheduledStart?.toISOString(), at("2026-10-06", "09:00").toISOString());
  const off = resolveShift("2026-10-06", TZ, weekly, {
    workDate: "2026-10-06",
    isDayOff: true,
    startTime: null,
    endTime: null,
  });
  assert.equal(off.isDayOff, true);
});
