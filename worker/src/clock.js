export const METHODS = {
  nfc: "NFC card",
  qr: "QR code",
  face: "Face recognition",
  pin: "PIN",
};

export function classifyFace(probe, templates) {
  if (!Array.isArray(probe) || probe.length !== 128) return { status: "unknown", employeeId: null, distance: null };
  const bestByEmployee = new Map();
  for (const template of templates) {
    if (!template?.descriptor || template.descriptor.length !== probe.length || !template.employeeId) continue;
    let sum = 0;
    for (let index = 0; index < probe.length; index += 1) sum += (probe[index] - template.descriptor[index]) ** 2;
    const distance = Math.sqrt(sum);
    const previous = bestByEmployee.get(template.employeeId);
    if (previous == null || distance < previous) bestByEmployee.set(template.employeeId, distance);
  }
  let best = { distance: Infinity, employeeId: null };
  let second = Infinity;
  for (const [employeeId, distance] of bestByEmployee) {
    if (distance < best.distance) {
      second = best.distance;
      best = { distance, employeeId };
    } else if (distance < second) second = distance;
  }
  if (!best.employeeId) return { status: "unknown", employeeId: null, distance: null };
  const alone = bestByEmployee.size === 1;
  const separated = alone || second - best.distance >= 0.08;
  const acceptAt = alone ? 0.38 : 0.42;
  if (best.distance <= acceptAt && separated) return { status: "match", employeeId: best.employeeId, distance: best.distance };
  if (best.distance <= 0.55) return { status: "low_confidence", employeeId: null, distance: best.distance };
  return { status: "unknown", employeeId: null, distance: best.distance };
}

export function matchFace(probe, templates) {
  const result = classifyFace(probe, templates);
  return result.status === "match" ? result.employeeId : null;
}

export function suggestedAction(lastEventType) {
  return lastEventType === "CLOCK_IN" ? "CLOCK_OUT" : "CLOCK_IN";
}

export function zonedNow(date = new Date(), timeZone = "Africa/Johannesburg") {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value ?? "";
  const hour = Number(pick("hour"));
  const minute = pick("minute");
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const hour12 = hour % 12 || 12;
  const suffix = hour < 12 ? "AM" : "PM";
  const monthName = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    month: "long",
  }).format(date);
  return {
    greeting,
    workDate: `${pick("year")}-${pick("month")}-${pick("day")}`,
    dateLabel: `${Number(pick("day"))} ${monthName} ${pick("year")}`,
    timeLabel: `${String(hour12).padStart(2, "0")}:${minute} ${suffix}`,
  };
}

export function minutesInZone(date, timeZone = "Africa/Johannesburg") {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return pick("hour") * 60 + pick("minute");
}

export function initials(firstName, lastName) {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

export function publicEmployee(row) {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    roleTitle: row.role_title,
    initials: initials(row.first_name, row.last_name),
    methods: {
      pin: Boolean(row.pin_hash),
      nfc: Boolean(row.nfc_hash),
      face: Boolean(row.face_object_key),
      qr: true,
    },
  };
}
