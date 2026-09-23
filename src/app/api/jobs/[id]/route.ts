import { NextResponse } from "next/server";
import { generationService } from "../../../../infrastructure/services";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(
  _request: Request,
  context: RouteContext,
) {
  const { id } = await context.params;

  const job = await generationService.getJob(id);

  if (!job) {
    return NextResponse.json(
      {
        error: "Job not found",
      },
      {
        status: 404,
      },
    );
  }

  return NextResponse.json({
    job,
  });
}