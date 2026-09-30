import type {
  UserRepository,
  CreateUserInput,
} from "../core/ports/user-repository";
import type {
  SessionRepository,
  CreateSessionInput,
} from "../core/ports/session-repository";
import type {
  WorkspaceRepository,
  CreateWorkspaceWithOwnerInput,
} from "../core/ports/workspace-repository";
import type {
  DatabasePort,
  TransactionContext,
} from "../core/ports/database";
import type {
  CreativeDirectionRepository,
  ListCreativeDirectionsOptions,
} from "../core/ports/creative-direction-repository";
import type {
  CreativeDirection,
  CreativeDirectionStatus,
  CreateCreativeDirectionInput,
  CreativeMode,
} from "../core/domain/creative-direction";
import type {
  CreativeContext,
  CreativeContextAsset,
  CreativeContextBrand,
  CreativeContextEvidence,
  CreativeContextIntent,
  CreativeContextProduct,
} from "../core/domain/creative-context";
import { getCreativeModePolicy } from "../core/services/creative-mode-policy";
import type { User, Session } from "../core/domain/auth";
import type { WorkspaceRole } from "../core/domain/auth";
import type {
  Workspace,
  WorkspaceMember,
} from "../core/domain/workspace";
import type {
  CreateStoryboardInput,
  Storyboard,
  UpdateStoryboardInput,
} from "../core/domain/storyboard";
import type {
  ListStoryboardsOptions,
  StoryboardRepository,
} from "../core/ports/storyboard-repository";
import type {
  StoryboardContext,
  StoryboardContextBrowserCapture,
  StoryboardContextDirection,
  StoryboardContextFeature,
  StoryboardContextRequirements,
  StoryboardContextWorkflow,
} from "../core/domain/storyboard-context";
import { planStoryboard } from "../core/services/deterministic-storyboard-planner";
import { createId } from "../lib/id";

export class FakeUserRepository implements UserRepository {
  users = new Map<string, User>();

  async create(input: CreateUserInput): Promise<User> {
    const now = new Date().toISOString();

    const user: User = {
      id: input.id,
      email: input.email,
      passwordHash: input.passwordHash,
      createdAt: now,
      updatedAt: now,
    };

    this.users.set(user.id, user);

    return user;
  }

  async getById(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async findByEmail(email: string): Promise<User | null> {
    for (const user of this.users.values()) {
      if (user.email === email) {
        return user;
      }
    }

    return null;
  }
}

export class FakeSessionRepository
  implements SessionRepository
{
  sessions = new Map<string, Session>();

  async create(input: CreateSessionInput): Promise<Session> {
    const session: Session = {
      id: input.id,
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      createdAt: new Date().toISOString(),
    };

    this.sessions.set(session.id, session);

    return session;
  }

  async findByTokenHash(
    tokenHash: string,
  ): Promise<Session | null> {
    for (const session of this.sessions.values()) {
      if (session.tokenHash === tokenHash) {
        return session;
      }
    }

    return null;
  }

  async deleteById(id: string): Promise<void> {
    this.sessions.delete(id);
  }

  async deleteByUserId(userId: string): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.userId === userId) {
        this.sessions.delete(session.id);
      }
    }
  }
}

