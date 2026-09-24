import { workspaceService } from "../../../../../infrastructure/services";
import { requireUser } from "../../../../../lib/require-auth";
import {
  parseJsonBody,
  wrapHttpError,
} from "../../../../../lib/http";
import type { WorkspaceRole } from "../../../../../core/domain/auth";

const ROLES: WorkspaceRole[] = ["OWNER", "ADMIN", "MEMBER"];

type MembersRouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(
  request: Request,
  context: MembersRouteContext,
) {
  try {
    const { user } = await requireUser(request);

    const { id } = await context.params;

    const members = await workspaceService.listMembers(
      id,
      user.id,
    );

    return Response.json({ members });
  } catch (error) {
    return wrapHttpError(error);
  }
}

export async function POST(
  request: Request,
  context: MembersRouteContext,
) {
  try {
    const { user } = await requireUser(request);

    const { id } = await context.params;

    const body = await parseJsonBody(request);

    if (!body) {
      return wrapHttpError(
        new Error("Invalid request body"),
      );
    }

    const role = ROLES.includes(body.role as WorkspaceRole)
      ? (body.role as WorkspaceRole)
      : "MEMBER";

    const member = await workspaceService.addMember(
      id,
      user.id,
      {
        userId: String(body.userId ?? ""),
        role,
      },
    );

    return Response.json({ member }, { status: 201 });
  } catch (error) {
    return wrapHttpError(error);
  }
}