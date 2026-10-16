export const TEST_DATABASE_URL =
  "postgresql://contentos:contentos@localhost:5433/content_os_test";
export const SESSION_COOKIE = "content_os_session";
export const BASE = "http://localhost";

export type Services = typeof import("../../../infrastructure/services");
export type Orm = Awaited<
  ReturnType<typeof loadLocalizationTestContext>
>["orm"];

export async function loadLocalizationTestContext() {
  process.env["DATABASE_URL"] = TEST_DATABASE_URL;

  const [dbModule, services] = await Promise.all([
    import("../../../prisma/db"),
    import("../../../infrastructure/services"),
  ]);

  return { orm: dbModule.db.orm.public, services };
}

export function uniqueEmail(prefix = "cp22"): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
}

export type Owner = Awaited<ReturnType<Services["authService"]["register"]>>;

export async function registerUser(
  services: Services,
  prefix = "cp22",
): Promise<Owner> {
  return services.authService.register({
    email: uniqueEmail(prefix),
    password: "test-password-1",
  });
}

export async function createProject(
  services: Services,
  owner: Owner,
  name: string,
): Promise<string> {
  const project = await services.projectService.createForWorkspace(
    owner.workspace!.id,
    { name },
    owner.user.id,
  );
  return project.id;
}

export function cookieFor(token: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}`;
}

export function request(
  url: string,
  init: RequestInit & { cookie?: string; origin?: string } = {},
): Request {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set("cookie", init.cookie);
  if (init.origin) headers.set("origin", init.origin);
  return new Request(url, { ...init, headers });
}

/**
 * A real CP18 writing document owned by the named project.
 *
 * Localization reads the source through the writing repository, so a document
 * that belongs to another project must resolve to nothing. The helper never
 * copies bytes — it creates the row the adapter reads.
 */
export async function createWritingDocument(
  orm: Orm,
  args: {
    projectId: string;
    userId: string;
    title?: string;
    content?: string;
    version?: number;
  },
): Promise<string> {
  const documentId = `wdoc-${Math.random().toString(36).slice(2, 10)}`;
  const content = args.content ?? "First paragraph.\n\nSecond paragraph.";
  const { createHash } = await import("node:crypto");
  const sha = (value: string) =>
    createHash("sha256").update(value).digest("hex");

  await orm.WritingDocument.create({
    id: documentId,
    projectId: args.projectId,
    createdById: args.userId,
    title: args.title ?? "Launch headline",
    blockType: "BODY",
    tone: "BRAND",
    length: "MEDIUM",
    objective: "AWARENESS",
    audience: "Launch audience",
    language: "en",
    content,
    contentSha256: sha(content),
    contextSnapshot: "{}",
    contextSha256: sha("{}"),
    version: args.version ?? 1,
  });

  return documentId;
}

export async function cleanupProject(
  orm: Orm,
  owner: Owner,
  projectId: string,
): Promise<void> {
  await orm.Project.where({ id: projectId }).delete().catch(() => undefined);
}

export async function cleanupOwner(orm: Orm, owner: Owner): Promise<void> {
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
