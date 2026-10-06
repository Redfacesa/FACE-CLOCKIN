"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { DomainError, type Actor } from "@/lib/domain/model";
import type { EventType } from "@/lib/attendance/types";
import { getStore, requireActor } from "@/lib/auth/current";
import { signSession } from "@/lib/auth/session";
import { getDevStore } from "@/lib/repository/dev-store";
import { resolvePayMerchant } from "@/lib/repository/pay-store";
import { clearPaySession, payClient, payConfig, savePaySession } from "@/lib/supabase/pay";

function fail(target: string, error: unknown): never {
  const message = error instanceof DomainError ? error.message : "Something went wrong.";
  redirect(`${target}?error=${encodeURIComponent(message)}`);
}

async function remember(actor: Actor) {
  const jar = await cookies();
  jar.set("fc_session", await signSession(actor), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
}

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (payConfig().enabled) {
    const supabase = payClient();
    const signed = await supabase.auth.signInWithPassword({ email, password });
    if (signed.error || !signed.data.session || !signed.data.user) {
      redirect(`/login?error=${encodeURIComponent("Those Redface Pay details were not recognised.")}`);
    }
    let merchant;
    try {
      merchant = await resolvePayMerchant(supabase, email);
    } catch (error) {
      const message = error instanceof DomainError ? error.message : "Redface Pay could not be reached.";
      redirect(`/login?error=${encodeURIComponent(message)}`);
    }
    if (!merchant) {
      redirect(`/login?error=${encodeURIComponent("This Redface Pay account is not linked to a merchant.")}`);
    }
    await savePaySession(signed.data.session.access_token, signed.data.session.refresh_token);
    const meta = signed.data.user.user_metadata as { full_name?: string } | undefined;
    await remember({
      id: signed.data.user.id,
      role: merchant.role,
      fullName: meta?.full_name || email,
      email,
      employeeId: merchant.employeeId,
      locationIds: [merchant.id],
    });
    redirect("/dashboard");
  }
  const actor = getDevStore().login(email, password);
  if (!actor) redirect("/login?error=Those%20details%20were%20not%20recognised.");
  await remember(actor);
  redirect("/dashboard");
}

export async function logout() {
  await clearPaySession();
  const jar = await cookies();
  jar.delete("fc_session");
  redirect("/login");
}

export async function createEmployee(formData: FormData) {
  const actor = await requireActor();
  try {
    const employee = await (await getStore()).createEmployee(actor, {
      firstName: String(formData.get("firstName") ?? ""),
      lastName: String(formData.get("lastName") ?? ""),
      locationId: String(formData.get("locationId") ?? ""),
      departmentId: String(formData.get("departmentId") ?? ""),
      positionId: String(formData.get("positionId") ?? ""),
      managerId: String(formData.get("managerId") ?? "") || null,
    });
    revalidatePath("/employees");
    redirect(`/employees/${employee.id}`);
  } catch (error) {
    if (error instanceof DomainError) fail("/employees", error);
    throw error;
  }
}

export async function recordConsent(formData: FormData) {
  const actor = await requireActor();
  const employeeId = String(formData.get("employeeId") ?? "");
  try {
    await (await getStore()).recordConsent(actor, employeeId);
  } catch (error) {
    if (error instanceof DomainError) fail(`/employees/${employeeId}`, error);
    throw error;
  }
  revalidatePath(`/employees/${employeeId}`);
  redirect(`/employees/${employeeId}`);
}

export async function setPin(formData: FormData) {
  const actor = await requireActor();
  const employeeId = String(formData.get("employeeId") ?? "");
  try {
    await (await getStore()).setPin(actor, employeeId, String(formData.get("pin") ?? ""));
  } catch (error) {
    if (error instanceof DomainError) fail(`/employees/${employeeId}`, error);
    throw error;
  }
  redirect(`/employees/${employeeId}?note=PIN%20updated`);
}

export async function deactivateEmployee(formData: FormData) {
  const actor = await requireActor();
  const employeeId = String(formData.get("employeeId") ?? "");
  try {
    await (await getStore()).deactivateEmployee(actor, employeeId);
  } catch (error) {
    if (error instanceof DomainError) fail(`/employees/${employeeId}`, error);
    throw error;
  }
  revalidatePath("/employees");
  redirect(`/employees/${employeeId}?note=Employee%20deactivated`);
}

export async function deleteTemplates(formData: FormData) {
  const actor = await requireActor();
  const employeeId = String(formData.get("employeeId") ?? "");
  try {
    await (await getStore()).deleteTemplates(actor, employeeId);
  } catch (error) {
    if (error instanceof DomainError) fail(`/employees/${employeeId}`, error);
    throw error;
  }
  redirect(`/employees/${employeeId}?note=Biometric%20templates%20deleted`);
}

