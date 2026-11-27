import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_POLICY, estimateMonth, rands, summariseDay } from "./payroll.js";

test("a return from lunch is a break, and extra break time is deducted", () => {
  const events = [
    { event_type: "CLOCK_IN", occurred_at: "2026-11-02T06:00:00.000Z", work_date: "2026-11-02" },
    { event_type: "CLOCK_OUT", occurred_at: "2026-11-02T10:00:00.000Z", work_date: "2026-11-02" },
    { event_type: "CLOCK_IN", occurred_at: "2026-11-02T11:30:00.000Z", work_date: "2026-11-02" },
    { event_type: "CLOCK_OUT", occurred_at: "2026-11-02T15:00:00.000Z", work_date: "2026-11-02" },
  ];
  const summary = summariseDay(events);
  assert.equal(summary.worked, 450);
  assert.equal(summary.breaks, 90);
  const row = estimateMonth({
    employee: { id: "1", first_name: "James", last_name: "Wilson", employee_number: "EMP-001" },
    dates: ["2026-11-02"],
    events,
    leaveDates: new Set(),
    policy: DEFAULT_POLICY,
    pay: { pay_type: "hourly", amount_cents: 10000 },
    timeZone: "Africa/Johannesburg",
    today: "2026-11-02",
  });
  assert.equal(row.extraBreakMinutes, 30);
  assert.equal(row.lateMinutes, 0);
  assert.equal(row.overtimeMinutes, 0);
  assert.equal(row.breakDeduction, 5000);
  assert.equal(row.net, 70000);
  assert.equal(rands(row.net), "R700.00");
});

test("a missed working day is an absence, not overtime", () => {
  const row = estimateMonth({
    employee: { id: "1", first_name: "Sarah", last_name: "Moore", employee_number: "EMP-002" },
    dates: ["2026-11-02"],
    events: [],
    leaveDates: new Set(),
    policy: DEFAULT_POLICY,
    pay: { pay_type: "hourly", amount_cents: 10000 },
    timeZone: "Africa/Johannesburg",
    today: "2026-11-02",
  });
  assert.equal(row.absences, 1);
  assert.equal(row.workedMinutes, 0);
  assert.equal(row.absenceDeduction, 90000);
});
