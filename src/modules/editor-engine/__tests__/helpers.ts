import { createId } from "../../../lib/id";
import type { EditorNode } from "../domain/types";
import { emptyStyle } from "../domain/types";

export const TEST_DATABASE_URL =
  "postgresql://contentos:contentos@localhost:5433/content_os_test";
export const SESSION_COOKIE = "content_os_session";
export const BASE = "http://localhost";

/** The `Cookie` header a real browser would send for a session token. */
export function cookieFor(token: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}`;
}

/** Builds a `Request` the route handlers accept, with cookie/origin helpers. */
export function request(
  url: string,
  init: RequestInit & { cookie?: string; origin?: string } = {},
): Request {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set("cookie", init.cookie);
  if (init.origin) headers.set("origin", init.origin);
  return new Request(url, { ...init, headers });
}

export type Services = typeof import("../../../infrastructure/services");
export type Orm = Awaited<ReturnType<typeof loadEditorTestContext>>["orm"];

export async function loadEditorTestContext() {
  process.env["DATABASE_URL"] = TEST_DATABASE_URL;

  const [dbModule, services] = await Promise.all([
    import("../../../prisma/db"),
    import("../../../infrastructure/services"),
  ]);

  return { orm: dbModule.db.orm.public, services };
}

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
}

export async function createEditorProject(
  services: Services,
  prefix = "cp20",
): Promise<{
  owner: Awaited<ReturnType<Services["authService"]["register"]>>;
  projectId: string;
}> {
  const user = await services.authService.register({
    email: uniqueEmail(prefix),
    password: "test-password-1",
  });

  const project = await services.projectService.createForWorkspace(
    user.workspace!.id,
    { name: "CP20 project" },
    user.user.id,
  );

  return { owner: user, projectId: project.id };
}

/** Removes the whole tree a test created, so the suite leaves nothing behind. */
export async function cleanupEditorProject(
  orm: Orm,
  owner: Awaited<ReturnType<Services["authService"]["register"]>>,
  projectId: string,
): Promise<void> {
  await orm.Project.where({ id: projectId }).delete().catch(() => undefined);
  await orm.WorkspaceMember.where((row) => row.userId.eq(owner.user.id))
    .delete()
    .catch(() => undefined);
  await orm.Session.where((row) => row.userId.eq(owner.user.id))
    .delete()
    .catch(() => undefined);
  if (owner.workspace) {
    await orm.Workspace.where({ id: owner.workspace.id })
      .delete()
      .catch(() => undefined);
  }
  await orm.User.where({ id: owner.user.id }).delete().catch(() => undefined);
}

export function textNode(overrides: Partial<EditorNode> & { id?: string } = {}) {
  return {
    id: overrides.id ?? createId("enode"),
    parentId: null,
    type: "TEXT",
    name: "Headline",
    zIndex: 0,
    transform: { x: 40, y: 80, width: 900, height: 200, rotation: 0, opacity: 1 },
    visible: true,
    asset: null,
    text: { value: "Draft headline" },
    style: emptyStyle(),
    trim: null,
    audio: null,
    shape: null,
    motion: null,
    effects: [],
    automation: [],
    provenance: null,
    ...overrides,
  } satisfies EditorNode;
}

export function imageNode(id?: string): EditorNode {
  return textNode({
    id: id ?? createId("enode"),
    type: "IMAGE",
    name: "Backdrop",
    zIndex: 1,
    text: null,
    asset: {
      ref: "generated:img-cp20",
      assetId: "img-cp20",
      kind: "IMAGE",
      origin: "GENERATED_IMAGE",
      sourceType: "GENERATED_IMAGE",
      sourceId: "img-cp20",
      mimeType: "image/png",
      byteSize: 4_096,
      width: 1_920,
      height: 1_080,
      durationMs: null,
    },
  });
}
