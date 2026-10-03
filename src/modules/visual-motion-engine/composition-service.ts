import { createId } from "../../lib/id";
import { HttpError } from "../../lib/http";
import type { VisualRepository } from "../../core/ports/visual-repository";
import {
  COMPOSITION_LIMITS,
  validateCompositionInput,
} from "./domain/validation";
import type { VisualCompositionRecord } from "./domain/types";
import { shotContext } from "./integrations/content-context";
import { brandVisualDefaults, type BrandVisualDefaults } from "./integrations/brand-defaults";
import { evaluateScene } from "./motion/evaluate-scene";
import type { ResolvedFrame } from "./motion/resolve-frame";
import {
  buildRendererContract,
  buildRendererScene,
  type RendererContract,
  type RendererScene,
} from "./export/renderer-contract";
import { buildSceneGraph, type SceneGraph } from "./serialization/scene-graph";

export const COMPOSITION_DEFAULTS = {
  width: 1080,
  height: 1920,
  frameRate: 30,
  durationMs: 5000,
} as const;

export type VisualCompositionServiceDeps = {
  repository: VisualRepository;
  authorizeProject: (projectId: string, userId: string) => Promise<void>;
};

export type CreateCompositionArgs = {
  projectId: string;
  userId: string;
  name?: string | null;
  shotId?: string | null;
  width?: number;
  height?: number;
  frameRate?: number;
  durationMs?: number;
};

export class VisualCompositionService {
  private readonly repository: VisualRepository;
  private readonly authorizeProject: VisualCompositionServiceDeps["authorizeProject"];

  constructor(deps: VisualCompositionServiceDeps) {
    this.repository = deps.repository;
    this.authorizeProject = deps.authorizeProject;
  }

  async createComposition(
    args: CreateCompositionArgs,
  ): Promise<VisualCompositionRecord> {
    await this.authorizeProject(args.projectId, args.userId);

    let name = (args.name ?? "").trim();
    let durationMs = args.durationMs ?? COMPOSITION_DEFAULTS.durationMs;
    let shotId: string | null = null;

    if (args.shotId) {
      const context = await shotContext(args.projectId, args.shotId);

      if (!context) {
        throw new HttpError(400, "Shot does not belong to this project");
      }

      shotId = context.shotId;
      if (name.length === 0) name = context.name;
      if (args.durationMs === undefined && context.durationMs > 0) {
        durationMs = context.durationMs;
      }
    }

    if (name.length === 0) {
      name = "Untitled composition";
    }

    const input = {
      name,
      width: args.width ?? COMPOSITION_DEFAULTS.width,
      height: args.height ?? COMPOSITION_DEFAULTS.height,
      frameRate: args.frameRate ?? COMPOSITION_DEFAULTS.frameRate,
      durationMs,
    };

    validateCompositionInput(input);

    const now = new Date().toISOString();

    return this.repository.createComposition({
      id: createId("vcomp"),
      projectId: args.projectId,
      shotId,
      ...input,
      createdById: args.userId,
      createdAt: now,
      updatedAt: now,
    });
  }

  async listCompositions(args: {
    projectId: string;
    userId: string;
  }): Promise<VisualCompositionRecord[]> {
    await this.authorizeProject(args.projectId, args.userId);
    return this.repository.listCompositions(args.projectId);
  }

  async getComposition(args: {
    projectId: string;
    compositionId: string;
    userId: string;
  }): Promise<VisualCompositionRecord> {
    await this.authorizeProject(args.projectId, args.userId);

    const composition = await this.repository.getComposition(
      args.projectId,
      args.compositionId,
    );

    if (!composition) {
      // A composition in another project reads as missing rather than
      // forbidden: a 403 would confirm the id exists somewhere.
      throw new HttpError(404, "Composition not found");
    }

    return composition;
  }

  async updateComposition(args: {
    projectId: string;
    compositionId: string;
    userId: string;
    changes: {
      name?: string;
      width?: number;
      height?: number;
      frameRate?: number;
      durationMs?: number;
      shotId?: string | null;
      status?: VisualCompositionRecord["status"];
    };
  }): Promise<VisualCompositionRecord> {
    const existing = await this.getComposition(args);

    let shotId = existing.shotId;

    if (args.changes.shotId !== undefined && args.changes.shotId !== null) {
      const context = await shotContext(args.projectId, args.changes.shotId);

      if (!context) {
        throw new HttpError(400, "Shot does not belong to this project");
      }

      shotId = context.shotId;
    } else if (args.changes.shotId === null) {
      shotId = null;
    }

    const merged = {
      name: args.changes.name ?? existing.name,
      width: args.changes.width ?? existing.width,
      height: args.changes.height ?? existing.height,
      frameRate: args.changes.frameRate ?? existing.frameRate,
      durationMs: args.changes.durationMs ?? existing.durationMs,
    };

    validateCompositionInput(merged);

    return this.repository.updateComposition(
      args.projectId,
      args.compositionId,
      {
        ...args.changes,
        shotId,
        updatedAt: new Date().toISOString(),
      },
    );
  }

  async deleteComposition(args: {
    projectId: string;
    compositionId: string;
    userId: string;
  }): Promise<void> {
    await this.getComposition(args);
    await this.repository.deleteComposition(
      args.projectId,
      args.compositionId,
    );
  }

  async evaluateFrame(args: {
    projectId: string;
    compositionId: string;
    userId: string;
    timeMs: number;
  }): Promise<ResolvedFrame> {
    const composition = await this.getComposition(args);
    return evaluateScene(composition, args.timeMs);
  }

  async sceneGraph(args: {
    projectId: string;
    compositionId: string;
    userId: string;
  }): Promise<SceneGraph> {
    return buildSceneGraph(await this.getComposition(args));
  }

  async rendererScene(args: {
    projectId: string;
    compositionId: string;
    userId: string;
    timeMs: number;
  }): Promise<RendererScene> {
    const composition = await this.getComposition(args);
    return buildRendererScene(composition, args.timeMs);
  }

  async rendererContract(args: {
    projectId: string;
    compositionId: string;
    userId: string;
  }): Promise<RendererContract> {
    const composition = await this.getComposition(args);
    return buildRendererContract(composition);
  }

  async visualDefaults(args: {
    projectId: string;
    userId: string;
  }): Promise<BrandVisualDefaults> {
    await this.authorizeProject(args.projectId, args.userId);
    return brandVisualDefaults(args.projectId);
  }
}

export { COMPOSITION_LIMITS };
