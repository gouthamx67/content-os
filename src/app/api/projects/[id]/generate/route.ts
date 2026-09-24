import { NextResponse } from "next/server";
import {
  generationService,
} from "../../../../../infrastructure/services";
import { requireUser } from "../../../../../lib/require-auth";
import { projectService } from "../../../../../infrastructure/services";

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

  try {
    const { user } = await requireUser(request);

    await projectService.getAuthorized(id, user.id);

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