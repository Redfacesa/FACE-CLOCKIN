import { addDays, localDate, localMinutes } from "./time";
import type { EngineEvent, EventType } from "./types";

const OVERNIGHT_CUTOFF_MINUTES = 5 * 60;
const CARRY_TYPES = new Set<EventType>(["CLOCK_OUT", "BREAK_START", "BREAK_END", "MANUAL_ADJUSTMENT"]);

function isCarry(event: EngineEvent, workDate: string, timeZone: string): boolean {
  return (
    localDate(event.occurredAt, timeZone) === workDate &&
    localMinutes(event.occurredAt, timeZone) < OVERNIGHT_CUTOFF_MINUTES &&
    CARRY_TYPES.has(event.eventType)
  );
}

function hasOpenClockIn(events: EngineEvent[], workDate: string, timeZone: string): boolean {
  const onDate = events.filter((event) => localDate(event.occurredAt, timeZone) === workDate);
  const clockedIn = onDate.some(
    (event) => event.eventType === "CLOCK_IN" && event.verificationStatus !== "FAILED",
  );
  const clockedOut = onDate.some(
    (event) => event.eventType === "CLOCK_OUT" && event.verificationStatus !== "FAILED",
  );
  return clockedIn && !clockedOut;
}

/** Events for a work date, including a post-midnight clock-out from the shift before. */
export function eventsForWorkDate(
  events: EngineEvent[],
  workDate: string,
  timeZone: string,
): EngineEvent[] {
  const previous = addDays(workDate, -1);
  const carriedForward = hasOpenClockIn(events, previous, timeZone)
    ? new Set(events.filter((event) => isCarry(event, workDate, timeZone)).map((event) => event.id))
    : new Set<string>();

  const own = events.filter(
    (event) => localDate(event.occurredAt, timeZone) === workDate && !carriedForward.has(event.id),
  );
  const carry = hasOpenClockIn(events, workDate, timeZone)
    ? events.filter((event) => isCarry(event, addDays(workDate, 1), timeZone))
    : [];

  return [...own, ...carry].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id),
  );
}
