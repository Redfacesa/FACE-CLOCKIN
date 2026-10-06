import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { FloorSnapshot } from "@/lib/domain/floor";
import type { Actor, Location } from "@/lib/domain/model";
import { getDevStore, type DevStore } from "@/lib/repository/dev-store";
import { PayStore, resolvePayMerchant } from "@/lib/repository/pay-store";
import { payConfig, paySession } from "@/lib/supabase/pay";
import { readSession, type SessionActor } from "./session";

export type EmployeeCard = {
  id: string;
  employeeCode: string;
  name: string;
  position: string;
  department: string;
  manager: string;
  status: string;
  consented: boolean;
  enrolled: boolean;
};

export type AppStore = {
  listLocations(actor: Actor): Promise<Location[]>;
  listDepartments(locationId: string): Promise<Array<{ id: string; locationId: string; name: string }>>;
  listPositions(): Promise<Array<{ id: string; name: string }>>;
  listEmployees(actor: Actor, locationId: string): Promise<EmployeeCard[]>;
  getEmployee(actor: Actor, employeeId: string): Promise<
    EmployeeCard & {
      pinSet: boolean;
      consent: { consentedAt: string } | null;
      template: { modelVersion: string; qualityScore: number | null } | null;
      today: { lateMinutes: number; workedMinutes: number; potentialOvertimeMinutes: number } | null;
      events: Array<{
        id: string;
        occurredAt: string;
        eventType: string;
        verificationMethod: string;
        verificationStatus: string;
        confidenceScore: number | null;
        adjustment: { reason: string } | null;
      }>;
      notices: string;
    }
  >;
  floor(actor: Actor, locationId: string, now?: Date, departmentId?: string): Promise<FloorSnapshot>;
  scheduleFor(actor: Actor, employeeId: string): Promise<{ weekly: Array<{ dayOfWeek: number; startTime: string; endTime: string }>; exceptions: unknown[] }>;
  listAttendance(
    actor: Actor,
    locationId: string,
    from: string,
    to: string,
    departmentId?: string,
  ): Promise<
    Array<{
      employeeId: string;
      workDate: string;
      employeeName: string;
      employeeCode: string;
      status: string;
      scheduledStart: string | null;
      scheduledEnd: string | null;
      actualStart: string | null;
      actualEnd: string | null;
      lateMinutes: number;
      earlyDepartureMinutes: number;
      workedMinutes: number;
      potentialOvertimeMinutes: number;
      approvedMinutes: number | null;
    }>
  >;
  listLeave(actor: Actor, locationId: string): Promise<Array<{ id: string; employeeName: string; employeeCode: string; leaveType: string; startsOn: string; endsOn: string; status: string }>>;
  listDevices(
    actor: Actor,
    locationId: string,
  ): Promise<Array<{ id: string; name: string; deviceCode: string; matchThreshold: number; lastSeenAt: string | null; online: boolean; status: string }>>;
  deviceActivity(
    actor: Actor,
    deviceId: string,
  ): Promise<Array<{ id: string; occurredAt: string; employeeName: string; eventType: string; verificationMethod: string }>>;
  listOvertime(
    actor: Actor,
    locationId: string,
  ): Promise<Array<{ id: string; workDate: string; employeeName: string; employeeCode: string; potentialMinutes: number; approvedMinutes: number | null; status: string }>>;
  listAudit(actor: Actor): Promise<Array<{ id: string; createdAt: string; actorLabel: string; action: string; metadata: Record<string, unknown> }>>;
  createEmployee(actor: Actor, input: { firstName: string; lastName: string; locationId: string; departmentId: string; positionId: string; managerId: string | null }): Promise<{ id: string }>;
  recordConsent(actor: Actor, employeeId: string): Promise<void>;
  setPin(actor: Actor, employeeId: string, pin: string): Promise<void>;
  deactivateEmployee(actor: Actor, employeeId: string): Promise<void>;
  deleteTemplates(actor: Actor, employeeId: string): Promise<void>;
  deleteRevokedTemplates(actor: Actor): Promise<void>;
  saveSchedule(actor: Actor, employeeId: string, days: Array<{ dayOfWeek: number; off: boolean; startTime: string; endTime: string }>): Promise<void>;
  setShiftException(actor: Actor, input: { employeeId: string; workDate: string; isDayOff: boolean; startTime: string; endTime: string; reason: string }): Promise<void>;
  createLeave(actor: Actor, input: { employeeId: string; leaveType: string; startsOn: string; endsOn: string }): Promise<unknown>;
  decideLeave(actor: Actor, leaveId: string, status: "approved" | "denied"): Promise<void>;
  createDevice(actor: Actor, input: { locationId: string; name: string; deviceCode: string; matchThreshold: number }): Promise<{ device: { deviceCode: string }; secret: string }>;
  setDeviceStatus(actor: Actor, deviceId: string, status: "active" | "disabled"): Promise<void>;
  supervisorEvent(actor: Actor, input: { employeeId: string; eventType: import("@/lib/attendance/types").EventType }): Promise<void>;
  manualAdjustment(actor: Actor, input: { employeeId: string; workDate: string; clockIn: string; clockOut: string; reason: string }): Promise<void>;
  decideOvertime(actor: Actor, overtimeId: string, decision: { status: "approved" | "rejected"; approvedMinutes?: number }): Promise<void>;
};

function promisify(store: object): AppStore {
  return new Proxy(store, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => Promise.resolve(Reflect.apply(value as (...args: unknown[]) => unknown, target, args));
    },
  }) as AppStore;
}

export async function currentActor(): Promise<Actor | null> {
  const jar = await cookies();
  const session = await readSession(jar.get("fc_session")?.value);
  if (!session) return null;
  const { exp: _exp, ...actor } = session;
  return actor;
}

export async function requireActor(): Promise<Actor> {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  return actor;
}

export async function getStore(): Promise<AppStore> {
  if (!payConfig().enabled) return promisify(getDevStore());
  const session = await paySession();
  if (!session?.user.email) redirect("/login");
  const merchant = await resolvePayMerchant(session.supabase, session.user.email);
  if (!merchant) {
    redirect(`/login?error=${encodeURIComponent("This Redface Pay account is not linked to a merchant.")}`);
  }
  return promisify(new PayStore(session.supabase, merchant.id, merchant.name));
}

/** Local station credential check. Pay mode does not use this path. */
export function clockStore(): DevStore {
  return getDevStore();
}

export async function workplace() {
  const actor = await requireActor();
  const store = await getStore();
  const locations = await store.listLocations(actor);
  return { actor, store, location: locations[0] ?? null, locations };
}

export type { SessionActor };
