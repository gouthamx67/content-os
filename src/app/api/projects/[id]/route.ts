import { NextResponse } from "next/server";
import { projectService } from "../../../../infrastructure/services";

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

  const project = await projectService.get(id);

  if (!project) {
    return NextResponse.json(
      {
        error: "Project not found",
      },
      {
        status: 404,
      },
    );
  }

  return NextResponse.json({
    project,
  });
}