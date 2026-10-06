import { NextResponse } from "next/server";
import { deviceContext, payStationPaused, unauthorized } from "@/lib/api/device";

export async function POST(request: Request) {
  const context = await deviceContext(request);
  if (context === "pay") return payStationPaused();
  if (!context) return unauthorized();
  return NextResponse.json(context.store.heartbeat(context.device));
}
