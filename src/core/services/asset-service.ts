import type { Asset } from "../domain/asset";
import type {
  AssetRepository,
  CreateAssetInput,
} from "../ports";
import { createId } from "../../lib/id";
import { HttpError } from "../../lib/http";
import type { ProjectService } from "./project-service";

export class AssetService {
  constructor(
    private readonly assets: AssetRepository,
    private readonly projects: ProjectService,
  ) {}

  async list(
    projectId: string,
    userId: string,
  ): Promise<Asset[]> {
    await this.projects.getAuthorized(projectId, userId);

    return this.assets.listByProject(projectId);
  }

  async create(
    projectId: string,
    input: Omit<CreateAssetInput, "id" | "projectId">,
    userId: string,
  ): Promise<Asset> {
    await this.projects.getAuthorized(projectId, userId);

    return this.assets.create({
      ...input,
      id: createId("asset"),
      projectId,
    });
  }

  async remove(
    projectId: string,
    assetId: string,
    userId: string,
  ): Promise<void> {
    await this.projects.getAuthorized(projectId, userId);

    const asset = await this.assets.getById(assetId);

    if (!asset || asset.projectId !== projectId) {
      throw new HttpError(404, "Asset not found");
    }

    await this.assets.deleteById(assetId);
  }
}