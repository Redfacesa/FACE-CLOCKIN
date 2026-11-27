export const METHODS = {
  nfc: "NFC card",
  qr: "QR code",
  face: "Face recognition",
  pin: "PIN",
};

export function suggestedAction(lastEventType) {
  return lastEventType === "CLOCK_IN" ? "CLOCK_OUT" : "CLOCK_IN";
}

export function johannesburg(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Johannesburg",
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
    timeZone: "Africa/Johannesburg",
    month: "long",
  }).format(date);
  return {
    greeting,
    workDate: `${pick("year")}-${pick("month")}-${pick("day")}`,
    dateLabel: `${Number(pick("day"))} ${monthName} ${pick("year")}`,
    timeLabel: `${String(hour12).padStart(2, "0")}:${minute} ${suffix}`,
  };
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
