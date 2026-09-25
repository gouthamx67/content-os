import { inputService } from "../../../../../infrastructure/services";
import { HttpError, isSameOrigin } from "../../../../../lib/http";
import {
  parseInputRequest,
  serializeInput,
  wrapInputHttpError,
} from "../../../../../lib/input-api";
import { requireUser } from "../../../../../lib/require-auth";

export const maxDuration = 60;

type InputsRouteContext = {
  params: Promise<{ id: string }>;
};

function serializeBundle(bundle: Awaited<ReturnType<typeof inputService.getBundle>>) {
  return {
    inputs: bundle.inputs.map(serializeInput),
    versions: bundle.versions,
    unversioned: bundle.unversioned.map(serializeInput),
  };
}

export async function GET(request: Request, context: InputsRouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id } = await context.params;
    const bundle = await inputService.getBundle(id, user.id);
    return Response.json(serializeBundle(bundle));
  } catch (error) {
    return wrapInputHttpError(error);
  }
}

export async function POST(request: Request, context: InputsRouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }
    const { user } = await requireUser(request);
    const { id } = await context.params;
    await inputService.authorize(id, user.id);
    const rawInputs = await parseInputRequest(request);
    const bundle = await inputService.createBatch(id, user.id, rawInputs, request.signal);
    return Response.json(serializeBundle(bundle), { status: 201 });
  } catch (error) {
    return wrapInputHttpError(error);
  }
}
