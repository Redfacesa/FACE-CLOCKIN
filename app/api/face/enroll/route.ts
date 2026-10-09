import { NextResponse } from "next/server";
import { z } from "zod";
import { DomainError } from "@/lib/domain/model";
import { rememberFace } from "@/lib/face/memory";
import { faceRequestIsLocal, rejectRemoteFaceRequest } from "@/lib/face/same-device";

const bodySchema = z.object({
  employeeId: z.string().uuid(),
  frames: z.tuple([z.string().min(1000), z.string().min(1000)]),
});

export async function POST(request: Request) {
  if (!faceRequestIsLocal(request)) return rejectRemoteFaceRequest();
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "The camera did not send two frames." }, { status: 400 });
  try {
    const saved = await rememberFace(parsed.data.employeeId, parsed.data.frames);
    return NextResponse.json({ ok: true, message: `${saved.name} is saved. Next time the camera can recognise them.` });
  } catch (error) {
    const message = error instanceof DomainError ? error.message : "The face could not be saved.";
    const status = error instanceof DomainError ? error.status : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
