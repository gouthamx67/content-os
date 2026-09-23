import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true,

    service: "content-os",

    architecture: "checkpoint-03",

    timestamp: new Date().toISOString(),
  });
}