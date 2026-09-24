import { projectService } from "../../../infrastructure/services";
import { requireUser } from "../../../lib/require-auth";
import { wrapHttpError } from "../../../lib/http";

export async function GET(request: Request) {
  try {
    const { user } = await requireUser(request);

    const projects = await projectService.listForUser(user.id);

    return Response.json({ projects });
  } catch (error) {
    return wrapHttpError(error);
  }
}