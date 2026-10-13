import { createHash } from "node:crypto";
import type { AdaptationWorker } from "../adaptation-worker";

export const TEST_DATABASE_URL =
  "postgresql://contentos:contentos@localhost:5433/content_os_test";
export const SESSION_COOKIE = "content_os_session";
export const BASE = "http://localhost";

export type Services = typeof import("../../../infrastructure/services");
export type Container = typeof import("../../../infrastructure/container");
export type Orm = Awaited<ReturnType<typeof loadAdaptationTestContext>>["orm"];

export async function loadAdaptationTestContext() {
  process.env["DATABASE_URL"] = TEST_DATABASE_URL;

  const [dbModule, services, container] = await Promise.all([
    import("../../../prisma/db"),
    import("../../../infrastructure/services"),
    import("../../../infrastructure/container"),
  ]);

  return { orm: dbModule.db.orm.public, services, container };
}

export function uniqueEmail(prefix = "cp19"): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
}

export async function registerUser(
  services: Services,
  prefix = "cp19",
): Promise<Awaited<ReturnType<Services["authService"]["register"]>>> {
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
    // Adaptation rows cascade from the project, so this is the whole tree.
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

export async function createProject(
  services: Services,
  prefix = "cp19",
): Promise<{
  owner: Awaited<ReturnType<Services["authService"]["register"]>>;
  projectId: string;
}> {
  const owner = await registerUser(services, prefix);
  const project = await services.projectService.createForWorkspace(
    owner.workspace!.id,
    { name: "CP19 project" },
    owner.user.id,
  );

  return { owner, projectId: project.id };
}

const SAMPLE_TEXT = [
  "Northwind Analytics is the content operating system for regulated teams.",
  "It keeps every claim traceable to the source that supports it.",
  "Exports run on a schedule, so a status report is never a manual chore.",
  "Editors approve what ships without waiting on an engineer.",
].join(" ");

/**
 * A writing document with one ready variant and two claims.
 *
 * Claims are created directly rather than through generation so a test can state
 * exactly which sources a caption is grounded in, which is what the copy
 * provenance rules are actually about.
 */
export async function createWritingSource(
  orm: Orm,
  services: Services,
  args: { projectId: string; userId: string },
): Promise<{ documentId: string; variantId: string; sourceIds: string[] }> {
  const documentId = `wdoc-${Math.random().toString(36).slice(2, 10)}`;
  const variantId = `wvar-${Math.random().toString(36).slice(2, 10)}`;
  const sourceIds = [
    `src-${Math.random().toString(36).slice(2, 10)}`,
    `src-${Math.random().toString(36).slice(2, 10)}`,
  ];
  const now = new Date().toISOString();

  await orm.WritingDocument.create({
    id: documentId,
    projectId: args.projectId,
    title: "CP19 writing source",
    blockType: "CAPTION",
    tone: "BRAND",
    length: "MEDIUM",
    objective: "AWARENESS",
    audience: "Regulated teams",
    language: "en",
    content: SAMPLE_TEXT,
    contentSha256: sha256(SAMPLE_TEXT),
    contextSha256: sha256("ctx"),
    contextSnapshot: "{}",
    version: 1,
    brandVersion: 1,
    intelligenceVersion: 1,
    createdById: args.userId,
    createdAt: now,
    updatedAt: now,
  });

  await orm.WritingVariant.create({
    id: variantId,
    documentId,
    ordinal: 0,
    label: "Caption A",
    text: SAMPLE_TEXT,
    textSha256: sha256(SAMPLE_TEXT),
    instruction: null,
    selected: true,
    createdAt: now,
    updatedAt: now,
  });

  await orm.WritingClaim.create({
    id: `wcl-${Math.random().toString(36).slice(2, 10)}`,
    projectId: args.projectId,
    documentId,
    variantId,
    text: "Northwind Analytics is the content operating system for regulated teams.",
    status: "GROUNDED",
    sourceIds: [sourceIds[0]!],
    reasoning: "Stated in the product brief.",
    createdAt: now,
  });

  await orm.WritingClaim.create({
    id: `wcl-${Math.random().toString(36).slice(2, 10)}`,
    projectId: args.projectId,
    documentId,
    variantId,
    text: "Editors approve what ships without waiting on an engineer.",
    status: "GROUNDED",
    sourceIds: [sourceIds[1]!],
    reasoning: "Stated in the product brief.",
    createdAt: now,
  });

  void services;

  return { documentId, variantId, sourceIds };
}

/** A real generated-image asset with real PNG bytes on CP17's storage. */
export async function createImageSource(
  services: Services,
  args: { projectId: string; userId: string },
  options: { width: number; height: number; transparent?: boolean },
): Promise<{ assetId: string; storageKey: string; bytes: Buffer }> {
  const sharp = (await import("sharp")).default;
  const { imageStorage } = await import(
    "../../image-generation/storage/image-storage"
  );

  const channel = options.transparent
    ? { r: 255, g: 255, b: 255, alpha: 0.25 }
    : { r: 32, g: 96, b: 160, alpha: 1 };

  const bytes = await sharp({
    create: {
      width: options.width,
      height: options.height,
      channels: 4,
      background: channel,
    },
  })
    .png()
    .toBuffer();

  const ownerId = `owner-${Math.random().toString(36).slice(2, 10)}`;
  const storageKey = [
    args.projectId,
    ownerId,
    `source-${Math.random().toString(36).slice(2, 10)}.png`,
  ].join("/");

  await imageStorage.putBytes(storageKey, bytes);

  const asset = await services.imageRepository.createAsset({
    id: `img-${Math.random().toString(36).slice(2, 10)}`,
    projectId: args.projectId,
    generationJobId: null,
    graphicDocumentId: null,
    storageKey,
    mimeType: "image/png",
    outputFormat: "PNG",
    width: options.width,
    height: options.height,
    byteSize: bytes.byteLength,
    checksumSha256: sha256(bytes),
    transparent: options.transparent ?? false,
    metadata: null,
    createdAt: new Date().toISOString(),
  });

  return { assetId: asset.id, storageKey, bytes };
}

/**
 * A composition with one image layer, so a video adaptation has something real to
 * re-frame.
 */
export async function createCompositionSource(
  services: Services,
  args: { projectId: string; userId: string },
  options: { width?: number; height?: number } = {},
): Promise<{ compositionId: string }> {
  const width = options.width ?? 1920;
  const height = options.height ?? 1080;

  const composition = await services.visualCompositionService.createComposition({
    projectId: args.projectId,
    userId: args.userId,
    name: "CP19 source composition",
    width,
    height,
    frameRate: 30,
    durationMs: 1000,
  });

  await services.visualLayerService.addLayer({
    projectId: args.projectId,
    userId: args.userId,
    compositionId: composition.id,
    name: "Backdrop",
    type: "SHAPE",
    assetRef: null,
    textContent: null,
    x: 0,
    y: 0,
    width,
    height,
    rotation: 0,
    opacity: 1,
    fit: "COVER",
    cropX: 0,
    cropY: 0,
    cropWidth: null,
    cropHeight: null,
    zIndex: 0,
    visible: true,
  });

  return { compositionId: composition.id };
}

/** A worker with the production wiring, driven one step at a time by the test. */
export function makeWorker(container: Container): AdaptationWorker {
  return container.createAdaptationWorker();
}

export async function drain(worker: AdaptationWorker): Promise<void> {
  for (let guard = 0; guard < 50; guard += 1) {
    const result = await worker.runOnce(4);
    if (result.processed === 0) return;
  }

  throw new Error("adaptation queue did not drain");
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export { sha256 };
