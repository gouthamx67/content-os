import { describe, expect, it } from "vitest";

import { ProjectService } from "./project-service";

import { InMemoryProjectRepository } from "../../infrastructure/repositories/in-memory-project-repository";

describe("ProjectService", () => {
  it("creates a project", async () => {
    const repository =
      new InMemoryProjectRepository();

    const service =
      new ProjectService(repository);

    const project = await service.create({
      name: "Demo Product",
    });

    expect(project.name).toBe("Demo Product");

    expect(project.status).toBe("created");

    expect(project.sources).toEqual([]);

    expect(project.assets).toEqual([]);
  });

  it("creates sources with IDs", async () => {
    const repository =
      new InMemoryProjectRepository();

    const service =
      new ProjectService(repository);

    const project = await service.create({
      name: "Demo",

      sources: [
        {
          type: "website",
          name: "Demo Website",
          uri: "https://example.com",
        },
      ],
    });

    expect(project.sources).toHaveLength(1);

    expect(project.sources[0].id).toBeTruthy();

    expect(project.sources[0].type).toBe("website");

    expect(project.sources[0].uri).toBe(
      "https://example.com",
    );
  });
});