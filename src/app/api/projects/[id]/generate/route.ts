import { NextResponse } from "next/server";
import {
  generationService,
} from "../../../../../infrastructure/services";
import type { ContentCategory } from "../../../../../core/domain/content";
import { isCreativeMode } from "../../../../../core/domain/creative-direction";
import { requireUser } from "../../../../../lib/require-auth";
import {
  HttpError,
  isSameOrigin,
  parseJsonBody,
  wrapHttpError,
} from "../../../../../lib/http";
import {
  enforceRateLimit,
  RATE_LIMITS,
} from "../../../../../lib/rate-limit";

import { projectService } from "../../../../../infrastructure/services";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

const CONTENT_CATEGORIES: readonly ContentCategory[] = [
  "video",
  "image",
  "writing",
  "audio",
  "campaign",
];

export async function POST(
  request: Request,
  context: RouteContext,
) {
  const { id } = await context.params;

  try {
    const { user } = await requireUser(request);
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin request");
    }

    await projectService.getAuthorized(id, user.id);

    const body = await parseJsonBody(request);
    if (!body) {
      throw new HttpError(400, "Invalid request body");
    }

    const limited = await enforceRateLimit(
      RATE_LIMITS.aiGeneration,
      user.id,
    );
    if (limited) return limited;

    const job = await generationService.createJob({
      projectId: id,

      type: typeof body.type === "string" ? body.type : "video.product_demo",

      category:
        typeof body.category === "string" &&
        CONTENT_CATEGORIES.includes(body.category as ContentCategory)
          ? (body.category as ContentCategory)
          : "video",

      instruction:
        typeof body.instruction === "string" ? body.instruction : undefined,

      platform: typeof body.platform === "string" ? body.platform : undefined,

      durationSeconds:
        typeof body.durationSeconds === "number"
          ? body.durationSeconds
          : undefined,

      aspectRatio:
        typeof body.aspectRatio === "string" ? body.aspectRatio : undefined,

      tone: typeof body.tone === "string" ? body.tone : undefined,

      creativeMode: isCreativeMode(body.creativeMode)
        ? (body.creativeMode.toLowerCase() as "balanced" | "guided" | "wild")
        : "balanced",

      language: typeof body.language === "string" ? body.language : "en",

      options:
        body.options !== null && typeof body.options === "object"
          ? (body.options as Record<string, unknown>)
          : undefined,
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
    // HttpError keeps its status and message; anything else is a 500 with a
    // generic body rather than the internal failure message.
    return wrapHttpError(error);
  }
}
