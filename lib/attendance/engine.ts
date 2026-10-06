import { minutesBetween } from "./time";
import type { DayInput, DayResult, DayStatus, EngineEvent, Presence } from "./types";

function accepted(events: EngineEvent[]): EngineEvent[] {
  return events
    .filter((event) => event.verificationStatus !== "FAILED")
    .slice()
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id));
}

function latestAdjustment(events: EngineEvent[]) {
  const adjustments = accepted(events).filter((event) => event.eventType === "MANUAL_ADJUSTMENT");
  for (let index = adjustments.length - 1; index >= 0; index -= 1) {
    const adjustment = adjustments[index]?.adjustment;
    if (adjustment?.clockIn || adjustment?.clockOut) return adjustment;
  }
  return null;
}

function breakSummary(events: EngineEvent[], start: Date, end: Date | null, now: Date) {
  const limit = end ?? now;
  let open: Date | null = null;
  let minutes = 0;
  let unclosed = false;
  for (const event of accepted(events)) {
    if (event.occurredAt < start || event.occurredAt > limit) continue;
    if (event.eventType === "BREAK_START") {
      open = event.occurredAt;
    } else if (event.eventType === "BREAK_END" && open) {
      minutes += Math.max(0, minutesBetween(open, event.occurredAt));
      open = null;
    }
  }
  if (open) unclosed = true;
  return { minutes, unclosed };
}

function emptyDay(input: DayInput, status: DayStatus, notes: string | null = null): DayResult {
  const scheduledMinutes =
    input.scheduledStart && input.scheduledEnd
      ? Math.max(0, minutesBetween(input.scheduledStart, input.scheduledEnd))
      : 0;
  return {
    employeeId: input.employeeId,
    workDate: input.workDate,
    status,
    scheduledStart: input.scheduledStart,
    scheduledEnd: input.scheduledEnd,
    actualStart: null,
    actualEnd: null,
    lateMinutes: 0,
    earlyDepartureMinutes: 0,
    scheduledMinutes,
    workedMinutes: 0,
    breakMinutes: 0,
    potentialOvertimeMinutes: 0,
    exceptionNotes: notes,
  };
}

/**
 * Potential overtime is time after the scheduled end, once the employee has
 * clocked out. It is not approved overtime, and arriving late does not reduce it.
 */
export function calculateAttendanceDay(input: DayInput): DayResult {
  if (input.onLeave) return emptyDay(input, "leave");
  if (input.isDayOff) return emptyDay(input, "day_off");

  const events = accepted(input.events);
  const adjustment = latestAdjustment(input.events);
  const clockIns = events.filter((event) => event.eventType === "CLOCK_IN");
  const clockOuts = events.filter((event) => event.eventType === "CLOCK_OUT");

  const actualStart = adjustment?.clockIn
    ? new Date(adjustment.clockIn)
    : clockIns[0]?.occurredAt ?? null;
  const actualEnd = adjustment?.clockOut
    ? new Date(adjustment.clockOut)
    : clockOuts.length > 0
      ? clockOuts[clockOuts.length - 1].occurredAt
      : null;

  const scheduledMinutes =
    input.scheduledStart && input.scheduledEnd
      ? Math.max(0, minutesBetween(input.scheduledStart, input.scheduledEnd))
      : 0;

  if (!actualStart) {
    if (!input.scheduledStart) return emptyDay(input, "expected");
    const elapsed = minutesBetween(input.scheduledStart, input.now);
    if (elapsed <= input.graceMinutes) return emptyDay(input, "expected");
    if (elapsed < input.absenceCutoffMinutes) {
      return {
        ...emptyDay(input, "late"),
        lateMinutes: elapsed,
      };
    }
    return emptyDay(input, "absent");
  }

  const notes: string[] = [];
  if (!input.scheduledStart) notes.push("No schedule");
  if (adjustment?.reason) notes.push(adjustment.reason);
  if (actualEnd && actualEnd < actualStart) notes.push("Clock-out is before clock-in");

  const lateRaw = input.scheduledStart ? minutesBetween(input.scheduledStart, actualStart) : 0;
  const lateMinutes = lateRaw > input.graceMinutes ? lateRaw : 0;
  const earlyDepartureMinutes =
    actualEnd && input.scheduledEnd && actualEnd < input.scheduledEnd
      ? minutesBetween(actualEnd, input.scheduledEnd)
      : 0;

  const breaks = breakSummary(input.events, actualStart, actualEnd, input.now);
  if (breaks.unclosed) notes.push("Unclosed break");

  const workedMinutes = actualEnd
    ? Math.max(0, minutesBetween(actualStart, actualEnd) - breaks.minutes)
    : 0;

  const potentialOvertimeMinutes =
    actualEnd && input.scheduledEnd && actualEnd > input.scheduledEnd
      ? minutesBetween(input.scheduledEnd, actualEnd)
      : 0;

  let status: DayStatus;
  if (!actualEnd) {
    if (input.scheduledEnd && input.now > input.scheduledEnd) {
      status = "open";
      notes.push("Missing clock-out");
    } else {
      status = lateMinutes > 0 ? "late" : "present";
    }
  } else if (lateMinutes > 0) {
    status = "late";
  } else if (earlyDepartureMinutes > 0) {
    status = "early_departure";
  } else {
    status = "present";
  }

  return {
    employeeId: input.employeeId,
    workDate: input.workDate,
    status,
    scheduledStart: input.scheduledStart,
    scheduledEnd: input.scheduledEnd,
    actualStart,
    actualEnd,
    lateMinutes,
    earlyDepartureMinutes,
    scheduledMinutes,
    workedMinutes,
    breakMinutes: breaks.minutes,
    potentialOvertimeMinutes,
    exceptionNotes: notes.length > 0 ? notes.join(". ") : null,
  };
}

export function presenceState(events: EngineEvent[]): Presence {
  let state: Presence = "out";
  for (const event of accepted(events)) {
    if (event.eventType === "CLOCK_IN") state = "in";
    else if (event.eventType === "CLOCK_OUT") state = "out";
    else if (event.eventType === "BREAK_START" && state === "in") state = "break";
    else if (event.eventType === "BREAK_END" && state === "break") state = "in";
    else if (event.eventType === "MANUAL_ADJUSTMENT") {
      if (event.adjustment?.clockOut) state = "out";
      else if (event.adjustment?.clockIn) state = "in";
    }
  }
  return state;
}
