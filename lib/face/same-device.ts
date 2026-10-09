import { NextResponse } from "next/server";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function faceRequestIsLocal(request: Request) {
  const host = (request.headers.get("host") ?? "").trim().toLowerCase();
  const hostname = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  return LOCAL_HOSTS.has(hostname);
}

export function rejectRemoteFaceRequest() {
  return NextResponse.json(
    {
      error:
        "Open Face Clock on this computer at http://localhost:3000. The camera and the face engine stay on the same device, and camera frames are not sent anywhere else.",
    },
    { status: 403 },
  );
}
