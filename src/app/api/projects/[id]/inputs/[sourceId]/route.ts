import { inputService } from "../../../../../../infrastructure/services";
import { HttpError, isSameOrigin } from "../../../../../../lib/http";
import { serializeInput, wrapInputHttpError } from "../../../../../../lib/input-api";
import { requireUser } from "../../../../../../lib/require-auth";

type InputRouteContext = {
  params: Promise<{ id: string; sourceId: string }>;
};

export async function GET(request: Request, context: InputRouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id, sourceId } = await context.params;
    const source = await inputService.getInput(id, user.id, sourceId);
    return Response.json({ input: serializeInput(source) });
  } catch (error) {
    return wrapInputHttpError(error);
  }
}

export async function DELETE(request: Request, context: InputRouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }
    const { user } = await requireUser(request);
    const { id, sourceId } = await context.params;
    await inputService.deleteInput(id, user.id, sourceId);
    return Response.json({ ok: true });
  } catch (error) {
    return wrapInputHttpError(error);
  }
}
