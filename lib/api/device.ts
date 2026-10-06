import { NextResponse } from "next/server";
import { payConfig } from "@/lib/supabase/pay";
import { getDevStore } from "@/lib/repository/dev-store";
import { currentActor } from "@/lib/auth/current";

export async function deviceContext(request: Request) {
  if (payConfig().enabled) return "pay" as const;
  const header = request.headers.get("authorization") ?? "";
  const secret = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const store = getDevStore();
  const device = store.authenticateDevice(secret);
  if (!device) return null;
  return { store, device };
}

export function unauthorized() {
  return NextResponse.json({ error: "Device credential was rejected." }, { status: 401 });
}

export function payStationPaused() {
  return NextResponse.json(
    {
      error:
        "Station sync uses the local store. With Redface Pay sign-in, register the station after migration 0477 and a service credential.",
    },
    { status: 503 },
  );
}

export async function reportActor() {
  return currentActor();
}
