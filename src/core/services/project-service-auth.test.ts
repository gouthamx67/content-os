import { describe, expect, it } from "vitest";
import { ProjectService } from "./project-service";
import { InMemoryProjectRepository } from "../../infrastructure/repositories/in-memory-project-repository";
import {
  FakeWorkspaceRepository,
  makeUserId,
  makeWorkspaceId,
} from "../../testing/fakes";

async function createScenario() {
  const projects = new InMemoryProjectRepository();

  const workspaces = new FakeWorkspaceRepository();

  const workspaceId = makeWorkspaceId();

  const ownerId = makeUserId();

  const memberId = makeUserId();

  const outsiderId = makeUserId();

  await workspaces.createWithOwner({
    workspaceId,
    name: "Design",
    ownerUserId: ownerId,
    memberId: makeWorkspaceId(),
  });

  await workspaces.addMember({
    id: makeWorkspaceId(),
    workspaceId,
    userId: memberId,
    role: "MEMBER",
  });

  const service = new ProjectService(
    projects,
    (workspace, user) =>
      workspaces.getMembership(workspace, user),
    async (user) =>
      (await workspaces.listForUser(user)).map(
        (membership) => membership.workspaceId,
      ),
  );

  return {
    projects,
    workspaces,
    workspaceId,
    ownerId,
    memberId,
    outsiderId,
    service,
  };
}

describe("ProjectService (workspace-authorized)", () => {
  it("creates a project in a workspace for any member", async () => {
    const { workspaceId, memberId, service } =
      await createScenario();

    const project = await service.createForWorkspace(
      workspaceId,
      { name: "Refresh" },
      memberId,
    );

    expect(project.workspaceId).toBe(workspaceId);

    expect(project.archived).toBe(false);
  });

  it("rejects project creation outside a workspace", async () => {
    const { workspaceId, outsiderId, service } =
      await createScenario();

    await expect(
      service.createForWorkspace(
        workspaceId,
        { name: "Nope" },
        outsiderId,
      ),
    ).rejects.toMatchObject({
      name: "HttpError",
      status: 403,
    });
  });

  it("gives members read access to workspace projects", async () => {
    const { workspaceId, ownerId, memberId, service } =
      await createScenario();

    const project = await service.createForWorkspace(
      workspaceId,
      { name: "Refresh" },
      ownerId,
    );

    const listed = await service.listForWorkspace(
      workspaceId,
      memberId,
    );

    expect(listed).toHaveLength(1);

    expect(listed[0].id).toBe(project.id);

    await expect(
      service.getAuthorized(project.id, memberId),
    ).resolves.toMatchObject({ name: "Refresh" });
  });

  it("denies read access to non-members", async () => {
    const { workspaceId, ownerId, outsiderId, service } =
      await createScenario();

    const project = await service.createForWorkspace(
      workspaceId,
      { name: "Refresh" },
      ownerId,
    );

    await expect(
      service.getAuthorized(project.id, outsiderId),
    ).rejects.toMatchObject({ status: 403 });

    await expect(
      service.listForWorkspace(workspaceId, outsiderId),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("prevents members from renaming and archiving projects", async () => {
    const { workspaceId, ownerId, memberId, projects, service } =
      await createScenario();

    const project = await service.createForWorkspace(
      workspaceId,
      { name: "Refresh" },
      ownerId,
    );

    await expect(
      service.updateAuthorized(
        project.id,
        { name: "Hacked" },
        memberId,
      ),
    ).rejects.toMatchObject({ status: 403 });

    await expect(
      service.archive(project.id, memberId),
    ).rejects.toMatchObject({ status: 403 });

    await expect(
      projects.getById(project.id),
    ).resolves.toMatchObject({
      name: "Refresh",
      archived: false,
    });
  });

  it("lets owners archive and restore projects", async () => {
    const { workspaceId, ownerId, service } =
      await createScenario();

    const project = await service.createForWorkspace(
      workspaceId,
      { name: "Refresh" },
      ownerId,
    );

    const archived = await service.archive(project.id, ownerId);

    expect(archived.archived).toBe(true);

    const restored = await service.restore(project.id, ownerId);

    expect(restored.archived).toBe(false);
  });

  it("lets owners rename projects", async () => {
    const { workspaceId, ownerId, service } =
      await createScenario();

    const project = await service.createForWorkspace(
      workspaceId,
      { name: "Refresh" },
      ownerId,
    );

    const updated = await service.updateAuthorized(
      project.id,
      { name: "  Rebrand  " },
      ownerId,
    );

    expect(updated.name).toBe("Rebrand");
  });

  it("lists a user's projects across their workspaces", async () => {
    const { service, projects, workspaces, ownerId, workspaceId } =
      await createScenario();

    await service.createForWorkspace(
      workspaceId,
      { name: "One" },
      ownerId,
    );

    const secondWorkspaceId = makeWorkspaceId();

    await workspaces.createWithOwner({
      workspaceId: secondWorkspaceId,
      name: "Launch",
      ownerUserId: ownerId,
      memberId: makeWorkspaceId(),
    });

    const second = await service.createForWorkspace(
      secondWorkspaceId,
      { name: "Two" },
      ownerId,
    );

    expect(second.workspaceId).toBe(secondWorkspaceId);

    const names = (await service.listForUser(ownerId))
      .map((project) => project.name)
      .sort();

    expect(names).toEqual(["One", "Two"]);

    await expect(projects.list()).resolves.toHaveLength(2);
  });

  it("does not leak another user's workspaces into listForUser", async () => {
    const { service, ownerId, outsiderId, workspaceId } =
      await createScenario();

    await service.createForWorkspace(
      workspaceId,
      { name: "One" },
      ownerId,
    );

    await expect(
      service.listForUser(outsiderId),
    ).resolves.toEqual([]);
  });
});