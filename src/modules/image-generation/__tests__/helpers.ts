import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ImageGenerationWorker } from "../generation-worker";
import { LocalImageStorage } from "../storage/image-storage";
import type { RenderWorkerHealth } from "../../video-rendering/worker-health";

export const TEST_DATABASE_URL =
  "postgresql://contentos:contentos@localhost:5433/content_os_test";
export const SESSION_COOKIE = "content_os_session";
export const BASE = "http://localhost";

export type Services = typeof import("../../../infrastructure/services");
export type Container = typeof import("../../../infrastructure/container");
export type Orm = Awaited<
  ReturnType<typeof loadImageTestContext>
>["orm"];

export async function loadImageTestContext() {
  process.env["DATABASE_URL"] = TEST_DATABASE_URL;

  const [dbModule, services, container] = await Promise.all([
    import("../../../prisma/db"),
    import("../../../infrastructure/services"),
    import("../../../infrastructure/container"),
  ]);

  return { orm: dbModule.db.orm.public, services, container };
}

export function uniqueEmail(prefix = "cp17"): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
}

export async function registerUser(
  services: Services,
  prefix = "cp17",
): Promise<
  Awaited<ReturnType<Services["authService"]["register"]>>
> {
  return services.authService.register({
    email: uniqueEmail(prefix),
    password: "test-password-1",
  });
}

export async function cleanupUser(
  orm: Orm,
  user: Awaited<ReturnType<Services["authService"]["register"]>>,
  projectId?: string,
): Promise<void> {
  if (projectId) {
    // Generated image rows cascade from the project, so this is the whole tree.
    await orm.Project.where({ id: projectId })
      .delete()
      .catch(() => undefined);
  }
  await orm.WorkspaceMember.where((row) => row.userId.eq(user.user.id))
    .delete()
    .catch(() => undefined);
  await orm.Session.where((row) => row.userId.eq(user.user.id))
    .delete()
    .catch(() => undefined);
  if (user.workspace) {
    await orm.Workspace.where({ id: user.workspace.id })
      .delete()
      .catch(() => undefined);
  }
  await orm.User.where({ id: user.user.id }).delete().catch(() => undefined);
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

export async function makeTempImageStorage(): Promise<{
  storage: LocalImageStorage;
  cleanup: () => Promise<void>;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "cp17-images-"));
  return {
    storage: new LocalImageStorage(root),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

/**
 * A worker backed by a throwaway storage root, so tests never touch the repo's
 * real image root. The source resolver keeps reading project assets from the
 * real provider store but reads generated sources from the same temp root.
 */
export function makeWorker(args: {
  services: Services;
  storage: LocalImageStorage;
  health?: RenderWorkerHealth;
}): ImageGenerationWorker {
  const { services, storage } = args;
  return new ImageGenerationWorker({
    repository: services.imageRepository,
    storage,
    sources: { ...services.imageSourceResolver, imageStorage: storage },
    health: args.health,
    pollIntervalMs: 5,
    cancelPollIntervalMs: 5,
    progressThrottleMs: 0,
  });
}

export const BRAND_BRIEF = [
  "# Northwind Analytics",
  "",
  "Northwind Analytics is the content operating system for regulated teams.",
  "",
  "## Voice",
  "",
  "Write in plain, direct sentences. Never say revolutionary.",
  "",
  "## Visual system",
  "",
  "Primary color: #1D4ED8",
  "Heading font: Sora",
  "Body font: Inter",
  "",
  "## Terminology",
  "",
  "Preferred term: single source of truth",
  "Avoid term: revolutionary",
].join("\n");

export const DIRECTION_BRIEF = [
  "# Northwind Analytics",
  "",
  "Northwind Analytics is a scheduling tool for engineering teams.",
  "",
  "## What it does",
  "",
  "Scheduled exports send a status report on a fixed schedule.",
  "",
  "## Who it is for",
  "",
  "Engineering leads who report progress to stakeholders every week.",
  "",
  "## Proof",
  "",
  "The product dashboard shows a next run time for every export.",
  "",
  "## Voice",
  "",
  "Plain and direct. Say single source of truth rather than revolutionary.",
].join("\n");

export async function createAnalyzedProject(
  services: Services,
): Promise<{
  owner: Awaited<ReturnType<Services["authService"]["register"]>>;
  projectId: string;
}> {
  const owner = await registerUser(services, "cp17-analyzed");
  const project = await services.projectService.createForWorkspace(
    owner.workspace!.id,
    { name: "CP17 analyzed project" },
    owner.user.id,
  );
  await services.inputService.createBatch(project.id, owner.user.id, [
    { type: "text", name: "Brand brief", value: BRAND_BRIEF },
  ]);
  await services.intelligenceService.analyze(project.id, owner.user.id, {});
  await services.brandService.analyze(project.id, owner.user.id);
  return { owner, projectId: project.id };
}

export type FullProjectContext = {
  owner: Awaited<ReturnType<Services["authService"]["register"]>>;
  projectId: string;
  intentId: string;
  directionId: string;
  storyboardId: string;
  sceneId: string;
};

export async function createFullProject(
  services: Services,
): Promise<FullProjectContext> {
  const owner = await registerUser(services, "cp17-full");
  const project = await services.projectService.createForWorkspace(
    owner.workspace!.id,
    { name: "CP17 full project" },
    owner.user.id,
  );

  await services.inputService.createBatch(project.id, owner.user.id, [
    { type: "text", name: "Product brief", value: DIRECTION_BRIEF },
  ]);

  const resolved = await services.contentIntentService.resolve({
    projectId: project.id,
    userId: owner.user.id,
    request:
      "Make a 30 second launch video for LinkedIn announcing our scheduling",
  });
  await services.intelligenceService.analyze(project.id, owner.user.id, {});
  await services.brandService.analyze(project.id, owner.user.id);

  const generated = await services.creativeDirectorService.generate({
    projectId: project.id,
    userId: owner.user.id,
    intentId: resolved.intent.id,
    mode: "BALANCED",
  });
  const directionId = generated.directions[0]!.id;
  await services.creativeDirectorService.select(
    project.id,
    owner.user.id,
    directionId,
  );

  const { storyboard } = await services.storyboardService.generate({
    projectId: project.id,
    userId: owner.user.id,
    intentId: resolved.intent.id,
    directionId,
  });

  return {
    owner,
    projectId: project.id,
    intentId: resolved.intent.id,
    directionId,
    storyboardId: storyboard.id,
    sceneId: storyboard.scenes[0]!.id,
  };
}
