import { workspaceService } from "../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../lib/require-auth";
import {
  parseJsonBody,
  wrapHttpError,
} from "../../../../../../lib/http";
import type { WorkspaceRole } from "../../../../../../core/domain/auth";

const ROLES: WorkspaceRole[] = ["OWNER", "ADMIN", "MEMBER"];

type MemberRouteContext = {
  params: Promise<{ id: string; userId: string }>;
};

export async function PATCH(
  request: Request,
  context: MemberRouteContext,
) {
  try {
    const { user } = await requireUser(request);

    const { id, userId } = await context.params;

    const body = await parseJsonBody(request);

    if (!body || !ROLES.includes(body.role as WorkspaceRole)) {
      return wrapHttpError(
        new Error("A valid role is required"),
      );
    }

    const member = await workspaceService.updateMemberRole(
      id,
      user.id,
      userId,
      body.role as WorkspaceRole,
    );

    return Response.json({ member });
  } catch (error) {
    return wrapHttpError(error);
  }
}

export async function DELETE(
  request: Request,
  context: MemberRouteContext,
) {
  try {
    const { user } = await requireUser(request);

    const { id, userId } = await context.params;

    await workspaceService.removeMember(id, user.id, userId);

    return Response.json({ ok: true });
  } catch (error) {
    return wrapHttpError(error);
  }
}