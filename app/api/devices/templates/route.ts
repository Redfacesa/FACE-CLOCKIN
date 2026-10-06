import { NextResponse } from "next/server";
import { deviceContext, payStationPaused, unauthorized } from "@/lib/api/device";

export async function GET(request: Request) {
  const context = await deviceContext(request);
  if (context === "pay") return payStationPaused();
  if (!context) return unauthorized();
  return NextResponse.json(context.store.cacheForDevice(context.device));
}
