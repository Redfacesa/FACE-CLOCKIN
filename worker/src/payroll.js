import { minutesInZone } from "./clock.js";

export const DEFAULT_POLICY = {
  workDays: [1, 2, 3, 4, 5],
  dayStart: "08:00",
  dayEnd: "17:00",
  weeklyMinutes: 45 * 60,
  lunchAllowanceMinutes: 60,
  lateGraceMinutes: 10,
  overtimeMultiplier: 1.5,
  deductLate: true,
  deductExtraBreak: true,
  deductAbsence: true,
};

export function rands(cents) {
  const amount = Number(cents) || 0;
  const sign = amount < 0 ? "-" : "";
  const absolute = Math.abs(Math.round(amount));
  return `${sign}R${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

export function monthDates(month) {
  const match = /^(\d{4})-(\d{2})$/.exec(month ?? "");
  if (!match) return [];
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const dates = [];
  const cursor = new Date(Date.UTC(year, monthIndex, 1));
  while (cursor.getUTCMonth() === monthIndex) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export function summariseDay(events) {
  const ordered = [...events].sort((left, right) => String(left.occurred_at).localeCompare(String(right.occurred_at)));
  let worked = 0;
  let breaks = 0;
  let openAt = null;
  let lastOut = null;
  let firstIn = null;
  for (const event of ordered) {
    if (event.event_type === "CLOCK_IN") {
      if (lastOut) breaks += Math.max(0, (Date.parse(event.occurred_at) - Date.parse(lastOut)) / 60000);
      if (!firstIn) firstIn = event;
      openAt = event.occurred_at;
    } else if (event.event_type === "CLOCK_OUT" && openAt) {
      worked += Math.max(0, (Date.parse(event.occurred_at) - Date.parse(openAt)) / 60000);
      lastOut = event.occurred_at;
      openAt = null;
    }
  }
  return { worked: Math.round(worked), breaks: Math.round(breaks), firstIn, lastOut };
}

function clockMinutes(value) {
  const [hour, minute] = String(value ?? "00:00").split(":");
  return Number(hour) * 60 + Number(minute);
}

export function estimateMonth({ employee, dates, events, leaveDates, policy, pay, timeZone, today }) {
  const rules = { ...DEFAULT_POLICY, ...policy };
  const dailyExpected = Math.max(1, Math.round(rules.weeklyMinutes / Math.max(1, rules.workDays.length)));
  const hourlyCents = pay?.pay_type === "hourly"
    ? pay.amount_cents
    : pay?.amount_cents
      ? Math.round(pay.amount_cents / ((rules.weeklyMinutes / 60) * 4.333))
      : 0;
  let worked = 0;
  let overtime = 0;
  let late = 0;
  let absences = 0;
  let lunch = 0;
  let extraBreak = 0;
  let early = 0;
  for (const date of dates) {
    if (!rules.workDays.includes(new Date(`${date}T12:00:00Z`).getUTCDay())) continue;
    if (date > today) continue;
    const away = leaveDates.has(date);
    const summary = summariseDay(events.filter((event) => event.work_date === date));
    if (!summary.firstIn) {
      if (!away) absences += 1;
      continue;
    }
    worked += summary.worked;
    overtime += Math.max(0, summary.worked - dailyExpected);
    lunch += summary.breaks;
    extraBreak += Math.max(0, summary.breaks - rules.lunchAllowanceMinutes);
    late += Math.max(0, minutesInZone(new Date(summary.firstIn.occurred_at), timeZone) - clockMinutes(rules.dayStart) - rules.lateGraceMinutes);
    if (summary.lastOut) early += Math.max(0, clockMinutes(rules.dayEnd) - minutesInZone(new Date(summary.lastOut), timeZone));
  }
  const ordinary = Math.max(0, worked - overtime);
  const basic = pay?.pay_type === "monthly" ? (pay.amount_cents || 0) : Math.round((ordinary / 60) * hourlyCents);
  const overtimePay = Math.round((overtime / 60) * hourlyCents * rules.overtimeMultiplier);
  const lateDeduction = rules.deductLate ? Math.round((late / 60) * hourlyCents) : 0;
  const breakDeduction = rules.deductExtraBreak ? Math.round((extraBreak / 60) * hourlyCents) : 0;
  const absenceDeduction = rules.deductAbsence ? Math.round(absences * (dailyExpected / 60) * hourlyCents) : 0;
  return {
    employeeId: employee.id,
    name: `${employee.first_name} ${employee.last_name}`,
    number: employee.employee_number ?? "",
    workedMinutes: worked,
    overtimeMinutes: overtime,
    lateMinutes: late,
    absences,
    lunchMinutes: lunch,
    extraBreakMinutes: extraBreak,
    earlyMinutes: early,
    basic,
    overtimePay,
    lateDeduction,
    breakDeduction,
    absenceDeduction,
    net: basic + overtimePay - lateDeduction - breakDeduction - absenceDeduction,
    configured: Boolean(pay?.amount_cents),
  };
}

export function reportCsv(report) {
  const header = ["Employee", "Number", "Hours", "Overtime hours", "Late minutes", "Absences", "Lunch minutes", "Extra break minutes", "Early minutes", "Basic", "Overtime", "Late adjustment", "Break adjustment", "Absence adjustment", "Estimated net"];
  const lines = report.rows.map((row) => [
    row.name, row.number, (row.workedMinutes / 60).toFixed(2), (row.overtimeMinutes / 60).toFixed(2), row.lateMinutes, row.absences,
    row.lunchMinutes, row.extraBreakMinutes, row.earlyMinutes, rands(row.basic), rands(row.overtimePay), rands(row.lateDeduction), rands(row.breakDeduction), rands(row.absenceDeduction), rands(row.net),
  ]);
  return [header, ...lines].map((cells) => cells.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\r\n");
}

export function reportPdf(report) {
  const lines = [
    `Red Face Workforce  ${report.month}  ${report.status}`,
    "Estimated attendance and payroll. This is not a wage payment.",
    "Overtime uses the company multiplier. Deductions apply only where the company enabled them.",
    ...report.rows.flatMap((row) => [
      `${row.number} ${row.name}`,
      `Hours ${(row.workedMinutes / 60).toFixed(1)}  OT ${(row.overtimeMinutes / 60).toFixed(1)}  Late ${row.lateMinutes}m  Absent ${row.absences}  Lunch ${row.lunchMinutes}m  Early ${row.earlyMinutes}m`,
      `Basic ${rands(row.basic)}  OT ${rands(row.overtimePay)}  Late ${rands(row.lateDeduction)}  Break ${rands(row.breakDeduction)}  Absence ${rands(row.absenceDeduction)}  Net ${rands(row.net)}`,
      "",
    ]),
  ].slice(0, 48);
  const commands = ["BT", "/F1 10 Tf", "40 800 Td", "14 TL"];
  for (const line of lines) commands.push(`(${pdfText(line)}) Tj`, "T*");
  commands.push("ET");
  const stream = commands.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index += 1) pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return pdf;
}

function pdfText(value) {
  return String(value).replace(/[^\x20-\x7E]/g, " ").replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}
