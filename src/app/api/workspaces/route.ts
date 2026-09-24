import { workspaceService } from "../../../infrastructure/services";
import { requireUser } from "../../../lib/require-auth";
import {
  parseJsonBody,
  wrapHttpError,
} from "../../../lib/http";

export async function GET(request: Request) {
  try {
    const { user } = await requireUser(request);

    const workspaces = await workspaceService.listForUser(
      user.id,
    );

    return Response.json({ workspaces });
  } catch (error) {
    return wrapHttpError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { user } = await requireUser(request);

    const body = await parseJsonBody(request);

    const workspace = await workspaceService.create(user.id, {
      name: typeof body?.name === "string" ? body.name : "",
    });

    return Response.json({ workspace }, { status: 201 });
  } catch (error) {
    return wrapHttpError(error);
  }
}