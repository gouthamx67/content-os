import {
  authenticateRequest,
} from "../../../../lib/require-auth";
import { jsonError } from "../../../../lib/http";

export async function GET(request: Request) {
  const authenticated = await authenticateRequest(request);

  if (!authenticated) {
    return jsonError(401, "Authentication required");
  }

  return Response.json({ user: authenticated.user });
}