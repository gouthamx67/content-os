import { describe, expect, it } from "vitest";
import { WorkspaceService } from "./workspace-service";
import {
  FakeWorkspaceRepository,
  makeUserId,
  makeWorkspaceId,
} from "../../testing/fakes";

function createService() {
  const workspaces = new FakeWorkspaceRepository();

  const service = new WorkspaceService(workspaces);

  return { workspaces, service };
}

async function seedOwner(
  service: WorkspaceService,
  workspaces: FakeWorkspaceRepository,
  name = "Design",
) {
  const workspaceId = makeWorkspaceId();

  const ownerUserId = makeUserId();

  const workspace = await workspaces.createWithOwner({
    workspaceId,
    name,
    ownerUserId,
    memberId: makeWorkspaceId(),
  });

  return { workspace, ownerUserId };
}

describe("WorkspaceService", () => {
  it("lists only the workspaces a user belongs to", async () => {
    const { workspaces, service } = createService();

    const { workspace, ownerUserId } = await seedOwner(
      service,
      workspaces,
    );

    const outsiderId = makeUserId();

    await workspaces.addMember({
      id: makeWorkspaceId(),
      workspaceId: workspace.id,
      userId: makeUserId(),
      role: "MEMBER",
    });

    const results = await service.listForUser(ownerUserId);

    expect(results).toHaveLength(1);

    expect(results[0].workspace.name).toBe("Design");

    await expect(
      service.listForUser(outsiderId),
    ).resolves.toHaveLength(0);
  });

  it("grants access to a member but rejects outsiders", async () => {
    const { workspaces, service } = createService();

    const { workspace, ownerUserId } = await seedOwner(
      service,
      workspaces,
    );

    const memberId = makeUserId();

    await workspaces.addMember({
      id: makeWorkspaceId(),
      workspaceId: workspace.id,
      userId: memberId,
      role: "MEMBER",
    });

    await expect(
      service.requireMembership(workspace.id, memberId),
    ).resolves.toMatchObject({ role: "MEMBER" });

    await expect(
      service.requireMembership(workspace.id, "outsider-id"),
    ).rejects.toMatchObject({
      name: "HttpError",
      status: 403,
    });

    await expect(
      service.get(workspace.id, ownerUserId),
    ).resolves.toMatchObject({
      workspace: { id: workspace.id },
    });
  });

  it("enforces role requirements on membership actions", async () => {
    const { workspaces, service } = createService();

    const { workspace, ownerUserId } = await seedOwner(
      service,
      workspaces,
    );

    await workspaces.addMember({
      id: makeWorkspaceId(),
      workspaceId: workspace.id,
      userId: makeUserId(),
      role: "OWNER",
    });

    const adminId = makeUserId();

    await workspaces.addMember({
      id: makeWorkspaceId(),
      workspaceId: workspace.id,
      userId: adminId,
      role: "ADMIN",
    });

    const memberId = makeUserId();

    await workspaces.addMember({
      id: makeWorkspaceId(),
      workspaceId: workspace.id,
      userId: memberId,
      role: "MEMBER",
    });

    await expect(
      service.addMember(workspace.id, memberId, {
        userId: makeUserId(),
        role: "MEMBER",
      }),
    ).rejects.toMatchObject({ status: 403 });

    await expect(
      service.addMember(workspace.id, adminId, {
        userId: makeUserId(),
        role: "OWNER",
      }),
    ).rejects.toMatchObject({ status: 403 });

    const added = await service.addMember(workspace.id, adminId, {
      userId: makeUserId(),
      role: "MEMBER",
    });

    expect(added.role).toBe("MEMBER");

    await expect(
      service.updateMemberRole(
        workspace.id,
        memberId,
        adminId,
        "OWNER",
      ),
    ).rejects.toMatchObject({ status: 403 });

    await expect(
      service.updateMemberRole(
        workspace.id,
        adminId,
        ownerUserId,
        "MEMBER",
      ),
    ).rejects.toMatchObject({ status: 403 });

    const updated = await service.updateMemberRole(
      workspace.id,
      ownerUserId,
      memberId,
      "ADMIN",
    );

    expect(updated.role).toBe("ADMIN");
  });

  it("prevents removing the last owner", async () => {
    const { workspaces, service } = createService();

    const { workspace, ownerUserId } = await seedOwner(
      service,
      workspaces,
    );

    await expect(
      service.removeMember(workspace.id, ownerUserId, ownerUserId),
    ).rejects.toMatchObject({ status: 400 });

    await expect(workspaces.members.size).toBe(1);
  });

  it("returns a 404 for unknown members when changing roles", async () => {
    const { workspaces, service } = createService();

    const { workspace, ownerUserId } = await seedOwner(
      service,
      workspaces,
    );

    await expect(
      service.updateMemberRole(
        workspace.id,
        ownerUserId,
        "missing-user",
        "ADMIN",
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("creates a workspace with the creator as owner", async () => {
    const { service } = createService();

    const userId = makeUserId();

    const workspace = await service.create(userId, {
      name: "  Launch Team  ",
    });

    expect(workspace.name).toBe("Launch Team");

    const membership = await service.getMembership(
      workspace.id,
      userId,
    );

    expect(membership?.role).toBe("OWNER");
  });

  it("rejects an empty workspace name", async () => {
    const { service } = createService();

    await expect(
      service.create(makeUserId(), { name: "   " }),
    ).rejects.toMatchObject({
      name: "HttpError",
      status: 400,
    });
  });
});