export async function saveSchedule(formData: FormData) {
  const actor = await requireActor();
  const employeeId = String(formData.get("employeeId") ?? "");
  const days = [1, 2, 3, 4, 5, 6, 0].map((dayOfWeek) => ({
    dayOfWeek,
    off: formData.get(`off_${dayOfWeek}`) === "on",
    startTime: String(formData.get(`start_${dayOfWeek}`) ?? "09:00"),
    endTime: String(formData.get(`end_${dayOfWeek}`) ?? "17:00"),
  }));
  try {
    await (await getStore()).saveSchedule(actor, employeeId, days);
  } catch (error) {
    if (error instanceof DomainError) fail("/schedules", error);
    throw error;
  }
  redirect(`/schedules?employee=${employeeId}&note=Schedule%20saved`);
}

export async function setShiftException(formData: FormData) {
  const actor = await requireActor();
  try {
    await (await getStore()).setShiftException(actor, {
      employeeId: String(formData.get("employeeId") ?? ""),
      workDate: String(formData.get("workDate") ?? ""),
      isDayOff: formData.get("isDayOff") === "on",
      startTime: String(formData.get("startTime") ?? ""),
      endTime: String(formData.get("endTime") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    });
  } catch (error) {
    if (error instanceof DomainError) fail("/schedules", error);
    throw error;
  }
  redirect("/schedules?note=Shift%20change%20saved");
}

export async function createLeave(formData: FormData) {
  const actor = await requireActor();
  try {
    await (await getStore()).createLeave(actor, {
      employeeId: String(formData.get("employeeId") ?? ""),
      leaveType: String(formData.get("leaveType") ?? "Annual"),
      startsOn: String(formData.get("startsOn") ?? ""),
      endsOn: String(formData.get("endsOn") ?? ""),
    });
  } catch (error) {
    if (error instanceof DomainError) fail("/leave", error);
    throw error;
  }
  redirect("/leave?note=Leave%20request%20saved");
}

export async function decideLeave(formData: FormData) {
  const actor = await requireActor();
  const status = String(formData.get("status") ?? "") === "denied" ? "denied" : "approved";
  try {
    await (await getStore()).decideLeave(actor, String(formData.get("leaveId") ?? ""), status);
  } catch (error) {
    if (error instanceof DomainError) fail("/leave", error);
    throw error;
  }
  redirect("/leave");
}

export async function createDevice(formData: FormData) {
  const actor = await requireActor();
  try {
    const created = await (await getStore()).createDevice(actor, {
      locationId: String(formData.get("locationId") ?? ""),
      name: String(formData.get("name") ?? ""),
      deviceCode: String(formData.get("deviceCode") ?? ""),
      matchThreshold: Number(formData.get("matchThreshold") ?? 0.4),
    });
    const jar = await cookies();
    jar.set("fc_issued_secret", `${created.device.deviceCode} ${created.secret}`, {
      httpOnly: true,
      sameSite: "lax",
      path: "/devices",
      maxAge: 180,
    });
  } catch (error) {
    if (error instanceof DomainError) fail("/devices", error);
    throw error;
  }
  redirect("/devices");
}

export async function setDeviceStatus(formData: FormData) {
  const actor = await requireActor();
  const status = String(formData.get("status") ?? "") === "disabled" ? "disabled" : "active";
  try {
    await (await getStore()).setDeviceStatus(actor, String(formData.get("deviceId") ?? ""), status);
  } catch (error) {
    if (error instanceof DomainError) fail("/devices", error);
    throw error;
  }
  redirect("/devices");
}

export async function supervisorEvent(formData: FormData) {
  const actor = await requireActor();
  const eventType = String(formData.get("eventType") ?? "CLOCK_IN") as EventType;
  try {
    await (await getStore()).supervisorEvent(actor, {
      employeeId: String(formData.get("employeeId") ?? ""),
      eventType,
    });
  } catch (error) {
    if (error instanceof DomainError) fail("/dashboard", error);
    throw error;
  }
  revalidatePath("/dashboard");
  redirect("/dashboard");
}

export async function manualAdjustment(formData: FormData) {
  const actor = await requireActor();
  const employeeId = String(formData.get("employeeId") ?? "");
  try {
    await (await getStore()).manualAdjustment(actor, {
      employeeId,
      workDate: String(formData.get("workDate") ?? ""),
      clockIn: String(formData.get("clockIn") ?? ""),
      clockOut: String(formData.get("clockOut") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    });
  } catch (error) {
    if (error instanceof DomainError) fail(`/employees/${employeeId}`, error);
    throw error;
  }
  redirect(`/employees/${employeeId}?note=Adjustment%20recorded`);
}

export async function decideOvertime(formData: FormData) {
  const actor = await requireActor();
  const status = String(formData.get("status") ?? "") === "rejected" ? "rejected" : "approved";
  try {
    await (await getStore()).decideOvertime(actor, String(formData.get("overtimeId") ?? ""), {
      status,
      approvedMinutes: formData.get("approvedMinutes") ? Number(formData.get("approvedMinutes")) : undefined,
    });
  } catch (error) {
    if (error instanceof DomainError) fail("/overtime", error);
    throw error;
  }
  redirect("/overtime");
}

export async function purgeRevokedTemplates() {
  const actor = await requireActor();
  try {
    await (await getStore()).deleteRevokedTemplates(actor);
  } catch (error) {
    if (error instanceof DomainError) fail("/audit", error);
    throw error;
  }
  redirect("/audit?note=Revoked%20templates%20deleted");
}
