import { NextResponse } from "next/server";
import { projectService } from "../../../infrastructure/services";

export async function GET() {
  const projects = await projectService.list();

  return NextResponse.json({
    projects,
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const project = await projectService.create({
      name: body?.name,
      sources: Array.isArray(body?.sources)
        ? body.sources
        : [],
    });

    return NextResponse.json(
      {
        project,
      },
      {
        status: 201,
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to create project",
      },
      {
        status: 400,
      },
    );
  }
}