export class FakeWorkspaceRepository
  implements WorkspaceRepository
{
  workspaces = new Map<string, Workspace>();

  members = new Map<string, WorkspaceMember>();

  async create(input: {
    id: string;
    name: string;
  }): Promise<Workspace> {
    const now = new Date().toISOString();

    const workspace: Workspace = {
      id: input.id,
      name: input.name,
      createdAt: now,
      updatedAt: now,
    };

    this.workspaces.set(workspace.id, workspace);

    return workspace;
  }

  async createWithOwner(
    input: CreateWorkspaceWithOwnerInput,
  ): Promise<Workspace> {
    const workspace = await this.create({
      id: input.workspaceId,
      name: input.name,
    });

    await this.addMember({
      id: input.memberId,
      workspaceId: input.workspaceId,
      userId: input.ownerUserId,
      role: "OWNER",
    });

    return workspace;
  }

  async getById(id: string): Promise<Workspace | null> {
    return this.workspaces.get(id) ?? null;
  }

  async memberCount(workspaceId: string): Promise<number> {
    let count = 0;

    for (const member of this.members.values()) {
      if (member.workspaceId === workspaceId) {
        count += 1;
      }
    }

    return count;
  }

  async listForUser(userId: string): Promise<WorkspaceMember[]> {
    return Array.from(this.members.values())
      .filter((member) => member.userId === userId)
      .sort(
        (a, b) => b.createdAt.localeCompare(a.createdAt),
      );
  }

  async getMembership(
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceMember | null> {
    for (const member of this.members.values()) {
      if (
        member.workspaceId === workspaceId &&
        member.userId === userId
      ) {
        return member;
      }
    }

    return null;
  }

  async listMembers(
    workspaceId: string,
  ): Promise<WorkspaceMember[]> {
    return Array.from(this.members.values())
      .filter((member) => member.workspaceId === workspaceId)
      .sort(
        (a, b) => b.createdAt.localeCompare(a.createdAt),
      );
  }

  async addMember(input: {
    id: string;
    workspaceId: string;
    userId: string;
    role: WorkspaceRole;
  }): Promise<WorkspaceMember> {
    const member: WorkspaceMember = {
      ...input,
      createdAt: new Date().toISOString(),
    };

    this.members.set(member.id, member);

    return member;
  }

  async updateMemberRole(
    workspaceId: string,
    userId: string,
    role: WorkspaceRole,
  ): Promise<WorkspaceMember> {
    for (const member of this.members.values()) {
      if (
        member.workspaceId === workspaceId &&
        member.userId === userId
      ) {
        member.role = role;

        return member;
      }
    }

    throw new Error("Workspace member not found");
  }

  async removeMember(
    workspaceId: string,
    userId: string,
  ): Promise<void> {
    for (const member of this.members.values()) {
      if (
        member.workspaceId === workspaceId &&
        member.userId === userId
      ) {
        this.members.delete(member.id);
      }
    }
  }
}

export class FakeDatabase implements DatabasePort {
  constructor(
    readonly users: FakeUserRepository,
    readonly sessions: FakeSessionRepository,
    readonly workspaces: FakeWorkspaceRepository,
  ) {}

  async transaction<T>(
    work: (tx: TransactionContext) => Promise<T>,
  ): Promise<T> {
    const context: TransactionContext = {
      users: this.users,
      sessions: this.sessions,
      workspaces: this.workspaces,
    };

    return work(context);
  }
}

export function createFakeContext() {
  const users = new FakeUserRepository();

  const sessions = new FakeSessionRepository();

  const workspaces = new FakeWorkspaceRepository();

  const database = new FakeDatabase(users, sessions, workspaces);

  return { users, sessions, workspaces, database };
}

export function isValidIdPrefix(
  id: string,
  prefix: string,
): boolean {
  return id.startsWith(`${prefix}_`);
}

export function futureIso(days: number): string {
  return new Date(
    Date.now() + days * 24 * 60 * 60 * 1000,
  ).toISOString();
}

export function pastIso(days: number): string {
  return new Date(
    Date.now() - days * 24 * 60 * 60 * 1000,
  ).toISOString();
}

export function makeUserId(): string {
  return createId("user");
}

export function makeSessionId(): string {
  return createId("session");
}

export function makeWorkspaceId(): string {
  return createId("workspace");
}

export function makeProjectId(): string {
  return createId("project");
}
/**
 * An in-memory creative direction store. It keeps the one rule the SQL
 * repository enforces in a single statement - only one selected direction per
 * intent - so a service test that passes here is a real behaviour and not an
 * artefact of the fake.
 */
export class FakeCreativeDirectionRepository
  implements CreativeDirectionRepository
{
  directions = new Map<string, CreativeDirection>();

  async create(input: CreateCreativeDirectionInput): Promise<CreativeDirection> {
    const now = new Date().toISOString();
    const direction: CreativeDirection = {
      ...input,
      id: input.id ?? createId("cdir"),
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
    };
    this.directions.set(direction.id, direction);
    return direction;
  }

  async getById(id: string): Promise<CreativeDirection | null> {
    return this.directions.get(id) ?? null;
  }

  async listByProject(
    projectId: string,
    options: ListCreativeDirectionsOptions = {},
  ): Promise<CreativeDirection[]> {
    return [...this.directions.values()]
      .filter((direction) => direction.projectId === projectId)
      .filter((direction) =>
        options.intentId ? direction.intentId === options.intentId : true,
      )
      .filter((direction) =>
        options.status ? direction.status === options.status : true,
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, options.limit ?? Number.MAX_SAFE_INTEGER);
  }

  async listByIntent(intentId: string): Promise<CreativeDirection[]> {
    return [...this.directions.values()]
      .filter((direction) => direction.intentId === intentId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async listByRun(creativeRunId: string): Promise<CreativeDirection[]> {
    return [...this.directions.values()].filter(
      (direction) => direction.creativeRunId === creativeRunId,
    );
  }

  async update(
    id: string,
    patch: Partial<CreativeDirection>,
  ): Promise<CreativeDirection | null> {
    const current = this.directions.get(id);
    if (!current) return null;
    const updated: CreativeDirection = { ...current, ...patch, id };
    this.directions.set(id, updated);
    return updated;
  }

  async setStatus(
    id: string,
    status: CreativeDirectionStatus,
    updatedAt: string,
  ): Promise<CreativeDirection | null> {
    return this.update(id, { status, updatedAt });
  }

  async selectForIntent(
    id: string,
    updatedAt: string,
  ): Promise<{ selected: CreativeDirection; demoted: CreativeDirection[] } | null> {
    const target = this.directions.get(id);
    if (!target) return null;

    const demoted: CreativeDirection[] = [];
    for (const direction of this.directions.values()) {
      if (
        direction.intentId === target.intentId &&
        direction.status === "SELECTED" &&
        direction.id !== id
      ) {
        demoted.push({ ...direction, status: "DRAFT", updatedAt });
        direction.status = "DRAFT";
        direction.updatedAt = updatedAt;
      }
    }

    target.status = "SELECTED";
    target.updatedAt = updatedAt;
    this.directions.set(id, target);
    return { selected: { ...target }, demoted };
  }

  async listUserEditedForIntent(
    intentId: string,
  ): Promise<CreativeDirection[]> {
    return [...this.directions.values()].filter(
      (direction) => direction.intentId === intentId && direction.editedByUser,
    );
  }
}

/**
 * A context with real-looking product material, so tests exercise the grounding
 * rules rather than an empty project that would pass by default.
 */
export function makeCreativeContext(
  overrides: {
    mode?: CreativeMode;
    assets?: CreativeContextAsset[];
    evidence?: CreativeContextEvidence[];
    claims?: CreativeContextProduct["claims"];
    features?: CreativeContextProduct["features"];
    problems?: CreativeContextProduct["problems"];
    benefits?: CreativeContextProduct["benefits"];
    brand?: Partial<CreativeContextBrand>;
    intent?: Partial<CreativeContextIntent>;
  } = {},
): CreativeContext {
  const mode = overrides.mode ?? "BALANCED";
  const evidence: CreativeContextEvidence[] = overrides.evidence ?? [
    {
      id: "ev_1",
      kind: "SOURCE_FRAGMENT",
      locator: "README.md#features",
      snippet: "Exports run on a schedule.",
      claimIds: ["cl_1"],
    },
  ];
  const claims: CreativeContextProduct["claims"] = overrides.claims ?? [
    {
      id: "cl_1",
      text: "Exports run on a schedule",
      verification: "SUPPORTED",
      evidenceIds: ["ev_1"],
    },
  ];

  return {
    projectId: "prj_1",
    intentId: "int_1",
    intent: {
      channel: "VIDEO",
      contentTypeName: "Product launch video",
      purpose: "Announce the product",
      audience: "engineering leads",
      tone: "direct",
      style: null,
      language: "en",
      cta: "Start free trial",
      durationSeconds: 30,
      quantity: 1,
      aspectRatio: "16:9",
      platforms: ["linkedin"],
      rawRequest: "Make a 30 second launch video for LinkedIn",
      subjects: [{ type: "PRODUCT", id: "prod_1" }],
      constraints: ["duration: 30"],
      ...overrides.intent,
    },
    product: {
      name: "Loomly",
      description: "A scheduling tool for teams",
      valueProposition: "Ship updates without chasing people",
      features: overrides.features ?? [
        { id: "ft_1", name: "Scheduled exports", description: "Reports send themselves" },
      ],
      problems: overrides.problems ?? [
        { id: "pb_1", description: "Chasing people for status eats a morning" },
      ],
      benefits: overrides.benefits ?? [
        { id: "bn_1", description: "A status update that arrives on its own" },
      ],
      workflows: [
        {
          id: "wf_1",
          name: "Weekly status report",
          steps: ["Pick a template", "Schedule the export", "Send to the team"],
        },
      ],
      claims,
      audienceSummary: "engineering leads at small teams",
    },
    brand: {
      name: "Loomly",
      summary: "Calm, precise, unfussy",
      tone: ["direct", "unfussy"],
      style: ["flat"],
      ctaStyle: null,
      executionSummary: "Plain and direct, no hype",
      version: 3,
      ...overrides.brand,
    },
    assets: overrides.assets ?? [
      {
        id: "as_1",
        name: "Schedule screen",
        type: "PRODUCT_UI",
        role: "PRODUCT_UI",
        isProductUi: true,
        origin: "INTELLIGENCE",
      },
    ],
    evidence,
    mode,
    policy: getCreativeModePolicy(mode),
    brandVersion: 3,
    intelligenceVersion: 7,
  };
}

export function makeCreativeDirection(
  overrides: Partial<CreativeDirection> = {},
): CreativeDirection {
  const now = new Date().toISOString();
  return {
    id: createId("cdir"),
    projectId: "prj_1",
    intentId: "int_1",
    creativeRunId: "crun_1",
    mode: "BALANCED",
    status: "DRAFT",
    angle: "PROBLEM_SOLUTION",
    name: "The problem, then the way out",
    thesis: "Chasing people for status eats a morning, and scheduling removes the chase.",
    hook: {
      statement: "Chasing people for status eats a morning",
      mechanism: "Open on a concrete moment from the problem",
      emotionalTrigger: "The discomfort of recognising your own situation",
    },
    audienceAngle: "For engineering leads who deal with this every week",
    emotionalAngle: "Relief, earned by being understood first",
    narrativeSummary:
      "The problem is shown honestly, then the scheduled export appears as the way out.",
    visualStrategy: {
      approach: "Sit with the problem, then cut to the schedule screen",
      rationale: "A problem shown as a lived moment makes the turn feel earned",
      productMoments: ["The schedule screen with an export queued"],
      assetIds: ["as_1"],
    },
    proofStrategy: {
      claimIds: ["cl_1"],
      evidenceIds: ["ev_1"],
      proofPoints: ["Show the queued export rather than repeating the claim"],
    },
    voiceDirection: "Plain and direct, no hype",
    musicDirection: "Low and sustained",
    soundDirection: "Real interface sound",
    cta: "Start free trial",
    rationale: "The project records the problem and the feature that answers it",
    strengthScore: 72,
    editedByUser: false,
    brandVersion: 3,
    intelligenceVersion: 7,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * A storyboard context, derived from the creative context and direction fakes so
 * the two stay in step: a change to the direction fake cannot leave the storyboard
 * context describing a different product.
 */
export function makeStoryboardContext(
  overrides: {
    mode?: CreativeMode;
    assets?: CreativeContextAsset[];
    evidence?: CreativeContextEvidence[];
    claims?: CreativeContextProduct["claims"];
    features?: StoryboardContextFeature[];
    workflows?: StoryboardContextWorkflow[];
    browserCaptures?: StoryboardContextBrowserCapture[];
    targetDurationMs?: number;
    requirements?: Partial<StoryboardContextRequirements>;
    direction?: Partial<StoryboardContextDirection>;
  } = {},
): StoryboardContext {
  const mode = overrides.mode ?? "BALANCED";
  const creative = makeCreativeContext({
    mode,
    assets: overrides.assets,
    evidence: overrides.evidence,
    claims: overrides.claims,
  });
  const direction = makeCreativeDirection({ mode, ...overrides.direction });
  const targetDurationMs = overrides.targetDurationMs ?? 30_000;

  return {
    projectId: creative.projectId,
    intentId: creative.intentId,
    directionId: direction.id,
    mode,
    policy: creative.policy,
    requirements: {
      targetDurationMs,
      aspectRatio: creative.intent.aspectRatio,
      platforms: creative.intent.platforms,
      language: creative.intent.language,
      tone: creative.intent.tone,
      style: creative.intent.style,
      channel: creative.intent.channel,
      contentTypeName: creative.intent.contentTypeName,
      rawRequest: creative.intent.rawRequest,
      audience: creative.intent.audience,
      cta: direction.cta,
      ...overrides.requirements,
    },
    direction: {
      id: direction.id,
      name: direction.name,
      angle: direction.angle,
      mode: direction.mode,
      creativeRunId: direction.creativeRunId,
      thesis: direction.thesis,
      hook: direction.hook,
      audienceAngle: direction.audienceAngle,
      emotionalAngle: direction.emotionalAngle,
      narrativeSummary: direction.narrativeSummary,
      visualStrategy: direction.visualStrategy,
      proofStrategy: direction.proofStrategy,
      voiceDirection: direction.voiceDirection,
      musicDirection: direction.musicDirection,
      soundDirection: direction.soundDirection,
      cta: direction.cta,
      rationale: direction.rationale,
    },
    product: {
      name: creative.product.name,
      description: creative.product.description,
      valueProposition: creative.product.valueProposition,
      audienceSummary: creative.product.audienceSummary,
      features:
        overrides.features ??
        creative.product.features.map((feature) => ({ ...feature, evidenceIds: ["ev_1"] })),
      workflows:
        overrides.workflows ??
        creative.product.workflows.map((workflow) => ({
          id: workflow.id,
          name: workflow.name,
          description: workflow.name,
          steps: workflow.steps.map((action, index) => ({
            id: `${workflow.id}_s${index}`,
            order: index,
            action,
            description: action,
            featureIds: [],
          })),
          featureIds: [],
          evidenceIds: ["ev_1"],
        })),
      problems: creative.product.problems,
      benefits: creative.product.benefits,
      claims: creative.product.claims,
    },
    brand: {
      name: creative.brand.name,
      positioning: creative.product.valueProposition,
      tagline: "",
      voiceSummary: creative.brand.executionSummary,
      tone: creative.brand.tone,
      visualStyle: creative.brand.style.join(", "),
      colors: [],
      fonts: [],
      preferredTerms: [],
      avoidTerms: [],
      version: creative.brand.version,
    },
    assets: creative.assets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      type: asset.type,
      role: asset.role ?? null,
      isProductUi: asset.isProductUi,
      width: null,
      height: null,
      durationMs: null,
      origin: asset.origin,
    })),
    evidence: creative.evidence.map((item) => ({
      id: item.id,
      kind: item.kind,
      locator: item.locator,
      snippet: item.snippet,
      claimIds: item.claimIds,
    })),
    browserCaptures: overrides.browserCaptures ?? [],
    brandVersion: creative.brandVersion,
    intelligenceVersion: creative.intelligenceVersion,
  };
}

/** A plan wrapped as a storyboard, with the parts a service would fill in. */
export function makeStoryboard(
  context: StoryboardContext = makeStoryboardContext(),
  overrides: Partial<Storyboard> = {},
): Storyboard {
  const now = new Date().toISOString();
  const plan = planStoryboard({ context, idPrefix: "sbtest" });
  return {
    id: createId("sb"),
    projectId: context.projectId,
    intentId: context.intentId,
    directionId: context.directionId,
    name: "Storyboard",
    status: "DRAFT",
    targetDurationMs: context.requirements.targetDurationMs,
    actualDurationMs: plan.actualDurationMs,
    aspectRatio: context.requirements.aspectRatio,
    platforms: context.requirements.platforms,
    brandVersion: context.brandVersion,
    intelligenceVersion: context.intelligenceVersion,
    creativeRunId: "crun_1",
    version: 1,
    scenes: plan.scenes,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * An in-memory storyboard store.
 *
 * The selection and lock rules are implemented rather than stubbed, because those
 * rules are what the service is being tested against: a test that used a fake
 * which simply set `status` would pass against a service that forgot to demote the
 * other plans, and that is exactly the bug worth catching.
 */
export class FakeStoryboardRepository implements StoryboardRepository {
  boards = new Map<string, Storyboard>();

  async create(input: CreateStoryboardInput): Promise<Storyboard> {
    const now = new Date().toISOString();
    const storyboard: Storyboard = {
      ...input,
      id: input.id ?? createId("sb"),
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
    };
    this.boards.set(storyboard.id, storyboard);
    return storyboard;
  }

  async getById(id: string): Promise<Storyboard | null> {
    return this.boards.get(id) ?? null;
  }

  async listByProject(
    projectId: string,
    options: ListStoryboardsOptions = {},
  ): Promise<Storyboard[]> {
    return [...this.boards.values()]
      .filter((board) => board.projectId === projectId)
      .filter((board) => (options.intentId ? board.intentId === options.intentId : true))
      .filter((board) =>
        options.directionId ? board.directionId === options.directionId : true,
      )
      .filter((board) => (options.status ? board.status === options.status : true))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, options.limit ?? Number.MAX_SAFE_INTEGER);
  }

  async listByIntent(intentId: string): Promise<Storyboard[]> {
    return [...this.boards.values()]
      .filter((board) => board.intentId === intentId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async update(
    id: string,
    patch: UpdateStoryboardInput,
  ): Promise<Storyboard | null> {
    const current = this.boards.get(id);
    if (!current) return null;
    const updated: Storyboard = {
      ...current,
      ...patch,
      id,
      updatedAt: patch.updatedAt ?? current.updatedAt,
    };
    this.boards.set(id, updated);
    return updated;
  }

  async lock(
    id: string,
    updatedAt: string,
  ): Promise<{ storyboard: Storyboard; archived: Storyboard[] } | null> {
    const current = this.boards.get(id);
    if (!current) return null;

    const archived: Storyboard[] = [];
    for (const board of this.boards.values()) {
      const selected = board.intentId === current.intentId && board.status === "SELECTED";
      if (selected && board.id !== id) {
        const demoted = { ...board, status: "ARCHIVED" as const, updatedAt };
        this.boards.set(board.id, demoted);
        archived.push(demoted);
      }
    }

    const locked: Storyboard = { ...current, status: "LOCKED", updatedAt };
    this.boards.set(id, locked);
    return { storyboard: locked, archived };
  }

  async selectForIntent(
    id: string,
    updatedAt: string,
  ): Promise<{ storyboard: Storyboard; demoted: Storyboard[] } | null> {
    const current = this.boards.get(id);
    if (!current) return null;

    const demoted: Storyboard[] = [];
    for (const board of this.boards.values()) {
      const selected = board.intentId === current.intentId && board.status === "SELECTED";
      if (selected && board.id !== id) {
        const dropped = { ...board, status: "DRAFT" as const, updatedAt };
        this.boards.set(board.id, dropped);
        demoted.push(dropped);
      }
    }

    const selected: Storyboard = { ...current, status: "SELECTED", updatedAt };
    this.boards.set(id, selected);
    return { storyboard: selected, demoted };
  }

  async getLockedForIntent(intentId: string): Promise<Storyboard | null> {
    return (
      [...this.boards.values()].find(
        (board) => board.intentId === intentId && board.status === "LOCKED",
      ) ?? null
    );
  }
}
