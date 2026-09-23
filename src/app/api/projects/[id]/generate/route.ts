import { NextResponse } from "next/server";
import {
  generationService,
  projectService,
} from "../../../../../infrastructure/services";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(
  request: Request,
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

  try {
    const body = await request.json();

    const job = await generationService.createJob({
      projectId: id,

      type: body?.type ?? "video.product_demo",

      category: body?.category ?? "video",

      instruction: body?.instruction,

      platform: body?.platform,

      durationSeconds: body?.durationSeconds,

      aspectRatio: body?.aspectRatio,

      tone: body?.tone,

      creativeMode: body?.creativeMode ?? "balanced",

      language: body?.language ?? "en",

      options: body?.options,
    });

    const completedJob =
      await generationService.execute(job);

    return NextResponse.json(
      {
        job: completedJob,
      },
      {
        status: 202,
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Generation failed",
      },
      {
        status: 400,
      },
    );
  }
}